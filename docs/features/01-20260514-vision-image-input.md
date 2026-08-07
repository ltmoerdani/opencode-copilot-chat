**Status:** ✅ Solved

# Vision / Image Input Support

**Topic:** models, provider, byok, vscode
**Updated:** 2026-05-15
**Tags:** #models #vision #multimodal #byok #vscode

**Released:** `v0.1.4` (2026-05-17), patched in `v0.1.5` (2026-05-20) and `v0.1.8`.

---

## Overview

Enable GitHub Copilot Chat users to attach images (screenshots, photos, diagrams) when using OpenCode Go/Zen models that support multimodal input. Prior to this change, all models reported `imageInput: false` regardless of their actual vision capability, and the extension did not handle `LanguageModelDataPart` image content from Copilot.

---

## Problem

1. **`modelCapabilities()` was hardcoded.** The function returned `imageInput: false` and `supportsImageToText: false` for every model, preventing Copilot from showing the image attachment button and from sending image data to any OpenCode model.

2. **No image content handling.** The `convertMessage()` function only processed `LanguageModelTextPart`, `LanguageModelToolCallPart`, and `LanguageModelToolResultPart`. Any `LanguageModelDataPart` with an image MIME type was silently dropped via the generic `partToText()` fallback returning `""`.

3. **`ApiMessage.content` was `string | null` only.** The OpenAI chat-completions API requires multimodal content to be sent as an array of content parts (`[{type:"text",...},{type:"image_url",...}]`), not a plain string. The interface did not support this shape.

4. **Message merging was unsafe for arrays.** `normalizeMessages()` concatenated `content` fields assuming they were strings. If a multimodal array was passed, it would produce `[object Object]` artifacts.

---

## Root Cause

The initial provider implementation (`v0.1.0`–`v0.1.2`) focused on text-only chat and tool calling. Vision capability was deferred because:

- The VS Code `LanguageModelChatCapabilities` API had not yet been audited
- The `LanguageModelDataPart` class (VS Code's way to deliver image bytes) was not handled
- Model vision support documentation was scattered across multiple providers

---

## Solution

### 1. Vision-Capable Model Registry

Added `VISION_CAPABLE_MODELS` — a `Set<string>` containing model IDs that support multimodal image input through the OpenCode gateway:

| Model ID            | Provider   | Vision Notes                   |
| ------------------- | ---------- | ------------------------------ |
| `minimax-m2.7`      | MiniMax    | Multimodal                     |
| `minimax-m2.5`      | MiniMax    | Multimodal                     |
| `minimax-m2.5-free` | MiniMax    | Multimodal (Zen free tier)     |
| `kimi-k2.6`         | MoonshotAI | Multimodal                     |
| `kimi-k2.5`         | MoonshotAI | Multimodal                     |
| `glm-5.1`           | Z.AI       | GLM-5 series vision            |
| `glm-5`             | Z.AI       | GLM-5 series vision            |
| `mimo-v2.5`         | Xiaomi     | Multimodal                     |
| `mimo-v2.5-pro`     | Xiaomi     | Multimodal                     |
| `mimo-v2-omni`      | Xiaomi     | Explicitly multimodal ("omni") |
| `mimo-v2-pro`       | Xiaomi     | Multimodal                     |
| `qwen3.6-plus`      | Alibaba    | Qwen-VL series                 |
| `qwen3.5-plus`      | Alibaba    | Qwen-VL series                 |

**Not vision-capable (text-only):** `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-free`, `hy3-preview`, `ring-2.6-1t-free`, `trinity-large-preview-free`, `nemotron-3-super-free`, `big-pickle`.

> **⚠️ v0.1.5 Correction (2026-05-20):** The initial `VISION_CAPABLE_MODELS` registry included several models that OpenCode metadata does NOT support for image attachment. As of v0.1.5, the following were **removed** from the vision-capable set: `glm-5`, `glm-5.1`, `minimax-m2.5`, `minimax-m2.7`, `minimax-m2.5-free`, `mimo-v2-pro`, and `mimo-v2.5-pro`. The table above reflects the **initial** v0.1.4 registry. See `docs/issues/08-20260520-vision-image-request-fixes.md` for the audit details.

### 2. Per-Model Capabilities

Changed `modelCapabilities()` from a static function to one that accepts `modelId`:

```ts
// Before (hardcoded)
function modelCapabilities(): CopilotCompatibleCapabilities {
  return {
    imageInput: false,
    toolCalling: 128,
    supportsImageToText: false,
    supportsToolCalling: true,
  };
}

// After (per-model)
function modelCapabilities(modelId: string): CopilotCompatibleCapabilities {
  const supportsVision = VISION_CAPABLE_MODELS.has(modelId);
  return {
    imageInput: supportsVision,
    toolCalling: 128,
    supportsImageToText: supportsVision,
    supportsToolCalling: true,
  };
}
```

Updated call site in `provideLanguageModelChatInformation()`:

```ts
capabilities: modelCapabilities(modelId),
```

### 3. Multimodal Content Type

Extended `ApiMessage.content` to support OpenAI multimodal content parts:

```ts
interface OpenAiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ApiMessage {
  role: ApiRole;
  content: string | null | OpenAiContentPart[];
  // ...
}
```

### 4. Image Part Handling in `convertMessage()`

Added `LanguageModelDataPart` handling that converts `Uint8Array` image data to a base64 data URI in the OpenAI `image_url` content part format:

```ts
if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
  const base64 = btoa(String.fromCodePoint(...part.data));
  imageParts.push({
    type: "image_url",
    image_url: { url: `data:${part.mimeType};base64,${base64}` },
  });
  continue;
}
```

When images are present, the message content becomes a multimodal array:

```ts
let content: string | null | OpenAiContentPart[];
if (hasImages) {
  const multimodal: OpenAiContentPart[] = [];
  if (textContent) {
    multimodal.push({ type: "text", text: textContent });
  }
  multimodal.push(...imageParts);
  content = multimodal;
}
```

### 5. Safe Message Normalization

Updated `normalizeMessages()` to only merge consecutive messages when both have string content — multimodal arrays are preserved as-is:

```ts
const prevIsString = typeof prevContent === "string";
const msgIsString = typeof msgContent === "string";

if (previous?.role === message.role && prevIsString && msgIsString && ...) {
  previous.content = `${prevContent}\n\n${msgContent}`.trim();
} else {
  normalized.push({ ...message });
}
```

Updated `hasMessagePayload()` to detect array content as valid payload:

```ts
if (Array.isArray(message.content)) {
  return message.content.length > 0;
}
```

---

## Files Changed

| File               | Change                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `src/extension.ts` | Added `VISION_CAPABLE_MODELS` set, `OpenAiContentPart` interface    |
| `src/extension.ts` | Changed `modelCapabilities()` to accept `modelId` parameter         |
| `src/extension.ts` | Updated `convertMessage()` to handle `LanguageModelDataPart` images |
| `src/extension.ts` | Extended `ApiMessage.content` type for multimodal arrays            |
| `src/extension.ts` | Updated `normalizeMessages()` for safe array handling               |
| `src/extension.ts` | Updated `hasMessagePayload()` for array content detection           |

---

## Verification

```bash
# 1. Compile check
npm run compile

# 2. Verify capabilities are per-model
rg "modelCapabilities\(" src/extension.ts
# Should show: modelCapabilities(modelId)

# 3. Verify vision model set
rg "VISION_CAPABLE_MODELS" src/extension.ts
# Should show 13 model IDs

# 4. Verify image handling in convertMessage
rg "LanguageModelDataPart" src/extension.ts
# Should show instanceof check with image/ MIME filter

# 5. Verify multimodal content type
rg "OpenAiContentPart" src/extension.ts
# Should show interface definition and usage in convertMessage
```

### Manual Test

1. Reload VS Code window after build
2. Open Copilot Chat
3. Select a vision-capable model (e.g. **GLM 5.1**, **Kimi K2.6**, **Minimax M2.7**)
4. Verify the image attachment button (📎 or screenshot) is available
5. Attach an image and send a prompt asking about the image content
6. Verify the model responds with image-aware content

---

## VS Code API Notes

- **`LanguageModelChatCapabilities.imageInput`** — Boolean that tells Copilot whether to show image attachment UI for this model.
- **`LanguageModelDataPart`** — VS Code's class for delivering binary data (images, JSON) in chat messages. Has `data: Uint8Array` and `mimeType: string` properties.
- **`LanguageModelDataPart.image()`** — Static factory for creating image parts (used by Copilot internally when user attaches an image).
- The `imageInput` capability flag is what controls the Copilot UI. Without it set to `true`, Copilot will not send image data regardless of model support.
