import type { StreamRequestOptions } from "../core/transport";
import { normalizeResponsesFullResponse, normalizeResponsesStreamEvent } from "../core/routing";
import { createThinkTagFilter } from "./thinkTags";
import { createReasoningDebugger, streamOpenCodeResponse } from "./engine";
import { OpenAiResponseExtractor } from "./extractors";
import { extractChatCompletionParts } from "./extract";

/** OpenAI Responses API transport (GPT-family models). */
export async function streamResponsesApi(options: StreamRequestOptions): Promise<void> {
  const thinkFilter = createThinkTagFilter(options.stripThinkTags, options.modelId, options.forceStripThinkTags);
  const extractor = new OpenAiResponseExtractor(
    options.onReasoningContent,
    createReasoningDebugger(options.output, options.debugReasoning),
    thinkFilter,
    options.progress,
    options.requestHeaders["x-opencode-request"],
    options.output,
    false,
    options.toolNameMap,
  );

  try {
    await streamOpenCodeResponse({
      ...options,
      usesDoneSentinel: true,
      extractStreamParts: (data) => extractor.extractStreamParts(normalizeResponsesStreamEvent(data)),
      extractFullParts: (data) => extractChatCompletionParts(normalizeResponsesFullResponse(data)),
    });
  } finally {
    // Flush accumulated tool calls / reasoning even when the engine throws
    // (e.g. truncation detection) so nothing already received is dropped.
    extractor.flushRemainingToolCalls(options.progress, options.requestHeaders["x-opencode-request"]);
    extractor.flushReasoningFallback(options.progress, options.requestHeaders["x-opencode-request"]);
  }
  options.output?.appendLine(
    `[stream-summary model=${options.modelId}] textChars=${String(extractor.emittedText)} toolCalls=${String(extractor.emittedTools)} reasoningChars=${String(extractor.reasoningChars)}`,
  );
}
