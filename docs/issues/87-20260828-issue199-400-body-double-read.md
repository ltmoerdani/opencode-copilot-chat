**Status:** ✅ Solved
**Fix PR:** #203
**Related:** #199, #191, #103, #109
**Landed:** v0.7.3

# HTTP 400 non-recoverable → "Body is unusable: Body has already been read" (double body read)

**Topic:** transport / engine / error-handling
**Updated:** 2026-08-28
**Tags:** #transport #engine #http400 #regression #gpt-luna

---

## Problem

Issue [#199](https://github.com/ltmoerdani/opencode-copilot-chat/issues/199):
`gpt-5.6-luna` on VS Code 1.135.0 + extension v0.7.2 fails with:

```text
Sorry, your request failed. Please try again.
Body is unusable: Body has already been read
TypeError at Response.text (node:internal/deps/undici)
  at streamOpenCodeResponse (out/transports/engine.js:279)
  at async streamResponsesApi (out/transports/responses.js)
```

The undici TypeError **swallows the real HTTP 400 error detail**, so the user
sees a cryptic crash instead of the actionable gateway message (e.g.
`[invalid_prompt] …`).

---

## Root Cause

A Fetch `Response` body can be consumed **exactly once** (WHATWG Fetch spec /
undici): the second `text()` call throws `TypeError: Body is unusable: Body has
already been read`.

Regression introduced by commit `2cd7342` ("loop the 400 analyze→patch→retry
up to 3 attempts", review #191, shipped in **0.7.2**). The refactor of the
HTTP-400 patch loop in `src/transports/engine.ts` dropped the assignment that
cached the freshly-read body:

```ts
// BEFORE (safe):
const errorDetail = await response.text();
consumedErrorBody = errorDetail; // ← always cached

// AFTER 2cd7342 (bug):
const errorDetail = consumedErrorBody ?? (await response.text());
// ← when consumedErrorBody was undefined, the body is read but NEVER cached
```

Failing path — **first loop iteration, non-recoverable 400**:

1. Gateway returns HTTP 400 whose body doesn't match any patch pattern in
   `analyzeHttp400ForRetry` (`src/retry.ts` returns `undefined`).
2. Loop reads the body directly (`consumedErrorBody` is still `undefined`),
   finds no patch, `break`s — `consumedErrorBody` stays `undefined`.
3. The `!response.ok` handler executes
   `consumedErrorBody ?? (await response.text())` → **second read of the same
   Response** → undici TypeError.

Only the first iteration is affected: later iterations always receive a body
from the post-patch refetch, which line 268-style assignment caches correctly.
All other `response.text()` call sites (5xx loop, non-stream body) assign or
read a fresh response — audited, no other double-read path exists.

**Why gpt-5.6-luna:** it routes to `/v1/responses` (`src/routing.ts`) and has a
long history of non-recoverable 400s there — #103 (context-overflow
`invalid_prompt`), #109 (image `invalid_prompt`). Any model on any transport
hitting a non-recoverable 400 crashes the same way; Luna just hits the path
most often.

Stack-trace line mapping verified against compiled `out/transports/engine.js`:
line 279 is exactly the `!response.ok` `await response.text()` re-read.

---

## Fix

`src/transports/engine.ts` — cache the body after the direct read in the
400-patch loop (one line + contract comment):

```ts
const errorDetail = consumedErrorBody ?? (await response.text());
consumedErrorBody ??= errorDetail; // never re-read a consumed body (#199)
```

Side benefit: users who hit this bug now receive the **original 400 error
detail** (actionable) instead of the TypeError.

---

## Verification

- New regression test `src/test/engine.test.ts` (uses the `vscode` module stub
  from `goUsageTestUtils`, stubs `globalThis.fetch` with a real 400 `Response`,
  asserts the surfaced error contains the 400 detail and never
  "Body is unusable").
- Red-green proof: test **fails** on pre-fix code with exactly
  `Body is unusable: Body has already been read`, **passes** with the fix.
- `npm run lint` (all 7 gates incl. TypeScript + unit tests): **Passed**.

---

## Lessons

- When refactoring a read-once resource (Fetch body) into a loop, every read
  must land in the cache variable — the `x ?? read()` pattern silently drops
  the read result when the cache is empty and nothing later re-checks it.
- A crash inside error handling doesn't just crash — it **replaces the real
  error message**, degrading diagnosability for users and maintainers alike.

**Related docs:** `docs/features/07-20260615-model-validation-retry.md` (400
retry contract), `docs/issues/51-20260807-pr107-transient-5xx-retry-merge.md`
(`consumedErrorBody` reset semantics), `docs/issues/47-20260804-gpt56-luna-responses-api-invalid-prompt.md` (#103).
