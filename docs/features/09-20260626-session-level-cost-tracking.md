**Status:** 🟢 Active

# Session-Level Cost Tracking

**Topic:** usage / features / status-bar / byok / vscode-api
**Updated:** 2026-06-26
**Tags:** #usage #features #session #copilotCredits #byok #vscode #estimation
**Supersedes:** —

---

## Overview

Each chat thread now accumulates its own cost, request count, and token usage, visible in the status bar tooltip, usage QuickPick, and usage webview. The status bar tooltip and QuickPick also report per-request credits (`copilotCredits`) so VS Code can theoretically accumulate session cost in its native session info popover (currently blocked by a VS Code limitation for BYOK providers).

Session cost is an **estimate** derived from the same local pricing data used for subscription totals. It does not match the exact server-side billed amount. An `(est)` marker is shown wherever session cost appears.

---

## Background

### Why this was needed

Before PR #55, the status bar showed subscription-level totals (5h/weekly/monthly) but no per-session breakdown. Copilot Chat shows session cost in the session info popover and tooltip. Users asked for feature parity: "How much did this particular conversation cost?"

### Design constraints

1. **No thread identifier from VS Code.** `ProvideLanguageModelChatResponseOptions` exposes `requestInitiator` and `modelConfiguration` only. No `sessionId`, `threadId`, or `activeChatSessionId` field exists.
2. **`x-opencode-session` header** is already resolved by `buildOpenCodeRequestHeaders()` for sticky routing. It hashes the first 3 messages + model ID, giving a stable identifier per conversation thread. Reused as the session key.
3. **Cost is an estimate.** The extension-tracked cost uses `estimateCost(modelId, prompt, completion, cached)` with model pricing from `models.dev` or the bundled table. Server-side cache affinity, rate-limit rebates, and CLI/TUI usage are invisible. This is the same limitation as the subscription totals (see issue #23, tracked in issue #59 for a SQLite-based fix).

### VS Code `copilotCredits` mechanism

VS Code 1.126 accumulates session cost by reading `usage.copilotCredits` from `IChatUsage` progress events (`{ kind: 'usage', copilotCredits: ... }`). For the built-in `copilot` vendor, the Copilot extension's `ToolCallingLoop` emits this after each model fetch. For BYOK providers, the standard mechanism is a `LanguageModelDataPart` with MIME `"usage"` emitted at the end of the response stream. Both `AnthropicLMProvider` and `GeminiNativeProvider` (Copilot's own BYOK providers) use this pattern.

**Known limitation:** VS Code 1.126's `ChatService.acceptResponseProgress()` does not convert `LanguageModelDataPart({ type: 'data', mimeType: 'usage' })` from BYOK provider streams into `IChatUsage` progress events. The data is correctly structured; the plumbing stops at the `ChatService` boundary for non-Copilot vendors. This is expected to be fixed in a future VS Code release.

---

## Implementation

### Session cost accumulation

```typescript
// goUsageTracker.ts
interface SessionCostSummary {
  sessionId: string;
  cost: number; // USD
  requests: number;
  promptTokens: number;
  completionTokens: number;
  lastActivity: number; // Date.now()
}
```

Each `record()` call accumulates into a `Map<string, SessionCostSummary>` keyed by `sessionId`:

```typescript
if (summary.sessionId) {
  const existing = this.sessionCosts.get(summary.sessionId);
  if (existing) {
    existing.cost += cost;
    existing.requests++;
    existing.promptTokens += prompt;
    existing.completionTokens += completion;
    existing.lastActivity = Date.now();
  } else {
    this.sessionCosts.set(summary.sessionId, { ... });
  }
  this.pruneSessions();
}
```

### Session pruning

| Parameter         | Value                                          | Purpose                                  |
| ----------------- | ---------------------------------------------- | ---------------------------------------- |
| `SESSION_IDLE_MS` | 2 hours                                        | Remove sessions with no activity for >2h |
| `MAX_SESSIONS`    | 50                                             | Hard cap on total session count          |
| Storage           | `globalState` key `opencodego.sessionCosts.v1` | Survives VS Code restarts                |

Pruning runs on every `record()` call. Idle sessions are removed first, then oldest-by-`lastActivity` if still over cap.

### Session lookup

`getCurrentSessionCost()` returns the session with the most recent `lastActivity`. This is a **global** lookup, not scoped to the active chat panel. When multiple panels are open, the QuickPick/tooltip shows the most recently active session, regardless of which panel the user is looking at. The label "Latest Session (est)" reflects this behavior accurately.

### Shared cost helper (PR #55 revision)

Before PR #55 revision, cost was computed twice: inline in `extension.ts`'s `onTransportSummary`, and again in `goUsageTracker.record()` via `estimateCost()`. The two formulas could drift.

The fix exports `estimateCost()` from `goUsageTracker.ts` and calls it from both sites:

```typescript
// extension.ts (onTransportSummary)
const cost = estimateCost(summary.modelId, prompt, completion, cached, metadata.cost);
summary.copilotCredits = cost * 100; // 1 credit = $0.01

// goUsageTracker.ts (record)
const cost = estimateCost(summary.modelId, prompt, completion, cached, externalCost, this.costResolver);
const copilotCredits = cost * 100;
```

Both paths now use the same `estimateCost()` function, eliminating drift.

### `copilotCredits` plumbing

Credits flow through four layers, so the usage data part emitted at the end of each response includes the credit total:

```
estimateCost() → cost × 100 → summary.copilotCredits
                  ↓
         TransportRequestSummary.copilotCredits
                  ↓
         UsageSnapshot.copilotCredits
                  ↓
         ProviderUsagePayload.copilotCredits
                  ↓
         LanguageModelDataPart({ copilotCredits }, "usage")
                  ↓
         UsageLogEntry.copilotCredits
```

### `onTransportSummary` reordering

In `streaming.ts`, `onTransportSummary` is now called **before** the usage `DataPart` array is built. This lets callers (like `extension.ts`) mutate the summary (e.g., add `copilotCredits`) so the enriched value is included in the emitted data parts. Previously the callback ran after data parts were already constructed.

```
┌─────────────────────────────────────────┐
│  streamOpenCodeResponse()               │
│  1. Build summary                       │
│  2. options.onTransportSummary(summary)  │  ← moved BEFORE step 3
│  3. Build usageParts from summary       │
│  4. Emit usageParts to progress         │
│  5. Record in goUsageTracker            │
└─────────────────────────────────────────┘
```

### UI surfaces

| Surface                      | What it shows                                                             | Condition                            |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| **Status bar tooltip (SVG)** | `Session (est): $0.0042  Requests: 3  Tokens: 4.2K` above Today/Yesterday | Session has ≥1 request with cost > 0 |
| **QuickPick (icon menu)**    | `💬 Latest Session (est)` item in Daily Summary section                   | Same condition                       |
| **Usage webview (SVG)**      | Same SVG card as tooltip                                                  | Same condition                       |

SVG card height adjusts dynamically: `310px` with session data, `286px` without. Card width widens from `330px` to `345px` when session data is present to fit the longer `Session (est):` label.

---

## Unit Tests

PR #55 added 35 tests in `src/test/goUsageTracker.test.ts` (test count: 40 → 75).

| Test group                           | Cases                                                           |
| ------------------------------------ | --------------------------------------------------------------- |
| `estimateCost()`                     | Pricing lookup, cache_read fallback, unknown model, zero tokens |
| `record()` accumulation              | Cost +=, requests++, promptTokens/completionTokens sum          |
| `getCurrentSessionCost()`            | Single session, multi-session (returns latest), empty state     |
| `getRecentSessionCosts()`            | Ordering by lastActivity, limit parameter                       |
| State restoration from `globalState` | Persist + restore round-trip, corrupt data handling             |
| Idle session pruning                 | Sessions older than 2h removed, recent sessions kept            |
| 50-session cap                       | Excess sessions pruned by oldest lastActivity                   |
| Edge cases                           | Zero tokens, unknown model IDs, missing sessionId               |

---

## Files Changed

| File                              | Change                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/goUsageTracker.ts`           | `estimateCost` exported, `SessionCostSummary` interface, session Map accumulation, `pruneSessions()`, `getCurrentSessionCost()`, `getRecentSessionCosts()`, session persistence/restore                  |
| `src/extension.ts`                | `copilotCredits` computation in `onTransportSummary`, session cost in QuickPick, session cost in SVG tooltip/webview, `buildUsageTooltip()`/`buildUsageTooltipSvg()` accept optional `sessionCost` param |
| `src/streaming.ts`                | `copilotCredits` added to `TransportRequestSummary`, `onTransportSummary` moved before data part creation                                                                                                |
| `src/usage.ts`                    | `copilotCredits` added to `UsageSnapshot` and `ProviderUsagePayload`                                                                                                                                     |
| `src/test/goUsageTracker.test.ts` | **New** — 35 unit tests                                                                                                                                                                                  |
| `CHANGELOG.md`                    | Added + Known Issue entries                                                                                                                                                                              |

---

## Known Issues

### VS Code session info popover does not show cost for BYOK providers

VS Code 1.126 accumulates session cost by reading `usage.copilotCredits` from `IChatUsage` progress events. The Copilot extension's `ToolCallingLoop` calls `stream.usage({ copilotCredits })` after each model fetch, which produces the correct event. For BYOK providers, the extension emits a `LanguageModelDataPart` with MIME `"usage"` (the standard mechanism), but VS Code's `ChatService.acceptResponseProgress()` does not convert BYOK usage data parts into `IChatUsage` events. Session cost is visible in the extension's own status bar tooltip and QuickPick; it is not visible in VS Code's native session info popover (the "ring" below the chat input). Expected to be fixed in a future VS Code release.

### Session cost is an estimate, not the billed amount

`getSummary()` returns `buildSummaryFromTracked(...)`, the local estimate. `buildSummaryFromRows()` (the SQLite reader) exists but is dead code: only the unused `hasSQLiteData` getter calls it. The status bar shows the local number, which can diverge from what OpenCode actually bills. The server-side cache affinity and CLI/TUI usage are invisible to the extension. Tracked in issue #59.

---

## Follow-up

- **Issue #59:** Wire SQLite reader (`readOpenCodeHistory` / `buildSummaryFromRows`) into `getSummary()` for subscription-level totals.
- **VS Code API gap:** `ProvideLanguageModelChatResponseOptions` has no `sessionId` / `threadId` / `activeChatSessionId` field. `getCurrentSessionCost()` uses global most-recent-by-`lastActivity` rather than the focused thread. This limitation will persist until VS Code exposes a stable chat thread identifier.
