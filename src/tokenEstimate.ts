import { IMAGE_TOKEN_ESTIMATE } from "./config";
import { countImageDataParts, stripImageData } from "./request/shared";
import type { ApiMessage } from "./request/types";

export interface PromptToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Estimate the complete prompt surface that the provider will tokenize.
 *
 * CONTRACT: base64 image data is replaced with a short placeholder before the
 * character heuristic runs; each stripped image is charged a bounded
 * `IMAGE_TOKEN_ESTIMATE` instead of its base64 length (#287). Hosted image
 * URLs stay counted as ordinary text. Tool schemas are included as before.
 */
export function estimatePromptTokenCount(messages: readonly ApiMessage[], tools?: readonly PromptToolDefinition[]): number {
  let imageTokens = 0;
  const strippedMessages = messages.map((message) => {
    imageTokens += countImageDataParts(message) * IMAGE_TOKEN_ESTIMATE;
    return stripImageData(message);
  });
  const prompt = {
    messages: strippedMessages,
    ...(tools?.length
      ? {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        }
      : {}),
  };

  return estimateTokenCount(JSON.stringify(prompt)) + imageTokens;
}

/** Estimate one message with the same image accounting as the full prompt. */
export function estimateMessageTokenCount(message: ApiMessage): number {
  return estimateTokenCount(JSON.stringify(stripImageData(message))) + countImageDataParts(message) * IMAGE_TOKEN_ESTIMATE;
}

export function estimateTokenCount(value: string): number {
  if (!value) return 0;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;

  // JSON structure makes word-count heuristics far too pessimistic. Character
  // count is steadier; modelLimits adds a proportional request-time margin for
  // tokenizer differences and retry.ts handles authoritative overflow errors.
  const cjkCharacters = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const charEstimate = Math.ceil(normalized.length / 4);
  const codeBuffer = Math.ceil(charEstimate * 0.1);

  return Math.max(1, Math.ceil(charEstimate + codeBuffer + cjkCharacters));
}
