import type { ProviderVendor } from "../providerTypes";
import type { ThinkingFamily } from "../thinking/types";

/**
 * Data-driven model registry — the single source of truth for "which model
 * family uses which transport + thinking strategy".
 *
 * Adding a new model family = adding ONE row here (+ optionally a thinking
 * strategy class in `src/thinking/`). Both the transport router
 * (`core/routing.ts` → {@link resolveModelRouting}) and the thinking-family
 * detector (`thinking/provider.ts` → {@link thinkingFamily}) consult this
 * table, so a family's wiring never lives in two places again.
 *
 * Per-model context limits / capabilities / cost are NOT in this table —
 * those come from the live models.dev metadata (`models/metadata.ts`), which
 * is already data-driven. The registry covers the two places that used to
 * hardcode per-family decisions in code.
 *
 * CONTRACT: pure — no `vscode` import, no side effects.
 */

/** Wire-format endpoint a model family speaks. */
export type ModelEndpointKind = "chat-completions" | "messages" | "responses" | "google";

export interface ModelRegistryEntry {
  /** Human-readable family label (used in diagnostics). */
  family: string;
  /**
   * Model-id patterns this entry matches. Entries are evaluated in table
   * order and the FIRST match wins, so order matters — put the most specific
   * patterns (e.g. `minimax-m2.` before `minimax-`) earlier.
   */
  patterns: RegExp[];
  /** Transport the family uses. */
  endpointKind: ModelEndpointKind;
  /** SDK package hint for the endpoint (diagnostics / future adapter wiring). */
  sdkPackage?: string;
  /**
   * Thinking strategy family (maps to `src/thinking/<family>.ts`).
   * `null` = no dedicated strategy (the generic fallback handles it).
   */
  thinkingFamily: ThinkingFamily;
  /**
   * Optional vendor restriction: the entry only applies when the model is
   * served by one of these base vendors. Absent = applies to every vendor.
   */
  vendors?: ProviderVendor[];
}

export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  // GPT family → OpenAI Responses API (reasoning only supported there).
  { family: "gpt", patterns: [/^gpt-/i], endpointKind: "responses", sdkPackage: "@ai-sdk/openai", thinkingFamily: "openai" },
  // Claude family → Anthropic Messages API (any vendor).
  { family: "claude", patterns: [/^claude-/i], endpointKind: "messages", sdkPackage: "@ai-sdk/anthropic", thinkingFamily: null },
  // MiniMax m2.x served by Go → Anthropic Messages API; on Zen it falls back
  // to chat-completions (the generic minimax row below).
  {
    family: "minimax-m2",
    patterns: [/^minimax-m2\./i],
    endpointKind: "messages",
    sdkPackage: "@ai-sdk/anthropic",
    thinkingFamily: "minimax",
    vendors: ["opencodego"],
  },
  // Qwen models that use the Anthropic Messages API (the rest go chat-completions).
  {
    family: "qwen-messages",
    patterns: [/^qwen3\.(?:5|6)-plus(?:-free)?$/i, /^qwen3\.7-max$/i],
    endpointKind: "messages",
    sdkPackage: "@ai-sdk/anthropic",
    thinkingFamily: "qwen",
  },
  // Gemini family served by Zen → Google Generative Language API.
  {
    family: "gemini",
    patterns: [/^gemini-/i],
    endpointKind: "google",
    sdkPackage: "@ai-sdk/google",
    thinkingFamily: null,
    vendors: ["opencodezen"],
  },
  // Muse Spark 1.2 (Meta) → OpenAI Responses API (per OpenCode Go docs).
  // The gateway rejects chat-completions parameters (stream_options,
  // tool_choice) so this MUST use the Responses endpoint.
  {
    family: "muse",
    patterns: [/^muse-/i],
    endpointKind: "responses",
    sdkPackage: "@ai-sdk/openai",
    thinkingFamily: "muse",
  },
  // Grok (xAI) → OpenAI Responses API. The OpenCode gateway serves grok
  // models exclusively via `/v1/responses` (@ai-sdk/openai, per the Zen
  // endpoint table) — sending them to chat-completions ("oa-compat") is
  // rejected with "Model grok-4.6 is not supported for format oa-compat"
  // (issue #208).
  {
    family: "grok",
    patterns: [/^grok-/i, /^grok-build-/i],
    endpointKind: "responses",
    sdkPackage: "@ai-sdk/openai",
    thinkingFamily: null,
  },
  // Everything else that has a dedicated thinking strategy → chat-completions.
  {
    family: "minimax",
    patterns: [/^minimax-/i],
    endpointKind: "chat-completions",
    sdkPackage: "@ai-sdk/openai-compatible",
    thinkingFamily: "minimax",
  },
  {
    family: "deepseek",
    patterns: [/^deepseek-/i],
    endpointKind: "chat-completions",
    sdkPackage: "@ai-sdk/openai-compatible",
    thinkingFamily: "deepseek",
  },
  { family: "glm", patterns: [/^glm-/i], endpointKind: "chat-completions", sdkPackage: "@ai-sdk/openai-compatible", thinkingFamily: "glm" },
  {
    family: "kimi",
    patterns: [/^kimi-/i],
    endpointKind: "chat-completions",
    sdkPackage: "@ai-sdk/openai-compatible",
    thinkingFamily: "kimi",
  },
  {
    family: "mimo",
    patterns: [/^mimo-/i],
    endpointKind: "chat-completions",
    sdkPackage: "@ai-sdk/openai-compatible",
    thinkingFamily: "mimo",
  },
  {
    family: "qwen",
    patterns: [/^qwen3(?:\.|-)/i],
    endpointKind: "chat-completions",
    sdkPackage: "@ai-sdk/openai-compatible",
    thinkingFamily: "qwen",
  },
  // Catch-all: unknown families use chat-completions with the generic strategy.
  { family: "default", patterns: [/.*/], endpointKind: "chat-completions", sdkPackage: "@ai-sdk/openai-compatible", thinkingFamily: null },
];

/**
 * Look up the first registry entry matching `modelId`.
 *
 * @param vendor Optional base vendor to honor `vendors` restrictions (pass
 *               `undefined` — e.g. for the thinking-family lookup — to ignore
 *               them). The router always passes the resolved base vendor.
 */
export function lookupModelRegistryEntry(modelId: string, vendor?: ProviderVendor): ModelRegistryEntry {
  for (const entry of MODEL_REGISTRY) {
    if (vendor !== undefined && entry.vendors !== undefined && !entry.vendors.includes(vendor)) {
      continue;
    }
    if (entry.patterns.some((pattern) => pattern.test(modelId))) {
      return entry;
    }
  }
  // Unreachable in practice (the default catch-all row matches everything),
  // kept as a safety net.
  return MODEL_REGISTRY[MODEL_REGISTRY.length - 1];
}
