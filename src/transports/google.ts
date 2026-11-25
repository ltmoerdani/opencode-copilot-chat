import type { StreamRequestOptions } from "../core/transport";
import { normalizeGoogleFullResponse, normalizeGoogleStreamEvent } from "../core/routing";
import { createThinkTagFilter } from "./thinkTags";
import { createReasoningDebugger, streamOpenCodeResponse } from "./engine";
import { OpenAiResponseExtractor } from "./extractors";
import { extractChatCompletionParts } from "./extract";
import { reportProgressPart } from "./streamParts";

/** Google Generative Language API transport (Gemini via Zen). */
export async function streamGoogleGenerateContent(options: StreamRequestOptions): Promise<void> {
  const thinkFilter = createThinkTagFilter(options.stripThinkTags, options.modelId, options.forceStripThinkTags);
  const extractor = new OpenAiResponseExtractor(
    options.onReasoningContent,
    createReasoningDebugger(options.output, options.debugReasoning),
    thinkFilter,
    options.progress,
    options.requestHeaders["x-opencode-request"],
  );

  try {
    await streamOpenCodeResponse({
      ...options,
      usesDoneSentinel: false,
      url: `${options.url}:streamGenerateContent?alt=sse`,
      extractStreamParts: (data) => {
        const normalized = normalizeGoogleStreamEvent(data) as {
          choices?: { delta?: { thought_signatures?: string[] } }[];
        };
        const signatures = normalized.choices?.[0]?.delta?.thought_signatures;
        if (signatures) {
          extractor.captureThoughtSignatures(signatures);
        }
        return extractor.extractStreamParts(normalized);
      },
      extractFullParts: (data) => {
        const normalized = normalizeGoogleFullResponse(data) as {
          choices?: { message?: { thought_signatures?: string[] } }[];
        };
        const signatures = normalized.choices?.[0]?.message?.thought_signatures;
        if (signatures) {
          extractor.captureThoughtSignatures(signatures);
        }
        return extractChatCompletionParts(normalized);
      },
    });
  } finally {
    // Flush accumulated tool calls / reasoning even when the engine throws
    // (e.g. truncation detection) so nothing already received is dropped.
    extractor.flushRemainingToolCalls(options.progress, options.requestHeaders["x-opencode-request"]);
    extractor.flushReasoningFallback(options.progress, options.requestHeaders["x-opencode-request"]);
  }
  // Gemini 3+ requires the opaque signature on the next turn; carry it in the
  // transcript as an internal data part (invisible in the chat UI).
  const signaturePart = extractor.flushThoughtSignaturePart();
  if (signaturePart) {
    reportProgressPart(options.requestHeaders["x-opencode-request"], options.progress, signaturePart);
  }
  options.output?.appendLine(
    `[stream-summary model=${options.modelId}] textChars=${String(extractor.emittedText)} toolCalls=${String(extractor.emittedTools)} reasoningChars=${String(extractor.reasoningChars)}`,
  );
  if (extractor.emittedText === 0 && extractor.emittedTools === 0) {
    options.output?.appendLine(
      `[warn] empty response from model=${options.modelId} (no text, no tool calls, no reasoning). Try a different free model or enable opencodego.debugReasoning to inspect raw SSE.`,
    );
  }
}
