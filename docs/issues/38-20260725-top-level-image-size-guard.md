**Status:** ⚠️ Deprecated (superseded by #94)
**Supersedes:** [`44-20260803-issue94-image-normalization.md`](44-20260803-issue94-image-normalization.md)

# Top-Level Image Attachment Size Guard — Prevent 400 on Oversized Pasted Images

**Topic:** vision / streaming / provider / gateway
**Updated:** 2026-08-05
**Tags:** #vision #streaming #provider #gateway #bug

---

## ⚠️ Superseded by PR #102 (issue #94, 2026-08-04)

The fix described below (a hard `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` raw-byte
guard that replaced oversized images with a placeholder) was **removed** in
PR #102 commit `4572a9f`. PR #102 introduced a proper image normalizer
(`src/imageNormalizer.ts`) that resizes and re-encodes oversized images to the
OpenCode CLI contract (2000×2000 / 5 MB base64) **before** any guard runs, so
images that the old guard would have dropped are now sent successfully after
normalization.

What changed in the current code:

- `MAX_TOP_LEVEL_IMAGE_BYTES` constant — **deleted**.
- `convertMessage()` is now `async`; top-level and tool-result image parts run
  through `normalizeImagePart()` before the final `MAX_IMAGE_BASE64_BYTES`
  (5 MB) guard decides whether the normalized payload is still safe to send.
- `MAX_TOOL_RESULT_IMAGE_BYTES` (1 MB raw, for cumulative MCP screenshot
  history bounding) is **kept**, since the normalizer does not bound the
  multi-image accumulation case.

See [`44-20260803-issue94-image-normalization.md`](44-20260803-issue94-image-normalization.md)
for the current implementation. The rest of this document is preserved as
historical reference for issue #38 context, MiMo-specific evidence, and the
byte-count thresholds that informed the original guard.

---

## Overview

When a user pasted or dragged a large image (4K screenshot, high-res phone photo)
into Copilot Chat while using a vision-capable OpenCode model (e.g. `mimo-v2.5`),
the request failed with:

```text
OpenCode Go API request failed (400) model=mimo-v2.5 payloadBytes=3182845:
Error from provider (Console Go): Upstream request failed
```

The 3.18 MB payload (~2.4 MB raw image × 1.33 base64 overhead) was forwarded
directly to the OpenCode Go gateway, which rejected it. Top-level image
attachments had **no size guard**, unlike MCP tool-result images which were
already capped at 1 MB by `MAX_TOOL_RESULT_IMAGE_BYTES` (PR #79 / `ec92a44`).

This was **not a regression** — the top-level image handler in
`src/extension.ts` `convertMessage()` never had a size cap since it was first
introduced in commit `dee9634`. The latent bug only surfaced now because users
are attaching larger images than before.

---

## Problem Statement

### Observed behavior

| Path                                      | Worked?                                                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Top-level paste/drag small image (< 1 MB) | ✅ Yes                                                                |
| Top-level paste/drag large image (> 2 MB) | ❌ No — `400 Upstream request failed`                                 |
| MCP tool result image (any size)          | ✅ Yes — guarded by `MAX_TOOL_RESULT_IMAGE_BYTES` (1 MB) since PR #79 |
| Built-in Copilot model + same image       | ✅ Yes                                                                |

### Error signature

```text
Client Request Id: 8f70e12c-e1d9-46df-a1de-33b74a3962e5
Reason: OpenCode Go API request failed (400) model=mimo-v2.5 payloadBytes=3182845:
Error from provider (Console Go): Upstream request failed
  at buildOpenCodeRequestError (.../out/errors.js:39:12)
  at streamOpenCodeResponse (.../out/streaming.js:333:73)
  at streamChatCompletions (.../out/streaming.js:64:5)
```

### Why MiMo in particular

`mimo-v2.5` is listed in `VISION_CAPABLE_MODELS` (`src/metadata.ts:247`), so the
extension treats it as a **native vision model**. This means:

1. `modelCapabilities()` reports `imageInput: true` — VS Code keeps image parts.
2. The vision proxy (`proxyVision()`) is **not** activated — it only fires for
   text-only models.
3. Images are forwarded directly to the model via transport chat-completions as
   OpenAI-style `image_url` base64 data URIs.
4. A 3.18 MB payload exceeds the (unpublished) OpenCode Go gateway limit and is
   rejected upstream.

---

## Root Cause

### The unguarded serialization path

In `src/extension.ts` `convertMessage()`, top-level image attachments were
serialized as:

```ts
if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
  const base64 = dataPartToBase64(part.data);
  imageParts.push({
    type: "image_url",
    image_url: { url: `data:${part.mimeType};base64,${base64}` },
  });
  continue;
}
```

No byte-length check. Any image, regardless of size, was encoded as a base64
data URI (~1.33× its raw byte size) and inserted into the request payload.

### Asymmetry with tool-result path

PR #79 (`ec92a44`) introduced a hard cap for images nested inside
`LanguageModelToolResultPart`:

```ts
const MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000; // 1 MB raw bytes

if (resultPart.data.byteLength > MAX_TOOL_RESULT_IMAGE_BYTES) {
  toolTextParts.push(
    `[Image attachment omitted: ${resultPart.data.byteLength} bytes exceeds the ${MAX_TOOL_RESULT_IMAGE_BYTES}-byte limit for tool results. ...]`,
  );
  continue;
}
```

But the **top-level** path — which is the more common entry point for user
images — was overlooked. Doc `docs/features/12-20260720-mcp-tool-result-image-support.md`
Limitations #3 explicitly acknowledged this:

> _"Top-level image attachments still have no size cap. Only tool-result images
> are bounded. Consistent limit can be added in a follow-up if users hit
> oversized pasted images."_

This is that follow-up.

### Why not a regression

`git log -L 3336,3341:src/extension.ts` confirms the top-level image handler
**never** had a size guard:

| Commit    | Date       | Change                                                              |
| --------- | ---------- | ------------------------------------------------------------------- |
| `dee9634` | Initial    | First vision support — base64 encode, no size check                 |
| `d0032ed` | Early      | Refactor `btoa` → `dataPartToBase64` (still no size check)          |
| `ec92a44` | 2026-07-20 | Added `MAX_TOOL_RESULT_IMAGE_BYTES` — but **only** for tool results |

No subsequent commit modified the top-level image branch. The bug was latent
since day one; it surfaced now because users are attaching larger images.

---

## Research (evidence-based)

### Provider limits — authoritative sources

| Provider            | Per-image limit                           | Total payload           | Source                                                                                                                         |
| ------------------- | ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **OpenAI**          | (not explicit)                            | 512 MB, 1500 images     | [developers.openai.com/api/docs/guides/images](https://developers.openai.com/api/docs/guides/images)                           |
| **Anthropic**       | **10 MB base64** (5 MB on Bedrock/Vertex) | 32 MB standard endpoint | [platform.claude.com/docs/en/docs/build-with-claude/vision](https://platform.claude.com/docs/en/docs/build-with-claude/vision) |
| **OpenCode Go/Zen** | Not published                             | Not published           | [opencode.ai/docs/zen](https://opencode.ai/docs/zen)                                                                           |

### Why upstream auto-resize makes large payloads pointless

OpenAI and Anthropic docs both confirm that **vision models auto-resize images
to a patch budget** before tokenization:

- **OpenAI**: 1568–2576 px long-edge depending on `detail` and model family.
- **Anthropic**: 1568 px (standard tier) / 2576 px (high-res tier), ~4784 visual
  tokens max.

Image pixels beyond the patch budget are discarded by the upstream model
regardless of what the client sends. Forwarding a 4K raw image is pure waste —
the model downscales it to ~1568–2576 px before processing. There is **no
fidelity benefit** to sending multi-MB raw images.

### Verified rejection point

The user's error shows `payloadBytes=3182845` (~3.18 MB) was rejected by the
OpenCode Go gateway. Combined with Anthropic's published 5–10 MB per-image
limit on partner platforms, 2 MB raw (→ ~2.7 MB base64) is a safe threshold with
margin.

---

## Solution

### 1. New constant `MAX_TOP_LEVEL_IMAGE_BYTES`

```ts
const MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000; // 2 MB raw bytes
```

Intentionally **more liberal** than `MAX_TOOL_RESULT_IMAGE_BYTES` (1 MB) because:

- Top-level images are user-supplied screenshots/photos, typically larger than
  pre-compressed MCP tool-result screenshots.
- Anthropic's published per-image limit is 5–10 MB; 2 MB stays well under that.
- OpenCode Go verified to reject 3.18 MB; 2 MB raw → ~2.7 MB base64 stays under
  the observed rejection point.

### 2. Size guard in `convertMessage()`

```ts
if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
  if (part.data.byteLength > MAX_TOP_LEVEL_IMAGE_BYTES) {
    textParts.push(
      `[Image attachment omitted: ${part.data.byteLength} bytes exceeds the ` +
        `${MAX_TOP_LEVEL_IMAGE_BYTES}-byte limit for top-level attachments. ` +
        `Resize or compress the image to under ${Math.floor(MAX_TOP_LEVEL_IMAGE_BYTES / 1_000_000)} MB and re-attach it.]`,
    );
    continue;
  }
  const base64 = dataPartToBase64(part.data);
  imageParts.push({
    type: "image_url",
    image_url: { url: `data:${part.mimeType};base64,${base64}` },
  });
  continue;
}
```

The model still knows an image was attached (placeholder text part is emitted),
and the user gets an **actionable hint** with the actual byte count, the limit,
and the suggested fix (resize/compress).

### Why not auto-resize inside the extension

Considered and rejected:

| Option                   | Verdict          | Reason                                                                                             |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------- |
| `sharp` (native binary)  | ❌ Rejected      | ~30 MB native dep, impractical for VS Code extension packaging, platform-specific builds           |
| `jimp` / pure-JS         | ❌ Rejected      | Manual impl, quality inconsistency across formats, large dep                                       |
| Delegate to vision proxy | ❌ Rejected      | Would silently consume Copilot quota; vision proxy is for text-only models, not native-vision MiMo |
| VS Code built-in API     | ❌ Not available | `vscode.LanguageModelDataPart` is immutable; no native resize API                                  |

Upstream models auto-resize to a patch budget anyway, so a client-side resize
layer adds complexity with no fidelity benefit.

---

## Files Changed

| File               | Change                                                                              | Lines |
| ------------------ | ----------------------------------------------------------------------------------- | ----- |
| `src/extension.ts` | New constant `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` with JSDoc rationale           | +23   |
| `src/extension.ts` | Size guard in `convertMessage()` top-level image branch with actionable placeholder | +15   |

**Total:** 1 file, +38 lines, 0 deletions.

---

## Code Locations

| Concern                                              | Location                                       |
| ---------------------------------------------------- | ---------------------------------------------- |
| `MAX_TOP_LEVEL_IMAGE_BYTES` constant                 | `src/extension.ts` (~L582)                     |
| Top-level image size guard                           | `src/extension.ts` `convertMessage()` (~L3359) |
| `MAX_TOOL_RESULT_IMAGE_BYTES` (tool-result analogue) | `src/extension.ts` (~L559)                     |
| Tool-result image size guard                         | `src/extension.ts` `convertMessage()` (~L3292) |

---

## Verification

- `npm run compile` (tsc strict) — **pass**, no errors.
- `get_errors src/extension.ts` — **0 errors**.
- `git diff --stat` — 1 file, +38 lines, scoped to the single image branch.

Manual testing path (deferred to release validation): paste a >2 MB image into
Copilot Chat with `mimo-v2.5` selected — model should now receive a placeholder
text note instead of the raw image, and no `400 Upstream request failed` should
occur.

---

## Limitations & Follow-ups

1. **No automatic resize.** Users must resize/compress externally before
   re-attaching. A future enhancement could bundle a pure-JS decoder for the
   common formats (PNG/JPEG) if the false-positive rate becomes a problem.
2. **Single threshold for all transports.** The 2 MB cap is the most
   conservative across Anthropic (5–10 MB) and observed OpenCode Go behavior
   (~3 MB rejection). Per-transport tuning is possible but adds complexity
   without clear benefit given upstream auto-resize.
3. **History-level trimming not addressed.** This bounds each image
   individually; a conversation with many small images can still cumulatively
   exceed the model's context window. VS Code's own history trimming is
   expected to handle that, and `estimateTokenCount` accounts for image tokens
   via `IMAGE_TOKEN_ESTIMATE`.

---

## Related Docs

- [`docs/features/01-20260514-vision-image-input.md`](../features/01-20260514-vision-image-input.md) — top-level image attachment foundation
- [`docs/features/11-20260715-vision-proxy.md`](../features/11-20260715-vision-proxy.md) — vision proxy for text-only models
- [`docs/features/12-20260720-mcp-tool-result-image-support.md`](../features/12-20260720-mcp-tool-result-image-support.md) — MCP tool-result image guard (`MAX_TOOL_RESULT_IMAGE_BYTES`)
- [`docs/issues/34-20260720-mcp-tool-result-image-dropped.md`](34-20260720-mcp-tool-result-image-dropped.md) — original tool-result size-guard investigation
