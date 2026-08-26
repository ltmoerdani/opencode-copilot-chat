**Status:** ✅ Solved
**Fix PR:** [#186](https://github.com/ltmoerdani/opencode-copilot-chat/pull/186)
**Related:** #181 (Ox Alpha Stealth truncation), #184 (GPT 5.6 Luna tool-call truncation), #178 (truncated-stream resilience), #180 (stream-stall resilience)
**Landed:** PR #186 (Fahad090NP/fix/stream-truncation-retry-loop, merge `0c936e0`)

# Stream truncation: retry a few times before throwing

**Topic:** chat / transport / streaming / resilience
**Updated:** 2026-08-22
**Tags:** #chat #transport #streaming #bug #resilience

---

## Problem

Issue #181 (Ox Alpha Stealth on Zen) and #184 (GPT 5.6 Luna with tool calling on
Go) both surface the truncation error:

```text
OpenCode Go/Zen response stream ended before completion
(no [DONE] or finish_reason after N bytes / M events)
```

The gateway drops the connection before sending the `data: [DONE]` sentinel or a
`finish_reason` chunk. #178/#180 added a **single** transparent retry, but only
when nothing user-visible had been emitted yet (`extractedPartCount === 0`) —
retrying after content would duplicate it, because VS Code flushes streamed
parts before reporting a provider error (`extHostLanguageModels.ts`
`$reportResponseDone`).

That single retry was not enough: flaky models truncate repeatedly, so the user
saw the error every turn with no further recovery attempt.

## Fix

- **`src/transports/streamParts.ts`** — replaced the boolean
  `isStreamFailureRetry` with a counter `streamFailureRetryAttempt` (0 = original
  attempt) so the retry budget is explicit and shared.
- **`src/transports/engine.ts`** — both failure paths (truncated connection and
  idle stall) now retry in a **bounded loop** of `STREAM_FAILURE_MAX_RETRIES = 3`
  attempts while `extractedPartCount === 0` and the request is not cancelled.
  Each retry increments the counter and recurses into `streamOpenCodeResponse`;
  the budget is shared across both failure modes, so the worst case is exactly
  three extra attempts, never an unbounded loop. Logs show `retry 1/3`, `2/3`,
  `3/3` so the diagnostics make the recovery visible.

## Why this is safe

The retry is gated on `extractedPartCount === 0`. When the provider throws after
emitting content, VS Code keeps the partial response and shows the error, so a
retry would append a full response after a partial one and garble the chat.
Gating on zero emitted parts means a retry can never duplicate visible content.
For truncations that occur _after_ content was emitted (e.g. #184's 257 KB /
93-event tool-call stream), auto-retry is intentionally not attempted — the
error message already tells the user to resend, and a manual resend is a fresh
request with no duplication.

## Verification

- `npm run lint` all 7 checks green.
- `npm run test-retry` E2E passed.
- 2 files changed, +18/−10.
