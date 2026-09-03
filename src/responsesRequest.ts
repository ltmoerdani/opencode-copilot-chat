import { randomUUID } from "node:crypto";

export interface ResponsesRequestEnvelopeOptions {
  model: string;
  input: readonly unknown[];
  maxOutputTokens: number;
  temperature?: number;
  thinkingPayload?: Record<string, unknown>;
  tools?: readonly unknown[];
  toolChoice?: unknown;
  truncation?: "auto" | "disabled";
}

/**
 * Structural message shape used by the Responses input serializer. Mirrors the
 * `ApiMessage` / `OpenAiContentPart` / `OpenAiToolCall` shapes produced by
 * `convertMessage()` in `extension.ts` — kept local so this module stays pure
 * (no `vscode` import) and unit-testable.
 */
export interface ResponsesApiMessage {
  role: string;
  content: string | null | readonly ResponsesApiContentPart[];
  tool_call_id?: string;
  tool_calls?: readonly ResponsesApiToolCall[];
}

export interface ResponsesApiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ResponsesApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Build the transport-independent portion of an OpenAI Responses request. */
export function buildResponsesRequestEnvelope(options: ResponsesRequestEnvelopeOptions): Record<string, unknown> {
  const tools = options.tools ?? [];

  return {
    model: options.model,
    input: options.input,
    max_output_tokens: options.maxOutputTokens,
    truncation: options.truncation ?? "auto",
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    stream: true,
    ...(options.thinkingPayload ?? {}),
    ...(tools.length > 0 ? { tools, tool_choice: options.toolChoice } : {}),
  };
}

// RULES: The Responses API `input` list uses a different item grammar than
// Chat Completions `messages`. Text → `input_text`, images → `input_image`,
// assistant text → `output_text` inside a message item, tool calls →
// `function_call`, tool results → `function_call_output`. This converter keeps
// that grammar in one pure module so it can be unit-tested without VS Code.

/**
 * Convert one internal `ApiMessage` into the Responses API `input` items.
 * Returns an empty array for unsupported roles / empty user content.
 */
export function responsesInputItemsFromMessage(message: ResponsesApiMessage): Record<string, unknown>[] {
  if (message.role === "user") {
    const content = responsesUserContent(message.content);
    return content.length ? [{ role: "user", content }] : [];
  }

  if (message.role === "assistant") {
    const items: Record<string, unknown>[] = [];
    const text = responsesAssistantText(message.content);
    if (text) {
      items.push({ role: "assistant", content: [{ type: "output_text", text }] });
    }

    for (const toolCall of message.tool_calls ?? []) {
      items.push({
        type: "function_call",
        // RULES: a Responses `function_call` item carries TWO identifiers —
        // `id` is the item id, which MUST start with `fc_`, while `call_id`
        // is the tool-invocation id that must match the paired
        // `function_call_output.call_id`. History tool calls carry
        // chat-completions-style `call_*` ids (from the upstream stream via
        // VS Code's LanguageModelToolCallPart), so the item id is regenerated
        // in the `fc_` namespace while `call_id` is preserved verbatim —
        // echoing `call_*` back as `id` makes the gateway reject the whole
        // request with `Invalid 'input[N].id': ... Expected an ID that begins
        // with 'fc'` (HTTP 400, issue #206).
        id: responsesFunctionCallItemId(toolCall.id),
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      });
    }

    return items;
  }

  if (message.role === "tool") {
    // The Responses API's function_call_output.output field expects a string.
    // Tool results that carry images (e.g. MCP screenshots) cannot be
    // represented natively here, so we degrade to the joined text payload.
    // Vision-capable OpenAI/Anthropic/Google transports handle images in tool
    // results natively via their respective request builders.
    const output = typeof message.content === "string" ? message.content : responsesToolOutput(message.content);
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id ?? `tool-${String(Date.now())}`,
        output,
      },
    ];
  }

  return [];
}

/**
 * Return a Responses-API-compliant `function_call` item id. Ids already in the
 * `fc_` namespace pass through unchanged; anything else (chat-completions
 * `call_*` ids, gateway ids, empty strings) is replaced with a fresh `fc_`
 * synthetic id. Deterministic per call site is not required — the id only has
 * to be valid and unique within the request.
 */
export function responsesFunctionCallItemId(originalId: string): string {
  return originalId.startsWith("fc_") ? originalId : `fc_${randomUUID().replace(/-/g, "")}`;
}

/** Narrow a union value to a content-part array without falling back to `any[]`. */
function isContentPartArray(value: unknown): value is readonly ResponsesApiContentPart[] {
  return Array.isArray(value);
}

function responsesUserContent(content: ResponsesApiMessage["content"]): Record<string, unknown>[] {
  if (typeof content === "string") {
    return content ? [{ type: "input_text", text: content }] : [];
  }

  if (!isContentPartArray(content)) {
    return [];
  }

  return content.flatMap((part): Record<string, unknown>[] => {
    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "input_text", text: part.text }];
    }

    if (part.type === "image_url" && part.image_url?.url) {
      // RULES: Responses API `input_image.image_url` is a plain STRING (a
      // fully qualified URL or a base64 data URL), unlike Chat Completions
      // which nests it as `{ url: "..." }`. Emitting the nested object shape
      // makes the gateway reject the whole request with `invalid_prompt`
      // (HTTP 400) — e.g. gpt-5.6-luna with an image attachment.
      return [{ type: "input_image", image_url: part.image_url.url }];
    }

    return [];
  });
}

function responsesAssistantText(content: ResponsesApiMessage["content"]): string {
  return joinedTextContent(content);
}

// RULES: Responses API function_call_output.output is a plain string and does
// not support inline image content blocks. To preserve tool result context
// for vision-capable models that would otherwise lose the image entirely, we
// keep any text parts joined with newlines and append a short note when an
// image was present. The note is intentionally brief (not a data URI) so it
// doesn't bloat the payload; the model is told the image was omitted.
function responsesToolOutput(content: ResponsesApiMessage["content"]): string {
  if (!isContentPartArray(content)) {
    return JSON.stringify(content ?? "");
  }

  const text = joinedTextContent(content, "\n");
  const hasImage = content.some((part) => part.type === "image_url" && part.image_url?.url);
  if (!hasImage) {
    return text || "";
  }

  return [text, "[Image attachment omitted — Responses API does not support images in tool output]"].filter(Boolean).join("\n\n");
}

/**
 * Join the text parts of a content array (or return a plain string as-is).
 * Shared by the Responses, Anthropic, and Google request builders.
 */
export function joinedTextContent(content: string | null | readonly { type: string; text?: string }[], separator = ""): string {
  if (typeof content === "string") {
    return content;
  }

  if (!isContentPartArray(content)) {
    return "";
  }

  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(separator);
}
