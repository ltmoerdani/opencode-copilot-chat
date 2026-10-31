/**
 * Reflection Beam thinking strategy.
 *
 * Beam always reasons and accepts only low/medium/high/xhigh/max. The
 * workspace's generic setting is reused as the storage slot, but an "off"
 * value is normalized to low so it can never reach the wire as an invalid
 * attempt to disable Beam reasoning.
 */
import { BaseThinkingProvider } from "./base";
import { effortProperty, type ThinkingSchema } from "./schema";
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ThinkingSettings, ThinkingFamily, BuildThinkingPayloadOptions } from "./types";

const BEAM_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export class BeamThinking extends BaseThinkingProvider {
  readonly family: ThinkingFamily = "beam";

  constructor(readonly modelId: string) {
    super();
  }

  schema(_metadata?: ResolvedModelMetadata): ThinkingSchema {
    return {
      properties: {
        reasoningEffort: effortProperty({
          enum: BEAM_EFFORTS,
          labels: ["Low", "Medium", "High", "XHigh", "Max"],
          descriptions: [
            "Faster responses with less reasoning",
            "Balanced reasoning and speed",
            "Greater reasoning depth",
            "Very high reasoning depth",
            "Maximum reasoning effort",
          ],
          default: "low",
        }),
      },
    };
  }

  applyOverride(settings: ThinkingSettings, override: Record<string, unknown>): ThinkingSettings {
    return this.applyEffort(settings, override, "generic", BEAM_EFFORTS);
  }

  normalize(settings: ThinkingSettings): ThinkingSettings {
    return settings.generic === "off" ? { ...settings, generic: "low" } : settings;
  }

  buildPayload(thinking: ThinkingSettings, _opts?: BuildThinkingPayloadOptions): Record<string, unknown> {
    const effort = BEAM_EFFORTS.includes(thinking.generic as (typeof BEAM_EFFORTS)[number]) ? thinking.generic : "low";
    return { reasoning_effort: effort };
  }

  requestsThinking(_thinking: ThinkingSettings): boolean {
    return true;
  }
}
