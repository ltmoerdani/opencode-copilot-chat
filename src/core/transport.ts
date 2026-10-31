import type * as vscode from "vscode";

/**
 * Transport contract types shared by every streaming adapter in `transports/`.
 * Types only — no runtime logic (safe for pure modules to import).
 */
export interface StreamRequestOptions {
  url: string;
  providerDisplayName: string;
  apiKey: string;
  modelId: string;
  body: unknown;
  requestHeaders: Record<string, string>;
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>;
  token: vscode.CancellationToken;
  output?: vscode.OutputChannel;
  debugReasoning: boolean;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  contextWindowOutputBuffer?: number;
  authHeaders?: Record<string, string>;
  onReasoningContent?: (toolCallIds: string[], reasoningContent: string) => void;
  capacityLimitedModelNotes?: Record<string, string>;
  onTransportSummary?: (summary: TransportRequestSummary) => void;
  /**
   * Whether `reasoning_content` should be surfaced as visible text instead of
   * a thinking part. Computed UPSTREAM by the thinking provider strategy from
   * the resolved thinking config — never inferred from the body here.
   *
   * Currently false for every family: reasoning models emit genuine CoT in
   * `reasoning_content`, so it always goes to the thinking panel. (The old
   * gateway #37635 mislabel is the gateway's bug, not worked around here.)
   */
  treatReasoningAsContent?: boolean;
  /**
   * Controls whether `<think>...</think>` tags inlined in the model's text
   * content are stripped and accumulated as reasoning content.
   *
   * - "never"  — pass text through unchanged
   * - "auto"   — strip only for models known to inline thinking tags
   *              (currently: minimax-m*)
   * - "always" — strip for every model
   */
  stripThinkTags?: "never" | "auto" | "always";
  /**
   * Force think-tag stripping regardless of stripThinkTags mode.
   * Set to true when the request is a subagent/tool-call invocation
   * to prevent <think> tags in content from rendering as blank code blocks.
   */
  forceStripThinkTags?: boolean;
  /**
   * Truncated → original tool name map for the tool-call round-trip.
   * Muse (Responses) and Beam (chat-completions) upstreams enforce the
   * OpenAI 64-char function-name limit, so their request builders truncate
   * names at request build time; the extractor reverse-looks up before
   * emitting `LanguageModelToolCallPart`. Only set when truncation applied.
   */
  toolNameMap?: ReadonlyMap<string, string>;
}

export interface TransportRequestSummary {
  providerDisplayName: string;
  modelId: string;
  url: string;
  requestId?: string;
  sessionId?: string;
  status?: number;
  contentType?: string;
  payloadBytes: number;
  totalBytes: number;
  totalEvents: number;
  durationMs: number;
  ttfbMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  finishReason?: string;
  /** Credits for VS Code session cost (1 credit = $0.01). */
  copilotCredits?: number;
  /** Go allowance counted by OpenCode after model/policy weighting, in USD. */
  allowance?: number;
  /** Go list-price equivalent reported alongside allowance, in USD. */
  listCost?: number;
  /** Upstream billing source, for diagnostics and future provider-specific handling. */
  billingSource?: string;
  rateLimitSummary?: string;
  abortedReason?: "request-timeout" | "stream-idle-timeout" | "cancelled" | "truncated-retry" | "stalled-retry";
  errorMessage?: string;
}
