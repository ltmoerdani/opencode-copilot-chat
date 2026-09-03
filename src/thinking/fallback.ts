/**
 * Fallback thinking strategy for models with no known family.
 *
 * Only reasoning-capable models (`metadata.reasoning`) get a generic off/on
 * picker schema; no thinking fields are ever emitted to the request, and
 * `reasoning_content` is always treated as genuine CoT (never visible text).
 */
import { BaseThinkingProvider } from "./base";
import { schemaFromReasoningOptions, genericReasoningSchema, type ThinkingSchema } from "./schema";
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
    return schemaFromReasoningOptions(effective) ?? (effective?.reasoning ? genericReasoningSchema() : undefined);
  }

  // applyOverride: no known family → no override mapping (inherited default).

  buildPayload(_thinking: ThinkingSettings, _opts?: BuildThinkingPayloadOptions): Record<string, unknown> {
    if (REPETITION_PENALIZED_MODEL_PATTERNS.some((pattern) => pattern.test(this.modelId))) {
      return { repetition_penalty: GENERIC_REPETITION_PENALTY };
    }
    return {};
  }

  requestsThinking(_thinking: ThinkingSettings): boolean {
    return false;
  }

  // treatReasoningAsContent: reasoning is genuine CoT → default false.
}
