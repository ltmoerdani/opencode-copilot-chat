import { GO_VENDOR, ZEN_VENDOR, type ProviderVendor, type AllProviderVendor } from "./providerTypes";

export interface BaseModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ModelCostTier {
  /** Dollars per 1M input tokens for this tier. */
  input: number;
  /** Dollars per 1M output tokens for this tier. */
  output: number;
  /** Dollars per 1M cache read tokens for this tier. */
  cache_read?: number;
  /** Dollars per 1M cache write tokens for this tier. */
  cache_write?: number;
  /** The tier specification, e.g. { type: "context", size: 256000 }. */
  tier: {
    type: string;
    size: number;
  };
}

export interface ModelCost {
  /** Dollars per 1M input tokens. */
  input: number;
  /** Dollars per 1M output tokens. */
  output: number;
  /** Dollars per 1M cache read tokens. */
  cache_read?: number;
  /** Dollars per 1M cache write tokens. */
  cache_write?: number;
  /** Context-size-based pricing tiers (from models.dev). */
  tiers?: ModelCostTier[];
  /** Pricing for contexts exceeding 200K tokens (shorthand). */
  context_over_200k?: Omit<ModelCost, "tiers" | "context_over_200k">;
}

export interface ModelMetadataFields {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsPdf?: boolean;
  reasoning?: boolean;
  /** Raw reasoning_options from models.dev, e.g. [{ type: "toggle" }, { type: "effort", values: ["low","medium","high"] }]. */
  reasoningOptions?: Array<{ type?: string; values?: string[] }>;
  /** Whether the model supports the temperature parameter. False means temperature is deprecated/unsupported. */
  temperature?: boolean;
  status?: string;
  cost?: ModelCost;
}

export interface CachedModelMetadataSnapshot {
  fetchedAt: number;
  providers: Record<ProviderVendor, Record<string, ModelMetadataFields>>;
}

export interface ResolvedModelMetadata extends BaseModelLimits {
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsPdf: boolean;
  reasoning: boolean;
  /** Parsed reasoning_options from models.dev, if available. */
  reasoningOptions?: Array<{ type?: string; values?: string[] }>;
  /** Whether the model supports the temperature parameter. Undefined means unknown (assume supported). */
  temperature?: boolean;
  status?: string;
  source: "models.dev" | "live" | "fallback" | "default";
  cost?: ModelCost;
}

export interface ModelListEntry {
  id?: string;
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

export interface ModelsDevModelRecord {
  status?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<{ type?: string; values?: string[] }>;
  temperature?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: Array<{
      input: number;
      output: number;
      cache_read?: number;
      cache_write?: number;
      tier: { type: string; size: number };
    }>;
    context_over_200k?: {
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
    };
  };
}

interface ModelsDevProviderRecord {
  models?: Record<string, ModelsDevModelRecord>;
}

export interface ModelsDevResponse {
  opencode?: ModelsDevProviderRecord;
  "opencode-go"?: ModelsDevProviderRecord;
}

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODEL_METADATA_REVISION = "session-2026-05-21-b";
export const MODEL_METADATA_CACHE_KEY = "opencode.modelMetadataCache.v5";
export const MODEL_METADATA_CACHE_TTL_MS = 1 * 60 * 60 * 1000;

const DEFAULT_MODEL_LIMITS: BaseModelLimits = {
  contextWindow: 262144,
  maxOutputTokens: 65536,
};

const MODELS_DEV_PROVIDER_BY_VENDOR: Record<ProviderVendor, keyof ModelsDevResponse> = {
  [GO_VENDOR]: "opencode-go",
  [ZEN_VENDOR]: "opencode",
};

const MODEL_LIMITS_BY_PROVIDER: Record<ProviderVendor, Record<string, BaseModelLimits>> = {
  [GO_VENDOR]: {
    "deepseek-v4-flash": { contextWindow: 1000000, maxOutputTokens: 384000 },
    "deepseek-v4-pro": { contextWindow: 1000000, maxOutputTokens: 384000 },
    "mimo-v2.5": { contextWindow: 1000000, maxOutputTokens: 128000 },
    "mimo-v2.5-pro": { contextWindow: 1048576, maxOutputTokens: 128000 },
    "mimo-v2-omni": { contextWindow: 262144, maxOutputTokens: 128000 },
    "mimo-v2-pro": { contextWindow: 1048576, maxOutputTokens: 128000 },
    "kimi-k2.7-code": { contextWindow: 256000, maxOutputTokens: 262144 },
    "kimi-k2.6": { contextWindow: 262144, maxOutputTokens: 65536 },
    "kimi-k2.5": { contextWindow: 262144, maxOutputTokens: 65536 },
    "glm-5.1": { contextWindow: 202752, maxOutputTokens: 32768 },
    "glm-5": { contextWindow: 202752, maxOutputTokens: 32768 },
    "minimax-m3": { contextWindow: 512000, maxOutputTokens: 131072 },
    "minimax-m2.7": { contextWindow: 204800, maxOutputTokens: 131072 },
    "minimax-m2.5": { contextWindow: 204800, maxOutputTokens: 65536 },
    "minimax-m2.1": { contextWindow: 204800, maxOutputTokens: 131072 },
    "minimax-m2": { contextWindow: 204800, maxOutputTokens: 131072 },
    "qwen3.7-max": { contextWindow: 1000000, maxOutputTokens: 65536 },
    "qwen3.6-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.5-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "gpt-5.6-luna": { contextWindow: 1050000, maxOutputTokens: 128000 },
    "hy3-preview": { contextWindow: 256000, maxOutputTokens: 64000 },
    "ring-2.6-1t": { contextWindow: 262000, maxOutputTokens: 66000 },
  },
  [ZEN_VENDOR]: {
    "claude-opus-4-7": { contextWindow: 1000000, maxOutputTokens: 128000 },
    "claude-opus-4-6": { contextWindow: 1000000, maxOutputTokens: 128000 },
    "claude-opus-4-5": { contextWindow: 200000, maxOutputTokens: 64000 },
    "claude-opus-4-1": { contextWindow: 200000, maxOutputTokens: 32000 },
    "claude-sonnet-4-6": { contextWindow: 1000000, maxOutputTokens: 64000 },
    "claude-sonnet-4-5": { contextWindow: 1000000, maxOutputTokens: 64000 },
    "claude-sonnet-4": { contextWindow: 1000000, maxOutputTokens: 64000 },
    "claude-haiku-4-5": { contextWindow: 200000, maxOutputTokens: 64000 },
    "deepseek-v4-flash-free": { contextWindow: 200000, maxOutputTokens: 128000 },
    "gemini-3.5-flash": { contextWindow: 1048576, maxOutputTokens: 65536 },
    "gemini-3.1-pro": { contextWindow: 1048576, maxOutputTokens: 65536 },
    "gemini-3-flash": { contextWindow: 1048576, maxOutputTokens: 65536 },
    "glm-5.1": { contextWindow: 204800, maxOutputTokens: 131072 },
    "glm-5": { contextWindow: 204800, maxOutputTokens: 131072 },
    "gpt-5.5": { contextWindow: 1050000, maxOutputTokens: 128000 },
    "gpt-5.5-pro": { contextWindow: 1050000, maxOutputTokens: 128000 },
    "gpt-5.4": { contextWindow: 1050000, maxOutputTokens: 128000 },
    "gpt-5.4-pro": { contextWindow: 1050000, maxOutputTokens: 128000 },
    "gpt-5.4-mini": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.4-nano": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.3-codex": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.3-codex-spark": { contextWindow: 128000, maxOutputTokens: 128000 },
    "gpt-5.2": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.2-codex": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.1": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.1-codex": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.1-codex-max": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5.1-codex-mini": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5-codex": { contextWindow: 400000, maxOutputTokens: 128000 },
    "gpt-5-nano": { contextWindow: 400000, maxOutputTokens: 128000 },
    "grok-build-0.1": { contextWindow: 256000, maxOutputTokens: 256000 },
    "kimi-k2.6": { contextWindow: 262144, maxOutputTokens: 65536 },
    "kimi-k2.5": { contextWindow: 262144, maxOutputTokens: 65536 },
    "minimax-m2.7": { contextWindow: 204800, maxOutputTokens: 131072 },
    "minimax-m2.5": { contextWindow: 204800, maxOutputTokens: 131072 },
    "minimax-m2.5-free": { contextWindow: 204800, maxOutputTokens: 131072 },
    "qwen3.6-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.6-plus-free": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.5-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "trinity-large-preview-free": { contextWindow: 131072, maxOutputTokens: 131072 },
    "nemotron-3-super-free": { contextWindow: 204800, maxOutputTokens: 128000 },
    "big-pickle": { contextWindow: 200000, maxOutputTokens: 128000 },
  },
};

/**
 * Models where the `temperature` request parameter is unsupported / deprecated.
 * The upstream API rejects any non-default temperature with HTTP 400 for these.
 * Mirrors the models.dev `temperature: false` flag so the extension still
 * omits temperature even when the live metadata fetch fails.
 */
const MODELS_WITHOUT_TEMPERATURE = new Set([
  // Kimi K2.7-code: Moonshot API returns "invalid temperature: only 1 is allowed"
  "kimi-k2.7-code",
]);

export const VISION_CAPABLE_MODELS = new Set([
  "minimax-m2.7",
  "minimax-m2.5",
  "minimax-m2.5-free",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "kimi-k2.5",
  "glm-5.1",
  "glm-5",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "mimo-v2-omni",
  "mimo-v2-pro",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-opus-4-1",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4",
  "claude-haiku-4-5",
  "gemini-3.5-flash",
  "gemini-3.1-pro",
  "gemini-3-flash",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.3-codex",
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
  "qwen3.6-plus",
  "qwen3.6-plus-free",
  "qwen3.5-plus",
  "gpt-5.6-luna",
]);

export function isFreshModelMetadata(snapshot: CachedModelMetadataSnapshot): boolean {
  return Date.now() - snapshot.fetchedAt < MODEL_METADATA_CACHE_TTL_MS;
}

export function toEffectiveModelId(modelId: string, vendor: AllProviderVendor): string {
  return `${vendor}:${modelId}::${MODEL_METADATA_REVISION}`;
}

export function bundledModelMetadataSnapshot(): CachedModelMetadataSnapshot {
  return {
    fetchedAt: 0,
    providers: {
      [GO_VENDOR]: bundledModelMetadataForProvider(GO_VENDOR),
      [ZEN_VENDOR]: bundledModelMetadataForProvider(ZEN_VENDOR),
    },
  };
}

export function fallbackModelMetadata(modelId: string, vendor: ProviderVendor): ModelMetadataFields | undefined {
  const limits = MODEL_LIMITS_BY_PROVIDER[vendor][modelId];
  const supportsVision = VISION_CAPABLE_MODELS.has(modelId);
  const status = vendor === ZEN_VENDOR && modelId === "minimax-m2.5-free" ? "deprecated" : undefined;

  if (!limits && !supportsVision && !status && !supportsReasoning(modelId)) {
    return undefined;
  }

  return {
    contextWindow: limits?.contextWindow,
    maxOutputTokens: limits?.maxOutputTokens,
    supportsVision: supportsVision || undefined,
    reasoning: supportsReasoning(modelId) || undefined,
    // Propagate temperature:false for models whose upstream API rejects the
    // parameter. Without this, the request body would still include
    // `temperature` when models.dev live fetch is unavailable.
    temperature: MODELS_WITHOUT_TEMPERATURE.has(modelId) ? false : undefined,
    status,
  };
}

export function normalizeModelsDevSnapshot(data: ModelsDevResponse): CachedModelMetadataSnapshot {
  return {
    fetchedAt: Date.now(),
    providers: {
      [GO_VENDOR]: normalizeModelsDevProvider(data[MODELS_DEV_PROVIDER_BY_VENDOR[GO_VENDOR]]?.models ?? {}),
      [ZEN_VENDOR]: normalizeModelsDevProvider(data[MODELS_DEV_PROVIDER_BY_VENDOR[ZEN_VENDOR]]?.models ?? {}),
    },
  };
}

export function normalizeLiveModelMetadata(model: ModelListEntry): ModelMetadataFields | undefined {
  const modalities = detectModalityFlags(model.modalities, model.imageInput ?? model.image_input ?? model.attachment);

  return normalizeModelMetadataFields({
    contextWindow: positiveNumber(model.contextWindow ?? model.context_window ?? model.limit?.context),
    maxOutputTokens: positiveNumber(model.maxOutputTokens ?? model.max_output_tokens ?? model.limit?.output),
    supportsVision: modalities.supportsVision,
    supportsAudio: modalities.supportsAudio,
    supportsVideo: modalities.supportsVideo,
    supportsPdf: modalities.supportsPdf,
    reasoning: typeof model.reasoning === "boolean" ? model.reasoning : undefined,
    status: model.deprecated ? "deprecated" : typeof model.status === "string" ? model.status : undefined,
  });
}

export function resolveModelMetadata(
  modelId: string,
  vendor: ProviderVendor,
  snapshot: CachedModelMetadataSnapshot,
  liveModelMetadataById: Map<string, ModelMetadataFields>,
): ResolvedModelMetadata {
  const cachedMetadata = snapshot.providers[vendor][modelId];
  const liveMetadata = liveModelMetadataById.get(modelId);
  const fallbackMetadata = fallbackModelMetadata(modelId, vendor);

  return {
    contextWindow:
      liveMetadata?.contextWindow ?? cachedMetadata?.contextWindow ?? fallbackMetadata?.contextWindow ?? DEFAULT_MODEL_LIMITS.contextWindow,
    maxOutputTokens:
      liveMetadata?.maxOutputTokens ??
      cachedMetadata?.maxOutputTokens ??
      fallbackMetadata?.maxOutputTokens ??
      DEFAULT_MODEL_LIMITS.maxOutputTokens,
    supportsVision: liveMetadata?.supportsVision ?? cachedMetadata?.supportsVision ?? fallbackMetadata?.supportsVision ?? false,
    supportsAudio: liveMetadata?.supportsAudio ?? cachedMetadata?.supportsAudio ?? false,
    supportsVideo: liveMetadata?.supportsVideo ?? cachedMetadata?.supportsVideo ?? false,
    supportsPdf: liveMetadata?.supportsPdf ?? cachedMetadata?.supportsPdf ?? false,
    reasoning: liveMetadata?.reasoning ?? cachedMetadata?.reasoning ?? fallbackMetadata?.reasoning ?? supportsReasoning(modelId),
    status: liveMetadata?.status ?? cachedMetadata?.status ?? fallbackMetadata?.status,
    source: liveMetadata ? "live" : cachedMetadata ? "models.dev" : fallbackMetadata ? "fallback" : "default",
    cost: liveMetadata?.cost ?? cachedMetadata?.cost ?? fallbackMetadata?.cost,
    reasoningOptions: liveMetadata?.reasoningOptions ?? cachedMetadata?.reasoningOptions,
    temperature: liveMetadata?.temperature ?? cachedMetadata?.temperature,
  };
}

export function hasExplicitModelLimits(modelId: string, vendor: ProviderVendor): boolean {
  return Boolean(fallbackModelMetadata(modelId, vendor));
}

function bundledModelMetadataForProvider(vendor: ProviderVendor): Record<string, ModelMetadataFields> {
  return Object.fromEntries(
    Object.keys(MODEL_LIMITS_BY_PROVIDER[vendor]).flatMap((modelId) => {
      const metadata = fallbackModelMetadata(modelId, vendor);
      return metadata ? [[modelId, metadata] as const] : [];
    }),
  );
}

function normalizeModelsDevProvider(models: Record<string, ModelsDevModelRecord>): Record<string, ModelMetadataFields> {
  const normalized: Record<string, ModelMetadataFields> = {};

  for (const [modelId, model] of Object.entries(models)) {
    const modalities = detectModalityFlags(model.modalities, model.attachment);
    const rawCost = model.cost;
    const cost: ModelCost | undefined =
      typeof rawCost?.input === "number" && typeof rawCost?.output === "number"
        ? {
            input: rawCost.input,
            output: rawCost.output,
            ...(typeof rawCost.cache_read === "number" ? { cache_read: rawCost.cache_read } : {}),
            ...(typeof rawCost.cache_write === "number" ? { cache_write: rawCost.cache_write } : {}),
            ...(Array.isArray(rawCost.tiers) && rawCost.tiers.length > 0
              ? {
                  tiers: rawCost.tiers.map((t) => ({
                    input: t.input,
                    output: t.output,
                    ...(typeof t.cache_read === "number" ? { cache_read: t.cache_read } : {}),
                    ...(typeof t.cache_write === "number" ? { cache_write: t.cache_write } : {}),
                    tier: { type: t.tier.type, size: t.tier.size },
                  })),
                }
              : {}),
            ...(rawCost.context_over_200k
              ? { context_over_200k: { input: rawCost.context_over_200k.input ?? 0, output: rawCost.context_over_200k.output ?? 0 } }
              : {}),
          }
        : undefined;

    const metadata = normalizeModelMetadataFields({
      contextWindow: positiveNumber(model.limit?.context),
      maxOutputTokens: positiveNumber(model.limit?.output),
      supportsVision: modalities.supportsVision,
      supportsAudio: modalities.supportsAudio,
      supportsVideo: modalities.supportsVideo,
      supportsPdf: modalities.supportsPdf,
      reasoning: typeof model.reasoning === "boolean" ? model.reasoning : undefined,
      reasoningOptions: Array.isArray(model.reasoning_options) && model.reasoning_options.length > 0 ? model.reasoning_options : undefined,
      temperature: typeof model.temperature === "boolean" ? model.temperature : undefined,
      status: typeof model.status === "string" ? model.status : undefined,
      cost,
    });

    if (metadata) {
      normalized[modelId] = metadata;
    }
  }

  return normalized;
}

function normalizeModelMetadataFields(metadata: ModelMetadataFields): ModelMetadataFields | undefined {
  if (
    metadata.contextWindow === undefined &&
    metadata.maxOutputTokens === undefined &&
    metadata.supportsVision === undefined &&
    metadata.supportsAudio === undefined &&
    metadata.supportsVideo === undefined &&
    metadata.supportsPdf === undefined &&
    metadata.reasoning === undefined &&
    metadata.reasoningOptions === undefined &&
    metadata.temperature === undefined &&
    metadata.status === undefined &&
    metadata.cost === undefined
  ) {
    return undefined;
  }
  return metadata;
}

interface ModalityFlags {
  supportsVision: boolean | undefined;
  supportsAudio: boolean | undefined;
  supportsVideo: boolean | undefined;
  supportsPdf: boolean | undefined;
}

function detectModalityFlags(
  modalities: { input?: string[]; output?: string[] } | undefined,
  attachmentHint: boolean | undefined,
): ModalityFlags {
  const inputModalities = Array.isArray(modalities?.input) ? modalities.input : undefined;

  if (inputModalities?.length) {
    return {
      supportsVision: inputModalities.some((m) => m !== "text"),
      supportsAudio: inputModalities.includes("audio") || undefined,
      supportsVideo: inputModalities.includes("video") || undefined,
      supportsPdf: inputModalities.includes("pdf") || undefined,
    };
  }

  const fallback = typeof attachmentHint === "boolean" ? attachmentHint : undefined;
  return {
    supportsVision: fallback,
    supportsAudio: undefined,
    supportsVideo: undefined,
    supportsPdf: undefined,
  };
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function supportsReasoning(modelId: string): boolean {
  return /^(deepseek-|glm-|kimi-|minimax-|qwen3(?:\.|-)|mimo-)/i.test(modelId);
}

// ---------------------------------------------------------------------------
// Context-size pricing-tiers helpers
// ---------------------------------------------------------------------------

export interface ContextSizeOption {
  /** Numeric context window token count for this option. */
  value: number;
  /** Human-readable label (e.g. "128K", "256K", "1M"). */
  label: string;
  /** Short description shown in the picker. */
  description: string;
  /** Whether this is the default option (cheapest/base tier). */
  isDefault: boolean;
}

/**
 * Given a model's cost metadata and its full context window, returns the
 * available context-size options for the VS Code model picker, or `undefined`
 * when the model has no tiered pricing.
 *
 * The options are derived from `cost.tiers[]` (each tier has a `tier.size`
 * threshold) and/or `cost.context_over_200k` (pricing beyond the base tier).
 */
export function getContextSizeOptions(cost: ModelCost | undefined, fullContextWindow: number): ContextSizeOption[] | undefined {
  if (!cost) return undefined;

  const tiers = cost.tiers;
  const hasContextOver200k = cost.context_over_200k !== undefined;

  // Collect all distinct context thresholds from explicit tiers
  const thresholds = (tiers ?? [])
    .filter((t) => t.tier?.type === "context" && typeof t.tier.size === "number" && t.tier.size > 0)
    .map((t) => t.tier.size)
    .sort((a, b) => a - b);

  // If no explicit tiers but context_over_200k exists, use 200_000 as the threshold
  if (thresholds.length === 0 && hasContextOver200k && fullContextWindow > 200_000) {
    thresholds.push(200_000);
  }

  if (thresholds.length === 0) return undefined;

  // Build options: base (up to first threshold) + each additional threshold + full context
  const options: ContextSizeOption[] = [];
  const baseThreshold = thresholds[0];

  // Base/default tier
  options.push({
    value: baseThreshold,
    label: formatContextSize(baseThreshold),
    description: "Default pricing",
    isDefault: true,
  });

  // Intermediate tiers (thresholds beyond base)
  for (const threshold of thresholds) {
    if (threshold === baseThreshold) continue;
    const hasSurcharge =
      tiers?.some((t) => t.tier.size === threshold && (t.input > cost.input || t.output > cost.output)) ?? hasContextOver200k;
    options.push({
      value: threshold,
      label: formatContextSize(threshold),
      description: hasSurcharge ? "Higher pricing" : "Extended",
      isDefault: false,
    });
  }

  // Full context window (if larger than the largest threshold)
  if (fullContextWindow > thresholds[thresholds.length - 1]) {
    const hasSurcharge = hasContextOver200k || tiers?.some((t) => t.input > cost.input || t.output > cost.output);
    options.push({
      value: fullContextWindow,
      label: formatContextSize(fullContextWindow),
      description: hasSurcharge ? "Higher pricing" : "Maximum",
      isDefault: false,
    });
  }

  return options;
}

/**
 * Resolve context-size options for a concrete model. Kimi K3 exposes a
 * cheaper 256K context mode alongside its larger window, but models.dev does
 * not consistently publish that distinction as a pricing tier.
 */
export function getContextSizeOptionsForModel(
  modelId: string,
  cost: ModelCost | undefined,
  fullContextWindow: number,
): ContextSizeOption[] | undefined {
  const metadataOptions = getContextSizeOptions(cost, fullContextWindow);
  if (metadataOptions?.length) {
    return metadataOptions;
  }

  const kimiBaseContext = 256_000;
  // 262,144 is the binary representation commonly used for a 256K window;
  // do not expose a fake second tier for models whose whole window is 256K.
  if (!/^(?:kimi-|k3(?:-|$))/i.test(modelId) || fullContextWindow <= 262_144) {
    return undefined;
  }

  return [
    {
      value: kimiBaseContext,
      label: formatContextSize(kimiBaseContext),
      description: "Default pricing",
      isDefault: true,
    },
    {
      value: fullContextWindow,
      label: formatContextSize(fullContextWindow),
      description: "Higher pricing",
      isDefault: false,
    },
  ];
}

function formatContextSize(size: number): string {
  if (size >= 1_000_000) {
    const m = size / 1_000_000;
    return m === Math.floor(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (size >= 1_000) {
    const k = size / 1_000;
    return k === Math.floor(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(size);
}
