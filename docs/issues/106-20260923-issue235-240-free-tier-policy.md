# Issues #235 & #240 — "Free tier can only be used from within OpenCode": Upstream Policy, Actionable Error Added

**Status:** ✅ Solved (as far as the extension can act — upstream policy, not a bug)
**Topic:** provider / policy / error UX
**Updated:** 2026-09-23
**Tags:** #provider #zen #free-tier #policy #errors
**GitHub Issues:** [#235](https://github.com/ltmoerdani/opencode-copilot-chat/issues/235), [#240](https://github.com/ltmoerdani/opencode-copilot-chat/issues/240)
**Related:** `KNOWN_UNAVAILABLE_MODEL_IDS` (doc 82, #182), feature doc [17 — data-driven model registry](../features/17-20260814-data-driven-model-registry.md)

---

## Problem

Free Zen models (e.g. `muse-spark-1.2-contributor-free`) fail on every request with:

```text
OpenCode Zen API request failed (403) ... OpenCode's free tier can only be
used from within OpenCode
```

Reported independently in #235 and #240; #235's comment thread gathered the timeline and even spotted third-party extensions that kept free models working by spoofing OpenCode's client identity.

## Root Cause — upstream policy, not a bug

Timeline (from OpenCode's own statements in anomalyco/opencode#49580):

- **Sep 6, 2026** — all requests must carry `x-opencode-session` (we shipped this in 0.7.5).
- **Sep 17, 2026** — free-tier models are restricted to OpenCode's own clients. Their words: _"Our free tier is only meant to be used in opencode"_, part of anti-abuse work.

Paid models (OpenCode Go) are **not** affected. Any client that still serves free models is masquerading as the official client, which violates OpenCode's terms and has been shut down repeatedly. Bypassing this in our extension is therefore off the table by design.

## What the Extension Does

1. **Actionable error** (`describeFreeTierRestriction()` in `src/errors.ts`): when the gateway rejects a request with the free-tier message, the user now sees _"OpenCode restricts this free-tier model to their official app (effective Sep 17, 2026). Use a paid OpenCode Go model, or run free models in the OpenCode app/CLI."_ instead of the raw gateway JSON — same pattern as the Router.Unavailable hint.
2. **No bypass**: deliberately not implementing client-identity spoofing or fake session headers; that is a TOS violation and would put users' accounts at risk.
3. Model list keeps coming from the gateway, so if OpenCode ever opens the free tier to third-party clients again, it is picked up automatically.

## Files Changed

| File                      | Change                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `src/errors.ts`           | `describeFreeTierRestriction()` + wiring into `buildOpenCodeRequestError`                    |
| `src/test/errors.test.ts` | Hint matching, end-to-end through `buildOpenCodeRequestError` (403), unrelated-message no-op |

## Verification

- `npm run lint` (full 7-check gate) pass; 484/484 unit tests pass.
- Manual: request on a free Zen model shows the actionable hint; paid Go models unaffected.

---

Detected 2026-09-16 (#235) and 2026-09-22 (#240) | Reported by @gp-slick-coder, @AIlaowong | Fixed 2026-09-23
