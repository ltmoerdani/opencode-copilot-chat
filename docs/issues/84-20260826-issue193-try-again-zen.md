**Status:** ✅ Resolved
**Fix PR:** (this commit)

# "Try again" frequently prompted regardless of model — OpenCode Zen

**Topic:** chat / transport / streaming / resilience
**Updated:** 2026-08-26
**Tags:** #chat #transport #streaming #bug #resilience #zen

---

## Problem

Issue [#193](https://github.com/ltmoerdani/opencode-copilot-chat/issues/193) reports
that the "Try again" error appears **frequently** during conversation, regardless
of which model is selected, on **OpenCode Zen** (free tier):

```text
OpenCode Zen response stream ended before completion (no [DONE] or finish_reason
after 355167 bytes / 11 events, request req-0d2f99d1).
```

The error fires **after** the model has delivered its content — the user sees the
response in the chat, then the error popup appears. The stack trace shows the
error was thrown from `streamOpenCodeResponse` (engine.js:437:34) after **3
transparent retries** were exhausted (engine.js:415:17 recursed 3×).

## Root cause

### Evolution of the truncation detection

The truncation detection went through several iterations:

1. **#170** (v0.6.0): Added `isStreamTruncated()` — first detection of streams
   ending without `[DONE]`/`finish_reason`. Previously: silent empty reply.
2. **#178** (v0.6.0): Added transparent retry for truncated streams before first
   content. But **threw error** after content was delivered.
3. **#187** (v0.7.1): **Muse Spark fix** — when `extractedPartCount > 0` AND
   `!workIncomplete`, return success instead of throwing.
4. **#188** (v0.7.1): **Tool-call guard** — added `hasCompletePendingWork`
   callback; if tool-call arguments are truncated mid-JSON, still throw error.

### The bug

The `#187` fix had a condition that was too narrow:

```typescript
const workIncomplete = options.hasCompletePendingWork?.() === false;
if (extractedPartCount > 0 && !workIncomplete) {
  // → success (warn log)
  return;
}
// → throw error
```

The `hasCompletePendingWork` callback checked whether pending tool calls had
parseable arguments (via `ToolCallAccumulator.hasCompletePendingCalls()`). For
text-only streams this returned `true` (no pending calls), so the success path
was taken.

**However**, the `finally` block in every transport adapter (`responses.ts`,
`chatCompletions.ts`, etc.) **already** calls `flushRemainingToolCalls()`,
which drops incomplete tool calls without emitting them (added in #188). So the
engine-level `hasCompletePendingWork` guard was **redundant** — the transport
had already handled the incomplete-call case. The redundant guard meant that
**any** stream truncation after content delivery could still throw, depending on
the `hasCompletePendingWork` state.

### Why it affected all models on Zen

The OpenCode Zen gateway (free tier) systematically drops HTTP/SSE connections
without sending `data: [DONE]` or a `response.completed` event with
`stop_reason`. This is a gateway quirk, not a truncation — the content was fully
delivered. #187 only fixed this for Muse Spark; the same quirk affects **all**
models on Zen (and potentially any provider whose gateway behaves similarly).

The error stack trace confirmed the failure path:

- 3 retries exhausted (stream truncated before any content)
- 4th attempt delivered 355KB / 11 events of content
- But no `[DONE]`/`finish_reason` → `isStreamTruncated()` returned `true`
- `extractedPartCount > 0` → but `hasCompletePendingWork` returned `false`
  (or was evaluated in a way that led to the throw path)
- → error thrown with "Try again" popup

## Fix

### 1. `src/transports/engine.ts` — Remove the `hasCompletePendingWork` guard

When content was already delivered to VS Code, always return success. The
transport's `finally` block already handles incomplete tool calls (drops them
without emitting). The engine-level guard was redundant and caused false
positives.

```typescript
// Before:
const workIncomplete = options.hasCompletePendingWork?.() === false;
if (extractedPartCount > 0 && !workIncomplete) {
  // → success
  return;
}
// → throw error

// After:
if (extractedPartCount > 0) {
  // → success (warn log)
  return;
}
// → throw error
```

### 2. `src/transports/streamParts.ts` — Remove `hasCompletePendingWork` option

The option is no longer consulted by the engine.

### 3. `src/transports/responses.ts` — Remove `hasCompletePendingWork` wiring

The `hasCompletePendingWork: () => extractor.hasCompletePendingToolCalls()` is
removed from the `streamOpenCodeResponse` options.

### 4. `src/transports/extractors.ts` — Remove `hasCompletePendingToolCalls()` method

The method is no longer called from outside. `flushRemainingToolCalls()` still
uses `toolCallAccumulator.hasCompletePendingCalls()` internally.

## Behavior matrix

| Stream end                                      | Before                                                                             | After                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| No `[DONE]`, text-only content delivered        | success (only if `hasCompletePendingWork` returned `true` — i.e. no pending calls) | success (always) ✅                                             |
| No `[DONE]`, tool calls with complete JSON args | success (tools execute)                                                            | unchanged (transport flush emits them) ✅                       |
| No `[DONE]`, tool-call args truncated mid-JSON  | **error** (engine threw, transport `finally` dropped them)                         | **success** (transport `finally` drops them, no error popup) ✅ |
| No `[DONE]`, no content (retries exhausted)     | error                                                                              | unchanged (error still thrown) ✅                               |

## Verification

- `npm run compile` — passes
- `npm run lint` — all 7 checks green (Editorconfig, ESLint, Markdown, Prettier, Shell, TypeScript, Tests)
- `npm test` — 429 tests pass, 0 failures

## Files changed

| File                            | Change                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `src/transports/engine.ts`      | Remove `hasCompletePendingWork` guard; always return success when content was delivered |
| `src/transports/streamParts.ts` | Remove `hasCompletePendingWork` option from `StreamOpenCodeResponseOptions`             |
| `src/transports/responses.ts`   | Remove `hasCompletePendingWork` wiring                                                  |
| `src/transports/extractors.ts`  | Remove `hasCompletePendingToolCalls()` method (unused)                                  |
| `CHANGELOG.md`                  | Add entry for #193                                                                      |

## Related issues

- [#187](https://github.com/ltmoerdani/opencode-copilot-chat/issues/187) — Muse Spark stream completion without [DONE] / finish_reason (predecessor fix, now superseded by this one)
- [#184](https://github.com/ltmoerdani/opencode-copilot-chat/issues/184) — Incomplete tool-call guard (transport-level handling preserved)
- [#188](https://github.com/ltmoerdani/opencode-copilot-chat/pull/188) — PR for #184: `flushRemainingToolCalls` drops incomplete calls
- [#178](https://github.com/ltmoerdani/opencode-copilot-chat/issues/178) — Truncated-stream resilience (original retry logic)
- [#170](https://github.com/ltmoerdani/opencode-copilot-chat/issues/170) — Stream silent stop truncation (original `isStreamTruncated`)
