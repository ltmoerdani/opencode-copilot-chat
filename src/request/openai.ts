/**
 * OpenAI-family request body builders.
 *
 * Builds the wire payloads for the OpenAI-compatible chat-completions endpoint
 * and the Responses API endpoint.
 *
 * CONTRACT: pure functions only — `vscode` is used as a TYPE and for the
 * `LanguageModelChatToolMode` enum value only; no extension-host side effects.
 */
import * as vscode from "vscode";
import { lookupModelRegistryEntry } from "../core/registry";
import { buildResponsesRequestEnvelope, responsesInputItemsFromMessage } from "../responsesRequest";
import { thinkingProviderFor } from "../thinking";
import { sanitizeToolSchema } from "./schema";
import { resolveProjectCacheKey } from "./headers";
import { messagesHaveImages } from "./shared";
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ModelLimits } from "../models/modelLimits";
import type { ApiMessage, ApiSettings, OpenAiToolDefinition } from "./types";

export function buildChatCompletionsRequestBody(
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  metadata: ResolvedModelMetadata,
  limits: ModelLimits,
): Record<string, unknown> {
  const tools = mapOpenAiTools(options.tools);
  const thinkingPayload = thinkingProviderFor(modelId).buildPayload(settings.thinking, {
    hasImageInput: messagesHaveImages(messages),
    endpoint: "chat",
  });

  return {
    model: modelId,
    messages,
    // Only send temperature if the model supports it (not deprecated)
    ...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
    max_tokens: limits.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
    ...(() => {
      const k = resolveProjectCacheKey(modelId);
      return k ? { prompt_cache_key: k } : {};
    })(),
    ...thinkingPayload,
    ...(tools.length ? { tools, tool_choice: toolChoice(options.toolMode) } : {}),
  };
}

export function buildResponsesRequestBody(
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  metadata: ResolvedModelMetadata,
  limits: ModelLimits,
): Record<string, unknown> {
  const input = messages.flatMap((message) => responsesInputItemsFromMessage(message));
  const tools = mapResponsesTools(options.tools, modelId);
  const thinkingPayload = thinkingProviderFor(modelId).buildPayload(settings.thinking, {
    hasImageInput: messagesHaveImages(messages),
    endpoint: "responses",
  });

  return buildResponsesRequestEnvelope({
    model: modelId,
    input,
    maxOutputTokens: limits.maxOutputTokens,
    ...(() => {
      const k = resolveProjectCacheKey(modelId);
      return k ? { promptCacheKey: k } : {};
    })(),
    // Muse Spark gateway requires `truncation: "disabled"` — requests whose
    // input exceeds the 1M context window will hard-fail (HTTP 400) instead
    // of being silently truncated upstream. This is a gateway constraint,
    // not a client choice; see PR #168 review.
    truncation: isMuseFamily(modelId) ? "disabled" : "auto",
    // Some models reject any non-default temperature value.
    ...(metadata.temperature === false ? {} : { temperature: settings.temperature }),
    thinkingPayload,
    tools,
    toolChoice: toolChoice(options.toolMode),
  });
}

function mapOpenAiTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): OpenAiToolDefinition[] {
  const sorted = [...(tools ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeToolSchema(tool.inputSchema),
    },
  }));
}

function mapResponsesTools(tools: readonly vscode.LanguageModelChatTool[] | undefined, modelId?: string): Record<string, unknown>[] {
  const needsTruncation = isMuseFamily(modelId ?? "");
  const sorted = [...(tools ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted.map((tool) => ({
    type: "function",
    name: needsTruncation ? truncateToolName(tool.name) : tool.name,
    description: tool.description,
    parameters: sanitizeToolSchema(tool.inputSchema),
  }));
}

// --- Muse Spark tool-name truncation (Responses API limit: 64 chars) ----------

const MUSE_MAX_TOOL_NAME = 64;
const MUSE_HASH_SUFFIX_LEN = 8;

export function isMuseFamily(modelId: string): boolean {
  if (!modelId) {
    return false;
  }
  return lookupModelRegistryEntry(modelId).family === "muse";
}

export function truncateToolName(name: string): string {
  if (name.length <= MUSE_MAX_TOOL_NAME) {
    return name;
  }
  const hash = simpleHash(name);
  const available = MUSE_MAX_TOOL_NAME - MUSE_HASH_SUFFIX_LEN - 1; // -1 for separator
  return `${name.slice(0, available)}_${hash}`;
}

/**
 * Build a truncated → original tool name map for the Responses extractor
 * round-trip. Only Muse-family models truncate, so non-Muse models return
 * an empty map. Mirrors the `toolNamesById` pattern in `src/request/google.ts`.
 */
export function buildResponsesToolNameMap(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
  modelId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!isMuseFamily(modelId) || !tools?.length) {
    return map;
  }
  for (const tool of tools) {
    const truncated = truncateToolName(tool.name);
    if (truncated !== tool.name) {
      map.set(truncated, tool.name);
    }
  }
  return map;
}

function simpleHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function toolChoice(mode: vscode.LanguageModelChatToolMode): "auto" | "required" {
  return mode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
}
