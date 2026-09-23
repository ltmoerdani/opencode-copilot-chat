/**
 * Thinking system public barrel.
 *
 * Re-exports the per-provider strategy architecture (see `./thinking/`).
 * Keeps the legacy `import { ... } from "./thinking"` paths working.
 */
export { thinkingFamily, thinkingProviderFor } from "./thinking/provider";
export type { ThinkingProvider } from "./thinking/provider";
export { resolveThinkingConfig, extractThinkingOverride, stripSchemaDefaultEcho } from "./thinking/resolve";
export type { ResolveThinkingConfigInput } from "./thinking/resolve";
export { schemaFromReasoningOptions, genericReasoningSchema } from "./thinking/schema";
export type { ThinkingSchema } from "./thinking/schema";
export { bodyRequestsThinking } from "./thinking/payload";
export { DeepSeekThinking } from "./thinking/deepseek";
export { GlmThinking } from "./thinking/glm";
export { KimiThinking } from "./thinking/kimi";
export { MiniMaxThinking } from "./thinking/minimax";
export { OpenAiThinking } from "./thinking/openai";
export { QwenThinking } from "./thinking/qwen";
export { MimoThinking } from "./thinking/mimo";
export { FallbackThinking } from "./thinking/fallback";
export type {
  ThinkingSettings,
  ThinkingFamily,
  ThinkingSource,
  ResolvedThinking,
  ThinkingOverride,
  BuildThinkingPayloadOptions,
} from "./thinking/types";
// (legacy per-family implementations moved to src/thinking/ — see barrel above)
