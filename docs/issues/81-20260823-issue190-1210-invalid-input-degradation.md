**Status:** 🟢 Fix PR open
**Fix PR:** [#191](https://github.com/ltmoerdani/opencode-copilot-chat/pull/191)
**Related:** #190

# Degrade optional parameters on `[1210] invalid input` 400s

**Topic:** chat / retry / resilience
**Updated:** 2026-08-23
**Tags:** #chat #retry #models #bug #resilience

---

## Problem

`ox-alpha-free` (new Go model) rejects requests with HTTP 400:

```text
Upstream request failed: [1210] Invalid API parameter, please check the
documentation.invalid input
```

The gateway does not name the offending parameter. The reporter's payload was
1.98 MB and otherwise well-formed; the model is a fallback-family entry, so no
thinking fields are even sent. One of the always-included optional parameters is
not accepted by this upstream.

## Fix

`src/retry.ts` — new `patchInvalidInput` classifier: on a 400 matching
`[1210] … invalid input / invalid API parameter`, strip optional parameters one
per engine retry attempt, least-likely-to-matter first:

1. `stream_options` (usage accounting hint)
2. `temperature` (fall back to the model default)
3. image parts (text preserved; some models reject data-URL images despite
   metadata)

Each patch fires only when the parameter is present, so the sequence stops once
everything optional is gone and real failures surface normally.

## Verification

- `npm run lint` all 7 checks green.
- 5 unit tests: each degradation step, image stripping with text preservation,
  exhaustion → undefined, no-fire for unrelated 400s.
