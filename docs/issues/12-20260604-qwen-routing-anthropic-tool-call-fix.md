**Status:** ✅ Solved

# Qwen Routing & Anthropic Tool-Call Streaming Fix

**Topic:** routing / tool-calling / streaming / models / provider
**Updated:** 2026-06-05
**Tags:** #routing #tool-calling #streaming #qwen #anthropic-bridge #context-window
**Supersedes:** —

---

## Overview

Qwen models (`qwen3.5-plus`, `qwen3.6-plus`, `qwen3.6-plus-free`, `qwen3.7-max`) were not able to call VS Code tools, responded with short answers without follow-through, and the context window indicator stayed at 0%. The root cause was incomplete Anthropic SSE event parsing in `AnthropicResponseExtractor` — the extractor only handled flat delta shapes and missed the structured Anthropic streaming events (`content_block_start`, `content_block_delta` with `input_json_delta`, `message_delta`, `message_stop`).

This session also involved an incorrect initial fix (v0.1.9) that rerouted Qwen to the OpenAI chat-completions endpoint, which caused a 401 error because the OpenCode Go gateway does not support Qwen in `oa-compat` format. The final fix (v0.1.10) reverted the routing and fixed the actual Anthropic streaming parser instead.

**Original session:** 2026-06-04 (analysis + v0.1.9)
**Hotfix session:** 2026-06-05 (v0.1.10)
**Documented:** 2026-06-13

---

## Timeline

### 1. 2026-06-04 — Initial Investigation

**Problem:** User reported that Qwen models in Copilot Chat did not access VS Code tools, answered briefly without follow-through, and the context window indicator did not update.

**Root Cause Analysis:**

The investigation traced through the full request pipeline:

| Component        | File               | Finding                                                                                       |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| Routing          | `src/routing.ts`   | `isMessagesQwenModel()` routes all Qwen to Anthropic `/messages` endpoint                     |
| Request builder  | `src/extension.ts` | `buildAnthropicMessagesRequestBody()` constructs Anthropic-format body                        |
| Streaming parser | `src/streaming.ts` | `AnthropicResponseExtractor` only checks flat `delta.type === "tool_use"`                     |
| Usage parser     | `src/streaming.ts` | `updateRequestUsageSummary()` only reads OpenAI fields (`prompt_tokens`, `completion_tokens`) |
| Thinking payload | `src/extension.ts` | `buildThinkingPayload()` sends Qwen-native `enable_thinking` to Anthropic endpoint            |

The `AnthropicResponseExtractor.extractStreamParts()` only handled:

- `delta.text` — text content ✅
- `delta.thinking` — reasoning content ✅
- `delta.type === "tool_use"` — flat tool_use delta (non-standard) ⚠️

It did **not** handle the actual Anthropic SSE streaming events:

- `content_block_start` with `content_block.type === "tool_use"` (contains tool `id` and `name`)
- `content_block_delta` with `delta.type === "input_json_delta"` (contains `partial_json` for tool arguments)
- `message_delta` with `delta.stop_reason` and `usage` (Anthropic-native usage fields)
- `message_stop` (final event to flush remaining tool calls)

This meant tool calls were silently dropped, and usage metadata (Anthropic `input_tokens`/`output_tokens`) was never parsed, keeping the context window at 0%.

**Also related:** GitHub Issue [#5](https://github.com/ltmoerdani/opencode-copilot-chat/issues/5) — "Support context window indicator" — users reported Qwen context window not moving, especially `qwen3.7-max` not reporting usage metadata.

### 2. 2026-06-04 — Incorrect Fix (v0.1.9)

**Action:** Removed Qwen from `isMessagesQwenModel()` so all Qwen models would fall through to `chat-completions` endpoint.

**Files changed:**

| #   | Change                         | File             | Detail                                               |
| --- | ------------------------------ | ---------------- | ---------------------------------------------------- |
| 1   | Remove `isMessagesQwenModel()` | `src/routing.ts` | Deleted function and its call from routing condition |
| 2   | Version bump                   | `package.json`   | `0.1.8` → `0.1.9`                                    |
| 3   | CHANGELOG entry                | `CHANGELOG.md`   | Documented the fix                                   |

**Initial test result:** ✅ User confirmed `qwen3.5-plus` and `qwen3.7-max` worked locally.

**Published to marketplace.**

### 3. 2026-06-05 — Regression Report

**Problem:** User reported after updating to v0.1.9:

```text
OpenCode Go API request failed (401) model=qwen3.7-max payloadBytes=97216:
Model qwen3.7-max is not supported for format oa-compat
```

**Root Cause:** The OpenCode Go gateway only supports Qwen models through the Anthropic Messages API endpoint (`/messages`), not the OpenAI chat-completions endpoint (`/chat/completions`). The v0.1.9 fix rerouted Qwen to `chat-completions`, which the gateway rejected.

**Key learning:** The Qwen routing to `/messages` was **intentional** and correct. The problem was in the Anthropic streaming parser, not the routing.

### 4. 2026-06-05 — Correct Fix (v0.1.10)

**Action:** Reverted Qwen routing back to `/messages` and fixed the actual Anthropic streaming parser.

**Changes:**

| #   | Fix                                                         | Files                          | Impact                                                                                                                                                                           |
| --- | ----------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Restore Qwen routing to `/messages`                         | `src/routing.ts`               | Restored `isMessagesQwenModel()`, Qwen back to Anthropic endpoint                                                                                                                |
| P1  | Rewrite `AnthropicResponseExtractor.extractStreamParts()`   | `src/streaming.ts`             | Now handles `content_block_start` (tool_use id/name), `content_block_delta` (input_json_delta partial_json), `message_delta` (stop_reason + usage), `message_stop` (final flush) |
| P2  | Add Anthropic usage fields to `updateRequestUsageSummary()` | `src/streaming.ts`             | Parse `input_tokens`, `output_tokens`, `cache_read_input_tokens` in addition to OpenAI fields                                                                                    |
| P3  | Add Anthropic `stop_reason` parsing                         | `src/streaming.ts`             | Extract `delta.stop_reason` from `message_delta` events                                                                                                                          |
| P4  | Qwen thinking payload translation                           | `src/extension.ts`             | New `buildQwenAnthropicThinkingPayload()` converts `enable_thinking` to Anthropic-native `{ type: "enabled"/"disabled" }` when Qwen is on messages endpoint                      |
| P5  | Version bump + CHANGELOG                                    | `package.json`, `CHANGELOG.md` | `0.1.9` → `0.1.10`                                                                                                                                                               |

**Verification:**

```bash
npm run compile    # clean
npx vsce package --no-dependencies  # 91.38 KB VSIX
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension opencode-copilot-chat-0.1.10.vsix --force
```

**Result:** ✅ User confirmed `qwen3.7-max` works — successfully read `package.json` via tool call with full response.

---

## Final Solution

### Routing (unchanged from original)

Qwen models remain on the Anthropic `/messages` endpoint as required by the OpenCode Go gateway:

```ts
// src/routing.ts
function isMessagesQwenModel(modelId: string): boolean {
  return /^qwen3\.(?:5|6)-plus(?:-free)?$/i.test(modelId) || /^qwen3\.7-max$/i.test(modelId);
}
```

### Anthropic Streaming Parser (rewritten)

`AnthropicResponseExtractor.extractStreamParts()` now handles the full Anthropic SSE event lifecycle:

1. **`content_block_start`** — captures `content_block.type === "tool_use"` with `id` and `name`, or `type === "thinking"` with initial thinking text, or `type === "text"` with initial text.

2. **`content_block_delta`** — handles three delta sub-types:
   - `text_delta` → `delta.text` (text content)
   - `thinking_delta` → `delta.thinking` (reasoning content)
   - `input_json_delta` → `delta.partial_json` (streaming tool arguments)

3. **`message_delta`** — captures `stop_reason` and Anthropic-native `usage` fields.

4. **`message_stop`** — final event, flushes any remaining pending tool calls.

5. **Fallback** — retains the original flat delta shape handling for non-standard gateways that may send Anthropic-style data without explicit event types.

### Usage Parsing (enhanced)

`updateRequestUsageSummary()` now recognizes both OpenAI and Anthropic usage field names:

| OpenAI field                          | Anthropic field           | Mapped to          |
| ------------------------------------- | ------------------------- | ------------------ |
| `prompt_tokens`                       | `input_tokens`            | `promptTokens`     |
| `completion_tokens`                   | `output_tokens`           | `completionTokens` |
| `prompt_tokens_details.cached_tokens` | `cache_read_input_tokens` | `cachedTokens`     |
| _(in delta)_                          | `delta.stop_reason`       | `finishReason`     |

### Thinking Payload (bridged)

New `buildQwenAnthropicThinkingPayload()` translates Qwen-native thinking settings to Anthropic format when Qwen is on the messages endpoint:

| Qwen Setting | Anthropic Payload                                     |
| ------------ | ----------------------------------------------------- |
| `off`        | `{ thinking: { type: "disabled" } }`                  |
| `on`         | `{ thinking: { type: "enabled", budget_tokens: N } }` |
| `auto`       | `{}` (no directive)                                   |

---

## Files Changed

| File               | Change                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `src/routing.ts`   | Restored `isMessagesQwenModel()` after v0.1.9 regression                                          |
| `src/streaming.ts` | Rewrote `AnthropicResponseExtractor.extractStreamParts()`, enhanced `updateRequestUsageSummary()` |
| `src/extension.ts` | Added `buildQwenAnthropicThinkingPayload()`, updated `buildAnthropicMessagesRequestBody()`        |
| `package.json`     | `0.1.8` → `0.1.9` → `0.1.10`                                                                      |
| `CHANGELOG.md`     | Entries for v0.1.9 and v0.1.10                                                                    |

---

## Verification

```bash
npm run compile
npx vsce package --no-dependencies
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension opencode-copilot-chat-0.1.10.vsix --force
```

Manual test with `qwen3.7-max`: asked model to read `package.json` — tool call succeeded, full response with summary returned.

---

## Lessons Learned

1. **Gateway endpoint support is model-specific.** The OpenCode Go gateway does not support all models on all endpoints. Qwen is only available on `/messages` (Anthropic format), not `/chat/completions` (OpenAI format). Always verify gateway behavior before changing routing.

2. **Fix the parser, not the route.** The initial instinct was to change routing to match the "native" format, but the correct fix was to make the Anthropic streaming parser handle the full SSE event lifecycle. The parser was incomplete — it only handled flat delta shapes and missed the structured events.

3. **Test with the actual gateway, not assumptions.** v0.1.9 appeared to work locally because the user tested with specific models that happened to be available, but the broader user base hit the 401 on OpenCode Go's gateway.

---

## Related

- GitHub Issue [#5](https://github.com/ltmoerdani/opencode-copilot-chat/issues/5) — Context window indicator
- `docs/issues/01-20260515-qwen36-tool-call-loop.md` — Ongoing Qwen tool-call loop investigation
- `CHANGELOG.md` — v0.1.9 and v0.1.10 entries
