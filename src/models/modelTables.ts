import { GO_VENDOR, ZEN_VENDOR, type ProviderVendor } from "../providerTypes";
import type { BaseModelLimits } from "./metadata";

/**
 * Static per-model data tables used as offline fallback when neither the live
 * model list nor models.dev is available. Pure data — resolution logic lives
 * in `metadata.ts`.
 */

/** Bundled context/output limits per vendor+model (models.dev snapshot). */
export const MODEL_LIMITS_BY_PROVIDER: Record<ProviderVendor, Record<string, BaseModelLimits | undefined>> = {
  [GO_VENDOR]: {
    // OpenCode Go caps completion at 131072 even though models.dev still lists
    // output: 384000 — the gateway rejects larger values with HTTP 400 (#171).
    "deepseek-v4-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
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
    "qwen3.7-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.6-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "qwen3.5-plus": { contextWindow: 262144, maxOutputTokens: 65536 },
    "gpt-5.6-luna": { contextWindow: 1050000, maxOutputTokens: 128000 },
    "hy3-preview": { contextWindow: 256000, maxOutputTokens: 64000 },
    "muse-spark-1.2-contributor": { contextWindow: 1048576, maxOutputTokens: 131072 },
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
    "muse-spark-1.2-contributor-free": { contextWindow: 1048576, maxOutputTokens: 131072 },
  },
};

/**
 * Models where the `temperature` request parameter is unsupported / deprecated.
 * The upstream API rejects any non-default temperature with HTTP 400 for these.
 * Mirrors the models.dev `temperature: false` flag so the extension still
 * omits temperature even when the live metadata fetch fails.
 */
export const MODELS_WITHOUT_TEMPERATURE = new Set([
  // Kimi K2.7-code: Moonshot API returns "invalid temperature: only 1 is allowed"
  "kimi-k2.7-code",
]);

/** Models known to accept image input even without live modality metadata. */
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
  "gpt-5.6-luna",
  // Muse Spark 1.2 — models.dev lists image/video/pdf/audio input modalities
  // for both variants; without these entries an offline fallback snapshot
  // reports imageInput: false and VS Code strips attachments before they
  // reach the provider (#183).
  "muse-spark-1.2-contributor",
  "muse-spark-1.2-contributor-free",
]);
