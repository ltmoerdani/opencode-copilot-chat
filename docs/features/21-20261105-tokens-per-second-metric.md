**Status:** ✅ Solved

# Tokens-per-Second Generation Speed Metric (#230)

**Topic:** usage
**Updated:** 2026-11-05
**Tags:** #usage #dashboard #telemetry #models

---

## Overview

Users had no way to compare how quickly different OpenCode Go models generate
output (GitHub issue #230, reported by @nickchomey). All raw ingredients were
already measured per request — `completionTokens` from usage, `durationMs` for
the total request time, and `ttfbMs` for time-to-first-byte — so the metric is
computed from the **generation window** only:

```text
tokensPerSecond = completionTokens / ((durationMs − ttfbMs) / 1000)
```

This measures pure generation speed, excluding connection and queueing time
that inflate the raw wall-clock duration.

## Implementation

- `computeTokensPerSecond()` (exported from `src/core/transport.ts`, next to
  `TransportRequestSummary`): returns `undefined` when `completionTokens` or
  `durationMs` is missing, or when the generation window is `<= 0`. A missing
  `ttfbMs` falls back to using the full duration as the window.
- `src/transports/engine.ts` computes it inside `emitSummary` and includes it
  in the summary and the `[response-summary]` output log line
  (`tokPerSec=<n|n/a>`).
- `GoUsageTracker.record()` persists it per usage entry, rounded to 1 decimal;
  `averageTokensPerSecond()` exposes the mean over entries that reported it.
- The usage dashboard shows the average as a `Speed` stat chip; `-` when no
  entry reported a value.

## Interpretation Notes

- The metric is **per upstream request**. One Copilot chat turn with tool
  loops consists of many upstream requests; speeds are never aggregated across
  a chat turn, only averaged per model over tracked entries.
- `ttfbMs` covers time to the first stream byte; reasoning-heavy models spend
  part of the generation window inside thinking output, which is included.

## Testing

- `src/test/tokensPerSecond.test.ts` — 8 unit tests (correct computation,
  missing-TTFB fallback, omission rules, window `<= 0`, tracker rounding).
- E2E (`tmp/e2e-issues-274-230-232.mjs`): realistic timings and all omission
  edge cases against the compiled helper — PASS.

Closes #230.
