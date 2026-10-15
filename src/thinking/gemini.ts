/**
 * Gemini thinking strategy (Google Generative Language API wire format).
 *
 * Gemini models speak Google's native `generationConfig.thinkingConfig`:
 * `thinkingLevel` pins the reasoning depth and `includeThoughts: true` requests
 * thought summaries so they could stream to the thinking panel while the model
 * works.
 *
 * NOTE (verified 2026-10-15 against `gemini-4-argon-contributor`): the gateway
 * accepts `thinkingConfig` (`thinkingLevel: "high"` → HTTP 200) and the model
 * does think — `usageMetadata.thoughtsTokenCount` is billed and included in the
 * completion count — but no thought SUMMARY text is ever relayed. Each stream
 * carries only the answer parts and a final `{"text":"","thoughtSignature":"…"}`
 * part whose value is an opaque signature (thought-context continuation token,
 * not decodable text). The thinking panel therefore stays empty for Gemini even
 * when thinking is enabled. This is an upstream limitation in the same class as
 * Muse Spark's `encrypted_content` (see `./muse.ts`), not a parsing gap: there
 * is no thought text in the payload to map. If upstream starts relaying
 * `thought: true` parts, `core/routing.ts` already maps them to
 * `reasoning_content` with no further client work.
 *
 * DISPLAY: Gemini thought parts are genuine CoT (echoed back as `thought: true`
 * parts on follow-up turns, see `request/google.ts`) → never visible text.
 *
 * CONTRACT: the payload is a `thinkingConfig` fragment — `request/google.ts`
 * merges it INSIDE `generationConfig` (unlike the flat OpenAI/Anthropic shapes).
 */
import { BaseThinkingProvider } from "./base";
import { schemaFromReasoningOptions, effortProperty, type ThinkingSchema } from "./schema";
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ThinkingSettings, ThinkingFamily, BuildThinkingPayloadOptions } from "./types";

const GEMINI_EFFORTS = ["off", "on", "low", "medium", "high"] as const;

export class GeminiThinking extends BaseThinkingProvider {
  readonly family: ThinkingFamily = "gemini";

  constructor(readonly modelId: string) {
    super();
  }

  schema(metadata?: ResolvedModelMetadata): ThinkingSchema | undefined {
    return (
      schemaFromReasoningOptions(metadata) ?? {
        properties: {
          reasoningEffort: effortProperty({
            enum: GEMINI_EFFORTS,
            labels: ["Off", "On", "Low", "Medium", "High"],
            descriptions: [
              "Fastest responses",
              "Model-default thinking with visible thoughts",
              "Faster responses with less reasoning",
              "Balanced reasoning and speed",
              "Greater reasoning depth but slower",
            ],
            default: "off",
          }),
        },
      }
    );
  }

  applyOverride(settings: ThinkingSettings, override: Record<string, unknown>): ThinkingSettings {
    return this.applyEffort(settings, override, "gemini", GEMINI_EFFORTS);
  }

  buildPayload(thinking: ThinkingSettings, _opts?: BuildThinkingPayloadOptions): Record<string, unknown> {
    const level = thinking.gemini;
    if (level === "off") {
      return {};
    }
    // "on" = model-default thinking, only surfaced; a level additionally pins depth.
    return {
      thinkingConfig: {
        includeThoughts: true,
        ...(level === "on" ? {} : { thinkingLevel: level }),
      },
    };
  }

  requestsThinking(thinking: ThinkingSettings): boolean {
    return thinking.gemini !== "off";
  }

  // treatReasoningAsContent: thought parts are genuine CoT → never content.
}
