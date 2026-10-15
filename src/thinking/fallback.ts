/**
 * Fallback thinking strategy for models with no known thinking family.
 *
 * This is the generic, data-driven path: whatever models.dev says about a
 * model wins, so a model released after this build still gets a working
 * reasoning control instead of silently emitting nothing.
 *
 *  - `metadata.reasoning` true → the model gets a generic reasoning-effort
 *    picker (its own `reasoning_options` levels when it declares them,
 *    otherwise the shared off→max ladder) and the pick is sent as a plain
 *    OpenAI-compatible `reasoning_effort`.
 *  - `metadata.reasoning` false/absent → no picker and no reasoning field.
 *
 * The generic payload is only valid on the OpenAI-compatible chat-completions
 * endpoint. Family-less models routed elsewhere — `claude-*` to Anthropic
 * messages, `grok-*` to the Responses API — keep their existing no-op
 * behaviour: `reasoning_effort` means nothing on those wire formats, so
 * surfacing a picker there would be a control that silently does nothing (or
 * gets the request rejected). `endpointKind` comes from the shared model
 * registry, so this stays data-driven rather than a name list. (Gemini has its
 * own Google-native strategy — see `thinking/gemini.ts`.)
 *
 * `reasoning_content` is always treated as genuine CoT (never visible text).
 */
import { BaseThinkingProvider } from "./base";
import { schemaFromReasoningOptions, genericReasoningSchema, GENERIC_REASONING_EFFORTS, type ThinkingSchema } from "./schema";
import { lookupModelRegistryEntry } from "../core/registry";
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ThinkingSettings, ThinkingFamily, BuildThinkingPayloadOptions } from "./types";

/**
 * Sampling-level repetition penalty for known degenerate repeaters served
 * through the generic (chat-completions, openai-compatible) endpoint — same
 * mechanism as the MiMo mitigation (issue #36 / PR #163). `big-pickle` is a
 * stealth free model that gets stuck repeating the same phrase mid-task on
 * complex agent workloads (issue #207); `repetition_penalty` is a standard
 * sampling param on OpenAI-compatible (vLLM/SGLang-style) backends.
 */
const GENERIC_REPETITION_PENALTY = 1.2;
const REPETITION_PENALIZED_MODEL_PATTERNS = [/^big-pickle$/i];

export class FallbackThinking extends BaseThinkingProvider {
  readonly family: ThinkingFamily = null;

  constructor(
    readonly modelId: string,
    private readonly metadata?: ResolvedModelMetadata,
  ) {
    super();
  }

  schema(metadata?: ResolvedModelMetadata): ThinkingSchema | undefined {
    const effective = this.metadata ?? metadata;
    if (!this.genericEffortSupported(effective)) return undefined;
    return schemaFromReasoningOptions(effective) ?? genericReasoningSchema();
  }

  applyOverride(settings: ThinkingSettings, override: Record<string, unknown>): ThinkingSettings {
    if (!this.genericEffortSupported()) return settings;
    // Accept exactly what this model's own picker offered, so a models.dev
    // level outside the generic ladder (`max`, `on`, …) still reaches the wire.
    return this.applyEffort(settings, override, "generic", this.effortValues());
  }

  buildPayload(thinking: ThinkingSettings, _opts?: BuildThinkingPayloadOptions): Record<string, unknown> {
    const base: Record<string, unknown> = REPETITION_PENALIZED_MODEL_PATTERNS.some((pattern) => pattern.test(this.modelId))
      ? { repetition_penalty: GENERIC_REPETITION_PENALTY }
      : {};
    if (!this.genericEffortSupported() || thinking.generic === "off") return base;
    return { ...base, reasoning_effort: thinking.generic };
  }

  requestsThinking(thinking: ThinkingSettings): boolean {
    return this.genericEffortSupported() && thinking.generic !== "off";
  }

  // treatReasoningAsContent: reasoning is genuine CoT → default false.

  /**
   * Whether this model takes the generic OpenAI-compatible `reasoning_effort`:
   * it must declare reasoning support AND be served over chat-completions.
   * The single predicate behind the schema, the override mapping and the
   * payload, so the picker can never offer a control the request ignores.
   */
  private genericEffortSupported(metadata = this.metadata): boolean {
    return metadata?.reasoning === true && lookupModelRegistryEntry(this.modelId).endpointKind === "chat-completions";
  }

  /** This model's offered levels, falling back to the shared generic ladder. */
  private effortValues(): readonly string[] {
    const offered = (this.schema()?.properties.reasoningEffort as { enum?: unknown } | undefined)?.enum;
    return Array.isArray(offered) ? offered.filter((value): value is string => typeof value === "string") : GENERIC_REASONING_EFFORTS;
  }
}
