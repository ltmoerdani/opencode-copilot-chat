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
