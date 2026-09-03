/**
 * Google (Gemini) request body builder.
 *
 * Builds the Google generateContent wire payload (Gemini models on the Zen
 * gateway).
 *
 * CONTRACT: pure functions only — `vscode` is used as a TYPE and for the
 * `LanguageModelChatToolMode` enum value only; no extension-host side effects.
 */
import * as vscode from "vscode";
import { joinedTextContent } from "../responsesRequest";
import { parseToolInput } from "../toolCallAccumulator";
import { sanitizeToolSchema } from "./schema";
import type { ModelLimits } from "../models/modelLimits";
import type { ApiMessage, ApiSettings } from "./types";

export function buildGoogleGenerateContentBody(
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  limits: ModelLimits,
): Record<string, unknown> {
  const tools = mapGoogleTools(options.tools);

  return {
    contents: googleContentsFromMessages(messages),
    generationConfig: {
      maxOutputTokens: limits.maxOutputTokens,
      temperature: settings.temperature,
    },
    ...(tools.length ? { tools: [{ functionDeclarations: tools }], toolConfig: googleToolConfig(options.toolMode) } : {}),
  };
}

function mapGoogleTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): Record<string, unknown>[] {
  const sorted = [...(tools ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: sanitizeToolSchema(tool.inputSchema),
  }));
}

function googleToolConfig(mode: vscode.LanguageModelChatToolMode): Record<string, unknown> {
  return {
    functionCallingConfig: {
      mode: mode === vscode.LanguageModelChatToolMode.Required ? "ANY" : "AUTO",
    },
  };
}

function googleContentsFromMessages(messages: ApiMessage[]): Record<string, unknown>[] {
  const toolNamesById = new Map<string, string>();
  const contents: Record<string, unknown>[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const parts = googleUserParts(message.content);
      if (parts.length) {
        contents.push({ role: "user", parts });
      }
      continue;
    }

    if (message.role === "assistant") {
      const parts: Record<string, unknown>[] = [];
      if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
        parts.push({ text: message.reasoning_content, thought: true });
      }
      const text = joinedTextContent(message.content);
      if (text) {
        parts.push({ text });
      }
      for (const toolCall of message.tool_calls ?? []) {
        const args = parseToolInput(toolCall.function.arguments);
        parts.push({ functionCall: { name: toolCall.function.name, args } });
        toolNamesById.set(toolCall.id, toolCall.function.name);
      }
      if (parts.length) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    // After the user/model continues above, role is narrowed to "tool".
    if (message.tool_call_id) {
      const name = toolNamesById.get(message.tool_call_id) ?? "tool";
      const response = googleFunctionResponseContent(message.content, name);
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: response,
          },
        ],
      });
    }
  }

  return contents;
}

function googleUserParts(content: ApiMessage["content"]): Record<string, unknown>[] {
  if (typeof content === "string") {
    return content ? [{ text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part): Record<string, unknown>[] => {
    if (part.type === "text" && typeof part.text === "string") {
      return [{ text: part.text }];
    }

    if (part.type === "image_url" && part.image_url?.url) {
      const inlineData = dataUrlToInlineData(part.image_url.url);
      return inlineData ? [{ inlineData }] : [];
    }

    return [];
  });
}

function dataUrlToInlineData(url: string): { mimeType: string; data: string } | undefined {
  const match = /^data:(.+?);base64,(.+)$/i.exec(url);
  if (!match) {
    return undefined;
  }
  return {
    mimeType: match[1],
    data: match[2],
  };
}

// RULES: Gemini's functionResponse.response is a flexible object. The plain
// form is `{ name, content }` where content is a JSON string (text-only tool
// results). When the tool result carries an image (e.g. MCP screenshot), we
// extend it with `parts` containing both the text and an inlineData block so
// vision-capable Gemini models can see the image. The `content` field is kept
// for backwards compatibility with providers that ignore the `parts` field.
function googleFunctionResponseContent(
  content: ApiMessage["content"],
  name: string,
): { name: string; content: string; parts?: Record<string, unknown>[] } {
  if (typeof content === "string") {
    return { name, content };
  }

  if (!Array.isArray(content)) {
    // ApiMessage content is `string | null | OpenAiContentPart[]`; after the
    // string and array checks above, this branch only sees null.
    return { name, content: JSON.stringify("") };
  }

  const text = joinedTextContent(content, "\n");
  const hasImage = content.some((part) => part.type === "image_url" && part.image_url?.url);
  if (!hasImage) {
    return { name, content: text };
  }

  const parts: Record<string, unknown>[] = [];
  if (text) {
    parts.push({ text });
  }
  for (const part of content) {
    if (part.type === "image_url" && part.image_url?.url) {
      const inlineData = dataUrlToInlineData(part.image_url.url);
      if (inlineData) {
        parts.push({ inlineData });
      }
    }
  }

  return { name, content: text, parts };
}
