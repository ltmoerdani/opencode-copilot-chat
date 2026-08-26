**Status:** 🟢 Fix PR open
**Fix PR:** [#188](https://github.com/ltmoerdani/opencode-copilot-chat/pull/188)
**Related:** #184 (GPT 5.6 luna tool calling), #187 (don't throw after content delivered)

# Fail loudly when a `[DONE]`-less stream cuts tool-call arguments

**Topic:** chat / transport / streaming / tools
**Updated:** 2026-08-23
**Tags:** #chat #transport #streaming #tools #bug #resilience

---

## Problem

Issue #184 reported GPT 5.6 luna with tool calling ending the Responses stream without
`[DONE]` / `finish_reason` after 257 KB / 93 events. #187 made such streams
return successfully — but for a **tool-calling** stream cut mid-arguments, that
success flushed a `LanguageModelToolCallPart` whose truncated JSON
`parseToolInput` silently coerced to `{}`. The tool executed with corrupted
(empty) input and nothing told the user.

## Root cause

`parseToolInput` is intentionally lenient (malformed JSON → `{}`), which is the
right behavior mid-stream but wrong at flush time: a flush of a half-streamed
arguments fragment produces a tool call that looks valid to VS Code.

## Fix

- **`src/toolCallAccumulator.ts`** — new `hasCompletePendingCalls()`: every
  named pending call must carry arguments that parse as a JSON object.
  - Empty arguments string counts as **complete**: gateways legitimately send
    no arguments delta for no-parameter tools, and Copilot's own loop
    normalizes `arguments === ''` to `'{}'` (`toolCallingLoop.ts`).
  - Non-empty but invalid JSON → incomplete (stream cut mid-args).
- **`src/transports/extractors.ts`** — `flushRemainingToolCalls()` now skips
  flushing when pending calls are incomplete, logging
  `[warn] dropping N incomplete tool call(s)…` and clearing them. This guards
  both the success path **and** the engine-throws path (the `finally` in each
  adapter previously emitted the corrupted call before the error surfaced).
- **`src/transports/streamParts.ts` + `engine.ts`** — new optional
  `hasCompletePendingWork` callback. In the content-delivered success path from
  #187, when the callback returns `false`, the engine throws the truncation
  error instead of returning success.
- **`src/transports/responses.ts`** — wired the callback (the #184 report is a
  Responses-stream model). Other transports keep #187 semantics.

## Behavior matrix

| Stream end                                      | Before                                    | After                                                      |
| ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| No `[DONE]`, text-only content delivered        | success (#187)                            | unchanged                                                  |
| No `[DONE]`, tool calls with complete JSON args | success, tools execute                    | unchanged                                                  |
| No `[DONE]`, tool-call args truncated mid-JSON  | success, tool executes with `{}` input ❌ | truncation error; incomplete call dropped, user resends ✅ |

## Verification

- `npm run lint` all 7 checks green; 6 unit tests for
  `hasCompletePendingCalls` in `src/test/toolCallAccumulator.test.ts`.
