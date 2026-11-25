/**
 * Shared types for building provider request bodies.
 *
 * CONTRACT: pure types only — no `vscode` runtime import, no side effects.
 * These are the wire shapes we construct for the OpenCode gateway.
 */
import type { ThinkingSettings } from "../thinking/types";

export type ApiRole = "system" | "user" | "assistant" | "tool";

/** Normalized internal message shape used by all request builders. */
export interface ApiMessage {
  role: ApiRole;
  content: string | null | OpenAiContentPart[];
  reasoning_content?: string;
  /** Opaque Gemini thought signatures replayed on the next turn (Google requires this for Gemini 3+). */
  thought_signatures?: string[];
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface OpenAiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Resolved extension settings used to build request bodies. */
export interface ApiSettings {
  temperature: number;
  maxOutputTokensOverride: number;
  maxInputTokensOverride: number;
  debugReasoning: boolean;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  thinking: ThinkingSettings;
  stripThinkTags: "never" | "auto" | "always";
}

export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

export interface AnthropicCacheControl {
  type: "ephemeral";
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicImageSourceUrl {
  type: "url";
  url: string;
}

export interface AnthropicImageSourceBase64 {
  type: "base64";
  media_type: string;
  data: string;
}

export type AnthropicImageSource = AnthropicImageSourceUrl | AnthropicImageSourceBase64;

export interface AnthropicImageBlock {
  type: "image";
  source: AnthropicImageSource;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  // Anthropic tool_result.content may be either a plain string or a list of
  // content blocks (text + image) per the Messages API spec. We support the
  // array form so MCP tool results that include images (e.g. screenshots) are
  // forwarded to vision-capable Anthropic models instead of being dropped.
  content: string | AnthropicContentBlock[];
  cache_control?: AnthropicCacheControl;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicRequestMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}
