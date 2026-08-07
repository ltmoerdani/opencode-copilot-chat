**Status:** ✅ Solved

# PR #60 — SQLite-backed Cost Accuracy, DeepSeek Context Overflow Fix

**Topic:** usage / provider / bugfix / performance
**Updated:** 2026-07-02
**Tags:** #usage #sqlite #deepseek #context-window #sse #community
**Supersedes:** —

---

## Overview

PR #60 addresses two known issues and one cleanup in a single changeset:

1. **#59 — Subscription cost drift.** The usage tracker estimated costs locally from token counts × model pricing, but this drifted 9–15% from actual billing because it couldn't see server-side cache affinity or CLI/TUI usage. The OpenCode CLI writes actual billed amounts to `~/.local/share/opencode/opencode.db`, but the tracker never read it.

2. **DeepSeek context overflow (400 error).** When the prompt is large (e.g. 668K tokens on `deepseek-v4-flash`), the requested `max_tokens` (384K) combined with the prompt exceeded the 1048K context window, causing a 400 error from the provider.

3. **SSE log noise.** `[sse-stats]` logged unconditionally on every streamed response, adding noise to the Output channel.

**Documented:** 2026-07-02
**Fixed in:** v0.3.5 (PR [#60](https://github.com/ltmoerdani/opencode-copilot-chat/pull/60), merged 2026-06-30)
**Issues:** [#59](https://github.com/ltmoerdani/opencode-copilot-chat/issues/59)
**Contributor:** [@Wallacy](https://github.com/Wallacy)

---

## Problem

### #59 — Subscription cost drift

Before this fix, `getSummary()` returned `buildSummaryFromTracked(...)`, which estimated costs from locally recorded token counts × model pricing. This estimate missed:

- **Server-side cache affinity** — the gateway may cache and serve repeated prompts at a lower rate than the local estimate assumes
- **CLI/TUI usage** — requests made through the OpenCode CLI or TUI are billed but never recorded by the extension
- **Pricing drift** — model pricing changes on the server side aren't reflected until the extension updates its bundled snapshot

The result: status bar percentages drifted 9–15% from what users actually saw on their OpenCode billing page.

### DeepSeek context overflow

The `modelLimits()` function calculated `apiMaxOutputTokens = Math.min(maxOutputTokens, contextWindow)`. For a 1048K context window with 384K max output, this allowed requesting 384K output tokens. But if the prompt was 668K tokens, the total (668K + 384K = 1052K) exceeded the 1048K context window, causing a hard 400 rejection from the provider.

### SSE log noise

The `[sse-stats]` line was logged unconditionally after every streamed response:

```text
[sse-stats] totalBytes=12345 totalEvents=42 bufferTailLen=0
```

This added noise to the Output channel during normal usage, with no opt-out mechanism.

---

## Root Cause

### #59 — Dead code

The SQLite reader (`readOpenCodeHistory()`) and row aggregator (`buildSummaryFromRows()`) already existed in `goUsageTracker.ts` but were dead code. `getSummary()` never called them. The extension only used `buildSummaryFromTracked()`, which relied on locally estimated costs.

### DeepSeek overflow

`modelLimits()` had no awareness of the actual prompt size. It capped output to `contextWindow` (the full window), assuming the prompt would be small enough. For large prompts (agent workflows, long conversations), this assumption broke.

### SSE logging

The `[sse-stats]` line was added as a diagnostic during early development and was never gated behind a debug flag.

---

## Solution

### SQLite-backed cost accuracy

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

### DeepSeek context overflow fix

`modelLimits()` now accepts an optional `promptTokens` parameter and caps output to `contextWindow - promptReserve`:

```typescript
const promptReserve = promptTokens ?? Math.floor(contextWindow * 0.8);
const safeOutputBudget = Math.max(1, contextWindow - promptReserve);
const apiMaxOutputTokens = Math.min(maxOutputTokens, safeOutputBudget);
```

At the call site, prompt size is estimated via `estimateTokenCount(JSON.stringify(apiMessages))`. When unknown, a conservative 80% reserve is used. This prevents context overflow across all providers and endpoint types, not just DeepSeek.

### SSE log gating

`[sse-stats]` is now gated behind the existing `debugReasoning` setting:

```typescript
if (options.debugReasoning && options.output) {
  options.output.appendLine(`[sse-stats] totalBytes=${totalBytes} totalEvents=${totalEvents} bufferTailLen=${buffer.length}`);
}
```

---

## Changes

| #   | Change                                              | Files                   | Impact                                                  |
| --- | --------------------------------------------------- | ----------------------- | ------------------------------------------------------- |
| P0  | SQLite-backed cost accuracy for subscription totals | `src/goUsageTracker.ts` | Usage percentages reflect actual billing, not estimates |
| P0  | `buildSqliteEnrichedSummary()` — new method         | `src/goUsageTracker.ts` | Combines SQLite costs with tracked token counts         |
| P0  | `sqliteAvailable` field on `UsageSummary`           | `src/goUsageTracker.ts` | Downstream consumers know data source                   |
| P0  | `promptTokens` param on `modelLimits()`             | `src/extension.ts`      | Prevents context window overflow for all providers      |
| P0  | `estimateTokenCount(JSON.stringify(apiMessages))`   | `src/extension.ts`      | Conservative prompt size estimate for output budget     |
| P1  | `[sse-stats]` gated behind `debugReasoning`         | `src/streaming.ts`      | Output channel cleaner during normal usage              |
| D1  | CHANGELOG entries                                   | `CHANGELOG.md`          | SQLite accuracy, DeepSeek fix, SSE gating documented    |

---

## Verification

```bash
npm run compile    # 0 errors
npm test           # 75/75 pass
```

Manual testing:

- SQLite path: reads `opencode.db`, enriches tokens, applies baselines
- No SQLite: falls back to tracked estimate (no regression)
- DeepSeek: `max_tokens` now capped to prevent context overflow
- SSE: `[sse-stats]` only appears with `debugReasoning` enabled

---

## Follow-up

- **Double DB read:** `hasSQLiteData` getter and `getSummary()` both call `readOpenCodeHistory()` independently. If both fire close together, two `sqlite3` processes spawn for the same read. Low priority; could cache per-call if profiling shows it matters.
- **Prompt estimation accuracy:** `JSON.stringify(apiMessages)` over-counts tokens due to JSON structure overhead (brackets, field names, tool schemas). The output budget ends up slightly tighter than the real limit. Acceptable for safety; could be refined with a dedicated tokenizer in the future.
