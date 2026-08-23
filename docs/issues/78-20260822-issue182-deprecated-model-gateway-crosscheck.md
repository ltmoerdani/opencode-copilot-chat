**Status:** ✅ Solved (partial — `deepseek-v4-flash-free` is upstream-blocked)

# Deprecated Model Gateway Cross-Check (#182)

**Topic:** models / provider / registry / availability
**Updated:** 2026-08-22
**Tags:** #models #provider #zen #deprecated #gateway
**Supersedes:** —
**Landed:** PR #185 (Barragek0/patch-1, merge `f0b3c04`)

---

## Overview

`models.dev` `status: deprecated` was hiding live models from the picker. The fix cross-checks against the gateway response: only hide when both `models.dev` says deprecated AND the gateway confirms the model is absent.

The original reporter's example (`deepseek-v4-flash-free`) turned out to be a deeper upstream problem: the gateway lists the model but it's actually broken (`Upstream request failed: Model is unavailable`). A working example is `laguna-s-2.1-free`, which is live and correctly shown by our fix.

---

## Problem

`deepseek-v4-flash-free` appears in the OpenCode Zen gateway (`https://opencode.ai/zen/v1/models` returns it), but requests to it fail:

```text
(400) model=deepseek-v4-flash-free: Error from provider (Console): Upstream request failed: Model is unavailable
```

Meanwhile, `laguna-s-2.1-free` is also listed by `models.dev` as `deprecated`, but IS live and working. The extension's `shouldHideDeprecatedModel` filter was hiding both unconditionally — a stale false positive for working models.

### Root Cause

The original deprecated filter (issue #03, 2026-05-16) was added because the gateway **can** list models that are broken at the provider level (`ring-2.6-1t-free`, `trinity-large-preview-free`). `models.dev deprecated` was the only signal that caught them.

However, `models.dev` is community-maintained and can drift — marking working models as deprecated. The filter had no cross-check against the gateway, so stale `deprecated` flags hid live models.

### Two Competing Failure Modes

|                 | Scenario                                                  | Before fix          |
| --------------- | --------------------------------------------------------- | ------------------- |
| #03 (May 2026)  | Gateway lists broken model, `models.dev` says deprecated  | ✅ Correctly hidden |
| #182 (Aug 2026) | Gateway lists working model, `models.dev` says deprecated | ❌ Falsely hidden   |

### Why `deepseek-v4-flash-free` is a separate problem

Neither `models.dev` nor the gateway is a reliable source of truth for availability:

- `models.dev` says `deprecated` → but `laguna-s-2.1-free` works fine (false positive)
- Gateway lists the model → but `deepseek-v4-flash-free` returns "Model is unavailable" (false positive)

The extension can't distinguish a working model from a broken one without actually sending a request. The honest behavior is to show what the gateway tells us and surface the error clearly when it fails. The real fix for `deepseek-v4-flash-free` is upstream: either the gateway stops listing it, or `models.dev` removes the `deprecated` flag.

---

## Solution

`shouldHideDeprecatedModel` now takes an optional `liveModelIds` set (the gateway response). It only hides when:

1. `models.dev` says `deprecated` **AND**
2. `liveModelIds` is provided (not offline/fallback) **AND**
3. The model is NOT in `liveModelIds` (gateway confirms absence)

This means:

- Gateway lists it → live → don't hide (fixes #182)
- Gateway absent + `models.dev` deprecated → hide (preserves #03 protection)
- Offline/fallback (no live data) → fail open, don't hide on stale metadata alone

### Files Changed

| File                               | Change                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/provider/settings.ts`         | `shouldHideDeprecatedModel` gains `liveModelIds?: ReadonlySet<string>` parameter; early-returns `false` when live set confirms the model is present or absent data |
| `src/provider/modelList.ts`        | `filterAvailableModels` signature gains `liveModelIds?`; gateway fetch builds `Set(ids)` and passes it through                                                     |
| `src/provider/OpenCodeProvider.ts` | `filterAvailableModels` threads `liveModelIds` to `shouldHideDeprecatedModel`; fetcher wiring updated                                                              |

---

## Verification

```bash
npm run compile  # passes
npm test         # passes (8 new tests for shouldHideDeprecatedModel)
```

Registry check:

| Model                        | Gateway   | `models.dev` | Actually works? | Before fix | After fix |
| ---------------------------- | --------- | ------------ | --------------- | ---------- | --------- |
| `laguna-s-2.1-free`          | ✅ listed | deprecated   | ✅ Yes          | ❌ hidden  | ✅ shown  |
| `deepseek-v4-flash-free`     | ✅ listed | deprecated   | ❌ No (400)     | ❌ hidden  | ✅ shown* |
| `ring-2.6-1t-free`           | ❌ absent | deprecated   | ❌ No           | ✅ hidden  | ✅ hidden |
| `trinity-large-preview-free` | ❌ absent | deprecated   | ❌ No           | ✅ hidden  | ✅ hidden |

\* Shown but fails at runtime — upstream issue, not solvable from extension side.

---

## Notes

- `KNOWN_UNAVAILABLE_MODEL_IDS` (`ring-2.6-1t`, `ring-2.6-1t-free`, `trinity-large-preview-free`) remains as a manual safety net for models known to fail even if listed.
- `models.dev` is still valuable for enrichment (pricing, context windows, capabilities) — just not as the sole source of truth for availability.
- Runtime failure tracking was considered but rejected — it creates confusing UX where models silently vanish from the picker with no explanation.
