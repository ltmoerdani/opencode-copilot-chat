import * as vscode from "vscode";
import {
  appendApiPath,
  apiRoutesFromBaseUrl,
  CONFIG_SECTION,
  DEFAULT_GO_API_BASE_URL,
  DEFAULT_GO_GOOGLE_MODELS_URL,
  DEFAULT_ZEN_API_BASE_URL,
  FALLBACK_USER_AGENT,
  FREE_ZEN_MODEL_IDS,
  normalizeApiBaseUrl,
  SETTING_API_BASE_URL,
  SETTING_FREE_ONLY,
} from "../config";
import type { ModelEndpointKind } from "../core/registry";
import type { ApiMessage } from "../request/types";
import { AGENT_GO_VENDOR, AGENT_ZEN_VENDOR, GO_VENDOR, ZEN_VENDOR, type AllProviderVendor } from "../providerTypes";

export type { ModelEndpointKind } from "../core/registry";

export interface ProviderDefinition {
  vendor: AllProviderVendor;
  displayName: string;
  modelNamePrefix: string;
  modelsUrl: string;
  /**
   * Base of the Google-native (Gemini) generate route. Absent = `modelsUrl`
   * (Zen); Go's built-in gateway serves that route on a different base.
   */
  googleModelsUrl?: string;
  chatCompletionsUrl: string;
  messagesUrl: string;
  responsesUrl?: string;
  /** Go-only server usage meter route; derived from the same base URL. */
  usageUrl?: string;
  testModelId: string;
  fallbackModels: string[];
  filterModel?: (modelId: string) => boolean;
  /** When true, this provider only serves agent-host models (targetChatSessionType=copilotcli). */
  isAgentVariant?: boolean;
  /** The vendor key for the main (non-agent) provider definition this variant mirrors. */
  baseVendor?: typeof GO_VENDOR | typeof ZEN_VENDOR;
}

let cachedUserAgent: string | undefined;

/**
 * Read a provider base URL from settings, falling back safely when missing or
 * malformed (issue #247).
 *
 * CONTRACT:
 * - Reads from the ROOT configuration with the FULL setting key
 *   (`opencodego.apiBaseUrl`). A section-scoped read
 *   (`getConfiguration("opencodego").get("apiBaseUrl")`) would resolve the key
 *   relative to the section and misread it — same trap as `enabled`.
 * - Non-http(s), embedded credentials, query strings, and hashes fall back to
 *   the built-in default via {@link normalizeApiBaseUrl}.
 * - Changes take effect on window reload (documented behavior), matching the
 *   module-scope derivation in {@link PROVIDERS}.
 */
export function configuredApiBaseUrl(vendor: typeof GO_VENDOR | typeof ZEN_VENDOR): string {
  const fallback = vendor === GO_VENDOR ? DEFAULT_GO_API_BASE_URL : DEFAULT_ZEN_API_BASE_URL;
  // Structural view keeps module-scope PROVIDERS derivation importable in
  // bare unit-test environments where the vscode stub exposes no workspace.
  const workspace = vscode.workspace as
    { getConfiguration?: () => { get?: (section: string, defaultValue: string) => string | undefined } } | undefined;
  const configured = workspace?.getConfiguration?.().get?.(`${vendor}.${SETTING_API_BASE_URL}`, fallback);
  return normalizeApiBaseUrl(configured ?? fallback, fallback);
}

/** Resolve the Go usage route from the same base URL as the Go provider. */
export function configuredGoUsageUrl(): string {
  return appendApiPath(configuredApiBaseUrl(GO_VENDOR), "usage");
}

/**
 * Build the User-Agent string from the extension's declared version.
 *
 * CONTRACT:
 * - Reads `context.extension.packageJSON.version` once, caches the result.
 * - Falls back to {@link FALLBACK_USER_AGENT} when version is unavailable
 *   (e.g. tests that construct a stub context).
 * - Avoids the drift that previously hardcoded a version literal here
 *   (issue #78: header reported `0.3.6` while package.json was `0.4.1`).
 */
export function getUserAgent(): string {
  if (cachedUserAgent) return cachedUserAgent;
  const packageJSON = vscode.extensions.getExtension("ltmoerdani.opencode-copilot-chat")?.packageJSON as { version?: unknown } | undefined;
  const version = typeof packageJSON?.version === "string" ? packageJSON.version : undefined;
  cachedUserAgent = version ? `opencode-copilot-chat/${version} VSCode` : FALLBACK_USER_AGENT;
  return cachedUserAgent;
}

/**
 * Classify a fetch error as transient (worth retrying) vs. permanent.
 *
 * Defined in `retry.ts` (the shared retry-decision module) and re-exported
 * here so existing importers keep working. See `retry.ts` for the rules and
 * the full implementation.
 */
export { isTransientFetchError } from "../retry";

/** Create an agent-variant provider definition that inherits URLs, models, and filters from a base. */
function providerVariant(
  base: ProviderDefinition,
  agentVendor: typeof AGENT_GO_VENDOR | typeof AGENT_ZEN_VENDOR,
  displayName: string,
): ProviderDefinition {
  return {
    vendor: agentVendor,
    displayName,
    modelNamePrefix: base.modelNamePrefix,
    modelsUrl: base.modelsUrl,
    googleModelsUrl: base.googleModelsUrl,
    chatCompletionsUrl: base.chatCompletionsUrl,
    messagesUrl: base.messagesUrl,
    responsesUrl: base.responsesUrl,
    usageUrl: base.usageUrl,
    testModelId: base.testModelId,
    fallbackModels: base.fallbackModels,
    filterModel: base.filterModel,
  };
}

export const PROVIDERS: Record<ProviderDefinition["vendor"], ProviderDefinition> = (() => {
  // Routes derive from the configured apiBaseUrl setting so a custom compatible
  // gateway replaces the built-in opencode.ai endpoints end-to-end (issue #247).
  const goBase = configuredApiBaseUrl(GO_VENDOR);
  const goRoutes = apiRoutesFromBaseUrl(goBase);
  const zenRoutes = apiRoutesFromBaseUrl(configuredApiBaseUrl(ZEN_VENDOR));
  const go: ProviderDefinition = {
    vendor: GO_VENDOR,
    displayName: "OpenCode Go",
    modelNamePrefix: "OpenCode Go",
    modelsUrl: goRoutes.modelsUrl,
    // Go's Google-native (Gemini) route sits on its own base on the built-in
    // gateway (DEFAULT_GO_GOOGLE_MODELS_URL); a configured apiBaseUrl keeps
    // driving every route end-to-end (issue #247).
    googleModelsUrl: goBase === DEFAULT_GO_API_BASE_URL ? DEFAULT_GO_GOOGLE_MODELS_URL : goRoutes.modelsUrl,
    chatCompletionsUrl: goRoutes.chatCompletionsUrl,
    messagesUrl: goRoutes.messagesUrl,
    responsesUrl: goRoutes.responsesUrl,
    usageUrl: goRoutes.usageUrl,
    testModelId: "deepseek-v4-flash",
    fallbackModels: [
      // Curated active set from models.dev (2026-09-08) — deprecated/legacy
      // models are excluded, mirroring the live catalog's own filtering.
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro",
      "glm-5.1",
      "glm-5.2",
      "glm-5.3",
      "glm-5.3-flash",
      "gpt-5.6-luna",
      "grok-4.6",
      "hy3",
      "hy4-preview",
      "kimi-k2.6",
      "kimi-k2.7-code",
      "kimi-k3",
      "longcat-2.0",
      "minimax-m2.7",
      "minimax-m3",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "muse-spark-1.2-contributor",
      "muse-spark-1.3-contributor",
      "omen-alpha",
      "qwen3.6-plus",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.8-flash",
      "qwen3.8-max",
    ],
  };
  const zen: ProviderDefinition = {
    vendor: ZEN_VENDOR,
    displayName: "OpenCode Zen",
    modelNamePrefix: "OpenCode Zen",
    modelsUrl: zenRoutes.modelsUrl,
    chatCompletionsUrl: zenRoutes.chatCompletionsUrl,
    messagesUrl: zenRoutes.messagesUrl,
    responsesUrl: zenRoutes.responsesUrl,
    testModelId: "deepseek-v4-flash-free",
    fallbackModels: [
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-opus-4-1",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4",
      "claude-haiku-4-5",
      "deepseek-v4-flash-free",
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "gemini-3-flash",
      "glm-5.1",
      "glm-5",
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5",
      "gpt-5-codex",
      "gpt-5-nano",
      "grok-build-0.1",
      "kimi-k2.6",
      "kimi-k2.5",
      "minimax-m2.7",
      "minimax-m2.5",
      "minimax-m2.5-free",
      "nemotron-3-super-free",
      "qwen3.6-plus",
      "qwen3.6-plus-free",
      "qwen3.5-plus",
      "big-pickle",
    ],
    filterModel: (modelId) =>
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_FREE_ONLY, true)
        ? modelId.endsWith("-free") || FREE_ZEN_MODEL_IDS.has(modelId)
        : true,
  };
  return {
    [GO_VENDOR]: go,
    [ZEN_VENDOR]: zen,
    [AGENT_GO_VENDOR]: { ...providerVariant(go, AGENT_GO_VENDOR, "OpenCode Go (Agents)"), isAgentVariant: true, baseVendor: GO_VENDOR },
    [AGENT_ZEN_VENDOR]: {
      ...providerVariant(zen, AGENT_ZEN_VENDOR, "OpenCode Zen (Agents)"),
      isAgentVariant: true,
      baseVendor: ZEN_VENDOR,
    },
  };
})();

export interface OpenCodeModel extends vscode.LanguageModelChatInformation {
  endpointKind: ModelEndpointKind;
  provider: ProviderDefinition;
  rawModelId?: string;
  isUserSelectable?: boolean;
  configurationSchema?: vscode.LanguageModelConfigurationSchema;
}

export interface ModelListEntry {
  id?: string;
  owned_by?: string;
  status?: string;
  deprecated?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  context_window?: number;
  contextWindow?: number;
  max_output_tokens?: number;
  maxOutputTokens?: number;
  attachment?: boolean;
  image_input?: boolean;
  imageInput?: boolean;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

export interface ModelListResponse {
  data?: ModelListEntry[];
}

export interface ConvertedMessageResult {
  messages: ApiMessage[];
  normalizedImageCount: number;
}

/**
 * Reasoning effort levels per model family, sourced from the upstream
 * OpenCode provider transform (anomalyco/opencode, packages/opencode/src/provider/transform.ts):
 *
 *   WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
 *   OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"]
 *
 * For @ai-sdk/openai-compatible (Mimo, and most models routed through
 * chat-completions): the default is WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"].
 * DeepSeek V4 on openai-compatible additionally adds "max" → ["low", "medium", "high", "max"].
 */
export interface LanguageModelConfiguration {
  apiKey?: unknown;
}

export type ConfiguredLanguageModelInfoOptions = vscode.PrepareLanguageModelChatModelOptions & {
  configuration?: LanguageModelConfiguration;
};

export type ConfiguredLanguageModelResponseOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  configuration?: LanguageModelConfiguration;
};
