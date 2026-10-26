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

## Follow-up — a premature blocklist, reverted after upstream research

A first follow-up blocklisted the model as dead (based on "even a 1.4KB request 402s, persisting >24h"). Web research prompted by the reporter ("it's available on the web") overturned that:

- **Upstream issue tracker (anomalyco/opencode)**: `Endpoint is unavailable` is OpenCode's generic per-model upstream-incident error, seen with status 402/429/503/451 across many models — #57613 (deepseek-v4.1-flash, 429), #56796 (glm-5.3-flash-free), #54835 (Step 5), #57851 (gemini-4-argon, 429), #57660 (official Windows client). Issues close within ~a day.
- **#55607** is literally "Bug: LongCat 2.5 Preview Free is unusable" ("every other request fails, 50%+") — closed 2026-10-16 as fixed. The model has a history of intermittent capacity bouts followed by recovery.
- **status.opencode.ai**: incident "Upstream provider issues — Free inference" ran **Oct 21 05:54–18:04 UTC (12h10m)**, then another 18:44–19:28 UTC. The reporter's failing requests are timestamped **Oct 21 19:49–19:50 UTC** — in the aftermath window ("after a service recovers, its incident stays open for a short while in case the problem comes back"). The ">24h persistent" reading was a timestamp misjudgment: every observed failure came from one ~1-minute burst.
- The status page's per-model breakdown explicitly **excludes Go's free models**, and the Go docs still advertise the model (Unlimited, limited time, no region restriction — unlike Beam).

Conclusion: temporary OpenCode-side incident, not a dead model. The blocklist attempt was reverted before commit (its commits were squashed away); the model stays selectable, and the hint now points users at **status.opencode.ai**.

## Notes

- No retry added: same precedent as Router.Unavailable — map the message, let the user retry manually.
- `capacityHint` (5xx-gated) intentionally untouched; 402 is not a capacity burst.
- Before ever blocklisting a model again: check status.opencode.ai + the anomalyco/opencode issue tracker, and compare failure timestamps against incident windows.
