# Issue #42 — Premature tool-call flush causes empty `<invoke>` calls (regression from #93)

**Date:** 2026-08-03
**Status:** ✅ Fixed
**Related:** [#98](https://github.com/ltmoerdani/opencode-copilot-chat/issues/98), [#93](https://github.com/ltmoerdani/opencode-copilot-chat/issues/93)

## Problem

After the 0.4.4 release, models such as `deepseek-v4` / `deepseek-v4-pro` via the **OpenCode Zen** provider enter an unrecoverable tool-calling loop in the VS Code Chat panel. The model emits an opening `<invoke>` tag with **no `<parameter>` elements** (empty arguments) and then keeps retrying, never converging.

- Reverting to 0.4.3 immediately resolves the issue.
- The exact same model + provider work fine via the OpenCode CLI terminal client.
- Multiple reporters confirmed the regression comes from this extension, not GitHub Copilot itself.

## Investigation

### Routing

`resolveModelRouting()` sends `deepseek-v4*` to the **chat-completions** transport (`streamChatCompletions`), which uses `OpenAiResponseExtractor`. The same extractor is shared by the **responses** (`streamResponsesApi`) and **google** (`streamGoogleGenerateContent`) transports. The **Anthropic** transport has its own extractor and is unaffected.

### Root cause — regression from #93

The #93 fix (`docs/issues/41-20260803-gpt56-luna-routing-fix.md`, shipped in 0.4.4) changed the flush condition in `OpenAiResponseExtractor.extractStreamParts()`:

```ts
if (
  first.finish_reason === "tool_calls"
  || (first.finish_reason == null && this.pendingToolCalls.size > 0)
) {
  const toolParts = this.flushToolCalls();
  ...
}
```

`extractStreamParts` runs **once per SSE event**. Standard OpenAI-compatible SSE streams (Go and Zen gateways alike) report `finish_reason: null` on **every intermediate chunk** — only the final chunk reports `"tool_calls"`. So the new second clause fired on the **first chunk carrying a tool-call delta**, flushing an **incomplete** tool call:

1. Chunk 1: `tool_calls[{index:0, id, name, arguments:""}]`, `finish_reason: null` → condition matches → flush.
2. `flushToolCalls()` → `parseToolInput("")` → `{}` → emits a `LanguageModelToolCallPart` with **empty input**.
3. VS Code renders that as `<invoke name="...">` with **no `<parameter>`**.
4. The model receives the empty tool result and retries the call → infinite loop.

Each subsequent arguments delta chunk (also `finish_reason: null`) re-triggered the flush, dropping the real arguments fragments. Net effect: a cascade of malformed empty calls.

**Why gpt-5.6-luna "worked" with the #93 fix:** the Go gateway delivered the complete tool call in a single final event (with `finish_reason: null`), so flushing at that point was harmless. But any model that streams arguments as incremental deltas across multiple `finish_reason: null` chunks — DeepSeek, Kimi, GLM, Qwen (non-plus), MiniMax (non-m2.x), MiMo — is broken by the same condition. The responses/google transports are equally affected because their normalizers also emit `finish_reason: null` per event.

**Why OpenCode CLI is fine:** the CLI has its own independent transport implementation and correctly accumulates deltas.

## Fix

In `OpenAiResponseExtractor`:

1. **Flush only on `finish_reason === "tool_calls"`.** Never flush on intermediate `null`/`undefined` chunks. Encapsulated as `ToolCallAccumulator.shouldFlushOnFinishReason(finishReason)`.
2. **Flush remaining pending tool calls once at end-of-stream.** New public method `flushRemainingToolCalls(progress, localRequestId)` flushes any accumulated calls after `streamOpenCodeResponse` returns, and is called in the three OpenAI-style transports right before `flushReasoningFallback`. This preserves the #93 intent: gateways that omit `finish_reason` entirely (gpt-5.6-luna on Go) still get their calls emitted — but only once, when the stream is finished, so arguments are complete.
3. **Extracted a pure, unit-tested `ToolCallAccumulator`** (`src/toolCallAccumulator.ts`, no `vscode` import — following the `src/thinking.ts` pure-module convention) so the accumulation/flush logic is testable in plain Node and cannot silently regress again.

### Why not filter out empty-argument calls?

An empty `{}` input is legitimate for tools that take no parameters. The bug was the **premature flush**, not the empty arguments themselves; dropping empty-input calls would break valid no-arg tools. The fix addresses the root cause instead.

## Changes Applied

### 1. `src/toolCallAccumulator.ts` (new, pure)

`PendingToolCall` / `FlushedToolCall` types, `parseToolInput` (moved from `streaming.ts`), and `ToolCallAccumulator` with:

- `collect(toolCalls)` — accumulate deltas by `index` (fragmented `name`/`arguments` appended).
- `shouldFlushOnFinishReason(finishReason)` — only `=== "tool_calls"`.
- `flush()` — return complete calls, drop entries with empty `name`, clear pending.
- `flushRemaining()` — end-of-stream flush; safe no-op when nothing is pending.

### 2. `src/streaming.ts` — `OpenAiResponseExtractor`

- `pendingToolCalls` Map replaced by a `ToolCallAccumulator` instance.
- `collectOpenAiToolCalls()` delegates to `toolCallAccumulator.collect()`.
- `flushToolCalls()` maps `FlushedToolCall[]` to `vscode.LanguageModelToolCallPart[]` (reasoning replication unchanged).
- `extractStreamParts()` flush condition → only `ToolCallAccumulator.shouldFlushOnFinishReason(first.finish_reason)`.
- New public `flushRemainingToolCalls(progress, localRequestId)`.
- Removed the now-migrated local `parseToolInput` and `PendingToolCall` definitions (imported from `./toolCallAccumulator`).

### 3. `src/streaming.ts` — transports

`streamChatCompletions`, `streamResponsesApi`, `streamGoogleGenerateContent` each call `extractor.flushRemainingToolCalls(...)` after `await streamOpenCodeResponse(...)` and before `flushReasoningFallback`. The Anthropic transport is unchanged (its extractor already flushes only on terminating events).

### 4. `src/test/toolCallAccumulator.test.ts` (new)

`node:test` + `assert/strict` (pattern of `src/test/thinking.test.ts`):

- Multi-chunk stream emits **exactly one** complete tool call only when `finish_reason` is `"tool_calls"`.
- No premature flush on intermediate `finish_reason: null` chunks (the #93 regression).
- `flushRemaining()` emits the complete call for gateways omitting `finish_reason` (gpt-5.6-luna case).
- Empty-name (arguments-only) deltas filtered; multiple tool calls handled by index; fragmented names appended.
- `parseToolInput` returns `{}` for empty/partial/non-object JSON.

### 5. Docs

- `CHANGELOG.md` — 0.4.5 entry.
- `docs/devlog.md` — session handoff updated.

## Status

- ✅ `npm run compile` — exit 0.
- ✅ `npm test` — new `toolCallAccumulator` suite passes.
- ✅ `npm run test-retry` — E2E retry test passes.
- ✅ Manual F5 verification — `deepseek-v4` (Zen): tool calls now emit full `<parameter>`; the tool-calling loop is resolved.
- ⚠️ `gpt-5.6-luna` (Go) **NOT live-verified**. The maintainer/reporter is in China, where GPT-series models cannot be reached through the gateway, so a live regression check of the #93 path was not possible. That path (end-of-stream `flushRemaining()`) is covered by the unit tests and shares the exact extractor code path verified with DeepSeek, but a live check on `gpt-5.6-luna` remains recommended for anyone who can access GPT models.

## Recommendation

Keep tool-call flush decisions in the pure `ToolCallAccumulator` and add a unit test for any future change to streaming/tool-call behavior. The 0.4.4 regression shipped because no test covered the flush logic.
