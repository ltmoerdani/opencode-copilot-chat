/**
 * Thinking-system shared types.
 *
 * CONTRACT: pure types only — no `vscode` import, no side effects.
 */

/** Per-family thinking settings stored in the workspace configuration. */
export interface ThinkingSettings {
  deepseek: "off" | "low" | "medium" | "high" | "max";
  glm: "off" | "high" | "max";
  kimi: "on" | "off";
  minimax: "off" | "on";
  openai: "off" | "low" | "medium" | "high" | "xhigh";
  qwen: "auto" | "on" | "off";
  qwenBudget: "auto" | "4096" | "16384" | "32768" | "81920";
  mimo: "off" | "low" | "medium" | "high";
  muse: "off" | "low" | "medium" | "high" | "xhigh";
  /**
   * Google-native (Gemini) thinking level sent as
   * `generationConfig.thinkingConfig.thinkingLevel`. `"off"` sends no thinking
   * config at all (the model's own default applies); `"on"` surfaces thoughts
   * without pinning a level.
   */
  gemini: "off" | "on" | "low" | "medium" | "high";
  /**
   * Effort for models with no dedicated thinking family, sent as a plain
   * OpenAI-compatible `reasoning_effort`. `"off"` sends nothing.
   *
   * Deliberately open-ended rather than a fixed union: the picker's levels come
   * from the model's own models.dev `reasoning_options` when it declares any,
   * so a model can offer levels this build has never heard of.
   */
  generic: string;
}

/** Detected thinking family for a raw model id. `null` = no known family. */
export type ThinkingFamily = "beam" | "deepseek" | "glm" | "kimi" | "minimax" | "openai" | "qwen" | "mimo" | "muse" | "gemini" | null;

/**
 * Which configuration layer supplied the effective thinking value.
 *
 * Priority (highest first):
 *   modelConfiguration → globalState → workspace → default
 */
export type ThinkingSource = "workspace" | "modelConfiguration" | "globalState" | "default";

/** Resolved thinking config with provenance. */
export interface ResolvedThinking {
  settings: ThinkingSettings;
  source: ThinkingSource;
  /** Whether the model's family value differs from the workspace baseline. */
  overrideApplied: boolean;
}

/** The subset of `modelConfiguration` the thinking system understands. */
export interface ThinkingOverride {
  reasoningEffort?: string;
  thinkingMode?: string;
  thinkingBudget?: string;
}

/** Options for building a request payload's thinking fields. */
export interface BuildThinkingPayloadOptions {
  /** Whether the request carries image input (affects Qwen auto behavior). */
  hasImageInput?: boolean;
  /** Endpoint the request will hit — changes the payload shape (Qwen, Gemini). */
  endpoint?: "chat" | "messages" | "responses" | "google";
}
