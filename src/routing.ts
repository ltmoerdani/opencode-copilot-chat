import { GO_VENDOR, ZEN_VENDOR, resolveBaseVendor, type ProviderRoutingDefinition } from "./providerTypes";

function isMessagesQwenModel(modelId: string): boolean {
  return /^qwen3\.(?:5|6)-plus(?:-free)?$/i.test(modelId) || /^qwen3\.7-max$/i.test(modelId);
}

export function resolveModelRouting(
  modelId: string,
  provider: ProviderRoutingDefinition,
): {
  endpointKind: "chat-completions" | "messages" | "responses" | "google";
  endpointUrl: string;
  sdkPackage?: string;
} {
  // Resolve agent-host variants to their base vendor for routing decisions.
  const baseVendor = resolveBaseVendor(provider.vendor);

  // GPT models use the Responses API (not chat-completions).
  // OpenCode Go docs require gpt-5.6-luna on /v1/responses.
  // OpenAI reasoning models (GPT-5.x) only support reasoning via Responses API.
  if (/^gpt-/i.test(modelId)) {
    return {
      endpointKind: "responses",
      endpointUrl: provider.responsesUrl ?? provider.chatCompletionsUrl,
      sdkPackage: "@ai-sdk/openai",
    };
  }

  if (/^claude-/i.test(modelId) || (baseVendor === GO_VENDOR && /^minimax-m2\./i.test(modelId)) || isMessagesQwenModel(modelId)) {
    return {
      endpointKind: "messages",
      endpointUrl: provider.messagesUrl,
      sdkPackage: "@ai-sdk/anthropic",
    };
  }

  if (baseVendor === ZEN_VENDOR && /^gemini-/i.test(modelId)) {
    return {
      endpointKind: "google",
      endpointUrl: `${provider.modelsUrl}/${modelId}`,
      sdkPackage: "@ai-sdk/google",
    };
  }

  return {
    endpointKind: "chat-completions",
    endpointUrl: provider.chatCompletionsUrl,
    sdkPackage: "@ai-sdk/openai-compatible",
  };
}

export function normalizeResponsesStreamEvent(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }

  const eventType = typeof data.type === "string" ? data.type : undefined;
  if (!eventType) {
    return data;
  }

  if (eventType === "response.output_text.delta") {
    const delta = firstString(data.delta, data.text, data.output_text_delta);
    return delta
      ? {
          choices: [
            {
              index: 0,
              delta: { content: delta },
              finish_reason: null,
            },
          ],
        }
      : { choices: [] };
  }

  if (eventType === "response.output_item.added") {
    const item = data.item;
    if (isRecord(item) && item.type === "function_call" && typeof item.name === "string") {
      return {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: typeof data.output_index === "number" ? data.output_index : 0,
                  id: firstString(item.call_id, item.id) ?? "",
                  type: "function",
                  function: { name: item.name, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
    }
  }

  if (eventType === "response.function_call_arguments.delta") {
    const delta = firstString(data.delta, data.arguments_delta);
    return delta
      ? {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: typeof data.output_index === "number" ? data.output_index : 0,
                    function: { arguments: delta },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }
      : { choices: [] };
  }

  if (eventType.includes("reasoning")) {
    const reasoning = extractResponsesReasoningText(data);
    return reasoning
      ? {
          choices: [
            {
              index: 0,
              delta: { reasoning_content: reasoning },
              finish_reason: null,
            },
          ],
        }
      : { choices: [] };
  }

  if (eventType === "response.completed") {
    const response = isRecord(data.response) ? data.response : data;
    const usage = normalizeResponsesUsage(response.usage);
    return {
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: normalizeResponsesFinishReason(firstString(response.stop_reason, data.stop_reason)),
        },
      ],
      ...(usage ? { usage } : {}),
    };
  }

  return { choices: [] };
}

export function normalizeResponsesFullResponse(data: unknown): unknown {
  if (!isRecord(data) || Array.isArray(data.choices)) {
    return data;
  }

  const response = isRecord(data.response) ? data.response : data;
  const output = Array.isArray(response.output) ? response.output : [];
  let text = "";
  const toolCalls: Array<Record<string, unknown>> = [];

  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
          text += part.text;
        }
      }
      continue;
    }

    if (item.type === "function_call" && typeof item.name === "string") {
      toolCalls.push({
        id: firstString(item.call_id, item.id) ?? "",
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
        },
      });
    }
  }

  const usage = normalizeResponsesUsage(response.usage);
  return {
    choices: [
      {
        index: 0,
        message: {
          ...(text ? { content: text } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: normalizeResponsesFinishReason(firstString(response.stop_reason, response.finish_reason)),
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

export function normalizeGoogleStreamEvent(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }

  const candidate = Array.isArray(data.candidates) && isRecord(data.candidates[0]) ? data.candidates[0] : undefined;
  const parts = isRecord(candidate?.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts.filter(isRecord) : [];
  const text = parts
    .filter((part) => typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text as string)
    .join("");
  const reasoning = parts
    .filter((part) => typeof part.text === "string" && part.thought === true)
    .map((part) => part.text as string)
    .join("");
  const toolCalls = parts.flatMap((part, index) => {
    if (!isRecord(part.functionCall) || typeof part.functionCall.name !== "string") {
      return [];
    }

    return [
      {
        index,
        id: "",
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      },
    ];
  });
  const usage = normalizeGoogleUsage(data.usageMetadata);

  if (!text && !reasoning && !toolCalls.length && !candidate?.finishReason && !usage) {
    return { choices: [] };
  }

  return {
    choices: [
      {
        index: 0,
        delta: {
          ...(text ? { content: text } : {}),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: normalizeGoogleFinishReason(
          typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined,
          toolCalls.length > 0,
        ),
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

export function normalizeGoogleFullResponse(data: unknown): unknown {
  if (!isRecord(data) || Array.isArray(data.choices)) {
    return data;
  }

  const candidate = Array.isArray(data.candidates) && isRecord(data.candidates[0]) ? data.candidates[0] : undefined;
  const parts = isRecord(candidate?.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts.filter(isRecord) : [];
  const text = parts
    .filter((part) => typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text as string)
    .join("");
  const reasoning = parts
    .filter((part) => typeof part.text === "string" && part.thought === true)
    .map((part) => part.text as string)
    .join("");
  const toolCalls = parts.flatMap((part) => {
    if (!isRecord(part.functionCall) || typeof part.functionCall.name !== "string") {
      return [];
    }

    return [
      {
        id: "",
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      },
    ];
  });
  const usage = normalizeGoogleUsage(data.usageMetadata);

  return {
    choices: [
      {
        index: 0,
        message: {
          ...(text ? { content: text } : {}),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: normalizeGoogleFinishReason(
          typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined,
          toolCalls.length > 0,
        ),
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

function normalizeResponsesFinishReason(value: string | undefined): "stop" | "tool_calls" | "length" | "content_filter" | null {
  if (!value) {
    return null;
  }

  if (value === "completed" || value === "stop") {
    return "stop";
  }
  if (value === "tool_call" || value === "tool_calls") {
    return "tool_calls";
  }
  if (value === "max_output_tokens" || value === "length") {
    return "length";
  }
  if (value.includes("filter") || value.includes("safety")) {
    return "content_filter";
  }

  return null;
}

function normalizeResponsesUsage(usage: unknown): Record<string, unknown> | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }

  const promptTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const completionTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const cachedTokens =
    isRecord(usage.input_tokens_details) && typeof usage.input_tokens_details.cached_tokens === "number"
      ? usage.input_tokens_details.cached_tokens
      : undefined;

  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined,
    ...(cachedTokens !== undefined ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {}),
  };
}

function extractResponsesReasoningText(data: Record<string, unknown>): string {
  const direct = firstString(data.delta, data.text, data.summary_text, data.output_text_delta);
  if (direct) {
    return direct;
  }

  const item = data.item;
  if (!isRecord(item)) {
    return "";
  }

  if (typeof item.text === "string") {
    return item.text;
  }

  if (Array.isArray(item.summary)) {
    return item.summary
      .filter((part): part is Record<string, unknown> => isRecord(part) && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
  }

  return "";
}

function normalizeGoogleUsage(usage: unknown): Record<string, unknown> | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }

  const promptTokens = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined;
  const candidatesTokens = typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined;
  const thoughtsTokens = typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : undefined;
  const cachedTokens = typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : undefined;
  const completionTokens = candidatesTokens !== undefined ? candidatesTokens + (thoughtsTokens ?? 0) : undefined;

  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens:
      typeof usage.totalTokenCount === "number"
        ? usage.totalTokenCount
        : promptTokens !== undefined && completionTokens !== undefined
          ? promptTokens + completionTokens
          : undefined,
    ...(cachedTokens !== undefined ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {}),
  };
}

function normalizeGoogleFinishReason(
  finishReason: string | undefined,
  hasToolCalls: boolean,
): "stop" | "tool_calls" | "length" | "content_filter" | null {
  if (!finishReason) {
    return null;
  }
  if (finishReason === "STOP") {
    return hasToolCalls ? "tool_calls" : "stop";
  }
  if (finishReason === "MAX_TOKENS") {
    return "length";
  }
  if (["IMAGE_SAFETY", "RECITATION", "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(finishReason)) {
    return "content_filter";
  }
  return null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
