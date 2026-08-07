**Status:** 🟢 Active

# Multimodal Tool Results — Images Returned by MCP Tools

**Topic:** vision / tool-calling / streaming / provider / mcp
**Updated:** 2026-07-20
**Tags:** #vision #tool-calling #streaming #provider #mcp
**Issues:** [#77](https://github.com/ltmoerdani/opencode-copilot-chat/issues/77)
**Released:** `Unreleased` (post-`0.4.1`)

---

## Overview

Extension-side support for forwarding images that arrive inside a
`LanguageModelToolResultPart` to vision-capable models. This is the shape
MCP tools such as `chrome-devtools-mcp` and `playwright-mcp` use to return
screenshots. Before this feature, those images were silently dropped at
serialization time and the model received an empty tool result. Now they
are encoded as OpenAI-style `image_url` content parts and translated into
the native multimodal format of each supported transport.

---

## Architecture

```
MCP tool returns image
  (chrome-devtools-mcp screenshot, etc.)
  ↓
VS Code delivers LanguageModelToolResultPart.content = [LanguageModelDataPart]
  ↓
convertMessage() walks part.content:
  • TextPart / internal DataPart / string  → joined into toolTextParts
  • image DataPart                        → encoded as OpenAiContentPart
                                            {type:"image_url", image_url:{url:"data:…"}}
                                            (subject to MAX_TOOL_RESULT_IMAGE_BYTES = 1 MB)
  ↓
Tool message content:
  • string                         if no images present (byte-identical to old behavior)
  • OpenAiContentPart[] multimodal if ≥1 image present
  ↓
Per-transport builder converts to native shape:
  • chat-completions: passes the array through as-is
  • Anthropic messages: tool_result.content becomes string | AnthropicContentBlock[]
  • Google Gemini: functionResponse.response gains parts:[{text},{inlineData}]
  • Responses API: image replaced with placeholder note (API limit: string only)
```

---

## Configuration

No settings, no toggle. If a model reports `imageInput: true` (i.e. it is in
`VISION_CAPABLE_MODELS` or `models.dev` says it supports vision), nested tool
result images are forwarded automatically. If the model is text-only, the
existing **vision proxy** (see
[`docs/features/11-20260715-vision-proxy.md`](11-20260715-vision-proxy.md))
handles it.

---

## Size Guard

```ts
const MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000; // 1 MB raw bytes
```

Single images larger than 1 MB are replaced with an inline placeholder note so
the request payload stays bounded. Typical MCP screenshots are 50–300 KB; the
cap exists to prevent agent loops that re-capture full-page screenshots from
producing multi-MB payloads that get rejected upstream with
`400 Upstream request failed`.

The placeholder text is:

> `[Image attachment omitted: N bytes exceeds the 1000000-byte limit for tool
results. Ask the tool to produce a smaller screenshot or save it to a file.]`

---

## Per-Transport Behavior

| Transport               | Image in tool result                                          | Notes                                                  |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| OpenAI chat-completions | ✅ Native — array content forwarded as-is                     | Used by Kimi, Mimo, GLM, DeepSeek, Grok on OpenCode Go |
| Anthropic messages      | ✅ Native — `tool_result.content: AnthropicContentBlock[]`    | Used by MiniMax M2.5/M2.7, Qwen3.5/3.6/3.7-max         |
| Google Gemini           | ✅ Native — `functionResponse.response.parts: [{inlineData}]` | Used by Gemini family (when available on OpenCode)     |
| OpenAI Responses API    | ❌ API limit — replaced with placeholder note                 | `function_call_output.output` is string-only           |

---

## Code Locations

| Concern                                   | Location                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| `convertMessage` tool-result image branch | `src/extension.ts` `convertMessage()`                |
| `MAX_TOOL_RESULT_IMAGE_BYTES` constant    | `src/extension.ts` (near `IMAGE_TOKEN_ESTIMATE`)     |
| Anthropic tool result content             | `src/extension.ts` `anthropicToolResultContent()`    |
| Responses API tool output                 | `src/extension.ts` `responsesToolOutput()`           |
| Google tool response content              | `src/extension.ts` `googleFunctionResponseContent()` |
| Anthropic content-block type widening     | `src/extension.ts` `AnthropicToolResultBlock`        |

---

## Verification

- `tsc -p ./` — compile pass, no errors
- `node --test out/test/**/*.test.js` — 107/107 pass, no regression
- Manual test with `chrome-devtools-mcp` + Kimi K2.7 Code on OpenCode Go:
  model successfully read and described the returned screenshot

See [`docs/issues/34-20260720-mcp-tool-result-image-dropped.md`](../issues/34-20260720-mcp-tool-result-image-dropped.md)
for the full investigation, timeline, and follow-up bugs uncovered during
manual testing.

---

## Limitations

1. **Responses API has no image support in tool output.** Only `gpt-5-codex`
   is affected today. Images are replaced with an actionable placeholder.
2. **No history-level image trimming.** The size guard bounds each image
   individually but does not trim smaller images that collectively exceed
   the model's context window. VS Code's own trimming is expected to handle
   that, but our `estimateTokenCount` under-counts base64 payloads.
3. **Top-level image attachments still have no size cap.** Only tool-result
   images are bounded. Consistent limit can be added in a follow-up if
   users hit oversized pasted images.

---

## Related Docs

- [`docs/features/01-20260514-vision-image-input.md`](01-20260514-vision-image-input.md) — top-level image attachments
- [`docs/features/11-20260715-vision-proxy.md`](11-20260715-vision-proxy.md) — proxy for text-only models
- [`docs/issues/34-20260720-mcp-tool-result-image-dropped.md`](../issues/34-20260720-mcp-tool-result-image-dropped.md) — root-cause + fix writeup
