import { bodyRequestsThinking } from "../thinking";
import type { StreamRequestOptions } from "../core/transport";
import { createThinkTagFilter } from "./thinkTags";
import { createReasoningDebugger, streamOpenCodeResponse } from "./engine";
import { OpenAiResponseExtractor } from "./extractors";
import { extractChatCompletionParts } from "./extract";
import { reportProgressPart } from "./streamParts";

/** OpenAI-compatible chat-completions transport. */
export async function streamChatCompletions(options: StreamRequestOptions): Promise<void> {
  const thinkFilter = createThinkTagFilter(options.stripThinkTags, options.modelId, options.forceStripThinkTags);
  // Display decision: whether `reasoning_content` should be surfaced as visible
  // text instead of a thinking part. Computed UPSTREAM by the thinking provider
  // strategy from the resolved thinking config — not inferred from the body
  // here. Currently false for all providers: reasoning_content is genuine CoT.
  const isGoGateway = options.url.includes("/zen/go/");
  const body = options.body as Record<string, unknown> | undefined;
  const hasReasoningEffort = isGoGateway && bodyRequestsThinking(body);
  const treatReasoningAsContent = options.treatReasoningAsContent ?? false;
  if (isGoGateway) {
    options.output?.appendLine(
      `[go-gw] model=${options.modelId} hasReasoningEffort=${String(hasReasoningEffort)} treatReasoningAsContent=${String(treatReasoningAsContent)}`,
    );
  }
  const extractor = new OpenAiResponseExtractor(
    options.onReasoningContent,
    createReasoningDebugger(options.output, options.debugReasoning),
    thinkFilter,
    options.progress,
    options.requestHeaders["x-opencode-request"],
    options.output,
    treatReasoningAsContent,
    options.toolNameMap,
  );

  try {
    await streamOpenCodeResponse({
      ...options,
      usesDoneSentinel: true,
      extractStreamParts: (data) => extractor.extractStreamParts(data),
      extractFullParts: extractChatCompletionParts,
    });
  } finally {
    // Flush accumulated tool calls / reasoning even when the engine throws
    // (e.g. truncation detection) so nothing already received is dropped.
    extractor.flushRemainingToolCalls(options.progress, options.requestHeaders["x-opencode-request"]);
    extractor.flushReasoningFallback(options.progress, options.requestHeaders["x-opencode-request"]);
  }
  // Dormant marker path: no provider treats reasoning as visible text anymore
  // (old gateway #37635 mislabel is not worked around), so flushReasoningMarker
  // is a no-op today — kept as the designed seam. Reported through the shared
  // progress wrapper so a bound context-window request stays correctly scoped.
  const reasoningMarker = extractor.flushReasoningMarker();
  if (reasoningMarker) {
    reportProgressPart(options.requestHeaders["x-opencode-request"], options.progress, reasoningMarker);
  }
  options.output?.appendLine(
    `[stream-summary model=${options.modelId}] textChars=${String(extractor.emittedText)} toolCalls=${String(extractor.emittedTools)} reasoningChars=${String(extractor.reasoningChars)}`,
  );
  if (extractor.reasoningLoopSuppressed) {
    options.output?.appendLine(
      `[warn] model=${options.modelId} output suppressed after ~${String(extractor.emittedText)} visible chars (probable model degradation at large context). Try a shorter conversation or use a different model.`,
    );
  }
  if (extractor.emittedText === 0 && extractor.emittedTools === 0) {
    options.output?.appendLine(
      `[warn] empty response from model=${options.modelId} (no text, no tool calls, no reasoning). Try a different free model or enable opencodego.debugReasoning to inspect raw SSE.`,
    );
    // Intentionally not calling .show(true) — the diagnostic log is
    // available in the Output pane when the user opens it manually.
  }
}
