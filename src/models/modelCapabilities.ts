export interface StableModelCapabilities {
  imageInput: boolean;
  toolCalling: true;
  supportsImageToText: boolean;
  supportsToolCalling: true;
}

/** Build model capabilities that are safe for regular Marketplace installs. */
export function buildStableModelCapabilities(supportsVision: boolean): StableModelCapabilities {
  return {
    imageInput: supportsVision,
    toolCalling: true,
    supportsImageToText: supportsVision,
    supportsToolCalling: true,
  };
}

/**
 * How tool-result images must be serialized for this model's chat-completions
 * upstream.
 *
 * CONTRACT (evidence-based, per-provider):
 * - "drop"  — MiMo (`mimo-*`): upstream strictly requires plain-string tool
 *   message content AND cannot see tool images at all. Flatten + drop with a
 *   placeholder note (issue #38, upstream anomalyco/opencode#32613).
 * - "defer" — glm-5.3* (`glm-5.3*`): tool-message image_url parts are
 *   rejected with HTTP 422 "[invalid_request_error] Input should be a valid
 *   string", but identical images in a user message return 200 (reproduced
 *   directly against zen/go/v1 chat-completions, issue #233). Move images
 *   into a follow-up user message instead of dropping them.
 * - null    — the upstream accepts multimodal tool content; forward it
 *   unchanged (Kimi, GLM-5.1/5.2, MiniMax, Qwen verified in production).
 *
 * Pure so the mapping stays unit-testable without a VS Code host.
 */
export function requiresStringToolContent(rawModelId: string | undefined): "drop" | "defer" | null {
  if (rawModelId === undefined) return null;
  if (/^mimo-/i.test(rawModelId)) return "drop";
  if (/^glm-5\.3/i.test(rawModelId)) return "defer";
  return null;
}
