import * as vscode from "vscode";
import {
  CONFIG_SECTION,
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_STREAM_IDLE_TIMEOUT_SECONDS,
  SETTING_DEBUG_REASONING,
  SETTING_MAX_INPUT_TOKENS,
  SETTING_MAX_TOKENS,
  SETTING_REQUEST_TIMEOUT_SECONDS,
  SETTING_STREAM_IDLE_TIMEOUT_SECONDS,
  SETTING_STRIP_THINK_TAGS,
  SETTING_TEMPERATURE,
  SETTING_THINKING_DEEPSEEK,
  SETTING_THINKING_GLM,
  SETTING_THINKING_KIMI,
  SETTING_THINKING_MIMO,
  SETTING_THINKING_MUSE,
  SETTING_THINKING_MINIMAX,
  SETTING_THINKING_OPENAI,
  SETTING_THINKING_QWEN,
  SETTING_THINKING_QWEN_BUDGET,
  THINKING_DEFAULTS,
  VISION_PROXY_MODEL_ID_KEY,
} from "../config";
import { getContextSizeOptionsForModel, type CachedModelMetadataSnapshot, type ResolvedModelMetadata } from "../models/metadata";
import { buildStableModelCapabilities } from "../models/modelCapabilities";
import { calculateModelLimits, type ModelLimits } from "../models/modelLimits";
import { AGENT_GO_VENDOR, AGENT_ZEN_VENDOR, GO_VENDOR, ZEN_VENDOR, resolveBaseVendor, type AllProviderVendor } from "../providerTypes";
import type { ApiSettings } from "../request/types";
import { thinkingProviderFor } from "../thinking";
import { extensionContext } from "../usage/dashboard";
import { toFiniteNumber } from "../utils";
import type { LanguageModelConfiguration, ProviderDefinition } from "./definitions";

/** Allowed values per thinking setting — a misconfigured value must never reach the wire. */
export const THINKING_ALLOWED_VALUES = {
  deepseek: ["off", "low", "medium", "high", "max"],
  glm: ["off", "high", "max"],
  kimi: ["on", "off"],
  minimax: ["off", "on"],
  openai: ["off", "low", "medium", "high", "xhigh"],
  qwen: ["auto", "on", "off"],
  qwenBudget: ["auto", "4096", "16384", "32768", "81920"],
  mimo: ["off", "low", "medium", "high"],
  muse: ["off", "low", "medium", "high", "xhigh"],
} as const;

/** Return `value` when it is one of `allowed`, else `fallback`. */
function validThinkingValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function getConfiguredApiKey(options?: { configuration?: LanguageModelConfiguration }): string | undefined {
  const configuredApiKey = options?.configuration?.apiKey;
  return typeof configuredApiKey === "string" && configuredApiKey.trim() ? configuredApiKey.trim() : undefined;
}

export function modelConfigurationSchema(
  modelId: string,
  metadata?: ResolvedModelMetadata,
): vscode.LanguageModelConfigurationSchema | undefined {
  const properties: Record<string, unknown> = {};

  // --- Thinking / Reasoning Effort ---
  // Delegated to the per-provider strategy (schemaFromReasoningOptions first,
  // then family hardcoded, then generic reasoning fallback).
  const builtinSchema = thinkingProviderFor(modelId, metadata).schema(metadata);

  if (builtinSchema) {
    Object.assign(properties, builtinSchema.properties);
  }

  // --- Context Size (tiered pricing) ---
  const contextSizeOptions = metadata ? getContextSizeOptionsForModel(modelId, metadata.cost, metadata.contextWindow) : undefined;
  if (contextSizeOptions && contextSizeOptions.length > 0) {
    properties.contextSize = {
      type: "number",
      title: "Context Size",
      enum: contextSizeOptions.map((o) => o.value),
      enumItemLabels: contextSizeOptions.map((o) => o.label),
      enumDescriptions: contextSizeOptions.map((o) => o.description),
      default: contextSizeOptions.find((o) => o.isDefault)?.value ?? contextSizeOptions[0].value,
      group: "tokens",
    };
  }

  if (Object.keys(properties).length === 0) {
    return undefined;
  }

  return { type: "object", properties: properties as vscode.LanguageModelConfigurationSchema["properties"] };
}

export function getRequestModelConfiguration(options: vscode.ProvideLanguageModelChatResponseOptions): Record<string, unknown> | undefined {
  // The field is `modelConfiguration` in the current proposed API; older
  // builds shipped it under `configuration` alongside the auth config. Accept
  // both shapes defensively so the picker keeps working across VS Code
  // versions.
  const opts = options as vscode.ProvideLanguageModelChatResponseOptions & {
    modelConfiguration?: Record<string, unknown>;
    configuration?: Record<string, unknown>;
  };
  return opts.modelConfiguration ?? opts.configuration;
}

/**
 * Scope-robust configuration read (issue #214).
 *
 * Plain `config.get()` merges workspace + user scope, but the Agents window
 * runs this extension in a separate agent-host process that can resolve the
 * workspace root differently (or have none at all), which made user-scope
 * `opencodego.thinking.*` values fall back to the baked-in defaults ("off").
 * Reading via `inspect()` prefers an explicitly set workspace value, then an
 * explicitly set user value, and only then the fallback — so a thinking
 * level set in User settings always wins over the default regardless of
 * which process/scope resolves first.
 */
function readConfigValue<T>(config: vscode.WorkspaceConfiguration, key: string, fallback: T): T {
  const inspected = config.inspect<T>(key);
  const value = inspected?.workspaceValue ?? inspected?.globalValue;
  return value === undefined ? fallback : value;
}

export function getSettings(): ApiSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  // Config values are sanitized so a misconfigured (e.g. string) value never
  // reaches the request body and 400s upstream.
  return {
    // Clamp to the range providers accept ([0, 2]) so a bad config value never
    // 400s upstream before the retry layer can strip it.
    temperature: toFiniteNumber(config.get(SETTING_TEMPERATURE, 0.2), 0.2, 0, 2),
    maxOutputTokensOverride: toFiniteNumber(config.get(SETTING_MAX_TOKENS, 0), 0, 0),
    maxInputTokensOverride: toFiniteNumber(config.get(SETTING_MAX_INPUT_TOKENS, 0), 0, 0),
    debugReasoning: config.get(SETTING_DEBUG_REASONING, false),
    // Clamped to sane upper bounds so a misconfigured huge value can't
    // silently disable the timeout safety net.
    requestTimeoutMs:
      toFiniteNumber(
        config.get(SETTING_REQUEST_TIMEOUT_SECONDS, DEFAULT_REQUEST_TIMEOUT_SECONDS),
        DEFAULT_REQUEST_TIMEOUT_SECONDS,
        1,
        1800,
      ) * 1000,
    streamIdleTimeoutMs:
      toFiniteNumber(
        config.get(SETTING_STREAM_IDLE_TIMEOUT_SECONDS, DEFAULT_STREAM_IDLE_TIMEOUT_SECONDS),
        DEFAULT_STREAM_IDLE_TIMEOUT_SECONDS,
        1,
        600,
      ) * 1000,
    thinking: {
      deepseek: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_DEEPSEEK, THINKING_DEFAULTS.deepseek),
        THINKING_ALLOWED_VALUES.deepseek,
        THINKING_DEFAULTS.deepseek,
      ),
      glm: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_GLM, THINKING_DEFAULTS.glm),
        THINKING_ALLOWED_VALUES.glm,
        THINKING_DEFAULTS.glm,
      ),
      kimi: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_KIMI, THINKING_DEFAULTS.kimi),
        THINKING_ALLOWED_VALUES.kimi,
        THINKING_DEFAULTS.kimi,
      ),
      minimax: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_MINIMAX, THINKING_DEFAULTS.minimax),
        THINKING_ALLOWED_VALUES.minimax,
        THINKING_DEFAULTS.minimax,
      ),
      openai: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_OPENAI, THINKING_DEFAULTS.openai),
        THINKING_ALLOWED_VALUES.openai,
        THINKING_DEFAULTS.openai,
      ),
      qwen: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_QWEN, THINKING_DEFAULTS.qwen),
        THINKING_ALLOWED_VALUES.qwen,
        THINKING_DEFAULTS.qwen,
      ),
      qwenBudget: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_QWEN_BUDGET, THINKING_DEFAULTS.qwenBudget),
        THINKING_ALLOWED_VALUES.qwenBudget,
        THINKING_DEFAULTS.qwenBudget,
      ),
      mimo: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_MIMO, THINKING_DEFAULTS.mimo),
        THINKING_ALLOWED_VALUES.mimo,
        THINKING_DEFAULTS.mimo,
      ),
      muse: validThinkingValue(
        readConfigValue(config, SETTING_THINKING_MUSE, THINKING_DEFAULTS.muse),
        THINKING_ALLOWED_VALUES.muse,
        THINKING_DEFAULTS.muse,
      ),
    },
    stripThinkTags: config.get<ApiSettings["stripThinkTags"]>(SETTING_STRIP_THINK_TAGS, "auto"),
  };
}

export function modelLimits(
  metadata: ResolvedModelMetadata,
  settings = getSettings(),
  contextSizeOverride?: number,
  promptTokens?: number,
): ModelLimits {
  return calculateModelLimits(metadata, {
    maxInputTokens: settings.maxInputTokensOverride,
    maxOutputTokens: settings.maxOutputTokensOverride,
    contextSize: contextSizeOverride,
    promptTokens,
  });
}

export function modelCapabilities(metadata: ResolvedModelMetadata): vscode.LanguageModelChatCapabilities {
  // When a vision proxy model is configured (non-empty ID in globalState),
  // report imageInput: true for ALL models so VS Code does not strip image
  // parts before they reach our provider. The vision proxy interceptor
  // forwards images to the configured model transparently.
  const supportsVision = metadata.supportsVision || isVisionProxyEnabled();

  // `editTools` is intentionally absent. VS Code 1.132 still gates that hint
  // behind the chatProvider proposal for non-allowlisted extensions.
  return buildStableModelCapabilities(supportsVision);
}

export function formatModalityBadges(metadata: ResolvedModelMetadata): string {
  const badges: string[] = [];
  if (metadata.supportsVision) {
    badges.push("Image");
  }
  if (metadata.supportsPdf) {
    badges.push("PDF");
  }
  if (metadata.supportsVideo) {
    badges.push("Video");
  }
  if (metadata.supportsAudio) {
    badges.push("Audio");
  }
  return badges.join(" · ");
}

export function shouldHideDeprecatedModel(
  modelId: string,
  vendor: ProviderDefinition["vendor"],
  snapshot: CachedModelMetadataSnapshot,
  liveModelIds?: ReadonlySet<string>,
): boolean {
  if (resolveBaseVendor(vendor) !== ZEN_VENDOR) {
    return false;
  }
  if (snapshot.providers[ZEN_VENDOR]?.[modelId]?.status !== "deprecated") {
    return false;
  }
  // Gateway is the source of truth for availability (issue #182). Only hide
  // when we have live gateway data confirming the model is absent. If the
  // gateway still serves it, models.dev is stale — don't hide. If we have
  // no live data (offline/fallback), fail open and don't hide either.
  if (!liveModelIds) {
    return false;
  }
  if (liveModelIds.has(modelId)) {
    return false;
  }
  return true;
}

export function resolveRawModelId(modelId: string): string {
  const [base] = modelId.split("::");
  const prefixes = [`${GO_VENDOR}:`, `${ZEN_VENDOR}:`, `${AGENT_GO_VENDOR}:`, `${AGENT_ZEN_VENDOR}:`];
  for (const prefix of prefixes) {
    if (base.startsWith(prefix)) {
      return base.slice(prefix.length);
    }
  }
  return base;
}

/** Best-effort vendor resolution from a model ID. */
export function resolveVendorFromId(modelId: string): AllProviderVendor {
  if (modelId.startsWith(`${AGENT_GO_VENDOR}:`)) return AGENT_GO_VENDOR;
  if (modelId.startsWith(`${AGENT_ZEN_VENDOR}:`)) return AGENT_ZEN_VENDOR;
  if (modelId.startsWith(`${ZEN_VENDOR}:`)) return ZEN_VENDOR;
  return GO_VENDOR;
}

/**
 * True when a vision proxy model has been configured (non-empty model ID
 * stored in globalState via the "OpenCode Go: Configure Vision Proxy" command).
 */
export function isVisionProxyEnabled(): boolean {
  return extensionContext().globalState.get<string>(VISION_PROXY_MODEL_ID_KEY, "").length > 0;
}
