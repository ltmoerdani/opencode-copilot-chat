import * as vscode from "vscode";
import { parseToolInput } from "../toolCallAccumulator";
import { isRecord } from "../utils";
import { thinkingPartConstructor, type RequestUsageSummary } from "./streamParts";

/** Non-stream chat-completions extraction (full response, not SSE). */
function extractChatCompletionParts(data: unknown): vscode.LanguageModelResponsePart[] {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return [];
  }

  const first: unknown = data.choices[0];
  if (!isRecord(first)) {
    return [];
  }

  const parts: vscode.LanguageModelResponsePart[] = [];
  const message = first.message;
  let emittedText = false;
  if (isRecord(message)) {
    const text = extractTextFromDelta(message);
    if (text) {
      emittedText = true;
      parts.push(new vscode.LanguageModelTextPart(text));
    } else {
      const reasoning = extractReasoningFromDelta(message);
      if (reasoning.trim()) {
        // Non-stream path: emit reasoning via thinking part when the API is
        // available (so chat.agent.thinkingStyle applies), else fall back to
        // plain text. Cast needed because LanguageModelThinkingPart is in the
        // LanguageModelResponsePart2 union, not the stable LanguageModelResponsePart.
        const thinkingPart = thinkingPartConstructor
          ? (new thinkingPartConstructor(reasoning) as unknown as vscode.LanguageModelResponsePart)
          : new vscode.LanguageModelTextPart(reasoning);
        parts.push(thinkingPart);
      }
    }
    for (const toolCallPart of toolCallPartsFromOpenAiMessage(message.tool_calls)) {
      parts.push(toolCallPart);
    }
  }

  // Some gateways put text in both `message.content` and `choices[0].text`;
  // emitting both would duplicate the response, so only fall back to the
  // choice-level field when the message produced no text.
  if (typeof first.text === "string" && !emittedText) {
    parts.push(new vscode.LanguageModelTextPart(first.text));
  }

  return parts;
}

/** Pure: collect text from an OpenAI-style delta/message object. */
export function extractTextFromDelta(delta: Record<string, unknown>): string {
  const candidates: unknown[] = [delta.content, delta.text, delta.output_text];
  let collected = "";
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      collected += candidate;
      continue;
    }
    if (Array.isArray(candidate)) {
      for (const part of candidate) {
        if (typeof part === "string") {
          collected += part;
        } else if (isRecord(part)) {
          const text = part.text ?? part.value ?? part.output_text;
          if (typeof text === "string") {
            collected += text;
          }
        }
      }
    }
  }
  return collected;
}

/** Pure: collect reasoning from an OpenAI-style delta/message object. */
export function extractReasoningFromDelta(delta: Record<string, unknown>): string {
  // Callers pass either a `choices[0].delta` or a `choices[0].message` object;
  // neither carries a nested `.message`, so only the top-level fields are read.
  const candidates: unknown[] = [delta.reasoning_content, delta.reasoning, delta.thinking];
  let collected = "";
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      collected += candidate;
    } else if (isRecord(candidate) && typeof candidate.content === "string") {
      collected += candidate.content;
    } else if (Array.isArray(candidate)) {
      for (const part of candidate) {
        if (typeof part === "string") {
          collected += part;
        } else if (isRecord(part) && typeof part.text === "string") {
          collected += part.text;
        }
      }
    }
  }
  return collected;
}

/** Non-stream Anthropic messages extraction. */
function extractAnthropicParts(data: unknown): vscode.LanguageModelResponsePart[] {
  if (!isRecord(data) || !Array.isArray(data.content)) {
    return [];
  }

  const parts: vscode.LanguageModelResponsePart[] = [];
  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const block of data.content) {
    if (!isRecord(block)) {
      continue;
    }

    if (typeof block.text === "string" && block.text.length > 0) {
      textParts.push(block.text);
      continue;
    }

    // Anthropic thinking blocks — surface via thinking part when available.
    if (
      (block.type === "thinking" || block.type === "redacted_thinking") &&
      typeof block.thinking === "string" &&
      block.thinking.length > 0
    ) {
      reasoningParts.push(block.thinking);
      continue;
    }

    if (block.type === "tool_use" && typeof block.name === "string") {
      const id = typeof block.id === "string" ? block.id : `opencodego-tool-${String(Date.now())}`;
      const input = isRecord(block.input) ? block.input : parseToolInput(typeof block.input === "string" ? block.input : "{}");
      parts.push(new vscode.LanguageModelToolCallPart(id, block.name, input));
    }
  }

  const text = textParts.join("");
  if (text) {
    parts.unshift(new vscode.LanguageModelTextPart(text));
  }

  // Emit accumulated reasoning via thinking part (or text fallback) at the front.
  const reasoning = reasoningParts.join("");
  if (reasoning) {
    const thinkingPart = thinkingPartConstructor
      ? (new thinkingPartConstructor(reasoning) as unknown as vscode.LanguageModelResponsePart)
      : new vscode.LanguageModelTextPart(reasoning);
    parts.unshift(thinkingPart);
  }

  return parts;
}

/** Pure: build tool-call parts from an OpenAI-style `tool_calls` array. */
function toolCallPartsFromOpenAiMessage(toolCalls: unknown): vscode.LanguageModelToolCallPart[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .filter(isRecord)
    .map((toolCall, index) => {
      const fn = toolCall.function;
      const id = typeof toolCall.id === "string" ? toolCall.id : `opencodego-tool-${String(Date.now())}-${String(index)}`;
      const name = isRecord(fn) && typeof fn.name === "string" ? fn.name : "";
      const args = isRecord(fn) && typeof fn.arguments === "string" ? fn.arguments : "{}";
      return name ? new vscode.LanguageModelToolCallPart(id, name, parseToolInput(args)) : undefined;
    })
    .filter((part): part is vscode.LanguageModelToolCallPart => Boolean(part));
}

/** Accumulate usage/stop-reason fields from a parsed SSE/full payload. */
export function updateRequestUsageSummary(summary: RequestUsageSummary, data: unknown): void {
  if (!isRecord(data)) {
    return;
  }

  // Responses API nests usage under response.usage (response.completed event);
  // OpenAI/Anthropic put it at top-level usage. Check both.
  const rawUsage = isRecord(data.usage) ? data.usage : undefined;
  const responseUsage = isRecord(data.response) && isRecord(data.response.usage) ? data.response.usage : undefined;
  const usage = rawUsage ?? responseUsage;
  if (usage) {
    // OpenAI-compatible fields
    const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
    const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
    const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
    const promptTokenDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
    const cachedTokens =
      promptTokenDetails && typeof promptTokenDetails.cached_tokens === "number" ? promptTokenDetails.cached_tokens : undefined;
    // Responses API uses input_tokens_details.cached_tokens for the same value
    const inputTokensDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
    const cachedFromInputDetails =
      inputTokensDetails && typeof inputTokensDetails.cached_tokens === "number" ? inputTokensDetails.cached_tokens : undefined;

    // Anthropic-compatible fields (input_tokens / output_tokens)
    const anthropicInputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
    const anthropicOutputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
    const cacheReadInputTokens = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined;

    if (promptTokens !== undefined) {
      summary.promptTokens = promptTokens;
    } else if (anthropicInputTokens !== undefined) {
      summary.promptTokens = anthropicInputTokens;
    }
    if (completionTokens !== undefined) {
      summary.completionTokens = completionTokens;
    } else if (anthropicOutputTokens !== undefined) {
      summary.completionTokens = anthropicOutputTokens;
    }
    if (totalTokens !== undefined) {
      summary.totalTokens = totalTokens;
    }
    if (cachedTokens !== undefined) {
      summary.cachedTokens = cachedTokens;
    } else if (cachedFromInputDetails !== undefined) {
      summary.cachedTokens = cachedFromInputDetails;
    } else if (cacheReadInputTokens !== undefined) {
      summary.cachedTokens = cacheReadInputTokens;
    }
  }

  // Responses API: response.completed is a terminal event — treat it as a healthy
  // stream end regardless of whether stop_reason is present.
  if (data.type === "response.completed") {
    const response = isRecord(data.response) ? data.response : data;
    summary.finishReason = typeof response.stop_reason === "string" ? response.stop_reason : "stop";
    return;
  }

  // Anthropic message_delta reports stop_reason in delta, not in choices
  const delta = isRecord(data.delta) ? data.delta : undefined;
  if (delta && typeof delta.stop_reason === "string") {
    summary.finishReason = delta.stop_reason;
  }

  const firstChoice = Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : undefined;
  if (firstChoice && typeof firstChoice.finish_reason === "string") {
    summary.finishReason = firstChoice.finish_reason;
  }
}

export { extractChatCompletionParts, extractAnthropicParts, toolCallPartsFromOpenAiMessage };
