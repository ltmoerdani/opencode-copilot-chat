**Status:** ✅ Solved (server-accurate since PR #132)

# Go Usage Tracker — Feature Implementation

**Topic:** usage / features / status-bar / provider / tracking
**Updated:** 2026-11-26
**Tags:** #usage #features #status-bar #go-usage #pricing #byok #sqlite #server-sync
**Supersedes:** —

---

## Overview

Implemented a real-time Go subscription usage tracker that displays 5-hour rolling, weekly, and monthly limit percentages in the VS Code status bar. The feature was triggered by a GitHub user request to display daily, weekly, and monthly limits as percentages.

> **Evolution (2026-08-13):** Originally this tracker estimated cost client-side from token counts × model pricing because (at the time) no OpenCode REST API existed for billing/usage. That conclusion is **superseded**: upstream shipped an official `GET /zen/go/v1/usage` endpoint (2026-08-11) and the tracker now syncs server-accurate, account-wide meters from it (PR #132). This doc keeps the original local-tracker design history, then adds the SQLite (PR #60) and server-sync (PR #132) evolution sections below.
>
> **Evolution (2026-08-13, PR #138):** the usage feature grew into a full realtime dashboard — Today/Yesterday/Codebase rows merging CLI history, permanent tracking, `node:sqlite` reads (no binary dependency), compact K/M/B/T formatting, and a full-page webview panel. See the living reference [`16-20260813-usage-dashboard-realtime.md`](16-20260813-usage-dashboard-realtime.md).

---

## Background

### User Request (GitHub)

> "Thanks for the great extension! It would be great to display the daily, weekly, and monthly limits for GO subscriptions as a percentage, as well as the amount spent per day."

### Research Findings

1. **No REST API** — OpenCode does not expose `/usage`, `/billing`, `/subscription`, `/quota`, or any public endpoint for usage data. All billing functions (`validateBilling()`, `queryLiteSubscription`) are server-side only.

2. **OpenUsage (github.com/robinebers/openusage)** — Uses 100% client-side approach:
   - Reads `~/.local/share/opencode/opencode.db` (SQLite) for server-computed `cost` field
   - Hardcodes limits from docs: $12/5h, $30/week, $60/month
   - Calculates percentages client-side

3. **OpenCode Go Pricing** — Full per-model pricing available at `opencode.ai/docs/go`:
   - Input, output, and cache_read prices per 1M tokens
   - 18+ models with pricing data

### UX Design Decision

User requested a design similar to Copilot's usage indicator:

- **Status bar icon** (bottom-right) — always visible, compact text
- **Click → Quick Pick panel** — detailed breakdown with progress bars

Final status bar format: `Go: 27%·62%·75%` (5h·weekly·monthly)
Warning threshold at >80%: `Go: 27%·83%⚠·75%`

---

## Implementation

### New File: `src/goUsageTracker.ts`

Complete usage tracking module (~500 lines):

| Component                      | Detail                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `GO_LIMITS`                    | `$12` (5h rolling), `$30` (weekly Mon–Mon UTC), `$60` (monthly anchor-based)        |
| `GO_MODEL_PRICING`             | 18+ models with input/output/cache_read per 1M token prices                         |
| `UsageLogEntry`                | Per-request: timestamp, modelId, cost, promptTokens, completionTokens, cachedTokens |
| `estimateCost()`               | Calculates USD from token counts × model pricing                                    |
| `GoUsageTracker`               | Main class — record entries, build period summaries, persist to globalState         |
| `record()`                     | Captures `TransportRequestSummary` data after each Go request                       |
| `getSummary()`                 | Returns `UsageSummary` with session/weekly/monthly periods                          |
| `buildSummaryFromTracked()`    | Aggregates tracked entries by time window                                           |
| `buildSummaryFromRows()`       | Aggregates SQLite rows (optional enrichment)                                        |
| `formatGoUsageStatusBarText()` | Compact `Go: XX%·XX%·XX%` format                                                    |
| `formatGoUsageTooltip()`       | Multi-line tooltip with dollar amounts and reset times                              |
| `buildUsageQuickPickItems()`   | Quick Pick items with progress bars                                                 |

### Changes to `src/extension.ts`

| Change                        | Detail                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Import `GoUsageTracker`       | Plus formatting and Quick Pick helper functions                                |
| Module variables              | `goUsageStatusBarItem`, `goUsageTracker`                                       |
| `activate()`                  | Initialize tracker, create status bar item, register command                   |
| `onTransportSummary` callback | Gate on `this.definition.vendor === GO_VENDOR`, call `goUsageTracker.record()` |
| `ensureGoUsageStatusBar()`    | Creates right-aligned status bar item at priority 94                           |
| `refreshGoUsageStatusBar()`   | Updates text/tooltip from tracker summary                                      |
| `showGoUsagePanel()`          | Quick Pick with progress bars, today/yesterday, actions                        |
| SQLite reader                 | Optional enrichment from `~/.local/share/opencode/opencode.db`                 |

### Changes to `package.json`

- Version bumped to `0.2.0`
- Command registered: `opencodego.showUsage`
- Activation event for the command

### Cost Calculation Logic

```typescript
cost = (billablePrompt × pricing.input + completionTokens × pricing.output
        + cachedTokens × pricing.cache_read) / 1_000_000

// billablePrompt = max(0, promptTokens - cachedTokens)
```

### Time Window Logic

| Period      | Window                                   | Reset Calculation           |
| ----------- | ---------------------------------------- | --------------------------- |
| **Session** | Rolling 5 hours                          | Oldest entry timestamp + 5h |
| **Weekly**  | UTC Monday 00:00 → next UTC Monday 00:00 | Next Monday 00:00 UTC       |
| **Monthly** | Anchor-based (oldest entry date)         | Next anchor date cycle      |

### Data Persistence

- Usage log stored in VS Code `globalState` under key `opencodego.usageLog.v1`
- Max 2000 entries, pruned to last 31 days
- Survives editor restarts

> **Known limitation (2026-11-26):** storing per-profile usage logs in `globalState` can trigger VS Code's "large extension state" warning. The reporter saw 632 KB; local verification with four profiles reached ~2 MB. A migration to `globalStorageUri`, with only a small index left in `globalState`, is **planned and not implemented**. See `docs/issues/128-20261126-gemini-thought-signature-and-triage.md` §Open follow-ups.

---

## Files Changed

| File                    | Change                                                    |
| ----------------------- | --------------------------------------------------------- |
| `src/goUsageTracker.ts` | **New** — Complete usage tracking module                  |
| `src/extension.ts`      | Status bar, command, recording callback, Quick Pick panel |
| `package.json`          | v0.2.0, new command registration                          |
| `CHANGELOG.md`          | `[0.2.0]` entry                                           |

## Verification

```bash
npx tsc --noEmit  # 0 errors
npx @vscode/vsce package --no-dependencies  # 106 KB VSIX
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.2.0.vsix --force
```

## Result

✅ Go Usage Tracker shipped in v0.2.0. Status bar shows `Go: XX%·XX%·XX%` at all times. Clicking opens Quick Pick with detailed breakdown. Usage persists across editor restarts. Works entirely client-side without requiring any external API or CLI installation.

---

## Follow-up

Status bar did not update after testing — see `docs/issues/13-20260605-go-usage-status-bar-not-updating.md` for the debugging session.

---

## SQLite-backed Cost Accuracy (PR #60, merged 2026-06-30)

**Status:** ✅ Solved | **Issue:** [#59](https://github.com/ltmoerdani/opencode-copilot-chat/issues/59) | **Contributor:** [@Wallacy](https://github.com/Wallacy)

### Problem

The original `getSummary()` returned `buildSummaryFromTracked(...)`, which estimated costs from locally recorded token counts × model pricing. This estimate drifted 9–15% from actual billing because it missed server-side cache affinity and CLI/TUI usage.

### Solution

`getSummary()` now tries SQLite first:

1. Calls `readOpenCodeHistory()` which reads `~/.local/share/opencode/opencode.db` via `sqlite3` CLI
2. Aggregates actual billed costs into subscription buckets (session 5h, weekly, monthly, today, yesterday)
3. Enriches today/yesterday with token/request counts from tracked entries (SQLite stores cost only)
4. Applies baselines on top of SQLite costs
5. Falls back to `buildSummaryFromTracked()` when no SQLite DB exists

New `UsageSummary` field: `sqliteAvailable: boolean` — indicates whether cost data comes from SQLite (actual billing) or local estimation.

```typescript
// getSummary() now tries SQLite first
const sqliteRows = readOpenCodeHistory();
if (sqliteRows) {
  return this.buildSqliteEnrichedSummary(nowMs, sqliteRows, clamp);
}
return this.buildSummaryFromTracked(nowMs, clamp);
```

### Data Flow

```text
opencode.db (SQLite)
  → readOpenCodeHistory() — sqlite3 CLI, 5s timeout
  → buildSummaryFromRows() — aggregate costs by time window
  → buildSqliteEnrichedSummary() — enrich with tracked tokens, apply baselines
  → UsageSummary { sqliteAvailable: true }
```

When SQLite is unavailable:

```text
Tracked entries (globalState)
  → buildSummaryFromTracked() — aggregate estimated costs
  → UsageSummary { sqliteAvailable: false }
```

### Key Design Decisions

- **SQLite as primary source:** When available, SQLite costs replace local estimates entirely. The `buildSummaryFromRows()` method (previously dead code) is now the primary aggregator.
- **Token enrichment from tracked entries:** SQLite stores cost only, not token counts. Today/yesterday token counts are enriched from the extension's tracked entries.
- **Baselines applied on top:** `buildSqliteEnrichedSummary()` applies baselines after SQLite aggregation, not during. This prevents double-counting.
- **Graceful fallback:** If `sqlite3` CLI is not installed or `opencode.db` doesn't exist, the extension falls back to local estimation with no breaking change.

### Files Changed

| File                    | Change                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/goUsageTracker.ts` | `buildSqliteEnrichedSummary()` method, `sqliteAvailable` field, SQLite-first logic in `getSummary()` |

### Related

- Issue doc: `docs/issues/30-20260630-pr60-sqlite-cost-deepseek-overflow.md`
- Original research: `docs/features/03-20260605-go-usage-tracker.md` §Research Findings

---

## Server-Accurate Go Usage via `/zen/go/v1/usage` (PR #132, merged 2026-08-12)

**Status:** ✅ Solved | **Issue:** [#130](https://github.com/ltmoerdani/opencode-copilot-chat/issues/130) | **PR:** [#132](https://github.com/ltmoerdani/opencode-copilot-chat/pull/132) by [@Fahad090NP](https://github.com/Fahad090NP) | **Upstream:** [anomalyco/opencode#16513](https://github.com/anomalyco/opencode/pull/16513)

### Problem

SQLite (#60) is still **per-machine** — it reads the local `opencode.db`, so CLI usage on other devices, other VS Code windows, and pre-install usage stay invisible. The meters still drifted from opencode.ai (the original issue #23 report).

### The unlock

Upstream merged an **official `GET /zen/go/v1/usage`** endpoint (live 2026-08-11) that returns server-accurate, account-wide rolling/weekly/monthly usage computed from the real subscription — authenticated with the same `opencode-go` key the extension already stores. This is the "Option D" (server sync) that June's research deemed impossible.

### Solution

New pure module `src/goUsageSync.ts` (+ unit tests):

| Function               | Role                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchGoUsage(apiKey)` | `GET /zen/go/v1/usage` with the stored Go key as a Bearer token. Failures classified (`no-key` / `unauthorized` / `no-subscription` / `not-found` / `network` / `invalid`) so callers can fall back. Key never logged or persisted. |
| `mergeServerUsage()`   | Overlays server rolling/weekly/monthly percent + `resetsAt` onto the local summary; `spent` derived from the authoritative percent. Today/Yesterday/per-session stay device-local.                                                  |

Tracker wiring (`src/goUsageTracker.ts`):

- `syncServerUsage(apiKey)` with a **60s TTL** (failures paced too, so a bad key can't hammer the API).
- `getSummary()` stays synchronous and overlays the cached server snapshot on top of the local summary.

Extension wiring (`src/extension.ts`): startup sync with the stored key; per-request re-sync using the exact key the request ran under (covers native BYOK group keys); background sync on status-bar refresh with repaint.

Bonus dialog fixes: wired the dead "Reset tracked usage data" action, stopped reset from collapsing the card to the first-run state (`everTracked` flag), wired the dead "Open OpenCode console" quick-pick, stabilized panel/hover card geometry.

### Current data flow (fallback chain)

```text
/zen/go/v1/usage (official, server-accurate, account-wide)
  → fetchGoUsage(apiKey) + mergeServerUsage()   [primary]
  → SQLite opencode.db (actual local billed amounts)   [fallback]
  → tracked estimates (token × pricing)   [last resort]
```

### Verification

- Endpoint verified live in production (401 shape matches upstream route source).
- `npm run lint` (strict, 7 steps incl. tsc) green; `npm test` 189/189 (incl. the fresh-install `hasData` regression test).
- Merge commit `4a14b1e` (2026-08-12T22:51:06Z); issue #130 closed 2026-08-12T22:51:07Z.

### Related

- Consolidated issue #23 timeline: `docs/issues/65-20260813-issue23-go-usage-status-sync.md`
- PR #132 doc: `docs/issues/62-20260812-pr132-go-usage-server-sync.md`
- Upstream endpoint: `anomalyco/opencode#16513`
- `globalState` growth triage: `docs/issues/128-20261126-gemini-thought-signature-and-triage.md`
