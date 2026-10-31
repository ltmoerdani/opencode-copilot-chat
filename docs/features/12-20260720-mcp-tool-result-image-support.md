**Status:** 🟢 Active

# Multimodal Tool Results — Images Returned by MCP Tools

**Topic:** vision / tool-calling / streaming / provider / mcp
**Updated:** 2026-11-01
**Tags:** #vision #tool-calling #streaming #provider #mcp
**Issues:** [#77](https://github.com/ltmoerdani/opencode-copilot-chat/issues/77), [#272](https://github.com/ltmoerdani/opencode-copilot-chat/issues/272)
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

```text
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
  • chat-completions: passes the array through as-is, except for DeepSeek and
                         GLM 5.3+, which defer image parts to a user message
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

| Transport               | Image in tool result                                          | Notes                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI chat-completions | ✅ Native, with provider-specific exceptions                  | Kimi, GLM 5.2, MiniMax and other accepting families forward arrays; DeepSeek (`deepseek-*`) and GLM 5.3+ defer image parts to a follow-up user message; MiMo drops them |
| Anthropic messages      | ✅ Native — `tool_result.content: AnthropicContentBlock[]`    | Used by MiniMax M2.5/M2.7, Qwen3.5/3.6/3.7-max                                                                                                                          |
| Google Gemini           | ✅ Native — `functionResponse.response.parts: [{inlineData}]` | Used by Gemini family (when available on OpenCode)                                                                                                                      |
| OpenAI Responses API    | ❌ API limit — replaced with placeholder note                 | `function_call_output.output` is string-only                                                                                                                            |

---

## Code Locations

| Concern                                   | Location                                                  |
| ----------------------------------------- | --------------------------------------------------------- |
| `convertMessage` tool-result image branch | `src/provider/messages.ts` `convertMessage()`             |
| `MAX_TOOL_RESULT_IMAGE_BYTES` constant    | `src/config.ts`                                           |
| Deferred image user message               | `src/request/shared.ts` `withDeferredToolImageMessages()` |
| Anthropic tool result content             | `src/request/anthropic.ts` `anthropicToolResultContent()` |
| Responses API tool output                 | `src/responsesRequest.ts` `responsesToolOutput()`         |
| Google tool response content              | `src/request/google.ts` `googleFunctionResponseContent()` |

---

## Verification

- `npm run compile` — compile pass, no errors
- `npm test` — 569/569 pass, including the issue #272 model-family regression cases
- Serialization E2E simulation — 20/20 pass across DeepSeek, GLM, MiMo, and accepting families
- Manual test with `chrome-devtools-mcp` + Kimi K2.7 Code on OpenCode Go:
  model successfully read and described the returned screenshot
- Live Extension Development Host test with local OpenCode Go + Deepseek V4 Pro
  on the separate `novaliners` project: browser screenshot capture completed,
  an image attachment was produced, and the request finished with `stop`
  without the previous HTTP 400 serialization error. DeepSeek reported that it
  cannot inspect pixels, so the textual description used the browser
  accessibility snapshot.

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
3. ~~**Top-level image attachments still have no size cap.**~~ **Resolved.**
   Top-level images are now normalized via `normalizeImagePart()` (PR #102 /
   issue #94) and bounded by `MAX_IMAGE_BASE64_BYTES = 5 MB` before send.
   Tool-result images run through the same normalizer (`src/extension.ts`
   `convertMessage()` ~L3232) **before** the `MAX_TOOL_RESULT_IMAGE_BYTES`
   raw guard still applies for cumulative MCP history bounding. See
   [`docs/features/13-20260803-image-normalization.md`](13-20260803-image-normalization.md).

---

## Related Docs

- [`docs/features/01-20260514-vision-image-input.md`](01-20260514-vision-image-input.md) — top-level image attachments
- [`docs/features/11-20260715-vision-proxy.md`](11-20260715-vision-proxy.md) — proxy for text-only models
- [`docs/features/13-20260803-image-normalization.md`](13-20260803-image-normalization.md) — image normalizer (resized/re-encoded before size guard, supersedes raw-byte-only guard)
- [`docs/issues/34-20260720-mcp-tool-result-image-dropped.md`](../issues/34-20260720-mcp-tool-result-image-dropped.md) — root-cause + fix writeup
- [`docs/issues/120-20261031-issue272-deepseek-tool-image-defer.md`](../issues/120-20261031-issue272-deepseek-tool-image-defer.md) — DeepSeek tool-image serialization exception and live verification
- [`docs/issues/38-20260725-top-level-image-size-guard.md`](../issues/38-20260725-top-level-image-size-guard.md) — ⚠️ Deprecated, superseded by #94 normalizer
