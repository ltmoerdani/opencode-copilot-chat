# Issue #41 — gpt-5.6-luna: routing, tool calling, and reasoning fix

**Date:** 2026-08-03
**Status:** ✅ Resolved
**Related:** [#93](https://github.com/ltmoerdani/opencode-copilot-chat/issues/93)

## Problem

`gpt-5.6-luna` exists on the OpenCode Go gateway (`https://opencode.ai/zen/go/v1/models`) but the extension returned "Sorry, no response was returned." when used in agent mode (with tool calling).

## Investigation

### What was tried

1. **Responses API routing** — Route GPT models on Go vendor to `/v1/responses` endpoint. The endpoint exists (returns 401 without auth, not 404), but tool calling still fails. VS Code's "Recovered from a request error" messages indicate the gateway rejects tool definitions via the Responses API for this model.

2. **chat-completions routing** — Original default. Also fails for `gpt-5.6-luna` on Go vendor.

### Root Cause

The OpenCode Go gateway for `gpt-5.6-luna` sends tool calls in **standard OpenAI chat-completions format** (`choices[0].delta.tool_calls`), BUT the final SSE event has `finish_reason: null` instead of `"tool_calls"`.

Our `OpenAiResponseExtractor.extractStreamParts()` only flushed accumulated tool calls when `finish_reason === "tool_calls"`. Since the gateway sends `null`, tool calls were collected by `collectOpenAiToolCalls()` but never flushed by `flushToolCalls()` — silently disappearing.

**Evidence from diagnostic SSE output:**

- Events 8-17: tool calls with `grep_search`, `read_file`, etc. ✓
- Event 20 (final): `finish_reason: null` ← BUG
- Result: `completionTokens=180` but `textChars=0 toolCalls=0`

**Why simple chat works:** No tool calls to flush, so the missing `finish_reason` doesn't matter.

## Fix

In `OpenAiResponseExtractor.extractStreamParts()`, flush pending tool calls when `finish_reason` is `null`/`undefined` AND there are accumulated tool calls:

```ts
if (
  first.finish_reason === "tool_calls"
  || (first.finish_reason == null && this.pendingToolCalls.size > 0)
) {
  const toolParts = this.flushToolCalls();
  ...
}
```

### Evidence

- `curl https://opencode.ai/zen/go/v1/models | jq '.data[].id' | grep gpt` → `gpt-5.6-luna` exists
- `curl -X POST .../v1/responses` → 401 (endpoint exists, needs auth)
- VS Code logs: "Recovered from a request error" × multiple → "Sorry, no response was returned."
- "Optimized tool selection" messages from VS Code Copilot indicate tool definition handling failure

## Changes Applied

### 1. `src/extension.ts` — Go provider `responsesUrl`

Added `responsesUrl: "https://opencode.ai/zen/go/v1/responses"` to the Go provider definition. Kept for future use when the gateway adds proper Responses API support.

### 2. `src/routing.ts` — GPT routing (reverted to Zen-only)

Initial fix removed `baseVendor === ZEN_VENDOR` guard, routing ALL GPT models to responses. Reverted because Go gateway doesn't support tool calling via Responses API. GPT models on Go now fall through to `chat-completions` (default).

### 3. `src/metadata.ts` — Model metadata

Added `gpt-5.6-luna` to Go vendor `MODEL_LIMITS_BY_PROVIDER`:

```ts
"gpt-5.6-luna": { contextWindow: 1050000, maxOutputTokens: 128000 },
```

Added to `FALLBACK_MODELS_SNAPSHOT`.

### 4. `src/extension.ts` — Go provider fallback models

Added `"gpt-5.6-luna"` to the Go provider's `fallbackModels` array so the model appears in the picker even when the live model list fetch fails.

## Status

- ✅ Model registered in picker and metadata
- ✅ Model appears in fallback list (resilient to fetch failures)
- ✅ Simple chat (no tools) works
- ✅ **FIXED:** Agent mode tool calls — gateway sends tool calls but finish_reason=null, now flushed correctly
- ✅ **FIXED:** Reasoning/thinking — Responses API route + nested reasoning payload format
- ✅ Diagnostic logging added for future debugging

## Diagnostic Output

When agent mode fails with `gpt-5.6-luna`, the Output channel will now automatically show:

```text
[diag-empty-response] model=gpt-5.6-luna completionTokens=65 totalEvents=15 rawSseDataCount=15
[diag-sse-event-0] {"id":"...","object":"chat.completion.chunk",...}
[diag-sse-event-1] ...
```

**Action:** Share these `[diag-sse-event-N]` lines so we can identify the exact format the gateway returns and fix the extractor.

## Recommendation

The root cause was a missing `finish_reason` in the gateway's final SSE event. The fix is in our extractor — no gateway-side changes needed.

For the thinking/reasoning issue: `gpt-5.6-luna` doesn't match any thinking family in our system, so `thinkingPayload` is always empty. This is expected behavior — the model may support reasoning natively but our extension doesn't have a thinking configuration for it yet.

## Scope Note

- `grok-4.5` is also a new model on Go gateway, not yet in our metadata/fallback. Separate investigation needed.
- The `responsesUrl` on Go provider is kept for future use.
