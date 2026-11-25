/**
 * Shared helpers for the request builders.
 *
 * CONTRACT: pure functions only — no `vscode` import, no side effects.
 */
import type { ApiMessage, OpenAiContentPart } from "./types";

/** Whether any message in the conversation carries an image part. */
export function messagesHaveImages(messages: readonly ApiMessage[]): boolean {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
}

/** Placeholder substituted for base64 image data when measuring payload weight. */
export const IMAGE_DATA_PLACEHOLDER = "[image]";

/** Count base64 data-URL image parts in one message (token accounting, #287). */
export function countImageDataParts(message: ApiMessage): number {
  if (!Array.isArray(message.content)) {
    return 0;
  }
  let count = 0;
  for (const part of message.content) {
    const url = part.type === "image_url" ? part.image_url?.url : undefined;
    if (typeof url === "string" && url.startsWith("data:")) {
      count += 1;
    }
  }
  return count;
}

/**
 * Shallow clone of `m` with base64 data-URL image payloads replaced by a short
 * placeholder. Only `data:` URLs are stripped — a hosted `https://` image URL
 * is plain text of trivial size and never carries the payload weight that
 * caused #173/#287, so it stays counted as-is. Returns `m` itself when there
 * is nothing to strip (the common case).
 */
export function stripImageData(m: ApiMessage): ApiMessage {
  if (!Array.isArray(m.content)) {
    return m;
  }
  // Copy-on-write: only clone the array when a data URL is found.
  let stripped: OpenAiContentPart[] | undefined;
  for (let i = 0; i < m.content.length; i++) {
    const part = m.content[i];
    const url = part.type === "image_url" ? part.image_url?.url : undefined;
    if (typeof url === "string" && url.startsWith("data:")) {
      stripped ??= [...m.content];
      stripped[i] = { ...part, image_url: { url: IMAGE_DATA_PLACEHOLDER } };
    }
  }
  return stripped ? { ...m, content: stripped } : m;
}

/** Leading note on deferred tool-image messages (see below). */
export const DEFERRED_TOOL_IMAGES_NOTE =
  "Images returned by a tool result (the upstream provider does not accept images inside tool messages):";

/**
 * Append tool-result images that were deferred out of role:"tool" messages as
 * a follow-up user message (issue #233). Some chat-completions upstreams
 * (glm-5.3*) reject image_url parts in tool messages with 422 while accepting
 * identical images in user messages — moving them preserves vision instead of
 * dropping them.
 *
 * Pure: returns a new array; the input is not mutated. When there is nothing
 * deferred, the input array is returned unchanged.
 */
export function withDeferredToolImageMessages(
  messages: readonly ApiMessage[],
  deferredImageParts: readonly OpenAiContentPart[],
): ApiMessage[] {
  if (deferredImageParts.length === 0) {
    return [...messages];
  }
  return [
    ...messages,
    {
      role: "user",
      content: [{ type: "text", text: DEFERRED_TOOL_IMAGES_NOTE }, ...deferredImageParts],
    },
  ];
}
