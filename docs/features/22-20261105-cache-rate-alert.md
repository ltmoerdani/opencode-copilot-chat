**Status:** ✅ Solved

# Prompt-Cache Hit-Rate Alert (#232)

**Topic:** usage
**Updated:** 2026-11-06
**Tags:** #usage #cost #cache #notifications

---

## Overview

When an agent session's prompt cache silently stops working, the cache hit
rate can fall from ~99% to ~20% and requests become roughly 10–50× more
expensive. Users often do not notice until a day's worth of credits is gone
(GitHub issue #232, reported by @nickchomey). The extension now tracks the
rolling cache hit rate per session and warns the user when it drops below a
configurable threshold.

## Implementation

- `src/usage/cacheMonitor.ts` (new) — a **pure** module (no `vscode` import):
  `createCacheMonitor(getThreshold, deps)` with `recordCacheSample(sample)` /
  `reset()`. Warning delivery (`deps.notify`) and the clock (`deps.now`) are
  injected, so the pipeline can never break on a warning failure and tests are
  deterministic.
- Each request's `promptTokens` / `cachedTokens` sample is recorded from
  `onTransportSummary` in `src/provider/chatPrep.ts` (Go gateway only — other
  providers do not report cached tokens). The closure captures
  `historyTrimmed = historyTrim.removed > 0` so the monitor knows which misses
  are the extension's own doing, and the request's `x-opencode-session` so it
  can tell one chat from another.
- Hit rate = `Σ cachedTokens / Σ promptTokens` over a rolling window of
  `CACHE_RATE_WINDOW_REQUESTS` (5) requests.

### Anti-false-positive design

| Mechanism                          | Constant                                | Effect                                                                        |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Expected rebuild: own history trim | —                                       | Resets the window instead of alerting — a miss we caused is not a regression  |
| Expected rebuild: idle gap         | `CACHE_RATE_IDLE_TTL_MS` (5 min)        | Provider cache TTL expiry after inactivity resets the window                  |
| Expected rebuild: model switch     | —                                       | A different `modelId` means a different provider prefix → window reset        |
| Expected rebuild: new chat session | —                                       | A different `x-opencode-session` → window reset                               |
| Tiny-request filter                | `CACHE_RATE_MIN_PROMPT_TOKENS` (2 000)  | Probes and one-shot helpers are not sampled — they can never hit the cache    |
| Consecutive-low requirement        | `CACHE_RATE_LOW_STREAK_REQUIRED` (3)    | The low rate must hold on 3 consecutive eligible requests before alerting     |
| Debounce                           | `CACHE_RATE_ALERT_DEBOUNCE_MS` (10 min) | At most one warning per window                                                |
| Unknown cached tokens              | —                                       | Providers that never report `cachedTokens` (e.g. Zen free models) stay silent |
| Disable switch                     | `cacheRateAlertEnabled` (or `0`)        | Silences monitoring entirely and clears the window                            |

> **Why the switch resets matter:** the gateway derives its sticky session id
> from a conversation anchor that includes the model, so the first request
> after a model switch or in a new chat can never hit the previous prefix.
> Counting those as regressions was the main source of false warnings, and the
> remedy the alert suggests (Compact Conversation) itself starts a new prefix —
> so the warning could re-fire right after the user followed it.

## Configuration

```jsonc
"opencodego.cacheRateAlertEnabled": true, // master switch
"opencodego.cacheRateThreshold": 0.5      // sensitivity (0–1; 0 also disables)
```

`cacheRateAlertEnabled` turns the warning on or off without touching the
sensitivity — the switch wins over the fraction. Turning it off clears the
rolling window, so turning it back on starts from a clean state instead of
resuming a stale one. `cacheRateThreshold` sets how low the hit rate must fall
before warning. The warning names the observed rate, the model, and the remedy:
run **Compact Conversation** or start a new session to restore the cached
prefix.

> **Not supported:** stopping an in-flight request when the cache rate drops
> (requested in the issue thread). VS Code's `ChatRequestHandler` provides no
> mid-flight abort the extension can invoke; cancellation is user-driven.

## Testing

- `src/test/cacheMonitor.test.ts` — 20 unit tests (window math, expected
  rebuilds, model/session switch resets, tiny-request filter, low-streak
  requirement, debounce, on/off switch + threshold resolution, injected
  notifier).
- E2E (`tmp/e2e-issues-274-230-232.mjs`) — 7-phase scripted journey against
  the compiled monitor: healthy session never alerts; degradation alerts once
  the window rate falls and holds; debounce holds; both expected-rebuild paths
  reset silently; unknown-cached-tokens and threshold-0 stay silent; `reset()`
  clears state. All PASS.

Closes #232.
