import * as vscode from "vscode";
import { isInternalDataPart, isReasoningMarkerPart, readReasoningMarker } from "../chatParts";
import { requiresStringToolContent } from "../models/modelCapabilities";
import { MAX_HISTORY_IMAGES_KEPT, MAX_TOOL_RESULT_IMAGE_BYTES } from "../config";
import { getImageDataUrlBase64Bytes, MAX_IMAGE_BASE64_BYTES, normalizeImageDataUrl } from "../imageNormalizer";
import { shouldEchoThinkingHistory, thinkingTextFromValue } from "../reasoningHistory";
import type { ApiMessage, OpenAiContentPart, OpenAiToolCall } from "../request/types";
import { partToText } from "./tokens";
import type { ConvertedMessageResult } from "./definitions";

/** Convert a VS Code chat message (text/tool/data/thinking parts) into the wire format. */
export async function convertMessage(
  message: vscode.LanguageModelChatRequestMessage,
  reasoningContentByToolCallId: ReadonlyMap<string, string>,
  rawModelId?: string,
): Promise<ConvertedMessageResult> {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const textParts: string[] = [];
  const thinkingTextParts: string[] = [];
  const imageParts: OpenAiContentPart[] = [];
  const toolCalls: OpenAiToolCall[] = [];
  const toolResults: ApiMessage[] = [];
  // Tool-result images deferred to a follow-up user message (see
  // requiresStringToolContent — "defer" mode). Emitted by finish().
  const deferredToolImageParts: OpenAiContentPart[] = [];
  let normalizedImageCount = 0;

  const normalizeImagePart = async (part: vscode.LanguageModelDataPart): Promise<string> => {
    const originalUrl = `data:${part.mimeType};base64,${dataPartToBase64(part.data)}`;
    const normalizedUrl = await normalizeImageDataUrl(originalUrl);
    if (normalizedUrl !== originalUrl) {
      normalizedImageCount += 1;
    }
    return normalizedUrl;
  };

  const finish = (messages: ApiMessage[]): ConvertedMessageResult => {
    const result = [...messages];
    if (deferredToolImageParts.length > 0) {
      // Tool images rejected in role:"tool" content but accepted in user
      // content (verified against zen/go/v1 chat-completions for
      // glm-5.3-flash: tool image_url → 422, user image_url → 200). Append
      // them as a follow-up user message so vision capability is preserved.
      result.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "Images returned by a tool result (the upstream provider does not accept images inside tool messages):",
          },
          ...deferredToolImageParts,
        ],
      });
    }
    return { messages: result, normalizedImageCount };
  };

  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: part.callId,
        type: "function",
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input),
        },
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelToolResultPart) {
      // CONTRACT: A LanguageModelToolResultPart.content is unknown[] and may
      // contain nested LanguageModelDataPart instances with image MIME types.
      // This happens when MCP tools (e.g. chrome-devtools-mcp screenshots)
      // return images. Previously we only ran partToText() which silently
      // dropped image DataParts (returned "" via the catch-all fallback),
      // so vision-capable models saw an empty tool result. We now serialize
      // nested images into OpenAiContentPart image_url parts and emit a
      // multimodal array on the tool message when any image is present.
      //
      // SIZE GUARD: Images larger than MAX_TOOL_RESULT_IMAGE_BYTES are
      // replaced with a placeholder text part. This prevents a single
      // oversized MCP screenshot from producing multi-MB payloads that
      // trigger upstream 400 errors when the conversation history grows.
      // Fallback for any non-text, non-image DataPart stays as plain text.
      const toolTextParts: string[] = [];
      const toolImageParts: OpenAiContentPart[] = [];
      for (const resultPart of part.content) {
        if (
          resultPart instanceof vscode.LanguageModelDataPart &&
          resultPart.mimeType.startsWith("image/") &&
          !isInternalDataPart(resultPart)
        ) {
          if (resultPart.data.byteLength > MAX_TOOL_RESULT_IMAGE_BYTES) {
            toolTextParts.push(
              `[Image attachment omitted: ${String(resultPart.data.byteLength)} bytes exceeds the ${String(MAX_TOOL_RESULT_IMAGE_BYTES)}-byte limit for tool results. Ask the tool to produce a smaller screenshot or save it to a file.]`,
            );
            continue;
          }
          const imageUrl = await normalizeImagePart(resultPart);
          toolImageParts.push({
            type: "image_url",
            image_url: { url: imageUrl },
          });
          continue;
        }

        const text = partToText(resultPart);
        if (text) {
          toolTextParts.push(text);
        }
      }

      let toolContent: string | OpenAiContentPart[];
      // PROVIDER QUIRK: several chat-completions upstreams reject multimodal
      // (list-type) content on role:"tool" messages while accepting the same
      // parts in user/assistant messages. requiresStringToolContent() maps a
      // model to its handling mode:
      //   "drop"  — MiMo: upstream cannot see tool images at all (issue #38,
      //             upstream anomalyco/opencode#32613); flatten to a string
      //             and replace each image with a placeholder note.
      //   "defer" — glm-5.3* (issue #233): tool-message image_url parts are
      //             rejected with HTTP 422 "[invalid_request_error] Input
      //             should be a valid string", but the SAME images in a user
      //             message return 200. Flatten the tool message to a string
      //             and move the images into a follow-up user message (see
      //             finish()), preserving vision instead of dropping it.
      //   null    — default: keep the multimodal array (Kimi, GLM-5.1/5.2,
      //             MiniMax, Qwen all accept list-type tool content).
      const stringToolContentMode = requiresStringToolContent(rawModelId);
      if (toolImageParts.length > 0 && stringToolContentMode !== null) {
        const flattened: string[] = [...toolTextParts];
        if (stringToolContentMode === "drop") {
          for (let i = 0; i < toolImageParts.length; i++) {
            flattened.push(
              `[Tool returned an image attachment, but the MiMo upstream provider does not accept images in tool messages. Image ${String(i + 1)} of ${String(toolImageParts.length)} was dropped to keep the request valid.]`,
            );
          }
        } else {
          flattened.push(
            `[Tool returned ${toolImageParts.length === 1 ? "an image attachment" : `${String(toolImageParts.length)} image attachments`}; ${toolImageParts.length === 1 ? "it is" : "they are"} included in the following message.]`,
          );
          deferredToolImageParts.push(...toolImageParts);
        }
        toolContent = flattened.join("\n");
      } else if (toolImageParts.length > 0) {
        const multimodal: OpenAiContentPart[] = [];
        const joinedText = toolTextParts.join("\n");
        if (joinedText) {
          multimodal.push({ type: "text", text: joinedText });
        }
        multimodal.push(...toolImageParts);
        toolContent = multimodal;
      } else {
        toolContent = toolTextParts.join("\n");
      }

      toolResults.push({
        role: "tool",
        tool_call_id: part.callId,
        content: toolContent,
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      // Normalize before the final payload guard. The previous raw-byte guard
      // ran first and dropped images that could have been resized or compressed
      // into a provider-safe representation.
      const imageUrl = await normalizeImagePart(part);
      const base64Bytes = getImageDataUrlBase64Bytes(imageUrl);
      if (base64Bytes === undefined || base64Bytes > MAX_IMAGE_BASE64_BYTES) {
        textParts.push(
          `[Image attachment omitted: normalized payload exceeds the ` +
            `${String(Math.floor(MAX_IMAGE_BASE64_BYTES / (1024 * 1024)))} MB base64 limit. ` +
            `Resize or compress the image and re-attach it.]`,
        );
        continue;
      }
      imageParts.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelDataPart && isReasoningMarkerPart(part)) {
      // Thinking-off responses carry their reasoning in a marker data part
      // (see streaming.ts / gateway bug #37635); echo it as reasoning_content
      // on the next turn or DeepSeek's validator 400s. Must be checked BEFORE
      // isInternalDataPart (which now includes the marker MIME) so the marker
      // is processed rather than skipped as an internal usage part.
      const reasoning = readReasoningMarker(part);
      if (reasoning) {
        thinkingTextParts.push(reasoning);
      }
      continue;
    }

    if (part instanceof vscode.LanguageModelDataPart && isInternalDataPart(part)) {
      continue;
    }

    if (part instanceof vscode.LanguageModelThinkingPart) {
      const thinking = thinkingPartText(part);
      if (thinking) {
        thinkingTextParts.push(thinking);
      }
      continue;
    }

    const text = partToText(part);
    if (text) {
      textParts.push(text);
    }
  }

  // Build content: use multimodal array if images present, otherwise plain string
  const hasImages = imageParts.length > 0;
  const textContent = textParts.join("\n");

  // Thinking parts from the conversation history. Models like DeepSeek V4
  // (OpenAI-compatible chat-completions) REQUIRE the previously emitted
  // reasoning_content to be passed back unchanged on multi-turn requests —
  // omitting it yields HTTP 400 "The reasoning_content in the thinking mode
  // must be passed back to the API". This also enables cross-turn reasoning
  // continuity for other families (Kimi, GLM, Qwen, MiniMax, Gemini).
  const thinkingText = thinkingTextParts.length ? thinkingTextParts.join("\n").trim() : undefined;

  let content: string | null | OpenAiContentPart[] = textContent;
  if (hasImages) {
    const multimodal: OpenAiContentPart[] = [];
    if (textContent) {
      multimodal.push({ type: "text", text: textContent });
    }
    multimodal.push(...imageParts);
    content = multimodal;
  }

  if (role === "assistant" && toolCalls.length) {
    // CONTRACT: reasoning_content injection into tool_call assistant messages
    // is gated by model family. MiMo upstream (Xiaomi) uses a strict Pydantic-
    // style validator that rejects assistant tool_call messages carrying a
    // `reasoning_content` field with HTTP 400 `Upstream request failed`, once
    // the conversation history contains tool_calls with reasoning echo. This
    // mirrors the DeepSeek V4 issue (#36354 upstream) and was verified in this
    // extension's logs (issue #38, 2026-07-25): MiMo succeeds until the first
    // tool_call turn with reasoning_content, then every subsequent turn 400s.
    //
    // For MiMo we omit reasoning_content in the echoed assistant tool_call
    // history. The current live response still surfaces reasoning_content to
    // the user via the thinking panel — only the *history echo* is dropped.
    // Other families (DeepSeek, Kimi, GLM, Qwen, MiniMax) tolerate the echo
    // and keep it for cross-turn reasoning continuity.
    const shouldOmitReasoningEcho = rawModelId !== undefined && /^mimo-/i.test(rawModelId);
    return finish([
      {
        role,
        content: typeof content === "string" ? content || null : content,
        reasoning_content: shouldOmitReasoningEcho
          ? undefined
          : (reasoningForToolCalls(toolCalls, reasoningContentByToolCallId) ?? thinkingText),
        tool_calls: toolCalls,
      },
    ]);
  }

  if (toolResults.length) {
    return finish(content ? [{ role, content }, ...toolResults] : toolResults);
  }

  if (role === "assistant") {
    return finish([
      {
        role,
        content: typeof content === "string" ? content || null : content,
        reasoning_content: shouldEchoThinkingHistory(rawModelId) ? thinkingText : undefined,
      },
    ]);
  }

  return finish([{ role, content }]);
}

export function dataPartToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

export function reasoningForToolCalls(
  toolCalls: OpenAiToolCall[],
  reasoningContentByToolCallId: ReadonlyMap<string, string>,
): string | undefined {
  const reasoning = toolCalls
    .map((toolCall) => reasoningContentByToolCallId.get(toolCall.id))
    .filter((value): value is string => Boolean(value?.trim()));

  return reasoning.length ? reasoning.join("\n") : undefined;
}

/**
 * Extract the raw thinking text from a history `LanguageModelThinkingPart`.
 * `LanguageModelThinkingPart` is a proposed VS Code API available at runtime
 * on all hosts we target (^1.125.0); `partToText` intentionally ignores it so
 * the thinking text never leaks into the visible assistant `content`. The
 * `typeof` guard mirrors `streaming.ts` so we degrade gracefully on any
 * hypothetical older host.
 */
export function thinkingPartText(part: unknown): string {
  if (typeof vscode.LanguageModelThinkingPart !== "function" || !(part instanceof vscode.LanguageModelThinkingPart)) {
    return "";
  }
  return thinkingTextFromValue(part.value);
}

export function normalizeMessages(messages: ApiMessage[]): ApiMessage[] {
  const normalized: ApiMessage[] = [];

  for (const message of messages) {
    if (!hasMessagePayload(message)) {
      continue;
    }

    const previous = normalized.at(-1);
    const prevContent = previous?.content;
    const msgContent = message.content;
    const prevIsString = typeof prevContent === "string";
    const msgIsString = typeof msgContent === "string";
    const prevHasToolCalls = !!(previous?.tool_calls?.length || previous?.tool_call_id);
    const msgHasToolCalls = !!(message.tool_calls?.length || message.tool_call_id);

    if (
      previous?.role === message.role &&
      message.role !== "tool" &&
      prevIsString &&
      msgIsString &&
      !prevHasToolCalls &&
      !msgHasToolCalls
    ) {
      // Merging two assistant messages must not drop the second one's
      // reasoning_content — DeepSeek-style models require it echoed back on
      // the next turn. Concatenate both into the merged message.
      if (message.reasoning_content) {
        previous.reasoning_content = [previous.reasoning_content, message.reasoning_content].filter(Boolean).join("\n");
      }
      previous.content = `${prevContent}\n\n${msgContent}`.trim();
    } else {
      normalized.push({ ...message });
    }
  }

  if (normalized[0]?.role === "assistant") {
    normalized.unshift({
      role: "user",
      content: "Continue the conversation based on the prior assistant message.",
    });
  }

  return normalized.length ? normalized : [{ role: "user", content: "" }];
}

/**
 * Replace image content parts in older messages with a placeholder text note
 * in place, keeping only the most recent `MAX_HISTORY_IMAGES_KEPT` images in
 * the conversation. This bounds the cumulative payload weight when MCP
 * screenshot loops (chrome-devtools-mcp, playwright-mcp) accumulate base64
 * data URIs in history and trigger upstream `400 Upstream request failed`
 * rejections from OpenCode Go.
 *
 * CONTRACT:
 *   - Iterates messages from newest to oldest, counting `image_url` parts.
 *   - Once `MAX_HISTORY_IMAGES_KEPT` images have been seen, every subsequent
 *     (older) image part is replaced in place with a placeholder text note.
 *   - Non-image content parts (text, tool_calls, tool_call_id) are preserved
 *     unchanged — the conversation structure stays intact.
 *   - The placeholder replaces the image part in the same message's content
 *     array; the array shape is preserved so downstream transport builders
 *     still see a valid multimodal structure.
 *   - Mutates the input array's message `content` fields in place (safe: the
 *     caller `provideLanguageModelChatResponse` does not reuse the original
 *     array after this point).
 *
 * INVARIANTS:
 *   - Total `image_url` parts remaining in the array after the call ≤
 *     `MAX_HISTORY_IMAGES_KEPT`.
 *   - Every original image position is either preserved or replaced with a
 *     placeholder text part — no message is silently dropped.
 *
 * @param messages ApiMessage[] from convertMessage() — must be in chronological
 *                 order (oldest first, newest last), as produced by
 *                 `messages.flatMap(convertMessage)`. Mutated in place.
 * @returns Number of image parts that were replaced with a placeholder (for
 *          diagnostic logging). Returns 0 when no trimming was needed.
 */
export function trimOldImagesFromHistoryInPlace(messages: ApiMessage[]): number {
  // Count total images to decide whether trimming is needed. Cheap pass that
  // skips allocation and mutation for the common case (short conversations,
  // 0-2 images).
  let totalImages = 0;
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "image_url") totalImages++;
    }
  }
  if (totalImages <= MAX_HISTORY_IMAGES_KEPT) {
    return 0;
  }

  // Walk newest -> oldest, allowing the first MAX_HISTORY_IMAGES_KEPT images
  // to pass through and replacing every older image with a placeholder note.
  let imagesKept = 0;
  let replacedCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!Array.isArray(msg.content)) continue;
    const hasImage = msg.content.some((p) => p.type === "image_url");
    if (!hasImage) continue;
    // Build a new content array, replacing image parts once the budget is spent.
    // We rebuild the array rather than splice-in-place because the original
    // parts array may be shared with the caller's view.
    const newContent: OpenAiContentPart[] = [];
    for (const part of msg.content) {
      if (part.type === "image_url") {
        if (imagesKept < MAX_HISTORY_IMAGES_KEPT) {
          newContent.push(part);
          imagesKept++;
        } else {
          newContent.push({
            type: "text",
            text: "[Earlier screenshot omitted from history to keep request payload under gateway limit. The latest screenshots above are preserved.]",
          });
          replacedCount++;
        }
      } else {
        newContent.push(part);
      }
    }
    msg.content = newContent;
  }
  return replacedCount;
}

export function hasMessagePayload(message: ApiMessage): boolean {
  if (message.tool_calls?.length || message.tool_call_id) {
    return true;
  }

  if (typeof message.content === "string") {
    return message.content.trim().length > 0;
  }

  if (Array.isArray(message.content)) {
    return message.content.length > 0;
  }

  return false;
}
