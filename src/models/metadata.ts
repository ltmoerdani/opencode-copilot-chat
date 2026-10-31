import { GO_VENDOR, ZEN_VENDOR, type ProviderVendor, type AllProviderVendor } from "../providerTypes";
import { MODEL_LIMITS_BY_PROVIDER, MODELS_WITHOUT_TEMPERATURE, VISION_CAPABLE_MODELS } from "./modelTables";

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
  reasoningOptions?: { type?: string; values?: string[] }[];
  /** Whether the model supports the temperature parameter. False means temperature is deprecated/unsupported. */
  temperature?: boolean;
  status?: string;
  cost?: ModelCost;
}

export interface CachedModelMetadataSnapshot {
  fetchedAt: number;
  /** Vendors may be absent in cached data loaded from disk. */
  providers: Record<ProviderVendor, Record<string, ModelMetadataFields> | undefined>;
}

export interface ResolvedModelMetadata extends BaseModelLimits {
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsPdf: boolean;
  reasoning: boolean;
  /** Parsed reasoning_options from models.dev, if available. */
  reasoningOptions?: { type?: string; values?: string[] }[];
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
  reasoning_options?: { type?: string; values?: string[] }[];
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
    tiers?: {
      input: number;
      output: number;
      cache_read?: number;
      cache_write?: number;
      tier: { type: string; size: number };
    }[];
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

import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  FREE_ZEN_MODEL_IDS,
  MODEL_METADATA_CACHE_TTL_MS,
  MODEL_METADATA_REVISION,
} from "../config";
import { positiveNumber } from "../utils";

export { MODELS_DEV_API_URL, MODEL_METADATA_REVISION, MODEL_METADATA_CACHE_KEY, MODEL_METADATA_CACHE_TTL_MS } from "../config";

const DEFAULT_MODEL_LIMITS: BaseModelLimits = {
  contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
  maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
};

const MODELS_DEV_PROVIDER_BY_VENDOR: Record<ProviderVendor, keyof ModelsDevResponse> = {
  [GO_VENDOR]: "opencode-go",
  [ZEN_VENDOR]: "opencode",
};

export function isFreeModel(modelId: string): boolean {
  return FREE_ZEN_MODEL_IDS.has(modelId) || modelId.endsWith("-free");
}

// Static per-model data tables live in `modelTables.ts`; re-exported here so
// existing import paths keep working.
export { VISION_CAPABLE_MODELS };

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
  const cachedMetadata = snapshot.providers[vendor]?.[modelId];
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
    // The bundled fallback propagates `temperature: false` (models whose API
    // rejects the parameter) so the request body omits it even when the live
    // models.dev fetch is unavailable.
    temperature: liveMetadata?.temperature ?? cachedMetadata?.temperature ?? fallbackMetadata?.temperature,
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
      typeof rawCost?.input === "number" && typeof rawCost.output === "number"
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
    // Only actual image-capable modalities imply vision. A model that accepts
    // audio/pdf/video but no images must NOT advertise imageInput: true —
    // VS Code would forward image attachments the model cannot process.
    const visionModalities = new Set(["image", "image_url", "input_image"]);
    return {
      supportsVision: inputModalities.some((m) => visionModalities.has(m.toLowerCase())) || undefined,
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

function supportsReasoning(modelId: string): boolean {
  return /^(beam-|deepseek-|glm-|kimi-|minimax-|qwen3(?:\.|-)|mimo-|muse-)/i.test(modelId);
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
    .filter((t) => t.tier.type === "context" && typeof t.tier.size === "number" && t.tier.size > 0)
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
    return m === Math.floor(m) ? `${String(m)}M` : `${m.toFixed(1)}M`;
  }
  if (size >= 1_000) {
    const k = size / 1_000;
    return k === Math.floor(k) ? `${String(k)}K` : `${k.toFixed(1)}K`;
  }
  return String(size);
}
