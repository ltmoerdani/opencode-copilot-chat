# LongCat Free 402 — "Endpoint is unavailable" Surfaced Raw

**Status:** ✅ Solved
**Topic:** errors / models / go
**Updated:** 2026-10-22
**Tags:** #errors #go #free-models #upstream
**Related:** issue #204 (dead models blocklist), [106 — free-tier 403 hint](106-20260923-issue235-240-free-tier-policy.md), [88 — issue204](88-20260903-issue204-block-unavailable-zen-free-models.md)

---

## Problem

Requests to `longcat-2.5-preview-free` failed with:

```text
OpenCode Go API request failed (402) model=longcat-2.5-preview-free:
Upstream request failed: Endpoint is unavailable.
```

The raw upstream text gave the user nothing actionable (and HTTP 402 "Payment Required" misleads Go subscribers).

## Investigation (live probes, 2026-10-22)

| Probe                              | Result                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /zen/go/v1/models`            | `longcat-2.5-preview-free` still listed (37 models total)                                                           |
| Dummy-key `POST /chat/completions` | HTTP 401 `Invalid credential` — the model PASSES gateway model validation; the endpoint exists at the routing layer |
| User request (valid key)           | HTTP 402 `Endpoint is unavailable` — fails at upstream SERVING time                                                 |

So this is not the #204 class (`Model is unavailable` = model removed upstream, blocklist-worthy). The gateway routes to an upstream backend that is not serving right now — the transient `Router.Unavailable` family, reached via a different status/message. Go's docs list the model as a limited-time free preview, which makes intermittent upstream availability expected. The model is NOT blocklisted: it is still in the catalog and passes validation; if it later proves permanently dead, that is a follow-up `KNOWN_UNAVAILABLE_MODEL_IDS` entry with evidence.

## Fix

| File                      | Change                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/errors.ts`           | New `describeEndpointUnavailable()` hint for `/endpoint is unavailable/i`; wired into the hint chain after free-tier and Router.Unavailable. `describeRouterUnavailable()` now returns `undefined` on mismatch (it previously always returned the fallback string, which silently short-circuited the chain). |
| `src/test/errors.test.ts` | 3 new tests: message match, unrelated-message pass-through, and the full `buildOpenCodeRequestError` path on HTTP 402 (hint in both `message` and `userMessage`, raw text not leaked — the #258 contract).                                                                                                    |

## Verification

- `npm test` — 559/559 pass.
- `npm run lint` — all 7 checks pass.
- Probe evidence above (dummy-key 401 distinguishes "model known" from "endpoint dead").

## Notes

- No retry added: same precedent as Router.Unavailable — map the message, let the user retry manually.
- `capacityHint` (5xx-gated) intentionally untouched; 402 is not a capacity burst.
