# Issue #204 — DeepSeek V4 Flash (Free) "Model is unavailable" → Block Dead Zen Free Models

**Status:** ✅ Solved (branch `fix/issues-204-214-batch`, commit `5c134b2`)
**Topic:** models / zen / unavailable-filter
**Updated:** 2026-09-03
**Tags:** #models #zen #unavailable #free-models
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#204](https://github.com/ltmoerdani/opencode-copilot-chat/issues/204)
**Related:** PR [#205](https://github.com/ltmoerdani/opencode-copilot-chat/pull/205) (same fix, community), issue doc [78](78-20260822-issue182-deprecated-model-gateway-crosscheck.md), [03](03-20260516-unavailable-deprecated-model-filtering.md)

---

## Problem

Zen requests to `deepseek-v4-flash-free` fail with HTTP 400 `Upstream request failed: Model is unavailable` (`payloadBytes=261716` — under the ~400 KB proxy cap, so not a size issue). The model is listed by the gateway's `/models` endpoint but is dead upstream, so it keeps appearing in the picker and every request fails.

## Root Cause

`deepseek-v4-flash-free` (and `laguna-s-2.1-free`) were removed upstream while the gateway still lists them. The `KNOWN_UNAVAILABLE_MODEL_IDS` blocklist (`src/config.ts`) is the extension-side mechanism for such models (`docs/issues/03`); neither id was in it. Note `shouldHideDeprecatedModel` did not catch them either — the models.dev snapshot does not mark them `deprecated`, and the live-gateway crosscheck keeps a model visible as long as the gateway lists it.

## Fix

Added `deepseek-v4-flash-free` and `laguna-s-2.1-free` to `KNOWN_UNAVAILABLE_MODEL_IDS` (`src/config.ts`). Same change as community PR #205 — after this merges, PR #205 is redundant and can be closed in its favor.

## Files Changed

| File            | Change                                                                        |
| --------------- | ----------------------------------------------------------------------------- |
| `src/config.ts` | +2 ids in `KNOWN_UNAVAILABLE_MODEL_IDS` (+ doc comment referencing the issue) |

## Verification

- `npx tsc --noEmit` clean; full unit suite 449/449 pass; staged-lint pre-commit gate pass.
- Manual: the two models disappear from the model picker after refresh.

## Lessons Learned

1. Gateway `/models` listing ≠ availability — dead upstream models can still be listed (same class of problem as #182, but without a `deprecated` status to key off).
2. The two-layer filter (hard blocklist + deprecated crosscheck) is correct; the blocklist just needs maintenance when upstream dies silently.

---

Detected 2026-09-03 | Reported by @Fahad090NP
