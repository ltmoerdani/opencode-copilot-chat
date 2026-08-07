**Status:** ✅ Solved

# MCP Tool Result Images Dropped — Vision-Capable Models Could Not See Screenshots

**Topic:** vision / tool-calling / streaming / provider / vscode / mcp
**Updated:** 2026-07-20
**Tags:** #vision #tool-calling #streaming #provider #vscode #mcp
**Issues:** [#77](https://github.com/ltmoerdani/opencode-copilot-chat/issues/77)

---

## Overview

When an MCP tool (e.g. `chrome-devtools-mcp`, `playwright-mcp`) returned an image
as part of its `LanguageModelToolResultPart`, vision-capable models connected via
this extension silently lost the image: the model would reply "I cannot see the
image" or ask the user to upload it again. The same MCP tool worked correctly with
Copilot's built-in models. Pasted image attachments also worked fine — only images
nested inside tool results were dropped.

This documents the full root-cause investigation, the four-transport fix, two
follow-up bugs uncovered during manual testing (payload explosion and warning
spam), and the size-guard + log-noise mitigations that ship alongside the core
fix.

---

## Problem Statement

Reported in [#77](https://github.com/ltmoerdani/opencode-copilot-chat/issues/77)
by [@yinhx3](https://github.com/yinhx3):

> When using the extension to connect a model, image responses from MCP tools
> (e.g., `chrome-devtools-mcp` screenshots) are not visible to the model. The
> same MCP tool output works correctly when using Copilot's built-in model.
>
> When the same image is uploaded directly through the chat input (for example,
> pasted as an attachment), the Kimi K2.7 Code model recognizes and describes
> it correctly. This confirms the model itself is capable of vision, and the
> problem is specifically with how MCP tool image results are passed to the
> model.

### Observed behavior

| Path                                                                                             | Worked?                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Paste/drag image into chat input (top-level `LanguageModelDataPart`)                             | ✅ Yes                                |
| MCP tool returns image (`LanguageModelDataPart` nested in `LanguageModelToolResultPart.content`) | ❌ No — model said "no image visible" |
| Built-in Copilot model + same MCP tool                                                           | ✅ Yes                                |

### Confirmation that Kimi K2.7 is vision-capable

`VISION_CAPABLE_MODELS` in `metadata.ts` (see
[`docs/features/01-20260514-vision-image-input.md`](../features/01-20260514-vision-image-input.md))
lists `kimi-k2.6`, `kimi-k2.5` from MoonshotAI as multimodal. K2.7 Code inherits
that capability. The bug is in the extension, not the model.

---

## Root Cause

### VS Code API recap

From the [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api#LanguageModelToolResultPart):

```ts
class LanguageModelToolResultPart {
  constructor(callId: string, content: unknown[]);
  readonly callId: string;
  readonly content: unknown[];
}
```

> `LanguageModelDataPart` — "Can be used in responses, chat messages, tool
> results, and other language model interactions."

A `LanguageModelToolResultPart.content` is `unknown[]` and **may contain nested
`LanguageModelDataPart` instances** with image MIME types. This is exactly how
MCP tools like `chrome-devtools-mcp` deliver screenshots.

### The broken serialization path

In `src/extension.ts` `convertMessage()`, tool results were serialized as:

```ts
if (part instanceof vscode.LanguageModelToolResultPart) {
  toolResults.push({
    role: "tool",
    tool_call_id: part.callId,
    content: part.content.map(partToText).filter(Boolean).join("\n"),
    //           ^^^^^^^^^^^^^^^^
    //           partToText() only handles TextPart / ToolCallPart /
    //           internal DataPart / string. Image DataPart fell through to
    //           the catch-all `return ""` → silently dropped.
  });
  continue;
}
```

And `partToText()`:

```ts
function partToText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolResultPart) return; /* recurse */
  if (part instanceof vscode.LanguageModelToolCallPart) return; /* … */
  if (part instanceof vscode.LanguageModelDataPart && isInternalDataPart(part)) return "";
  if (typeof part === "string") return part;
  return ""; // ← image DataPart in a tool result landed here → DROPPED
}
```

The extension sent `content: ""` to the provider, and the model honestly replied
that it had no image.

### Why top-level paste worked

Top-level image attachments arrive as a sibling of `LanguageModelToolResultPart`
inside `message.content`. They hit a separate handler in `convertMessage()` that
explicitly checked `part.mimeType.startsWith("image/")` and produced an
`OpenAiContentPart` of `type: "image_url"`. That code path was never reached for
images nested inside tool results.

---

## Solution

### 1. Serialize nested images in tool results (`convertMessage`)

The tool-result branch was rewritten to walk `part.content` and partition each
item into either text (via `partToText`) or an `OpenAiContentPart` image part
(via `dataPartToBase64`). When at least one image is present, the resulting
`ApiMessage.content` becomes a multimodal array; otherwise it stays a plain
string so text-only tool results remain byte-for-byte identical to the previous
behavior.

```ts
const toolTextParts: string[] = [];
const toolImageParts: OpenAiContentPart[] = [];
for (const resultPart of part.content) {
  if (resultPart instanceof vscode.LanguageModelDataPart && resultPart.mimeType.startsWith("image/") && !isInternalDataPart(resultPart)) {
    const base64 = dataPartToBase64(resultPart.data);
    toolImageParts.push({
      type: "image_url",
      image_url: { url: `data:${resultPart.mimeType};base64,${base64}` },
    });
    continue;
  }
  const text = partToText(resultPart);
  if (text) toolTextParts.push(text);
}

let toolContent: string | OpenAiContentPart[];
if (toolImageParts.length > 0) {
  const multimodal: OpenAiContentPart[] = [];
  const joinedText = toolTextParts.join("\n");
  if (joinedText) multimodal.push({ type: "text", text: joinedText });
  multimodal.push(...toolImageParts);
  toolContent = multimodal;
} else {
  toolContent = toolTextParts.join("\n");
}
```

### 2. Per-transport tool result handling

Each transport builder was updated so the multimodal tool content survives into
the final request body:

| Transport                   | Change                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic messages**      | `AnthropicToolResultBlock.content` type widened from `string` to `string \| AnthropicContentBlock[]`. New helper `anthropicToolResultContent()` returns the string form when there are no images (byte-identical to the old behavior) and the array form (text + image blocks) only when an image is present. |
| **OpenAI Responses API**    | `function_call_output.output` is spec'd as a plain string and does not accept image content blocks. New helper `responsesToolOutput()` joins the text parts and appends a short note when an image was omitted. No image is forwarded on this transport.                                                      |
| **Google Gemini**           | New helper `googleFunctionResponseContent()` emits the legacy `{ name, content }` shape for text-only tool results and extends it with `parts: [{text}, {inlineData}]` when an image is present.                                                                                                              |
| **OpenAI chat-completions** | No builder change required — the multimodal `content` array produced by `convertMessage` flows straight into the request body.                                                                                                                                                                                |

### 3. Size guard for oversized images

Manual testing (see "Follow-up bugs" below) revealed that MCP screenshot loops
can push a single request payload to 4.6 MB and trigger upstream `400 "Upstream
request failed"`. A hard cap was added in `convertMessage`:

```ts
const MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000; // 1 MB raw bytes

if (resultPart.data.byteLength > MAX_TOOL_RESULT_IMAGE_BYTES) {
  toolTextParts.push(
    `[Image attachment omitted: ${resultPart.data.byteLength} bytes exceeds the ` +
      `${MAX_TOOL_RESULT_IMAGE_BYTES}-byte limit for tool results. Ask the tool ` +
      `to produce a smaller screenshot or save it to a file.]`,
  );
  continue;
}
```

The model still knows an image was returned, the request payload stays bounded,
and the user gets an actionable hint.

### 4. Log noise reduction (pre-existing, surfaced during testing)

Two unrelated log-spam issues were addressed in the same session because they
made manual testing of the image fix very hard to follow:

- `provideLanguageModelChatInformation` previously logged one line per model
  per call (22 lines per call × ~3 calls/sec). Replaced with a single summary
  log line: `Models registered: count=22 provider=opencodego first=… last=…`.
- `fetchModels` previously called `vscode.window.showWarningMessage` on every
  transient upstream failure (400/503 from OpenCode's shared gateway are
  common and resolve on retry within seconds). Replaced with an Output-channel
  log line. The bundled `fallbackModels` snapshot keeps the picker functional.

---

## Files Changed

| File               | Change                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` | `convertMessage()`: serialize nested image DataParts into multimodal `OpenAiContentPart[]` on tool messages; enforce `MAX_TOOL_RESULT_IMAGE_BYTES` cap.                               |
| `src/extension.ts` | `AnthropicToolResultBlock.content` type widened to `string \| AnthropicContentBlock[]`; new `anthropicToolResultContent()`.                                                           |
| `src/extension.ts` | `responsesInputItemsFromMessage()` tool branch: new `responsesToolOutput()` helper that degrades images to a placeholder note (Responses API does not support images in tool output). |
| `src/extension.ts` | `googleContentsFromMessages()` tool branch: new `googleFunctionResponseContent()` that emits `parts: [{text}, {inlineData}]` when an image is present.                                |
| `src/extension.ts` | `provideLanguageModelChatInformation()`: replaced per-model log spam with one summary line per invocation.                                                                            |
| `src/extension.ts` | `fetchModels()`: replaced `showWarningMessage` with Output-channel log on transient upstream failures.                                                                                |
| `src/extension.ts` | Added `MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000` constant.                                                                                                                             |

**Total:** 1 file, +180 / −45 lines (approx).

---

## Follow-up Bugs Uncovered During Manual Testing

### A. 4.6 MB payload → upstream 400

After the core fix was in place, manual testing with `chrome-devtools-mcp` on
`mimo-v2.5` produced a series of `400 Bad Request` errors from the OpenCode Go
gateway. Inspecting the Output channel revealed:

```text
[request] url=https://opencode.ai/zen/go/v1/chat/completions payloadBytes=4665383
[http-error-body] {"error":{"message":"Error from provider (Console Go): Upstream
   request failed","type":"invalid_request_error","code":"invalid_request_error"}}
```

Timeline (each turn re-sends the entire conversation history):

```text
02:58:03  payloadBytes=1356        messages=1
02:58:41  payloadBytes=144169      messages=3   (first screenshot)
02:59:17  payloadBytes=189950      messages=7   (loop screenshots accumulate)
03:00:07  payloadBytes=200065      messages=11
03:00:28  payloadBytes=201561      messages=13
03:00:42  payloadBytes=202412      messages=15
03:00:55  payloadBytes=4665383     messages=17  ← BOOM (4.6 MB)
03:01:05  → 400 Upstream request failed
03:01:07  → retry → 400
03:01:15  → retry → 400
03:01:21  → retry → 400
```

Cause: full-page MCP screenshots can be 1–2 MB each. Once several are embedded
in history as base64 data URIs (~1.33× the byte size), the payload crosses the
upstream limit and every subsequent retry in the same agent loop fails. The
`MAX_TOOL_RESULT_IMAGE_BYTES` size guard above is the direct mitigation.

A longer-term follow-up would be to trim old images from conversation history
when the estimated token count exceeds the model's context window, but VS Code
Copilot Chat is supposed to perform that trimming based on
`advertisedMaxInputTokens` and the extension's local estimator currently
under-counts base64 image data. That's tracked separately.

### B. "Model registered" log spam + warning popups

Investigation of the "loading forever" UX complaint surfaced that:

- VS Code refreshes model info on roughly a 300 ms cadence during UI activity.
- Each call produced 22 log lines (one per registered model).
- A single transient 400 from the shared OpenCode gateway on the auto-registered
  `opencodezen-agent` provider (the user was on `opencodego`) triggered a modal
  `showWarningMessage` popup, even though the bundled `fallbackModels` snapshot
  kept everything functional.

Both were noise rather than correctness bugs, but they obscured the real signal
during testing and made the extension feel broken. Fixed as described in
section 4 above.

---

## Verification

```bash
# 1. TypeScript strict compile
./node_modules/.bin/tsc -p ./
# Result: exit 0, no errors

# 2. Full unit test suite
node --test out/test/**/*.test.js
# Result: 107/107 pass, 0 fail, 0 regression on vision proxy / metadata /
# thinking / retry / usage / goUsageTracker / usageProfile tests
```

### Manual test (performed by @ltmoerdani)

1. Set up `chrome-devtools-mcp` in `~/Library/Application Support/Code/User/mcp.json`.
2. Launched Extension Development Host (`F5` → "Run Extension with Copilot").
3. Picked an OpenCode Go model in Copilot Chat.
4. Prompt: `Take a screenshot of https://example.com using chrome-devtools,
then describe what you see.`
5. ✅ The model read and described the screenshot.
6. No `400 Upstream request failed` for normal-sized screenshots.

---

## Limitations & Follow-ups

1. **Responses API cannot carry images in tool output.** The OpenAI Responses
   API's `function_call_output.output` field is spec'd as a string. Images in
   tool results are degraded to a placeholder note on that transport. The only
   Responses-API model in the catalog today is `gpt-5-codex`, so the impact is
   limited. A future improvement would be to surface this limitation to the
   user via the model's tooltip.
2. **No history-level image trimming.** When multiple screenshots accumulate
   across turns, the size guard trims each oversized image but does not trim
   smaller images that collectively exceed the context window. VS Code's own
   trimming should handle that, but its decisions rely on our
   `estimateTokenCount`, which under-counts base64 payloads. Worth revisiting
   if users hit context overflow with many small screenshots.
3. **Mimo v2.5 is slow on multimodal prompts.** Time-to-first-byte of 10–20 s
   is normal for this model on payloads >100 KB. For faster verification of
   vision fixes, prefer `qwen3.6-plus`, `glm-5.2`, or `kimi-k2.7-code`.

---

## Related Docs

- [`docs/features/01-20260514-vision-image-input.md`](../features/01-20260514-vision-image-input.md) — native vision support (the foundation this builds on)
- [`docs/features/11-20260715-vision-proxy.md`](../features/11-20260715-vision-proxy.md) — vision proxy for text-only models (separate feature, not required for this fix)
- [`docs/issues/08-20260520-vision-image-request-fixes.md`](08-20260520-vision-image-request-fixes.md) — earlier vision fixes (stack overflow, Qwen budget)
