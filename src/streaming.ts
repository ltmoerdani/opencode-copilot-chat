import * as vscode from "vscode";
import {
  buildOpenCodeRequestError,
  formatDuration,
  formatRateLimitSummary,
  OpenCodeRequestError,
  readRateLimitInfo,
  truncateForLog,
} from "./errors";
import {
  analyzeHttp400ForRetry,
  isTransientServerError,
  TRANSIENT_5XX_MAX_RETRIES,
  TRANSIENT_5XX_RETRY_BASE_MS,
  TRANSIENT_5XX_RETRY_JITTER_MS,
} from "./retry";
import {
  normalizeGoogleFullResponse,
  normalizeGoogleStreamEvent,
  normalizeResponsesFullResponse,
  normalizeResponsesStreamEvent,
} from "./routing";
import { createUsageDataParts } from "./chatParts";
import {
  clearContextWindowRequest,
  reportProgressWithContextWindowRequest,
  reportUsageToContextWindowForRequest,
  setContextWindowOutputBufferForRequest,
} from "./contextWindowHookBridge";
import { formatUsageLogLine } from "./usage";
import { parseToolInput, ToolCallAccumulator, type PendingToolCall } from "./toolCallAccumulator";

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
   * Controls whether `<think>...</think>` tags inlined in the model's text
   * content are stripped and accumulated as reasoning content.
   *
   * - "never"  — pass text through unchanged
   * - "auto"   — strip only for models known to inline thinking tags
   *              (currently: minimax-m*)
   * - "always" — strip for every model
   */
  stripThinkTags?: "never" | "auto" | "always";
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
  rateLimitSummary?: string;
  abortedReason?: "request-timeout" | "stream-idle-timeout" | "cancelled";
  errorMessage?: string;
}

export async function streamChatCompletions(options: StreamRequestOptions): Promise<void> {
  const thinkFilter = createThinkTagFilter(options.stripThinkTags, options.modelId);
  // Workaround for opencode-go gateway bug (#37635): the Go gateway wraps ALL
  // streaming responses in `reasoning_content`. Only apply when:
  // 1. Request goes to the Go gateway URL (/zen/go/)
  // 2. `reasoning_effort` is NOT in the body (model thinking is OFF)
  // When thinking IS on (reasoning_effort present), reasoning_content is genuine
  // CoT and should remain in the thinking panel.
  const isGoGateway = options.url.includes("/zen/go/");
  const body = options.body as Record<string, unknown> | undefined;
  const hasReasoningEffort = isGoGateway && (typeof body?.reasoning_effort === "string" || typeof body?.budget_tokens === "number");
  const treatReasoningAsContent = isGoGateway && !hasReasoningEffort;
  if (isGoGateway) {
    options.output?.appendLine(
      `[go-gw] model=${options.modelId} hasReasoningEffort=${hasReasoningEffort} treatReasoningAsContent=${treatReasoningAsContent}`,
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
  );

  await streamOpenCodeResponse({
    ...options,
    extractStreamParts: (data) => extractor.extractStreamParts(data),
    extractFullParts: extractChatCompletionParts,
  });

  extractor.flushRemainingToolCalls(options.progress, options.requestHeaders["x-opencode-request"]);
  extractor.flushReasoningFallback(options.progress, options.requestHeaders["x-opencode-request"]);
  options.output?.appendLine(
    `[stream-summary model=${options.modelId}] textChars=${extractor.emittedText} toolCalls=${extractor.emittedTools} reasoningChars=${extractor.reasoningChars}`,
  );
  if (extractor.reasoningLoopSuppressed) {
    options.output?.appendLine(
      `[warn] model=${options.modelId} output suppressed after ~${extractor.emittedText} visible chars (probable model degradation at large context). Try a shorter conversation or use a different model.`,
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

export async function streamAnthropicMessages(options: StreamRequestOptions): Promise<void> {
  const thinkFilter = createThinkTagFilter(options.stripThinkTags, options.modelId);
  const extractor = new AnthropicResponseExtractor(
    options.onReasoningContent,
    createReasoningDebugger(options.output, options.debugReasoning),
    thinkFilter,
    options.progress,
    options.requestHeaders["x-opencode-request"],
  );

  await streamOpenCodeResponse({
    ...options,
    extractStreamParts: (data) => extractor.extractStreamParts(data),
    extractFullParts: extractAnthropicParts,
  });

  extractor.flushReasoningFallback(options.progress, options.requestHeaders["x-opencode-request"]);
  options.output?.appendLine(
    `[stream-summary model=${options.modelId}] textChars=${extractor.emittedText} toolCalls=${extractor.emittedTools} reasoningChars=${extractor.reasoningChars}`,
  );
}

export async function streamResponsesApi(options: StreamRequestOptions): Promise<void> {
  const thinkFilter = createThinkTagFilter(options.stripThinkTags, options.modelId);
  const extractor = new OpenAiResponseExtractor(
    options.onReasoningContent,
    createReasoningDebugger(options.output, options.debugReasoning),
    thinkFilter,
    options.progress,
    options.requestHeaders["x-opencode-request"],
  );

  await streamOpenCodeResponse({
    ...options,
    extractStreamParts: (data) => extractor.extractStreamParts(normalizeResponsesStreamEvent(data)),
    extractFullParts: (data) => extractChatCompletionParts(normalizeResponsesFullResponse(data)),
  });

  extractor.flushRemainingToolCalls(options.progress, options.requestHeaders["x-opencode-request"]);
  extractor.flushReasoningFallback(options.progress, options.requestHeaders["x-opencode-request"]);
  options.output?.appendLine(
    `[stream-summary model=${options.modelId}] textChars=${extractor.emittedText} toolCalls=${extractor.emittedTools} reasoningChars=${extractor.reasoningChars}`,
  );
}

export async function streamGoogleGenerateContent(options: StreamRequestOptions): Promise<void> {
  const thinkFilter = createThinkTagFilter(options.stripThinkTags, options.modelId);
  const extractor = new OpenAiResponseExtractor(
    options.onReasoningContent,
    createReasoningDebugger(options.output, options.debugReasoning),
    thinkFilter,
    options.progress,
    options.requestHeaders["x-opencode-request"],
  );

  await streamOpenCodeResponse({
    ...options,
    url: `${options.url}:streamGenerateContent?alt=sse`,
    extractStreamParts: (data) => extractor.extractStreamParts(normalizeGoogleStreamEvent(data)),
    extractFullParts: (data) => extractChatCompletionParts(normalizeGoogleFullResponse(data)),
  });

  extractor.flushRemainingToolCalls(options.progress, options.requestHeaders["x-opencode-request"]);
  extractor.flushReasoningFallback(options.progress, options.requestHeaders["x-opencode-request"]);
  options.output?.appendLine(
    `[stream-summary model=${options.modelId}] textChars=${extractor.emittedText} toolCalls=${extractor.emittedTools} reasoningChars=${extractor.reasoningChars}`,
  );
}

interface StreamOpenCodeResponseOptions extends StreamRequestOptions {
  extractStreamParts: (data: unknown) => vscode.LanguageModelResponsePart[];
  extractFullParts: (data: unknown) => vscode.LanguageModelResponsePart[];
}

interface RequestUsageSummary {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  finishReason?: string;
  copilotCredits?: number;
}

function reportProgressPart(
  localRequestId: string | undefined,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  part: vscode.LanguageModelResponsePart2,
): void {
  if (!localRequestId) {
    progress.report(part);
    return;
  }

  reportProgressWithContextWindowRequest(localRequestId, progress, part);
}

/**
 * CONTRACT — Reasoning surfacing via LanguageModelThinkingPart
 *
 * RULES:
 *   1. `LanguageModelThinkingPart` is a proposed VS Code API available at
 *      runtime since VS Code ~1.102 (Aug 2025). Our `engines.vscode: ^1.125.0`
 *      guarantees it is present, but we guard defensively so the extension
 *      degrades gracefully on any hypothetical older host.
 *   2. When available, reasoning is streamed to the Copilot Chat UI per-chunk
 *      as a thinking part. This lets `chat.agent.thinkingStyle`
 *      (`collapsed` / `collapsedPreview` / `fixedScrolling`) apply, fixing
 *      issues #22 and #71.
 *   3. When NOT available (very old host), the caller falls back to the
 *      legacy accumulate-and-flush behavior (reasoning emitted as a
 *      LanguageModelTextPart only when the response is otherwise empty).
 *
 * INVARIANTS:
 *   - Never throws: if the constructor is missing or `progress.report` fails,
 *     the reasoning is silently dropped (the visible response is unaffected).
 *   - The returned boolean tells the caller whether the thinking part was
 *     successfully emitted, so the caller can decide whether to also
 *     accumulate into `reasoningContent` for the legacy fallback path.
 */
const thinkingPartConstructor: (new (value: string | string[]) => vscode.LanguageModelResponsePart2) | undefined = (() => {
  const ctor = (
    vscode as unknown as {
      LanguageModelThinkingPart?: unknown;
    }
  ).LanguageModelThinkingPart;
  return typeof ctor === "function" ? (ctor as new (value: string | string[]) => vscode.LanguageModelResponsePart2) : undefined;
})();

/**
 * Emit a reasoning chunk to the Copilot Chat UI as a thinking part.
 *
 * @returns `true` if the thinking part was emitted successfully;
 *          `false` if the API is unavailable (caller should accumulate
 *          for the legacy fallback path).
 */
function emitThinkingPart(
  localRequestId: string | undefined,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  reasoningChunk: string,
): boolean {
  if (!reasoningChunk || !thinkingPartConstructor) {
    return false;
  }
  try {
    reportProgressPart(localRequestId, progress, new thinkingPartConstructor(reasoningChunk));
    return true;
  } catch {
    // Defensive: never let a thinking-part emit failure break the visible response.
    return false;
  }
}

/**
 * Wait for `ms` milliseconds, aborting early if the token is cancelled.
 *
 * IMPORTANT: the cancellation listener is registered BEFORE the timer is
 * started, and cleared after it fires. This ordering guarantees there is no
 * window where a cancellation arrives between `await sleep` resuming and the
 * listener being removed — which would otherwise call `clearTimeout` on an
 * already-finished timer (harmless) or, worse, resolve a stale listener.
 */
function sleepWithCancellation(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function streamOpenCodeResponse(options: StreamOpenCodeResponseOptions): Promise<void> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const localRequestId = options.requestHeaders["x-opencode-request"];
  let firstByteAt: number | undefined;
  const usageSummary: RequestUsageSummary = {};
  let abortReason: "request-timeout" | "stream-idle-timeout" | "cancelled" | undefined;
  let responseStatus: number | undefined;
  let responseContentType: string | undefined;
  let emittedSummary = false;
  const abort = (reason: typeof abortReason) => {
    abortReason ??= reason;
    controller.abort();
  };
  const cancellation = options.token.onCancellationRequested(() => abort("cancelled"));
  const requestTimeout = setTimeout(() => abort("request-timeout"), options.requestTimeoutMs);
  let streamIdleTimeout: ReturnType<typeof setTimeout> | undefined;
  const resetStreamIdleTimeout = () => {
    if (streamIdleTimeout) {
      clearTimeout(streamIdleTimeout);
    }
    streamIdleTimeout = setTimeout(() => abort("stream-idle-timeout"), options.streamIdleTimeoutMs);
  };
  const emitSummary = (totalBytes: number, totalEvents: number, extra?: Partial<TransportRequestSummary>) => {
    if (emittedSummary) {
      return;
    }
    emittedSummary = true;
    const summary: TransportRequestSummary = {
      providerDisplayName: options.providerDisplayName,
      modelId: options.modelId,
      url: options.url,
      requestId: options.requestHeaders["x-opencode-request"],
      sessionId: options.requestHeaders["x-opencode-session"],
      status: responseStatus,
      contentType: responseContentType,
      payloadBytes:
        typeof options.body === "string" ? options.body.length : new TextEncoder().encode(JSON.stringify(options.body)).byteLength,
      totalBytes,
      totalEvents,
      durationMs: Date.now() - startedAt,
      ...(firstByteAt === undefined ? {} : { ttfbMs: firstByteAt - startedAt }),
      ...(usageSummary.promptTokens === undefined ? {} : { promptTokens: usageSummary.promptTokens }),
      ...(usageSummary.completionTokens === undefined ? {} : { completionTokens: usageSummary.completionTokens }),
      ...(usageSummary.totalTokens === undefined ? {} : { totalTokens: usageSummary.totalTokens }),
      ...(usageSummary.cachedTokens === undefined ? {} : { cachedTokens: usageSummary.cachedTokens }),
      ...(usageSummary.finishReason === undefined ? {} : { finishReason: usageSummary.finishReason }),
      ...extra,
    };

    // Let the caller enrich the summary (e.g. add copilotCredits) before
    // we create the usage data parts, so VS Code session cost works.
    options.onTransportSummary?.(summary);

    options.output?.appendLine(
      `[response-summary] status=${summary.status ?? "n/a"} durationMs=${summary.durationMs} ttfbMs=${summary.ttfbMs ?? "n/a"} promptTokens=${summary.promptTokens ?? "n/a"} completionTokens=${summary.completionTokens ?? "n/a"} totalTokens=${summary.totalTokens ?? "n/a"} cachedTokens=${summary.cachedTokens ?? "n/a"} finishReason=${summary.finishReason ?? "<unknown>"} totalBytes=${summary.totalBytes} totalEvents=${summary.totalEvents}`,
    );
    const usageLog = formatUsageLogLine({
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      totalTokens: summary.totalTokens,
      cachedTokens: summary.cachedTokens,
      finishReason: summary.finishReason,
    });
    if (usageLog) {
      options.output?.appendLine(`[usage] ${usageLog}`);
    }

    if (localRequestId) {
      reportUsageToContextWindowForRequest(localRequestId, {
        promptTokens: summary.promptTokens,
        completionTokens: summary.completionTokens,
        totalTokens: summary.totalTokens,
        cachedTokens: summary.cachedTokens,
        finishReason: summary.finishReason,
      });
    }

    const usageParts =
      summary.errorMessage || summary.abortedReason
        ? []
        : createUsageDataParts({
            promptTokens: summary.promptTokens,
            completionTokens: summary.completionTokens,
            totalTokens: summary.totalTokens,
            cachedTokens: summary.cachedTokens,
            finishReason: summary.finishReason,
            copilotCredits: summary.copilotCredits,
          });
    for (const usagePart of usageParts) {
      reportProgressPart(localRequestId, options.progress, usagePart);
    }
  };

  try {
    if (localRequestId && options.contextWindowOutputBuffer !== undefined) {
      setContextWindowOutputBufferForRequest(localRequestId, options.contextWindowOutputBuffer);
    }

    const rawPayload = JSON.stringify(options.body);

    // Log request for debugging latency.
    options.output?.appendLine(
      `[request] url=${options.url} payloadBytes=${rawPayload.length} requestTimeoutMs=${options.requestTimeoutMs} streamIdleTimeoutMs=${options.streamIdleTimeoutMs}`,
    );

    // ------------------------------------------------------------------
    // NOTE: We do NOT gzip-compress the payload.  The OpenCode proxy
    // does not support Content-Encoding: gzip and returns HTTP 500.
    // ------------------------------------------------------------------
    let payload = rawPayload;
    const fetchHeaders: Record<string, string> = {
      ...(options.authHeaders ?? { Authorization: `Bearer ${options.apiKey}` }),
      "Content-Type": "application/json",
      ...options.requestHeaders,
    };
    const fetchWithBody = (body: string) =>
      fetch(options.url, {
        method: "POST",
        headers: fetchHeaders,
        body,
        signal: controller.signal,
      });

    let response = await fetchWithBody(payload);

    // --- Runtime retry for recoverable HTTP 400 errors ---
    // If the upstream rejects a parameter (thinking, temperature, reasoning_effort),
    // patch the body and retry once. This handles stale models.dev metadata and
    // provider API changes without requiring a code release.
    let consumedErrorBody: string | undefined;
    if (response.status === 400) {
      const errorDetail = await response.text();
      consumedErrorBody = errorDetail;
      options.output?.appendLine(`[http-error-body] ${errorDetail.trim() ? truncateForLog(errorDetail) : "<empty>"}`);
      const parsedBody = JSON.parse(rawPayload) as Record<string, unknown>;
      const patch = analyzeHttp400ForRetry(errorDetail, parsedBody);
      if (patch) {
        options.output?.appendLine(`[retry] HTTP 400 recoverable: ${patch.reason}. Retrying with patched body…`);
        payload = JSON.stringify(patch.body);
        response = await fetchWithBody(payload);
        options.output?.appendLine(`[retry] Response after patch: ${response.status} ${response.statusText}`);
        // If retry also returned 400, consume its body so the normal error
        // handler below doesn't try to re-read (the stream is already consumed).
        if (!response.ok && response.status === 400) {
          consumedErrorBody = await response.text();
        } else {
          // The patched retry produced a fresh (non-consumed) body, so any
          // stored 400 detail no longer matches the current response.
          consumedErrorBody = undefined;
        }
      }
    }

    // --- Transient 5xx retry (gateway/router capacity) ---
    // Retry a small number of times with exponential backoff (plus jitter)
    // when the gateway is momentarily unavailable (502/503/504, or 5xx body
    // that names Router.Unavailable). Cancellation aborts the wait immediately.
    let attempt = 0;
    while (attempt < TRANSIENT_5XX_MAX_RETRIES && isTransientServerError(response.status, consumedErrorBody ?? "")) {
      attempt += 1;
      // Jitter spreads concurrent retries so they don't pile on the gateway
      // at the same timestamp.
      const backoffMs = Math.round(TRANSIENT_5XX_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * TRANSIENT_5XX_RETRY_JITTER_MS);
      options.output?.appendLine(
        `[retry] transient ${response.status} (attempt ${attempt}/${TRANSIENT_5XX_MAX_RETRIES}); retrying in ${backoffMs}ms…`,
      );
      await sleepWithCancellation(backoffMs, options.token);
      if (options.token.isCancellationRequested) {
        break;
      }
      response = await fetchWithBody(payload);
      // A fresh response may carry a new error body; drop stale 400 detail.
      consumedErrorBody = undefined;
    }

    responseStatus = response.status;
    responseContentType = response.headers.get("content-type") ?? "";
    options.output?.appendLine(`[http] ${response.status} ${response.statusText} content-type=${responseContentType || "<none>"}`);
    const rateLimitSummary = formatRateLimitSummary(readRateLimitInfo(response.headers));
    if (rateLimitSummary) {
      options.output?.appendLine(`[rate-limit] ${rateLimitSummary}`);
    }

    if (!response.ok) {
      // Use already-consumed body if available (from retry logic above),
      // otherwise read from the response stream.
      const detail = consumedErrorBody ?? (await response.text());
      options.output?.appendLine(`[http-error-body] ${detail.trim() ? truncateForLog(detail) : "<empty>"}`);
      const capacityHint =
        options.capacityLimitedModelNotes?.[options.modelId] && response.status >= 500
          ? ` — ${options.capacityLimitedModelNotes[options.modelId]}`
          : "";
      const requestError = buildOpenCodeRequestError(
        options.providerDisplayName,
        response,
        detail,
        options.modelId,
        payload.length,
        capacityHint,
      );
      emitSummary(new TextEncoder().encode(detail).byteLength, 0, {
        errorMessage: requestError.message,
        rateLimitSummary,
      });
      throw requestError;
    }

    if (!response.body || !responseContentType.includes("text/event-stream")) {
      const raw = await response.text();
      firstByteAt ??= Date.now();
      options.output?.appendLine(`[non-stream-body] ${truncateForLog(raw)}`);
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        data = undefined;
      }
      if (data !== undefined) {
        updateRequestUsageSummary(usageSummary, data);
        for (const part of options.extractFullParts(data)) {
          reportProgressPart(localRequestId, options.progress, part);
        }
      }
      emitSummary(new TextEncoder().encode(raw).byteLength, data === undefined ? 0 : 1, {
        rateLimitSummary,
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalBytes = 0;
    let totalEvents = 0;
    // Diagnostic: collect raw SSE data when response is empty to identify
    // format mismatches between gateway output and our extractor (issue #93).
    const rawSseData: unknown[] = [];
    let extractedPartCount = 0;
    resetStreamIdleTimeout();

    while (!options.token.isCancellationRequested) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      resetStreamIdleTimeout();

      totalBytes += value?.byteLength ?? 0;
      if (firstByteAt === undefined && (value?.byteLength ?? 0) > 0) {
        firstByteAt = Date.now();
      }
      const chunk = decoder.decode(value, { stream: true });
      if (options.debugReasoning && options.output && chunk) {
        options.output.appendLine(`[sse-raw bytes=${value?.byteLength ?? 0}] ${truncateForLog(chunk)}`);
      }
      buffer += chunk;
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        totalEvents += 1;
        if (options.debugReasoning && options.output && event.trim()) {
          options.output.appendLine(`[sse] ${truncateForLog(event)}`);
        }
        for (const part of parseServerSentEvent(event, options.extractStreamParts, (data) => {
          updateRequestUsageSummary(usageSummary, data);
          rawSseData.push(data);
        })) {
          extractedPartCount += 1;
          reportProgressPart(localRequestId, options.progress, part);
        }
      }
    }

    if (buffer.trim()) {
      if (options.debugReasoning && options.output) {
        options.output.appendLine(`[sse-tail] ${truncateForLog(buffer)}`);
      }
      for (const part of parseServerSentEvent(buffer, options.extractStreamParts, (data) => {
        updateRequestUsageSummary(usageSummary, data);
        rawSseData.push(data);
      })) {
        extractedPartCount += 1;
        reportProgressPart(localRequestId, options.progress, part);
      }
    }

    if (options.debugReasoning && options.output) {
      options.output.appendLine(`[sse-stats] totalBytes=${totalBytes} totalEvents=${totalEvents} bufferTailLen=${buffer.length}`);
    }

    // Diagnostic: when the gateway reported completion tokens but our
    // extractor found nothing, dump raw SSE data to identify format mismatches.
    // This helps diagnose issues like #93 where the model generates tokens
    // but the response content is in an unrecognized format.
    if (usageSummary.completionTokens && usageSummary.completionTokens > 0 && extractedPartCount === 0 && rawSseData.length > 0) {
      options.output?.appendLine(
        `[diag-empty-response] model=${options.modelId} completionTokens=${usageSummary.completionTokens} totalEvents=${totalEvents} rawSseDataCount=${rawSseData.length}`,
      );
      for (let i = 0; i < rawSseData.length; i++) {
        options.output?.appendLine(`[diag-sse-event-${i}] ${truncateForLog(JSON.stringify(rawSseData[i]))}`);
      }
    }

    emitSummary(totalBytes, totalEvents, { rateLimitSummary });
  } catch (error) {
    if (abortReason === "cancelled") {
      emitSummary(0, 0, {
        abortedReason: "cancelled",
        errorMessage: "request cancelled",
      });
      return;
    }
    if (abortReason === "request-timeout") {
      const requestError = new OpenCodeRequestError(
        `${options.providerDisplayName} request timed out after ${formatDuration(options.requestTimeoutMs)}.`,
        `${options.providerDisplayName} did not start or finish the request within ${formatDuration(options.requestTimeoutMs)}. Try again later or reduce the request size.`,
      );
      emitSummary(0, 0, {
        abortedReason: "request-timeout",
        errorMessage: requestError.message,
      });
      throw requestError;
    }
    if (abortReason === "stream-idle-timeout") {
      const requestError = new OpenCodeRequestError(
        `${options.providerDisplayName} stream stalled for ${formatDuration(options.streamIdleTimeoutMs)} without new data.`,
        `${options.providerDisplayName} stopped sending stream data for ${formatDuration(options.streamIdleTimeoutMs)}, so the request was cancelled to avoid leaving Copilot stuck.`,
      );
      emitSummary(0, 0, {
        abortedReason: "stream-idle-timeout",
        errorMessage: requestError.message,
      });
      throw requestError;
    }
    emitSummary(0, 0, {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(requestTimeout);
    if (streamIdleTimeout) {
      clearTimeout(streamIdleTimeout);
    }
    cancellation.dispose();
    if (localRequestId) {
      clearContextWindowRequest(localRequestId);
    }
  }
}

function parseServerSentEvent(
  event: string,
  extractParts: (data: unknown) => vscode.LanguageModelResponsePart[],
  onData?: (data: unknown) => void,
): vscode.LanguageModelResponsePart[] {
  const lines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  const parts: vscode.LanguageModelResponsePart[] = [];

  for (const line of lines) {
    if (!line || line === "[DONE]") {
      continue;
    }

    try {
      const data = JSON.parse(line) as unknown;
      onData?.(data);
      parts.push(...extractParts(data));
    } catch {
      // Ignore malformed SSE lines; the API may send comments or keep-alive frames.
    }
  }

  return parts;
}

function createReasoningDebugger(
  output: vscode.OutputChannel | undefined,
  enabled: boolean,
): ((reasoningContent: string) => void) | undefined {
  if (!enabled || !output) {
    return undefined;
  }

  return (reasoningContent) => {
    output.appendLine("[reasoning_content]");
    output.appendLine(reasoningContent);
    output.appendLine("[/reasoning_content]");
  };
}

// ---------------------------------------------------------------------------
// ThinkTagFilter — streaming stripper for inline `<think>...</think>` tags
//
// Some models (notably MiniMax M-series) inline their chain-of-thought
// directly inside the `content` text field wrapped in `<think>` / `</think>`
// tags rather than using a dedicated `reasoning_content` field.  When this
// raw text is emitted to the VS Code chat UI the reasoning "leaks" into the
// visible response, making it unreadable.
//
// The filter processes text **as it arrives** (potentially split across many
// SSE chunks) and separates it into:
//   • `visibleText` — content outside think tags (emitted to chat)
//   • `thinkingText` — content inside think tags (accumulated as reasoning)
//
// Edge cases handled:
//   - `<think>` or `</think>` split across chunk boundaries
//   - Unclosed `<think>` at end of stream (flushed as thinking on `finish()`)
//   - Leading whitespace immediately after opening `<think>` is trimmed
// ---------------------------------------------------------------------------

const OPEN_THINK_TAG = "<think>";
const CLOSE_THINK_TAG = "</think>";

function shouldStripThinkTags(mode: "never" | "auto" | "always" | undefined, modelId: string): boolean {
  if (mode === "always") {
    return true;
  }
  if (mode === "never" || mode === undefined) {
    return false;
  }
  // "auto" — strip only for models known to inline thinking tags
  return /^minimax-m/i.test(modelId);
}

function createThinkTagFilter(mode: "never" | "auto" | "always" | undefined, modelId: string): ThinkTagFilter | undefined {
  return shouldStripThinkTags(mode, modelId) ? new ThinkTagFilter() : undefined;
}

class ThinkTagFilter {
  /** Partial text carried over from the previous chunk for boundary matching. */
  private carry = "";
  /** Whether we are currently inside a `<think>` block. */
  private insideThink = false;

  /**
   * Process an incoming text chunk.
   * Returns `{ visible, thinking }` where `visible` is safe to emit to the
   * chat and `thinking` should be accumulated as reasoning content.
   */
  process(chunk: string): { visible: string; thinking: string } {
    if (!chunk) {
      return { visible: "", thinking: "" };
    }

    // Prepend carry from the previous chunk so boundary tags can be detected
    // even when they are split across chunks.
    const buffer = this.carry + chunk;
    this.carry = "";

    let visible = "";
    let thinking = "";
    let pos = 0;
    const maxScan = Math.max(OPEN_THINK_TAG.length, CLOSE_THINK_TAG.length);

    while (pos < buffer.length) {
      if (this.insideThink) {
        // Look for closing </think>
        const closeIdx = buffer.indexOf(CLOSE_THINK_TAG, pos);
        if (closeIdx === -1) {
          // No closing tag found — consume the rest, but keep a tail for
          // boundary matching in the next chunk.
          const safeEnd = buffer.length - maxScan;
          if (safeEnd > pos) {
            thinking += buffer.slice(pos, safeEnd);
            this.carry = buffer.slice(safeEnd);
          } else {
            // Entire remaining buffer is shorter than max scan — carry it all
            this.carry = buffer.slice(pos);
          }
          break;
        }
        // Found closing tag
        thinking += buffer.slice(pos, closeIdx);
        pos = closeIdx + CLOSE_THINK_TAG.length;
        this.insideThink = false;
        // Skip a single leading whitespace after </think> for cleaner output
        if (pos < buffer.length && (buffer[pos] === "\n" || buffer[pos] === "\r")) {
          pos += 1;
          if (pos < buffer.length && buffer[pos] === "\n") {
            pos += 1;
          }
        }
      } else {
        // Look for opening <think>
        const openIdx = buffer.indexOf(OPEN_THINK_TAG, pos);
        if (openIdx === -1) {
          // No opening tag — emit visible text but keep a tail for boundary
          const safeEnd = buffer.length - maxScan;
          if (safeEnd > pos) {
            visible += buffer.slice(pos, safeEnd);
            this.carry = buffer.slice(safeEnd);
          } else {
            this.carry = buffer.slice(pos);
          }
          break;
        }
        // Found opening tag
        visible += buffer.slice(pos, openIdx);
        pos = openIdx + OPEN_THINK_TAG.length;
        this.insideThink = true;
        // Skip a single leading whitespace after <think>
        if (pos < buffer.length && (buffer[pos] === "\n" || buffer[pos] === "\r")) {
          pos += 1;
          if (pos < buffer.length && buffer[pos] === "\n") {
            pos += 1;
          }
        }
      }
    }

    return { visible, thinking };
  }

  /**
   * Call at end of stream to flush any remaining carry.
   * If we were inside an unclosed `<think>`, that content is treated as
   * thinking. Otherwise the remaining carry is visible text.
   */
  finish(): { visible: string; thinking: string } {
    const remaining = this.carry;
    this.carry = "";
    if (this.insideThink) {
      // Unclosed think tag at end of stream — treat as thinking
      this.insideThink = false;
      return { visible: "", thinking: remaining };
    }
    return { visible: remaining, thinking: "" };
  }
}

class OpenAiResponseExtractor {
  private readonly toolCallAccumulator = new ToolCallAccumulator();
  private reasoningContent = "";
  private emittedTextLength = 0;
  private emittedToolCallsCount = 0;
  /**
   * Total reasoning characters seen across the entire stream. Unlike
   * `reasoningContent` (which is cleared by flushToolCalls/flushReasoningFallback
   * for tool-call replication), this counter is monotonically increasing and
   * used for the [stream-summary] log line so metrics stay accurate.
   */
  private totalReasoningChars = 0;

  /**
   * Reasoning loop suppression state.
   *
   * When the model generates excessive reasoning without progress (visible text
   * or tool calls), thinking parts are suppressed and a warning is emitted.
   */
  private _reasoningLoopSuppressed = false;
  private reasoningLoopWarningEmitted = false;
  private reasoningLoopLogGuard = false;
  /**
   * Suffix-based chunk-level repetition guard. When N consecutive reasoning
   * fragments share the same 40-char suffix, the model is in a word-level
   * loop and further output is suppressed.
   */
  private readonly reasoningFragmentSuffixes: string[] = [];
  private static readonly REASONING_LOOP_SUFFIX_MATCHES = 6;

  constructor(
    private readonly onReasoningContent?: (toolCallIds: string[], reasoningContent: string) => void,
    private readonly onReasoningDebug?: (reasoningContent: string) => void,
    private readonly thinkFilter?: ThinkTagFilter,
    /**
     * Progress reporter used to stream reasoning chunks to the Copilot Chat UI
     * as `LanguageModelThinkingPart`. When provided (together with
     * `localRequestId`), reasoning is surfaced live so that
     * `chat.agent.thinkingStyle` applies (fixes #22, #71).
     */
    private readonly progress?: vscode.Progress<vscode.LanguageModelResponsePart2>,
    private readonly localRequestId?: string,
    /**
     * Optional output channel for debug logging.
     */
    private readonly output?: vscode.OutputChannel,
    /**
     * Workaround for opencode-go gateway bug (#37635).
     *
     * The Go gateway wraps ALL model streaming responses in `reasoning_content`
     * instead of `content`. When this flag is `true` AND a delta has
     * `reasoning_content` but no `content`, the reasoning is emitted as
     * visible `LanguageModelTextPart` instead of as a thinking part.
     *
     * CONTRACT:
     * - Only set for Go-gateway requests where `reasoning_effort` is NOT in the
     *   payload (i.e. MiMo thinking is OFF). When thinking IS on, the model
     *   genuinely uses reasoning_content for CoT → goes to thinking panel.
     * - Zen gateway and all non-Go models are never affected.
     */
    private readonly treatReasoningAsContent: boolean = false,
  ) {}

  get emittedText(): number {
    return this.emittedTextLength;
  }

  get emittedTools(): number {
    return this.emittedToolCallsCount;
  }

  get reasoningChars(): number {
    return this.totalReasoningChars;
  }

  /** Whether the reasoning loop suppression was triggered. */
  get reasoningLoopSuppressed(): boolean {
    return this._reasoningLoopSuppressed;
  }

  /**
   * Accumulate reasoning for tool-call replication, and — when the thinking
   * part API is available — stream it live to the Copilot Chat UI.
   *
   * Also detects reasoning loops: if total reasoning chars exceeds a threshold
   * without any visible text or tool calls being emitted, the model is likely
   * stuck and further thinking parts are suppressed.
   *
   * Returns the reasoning string that was handled (for logging/debug).
   */
  private handleReasoning(reasoning: string): string {
    if (!reasoning) {
      return "";
    }
    this.reasoningContent += reasoning;
    this.totalReasoningChars += reasoning.length;

    // Reasoning loop guard: suppress if suffix repetition detected
    if (this.shouldSuppressThinkingEmit(reasoning)) {
      // Accumulate but don't emit — loop detected
      return reasoning;
    }

    // Stream reasoning to the UI per-chunk as a thinking part, so that
    // chat.agent.thinkingStyle (collapsed / collapsedPreview / fixedScrolling)
    // can apply. Falls back to legacy accumulate-only when the API is absent.
    if (this.progress) {
      emitThinkingPart(this.localRequestId, this.progress, reasoning);
    }
    return reasoning;
  }

  /**
   * Check whether reasoning should be suppressed due to a detected loop.
   *
   * Only guard: **suffix repetition** — same 40-char suffix on 6+ consecutive
   * chunks. This catches actual word-level repetition loops without false
   * positives on fresh conversations where the model legitimately reasons
   * for thousands of chars before producing output.
   *
   * A char-budget guard was previously used but removed because it triggered
   * false positives on normal fresh conversations (model can legitimately
   * produce 3000+ thinking chars before visible output or tool calls).
   */
  private shouldSuppressThinkingEmit(chunk: string): boolean {
    if (this._reasoningLoopSuppressed) {
      return true;
    }

    // Guard: suffix repetition
    if (chunk.length >= 10) {
      const suffix = chunk.slice(-40);
      const lastSuffix = this.reasoningFragmentSuffixes.at(-1);
      if (lastSuffix !== undefined && suffix === lastSuffix) {
        this.reasoningFragmentSuffixes.push(suffix);
        if (this.reasoningFragmentSuffixes.length >= 6) {
          this._reasoningLoopSuppressed = true;
          this.output?.appendLine(`[mimo] reasoning loop: suffix repeated 6x. Suppressing thinking parts.`);
        }
      } else {
        this.reasoningFragmentSuffixes.length = 0;
        this.reasoningFragmentSuffixes.push(suffix);
      }
    }

    if (this._reasoningLoopSuppressed && !this.reasoningLoopLogGuard) {
      this.reasoningLoopLogGuard = true;
      this.output?.appendLine(`[mimo] reasoning loop suppression ACTIVE. Thinking parts will be dropped.`);
    }

    return this._reasoningLoopSuppressed;
  }

  extractStreamParts(data: unknown): vscode.LanguageModelResponsePart[] {
    if (!isRecord(data) || !Array.isArray(data.choices)) {
      return [];
    }

    const first = data.choices[0];
    if (!isRecord(first)) {
      return [];
    }

    const parts: vscode.LanguageModelResponsePart[] = [];
    const delta = first.delta;
    if (isRecord(delta)) {
      const text = extractTextFromDelta(delta);
      const { visible, thinking } = this.filterText(text);
      if (visible) {
        this.emittedTextLength += visible.length;
        parts.push(new vscode.LanguageModelTextPart(visible));
      }
      if (thinking) {
        this.handleReasoning(thinking);
      }
      const reasoning = extractReasoningFromDelta(delta);
      if (reasoning) {
        // Workaround for opencode-go gateway bug (#37635):
        // When treatReasoningAsContent is true AND delta.content is empty,
        // the model's response was placed in reasoning_content by the gateway.
        // Emit as visible text. Suffix-repetition loop guard still applies.
        if (this.treatReasoningAsContent && !visible && text.length === 0) {
          if (!this.shouldSuppressThinkingEmit(reasoning)) {
            this.emittedTextLength += reasoning.length;
            parts.push(new vscode.LanguageModelTextPart(reasoning));
          }
        } else {
          this.handleReasoning(reasoning);
        }
      }
      this.collectOpenAiToolCalls(delta.tool_calls);
    }

    const message = first.message;
    if (isRecord(message)) {
      const text = extractTextFromDelta(message);
      const { visible, thinking } = this.filterText(text);
      if (visible) {
        this.emittedTextLength += visible.length;
        parts.push(new vscode.LanguageModelTextPart(visible));
      }
      if (thinking) {
        this.handleReasoning(thinking);
      }
      const reasoning = extractReasoningFromDelta(message);
      if (reasoning) {
        this.handleReasoning(reasoning);
      }
      this.collectOpenAiToolCalls(message.tool_calls);
    }

    // Flush accumulated tool calls ONLY when the stream reports the OpenAI
    // `"tool_calls"` finish reason. Intermediate chunks always carry
    // `finish_reason: null`, so flushing there would emit an incomplete tool
    // call (empty arguments → `<invoke>` without `<parameter>`, issue #98).
    // Gateways that omit `finish_reason` entirely (e.g. OpenCode Go for
    // gpt-5.6-luna, issue #93) are flushed once at end-of-stream via
    // `flushRemainingToolCalls()`.
    if (ToolCallAccumulator.shouldFlushOnFinishReason(first.finish_reason)) {
      const toolParts = this.flushToolCalls();
      this.emittedToolCallsCount += toolParts.length;
      parts.push(...toolParts);
    }

    return parts;
  }

  /** Split text through the think-tag filter (if active). */
  private filterText(text: string): { visible: string; thinking: string } {
    if (!text) {
      return { visible: "", thinking: "" };
    }
    if (!this.thinkFilter) {
      return { visible: text, thinking: "" };
    }
    return this.thinkFilter.process(text);
  }

  flushReasoningFallback(progress: vscode.Progress<vscode.LanguageModelResponsePart2>, localRequestId?: string): void {
    // Emit a visible warning if a reasoning loop was detected and suppressed
    if (this._reasoningLoopSuppressed && !this.reasoningLoopWarningEmitted) {
      this.reasoningLoopWarningEmitted = true;
      const warning = "[Reasoning loop detected — thinking output suppressed]";
      reportProgressPart(localRequestId, progress, new vscode.LanguageModelTextPart(warning));
      this.emittedTextLength += warning.length;
    }

    // Flush any remaining text in the think filter
    if (this.thinkFilter) {
      const { visible, thinking } = this.thinkFilter.finish();
      if (visible) {
        this.emittedTextLength += visible.length;
        reportProgressPart(localRequestId, progress, new vscode.LanguageModelTextPart(visible));
      }
      if (thinking) {
        // Surface remaining think-filter carry through the thinking part channel.
        this.handleReasoning(thinking);
      }
    }

    const reasoning = this.reasoningContent.trim();
    if (!reasoning) {
      return;
    }
    // If the thinking part API is available, reasoning was already streamed
    // live during extractStreamParts via handleReasoning(). The accumulated
    // reasoningContent is retained only for tool-call replication
    // (flushToolCalls → onReasoningContent). Nothing more to emit here.
    if (thinkingPartConstructor) {
      this.reasoningContent = "";
      return;
    }
    // Legacy fallback (API unavailable): emit reasoning as plain text only
    // when the response is otherwise empty, to avoid breaking the visible
    // output. This preserves the pre-fix safety-net semantics.
    if (this.emittedTextLength > 0 || this.emittedToolCallsCount > 0) {
      this.reasoningContent = "";
      return;
    }
    this.onReasoningDebug?.(this.reasoningContent);
    reportProgressPart(localRequestId, progress, new vscode.LanguageModelTextPart(reasoning));
    this.emittedTextLength += reasoning.length;
    this.reasoningContent = "";
  }

  private collectOpenAiToolCalls(toolCalls: unknown): void {
    this.toolCallAccumulator.collect(toolCalls);
  }

  private flushToolCalls(): vscode.LanguageModelToolCallPart[] {
    const calls = this.toolCallAccumulator.flush();
    const parts = calls.map(
      (call, index) => new vscode.LanguageModelToolCallPart(call.id || `opencodego-tool-${Date.now()}-${index}`, call.name, call.input),
    );

    if (this.reasoningContent.trim()) {
      this.onReasoningDebug?.(this.reasoningContent);
      this.onReasoningContent?.(
        parts.map((part) => part.callId),
        this.reasoningContent,
      );
    }

    this.reasoningContent = "";
    return parts;
  }

  /**
   * Flush any tool calls still accumulated when the stream ends. Some
   * gateways omit the `finish_reason: "tool_calls"` final event (e.g. the
   * OpenCode Go gateway for gpt-5.6-luna, issue #93), so a final flush here
   * prevents those calls from silently disappearing.
   *
   * Must be called BEFORE `flushReasoningFallback` so tool-call reasoning
   * replication runs first. Safe no-op when nothing is pending.
   */
  flushRemainingToolCalls(progress: vscode.Progress<vscode.LanguageModelResponsePart2>, localRequestId?: string): void {
    if (this.toolCallAccumulator.size === 0) {
      return;
    }
    const toolParts = this.flushToolCalls();
    this.emittedToolCallsCount += toolParts.length;
    for (const part of toolParts) {
      reportProgressPart(localRequestId, progress, part);
    }
  }
}

class AnthropicResponseExtractor {
  private readonly pendingToolCalls = new Map<number, PendingToolCall>();
  private reasoningContent = "";
  private emittedTextLength = 0;
  private emittedToolCallsCount = 0;
  /**
   * Total reasoning characters seen across the entire stream (monotonic).
   * See OpenAiResponseExtractor.totalReasoningChars for rationale.
   */
  private totalReasoningChars = 0;

  constructor(
    private readonly onReasoningContent?: (toolCallIds: string[], reasoningContent: string) => void,
    private readonly onReasoningDebug?: (reasoningContent: string) => void,
    private readonly thinkFilter?: ThinkTagFilter,
    /**
     * Progress reporter used to stream reasoning chunks to the Copilot Chat UI
     * as `LanguageModelThinkingPart`. See OpenAiResponseExtractor for contract.
     */
    private readonly progress?: vscode.Progress<vscode.LanguageModelResponsePart2>,
    private readonly localRequestId?: string,
  ) {}

  get emittedText(): number {
    return this.emittedTextLength;
  }

  get emittedTools(): number {
    return this.emittedToolCallsCount;
  }

  get reasoningChars(): number {
    return this.totalReasoningChars;
  }

  /**
   * Accumulate reasoning for tool-call replication, and — when the thinking
   * part API is available — stream it live to the Copilot Chat UI.
   * Mirror of OpenAiResponseExtractor.handleReasoning.
   */
  private handleReasoning(reasoning: string): string {
    if (!reasoning) {
      return "";
    }
    this.reasoningContent += reasoning;
    this.totalReasoningChars += reasoning.length;
    if (this.progress) {
      emitThinkingPart(this.localRequestId, this.progress, reasoning);
    }
    return reasoning;
  }

  extractStreamParts(data: unknown): vscode.LanguageModelResponsePart[] {
    if (!isRecord(data)) {
      return [];
    }

    const parts: vscode.LanguageModelResponsePart[] = [];
    const eventType = typeof data.type === "string" ? data.type : "";
    const delta = isRecord(data.delta) ? data.delta : undefined;

    // --- Handle Anthropic SSE event types ---

    // 1. content_block_start: contains the initial content block info.
    //    For tool_use blocks, the id and name are in data.content_block.
    //    For text blocks, data.content_block.text may contain initial text.
    if (eventType === "content_block_start") {
      const contentBlock = isRecord(data.content_block) ? data.content_block : undefined;
      const index = typeof data.index === "number" ? data.index : this.pendingToolCalls.size;

      if (contentBlock && contentBlock.type === "tool_use") {
        const pending = this.pendingToolCalls.get(index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (typeof contentBlock.id === "string") {
          pending.id = contentBlock.id;
        }
        if (typeof contentBlock.name === "string") {
          pending.name += contentBlock.name;
        }
        this.pendingToolCalls.set(index, pending);
      } else if (contentBlock && contentBlock.type === "thinking" && typeof contentBlock.thinking === "string") {
        this.handleReasoning(contentBlock.thinking);
      } else if (contentBlock && typeof contentBlock.text === "string" && contentBlock.text.length > 0) {
        const { visible, thinking } = this.filterText(contentBlock.text);
        if (visible) {
          this.emittedTextLength += visible.length;
          parts.push(new vscode.LanguageModelTextPart(visible));
        }
        if (thinking) {
          this.handleReasoning(thinking);
        }
      }

      return parts;
    }

    // 2. content_block_delta: streaming deltas for the current block.
    //    text delta: delta.type === "text_delta", delta.text
    //    thinking delta: delta.type === "thinking_delta", delta.thinking
    //    tool input delta: delta.type === "input_json_delta", delta.partial_json
    if (eventType === "content_block_delta" && delta) {
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
        const { visible, thinking } = this.filterText(delta.text);
        if (visible) {
          this.emittedTextLength += visible.length;
          parts.push(new vscode.LanguageModelTextPart(visible));
        }
        if (thinking) {
          this.handleReasoning(thinking);
        }
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length > 0) {
        this.handleReasoning(delta.thinking);
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const index = typeof data.index === "number" ? data.index : this.pendingToolCalls.size - 1;
        const pending = this.pendingToolCalls.get(index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        pending.arguments += delta.partial_json;
        this.pendingToolCalls.set(index, pending);
      }

      return parts;
    }

    // 3. message_delta: contains stop_reason and usage.
    if (eventType === "message_delta" && delta) {
      if (isRecord(data.usage)) {
        updateRequestUsageSummary(this as unknown as RequestUsageSummary, data);
      }
      if (delta.stop_reason) {
        const toolParts = this.flushToolCalls();
        this.emittedToolCallsCount += toolParts.length;
        parts.push(...toolParts);
      }
      return parts;
    }

    // 4. message_stop: final event, flush any remaining tool calls.
    if (eventType === "message_stop") {
      const toolParts = this.flushToolCalls();
      this.emittedToolCallsCount += toolParts.length;
      parts.push(...toolParts);
      return parts;
    }

    // --- Fallback: handle non-standard or flat SSE shapes ---
    // Some providers may send Anthropic-style data without explicit event types,
    // or use a flat delta shape similar to the original extractor logic.
    if (delta) {
      if (typeof delta.text === "string" && delta.text.length > 0) {
        const { visible, thinking } = this.filterText(delta.text);
        if (visible) {
          this.emittedTextLength += visible.length;
          parts.push(new vscode.LanguageModelTextPart(visible));
        }
        if (thinking) {
          this.handleReasoning(thinking);
        }
      }

      if (typeof delta.thinking === "string" && delta.thinking.length > 0) {
        this.handleReasoning(delta.thinking);
      }
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        this.handleReasoning(delta.reasoning_content);
      }
      if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
        this.handleReasoning(delta.reasoning);
      }

      if (typeof delta.type === "string") {
        // Flat tool_use delta (non-standard but some gateways use this)
        if (delta.type === "tool_use") {
          const index = typeof delta.index === "number" ? delta.index : this.pendingToolCalls.size;
          const pending = this.pendingToolCalls.get(index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          if (typeof delta.id === "string") {
            pending.id = delta.id;
          }
          if (typeof delta.name === "string") {
            pending.name += delta.name;
          }
          if (typeof delta.input === "string") {
            pending.arguments += delta.input;
          } else if (isRecord(delta.input)) {
            pending.arguments += JSON.stringify(delta.input);
          }
          this.pendingToolCalls.set(index, pending);
        }
      }

      if (delta.stop_reason) {
        const toolParts = this.flushToolCalls();
        this.emittedToolCallsCount += toolParts.length;
        parts.push(...toolParts);
      }
    }

    return parts;
  }

  /** Split text through the think-tag filter (if active). */
  private filterText(text: string): { visible: string; thinking: string } {
    if (!text) {
      return { visible: "", thinking: "" };
    }
    if (!this.thinkFilter) {
      return { visible: text, thinking: "" };
    }
    return this.thinkFilter.process(text);
  }

  flushReasoningFallback(progress: vscode.Progress<vscode.LanguageModelResponsePart2>, localRequestId?: string): void {
    // Flush any remaining text in the think filter
    if (this.thinkFilter) {
      const { visible, thinking } = this.thinkFilter.finish();
      if (visible) {
        this.emittedTextLength += visible.length;
        reportProgressPart(localRequestId, progress, new vscode.LanguageModelTextPart(visible));
      }
      if (thinking) {
        // Surface remaining think-filter carry through the thinking part channel.
        this.handleReasoning(thinking);
      }
    }

    const reasoning = this.reasoningContent.trim();
    if (!reasoning) {
      return;
    }
    // If the thinking part API is available, reasoning was already streamed
    // live during extractStreamParts via handleReasoning(). The accumulated
    // reasoningContent is retained only for tool-call replication
    // (flushToolCalls → onReasoningContent). Nothing more to emit here.
    if (thinkingPartConstructor) {
      this.reasoningContent = "";
      return;
    }
    // Legacy fallback (API unavailable): emit reasoning as plain text only
    // when the response is otherwise empty, to avoid breaking the visible
    // output. This preserves the pre-fix safety-net semantics.
    if (this.emittedTextLength > 0 || this.emittedToolCallsCount > 0) {
      this.reasoningContent = "";
      return;
    }
    this.onReasoningDebug?.(this.reasoningContent);
    reportProgressPart(localRequestId, progress, new vscode.LanguageModelTextPart(reasoning));
    this.emittedTextLength += reasoning.length;
    this.reasoningContent = "";
  }

  private flushToolCalls(): vscode.LanguageModelToolCallPart[] {
    const toolCalls = Array.from(this.pendingToolCalls.values()).filter((toolCall) => toolCall.name);
    const parts = toolCalls.map(
      (toolCall, index) =>
        new vscode.LanguageModelToolCallPart(
          toolCall.id || `opencodego-tool-${Date.now()}-${index}`,
          toolCall.name,
          parseToolInput(toolCall.arguments),
        ),
    );

    if (this.reasoningContent.trim()) {
      this.onReasoningDebug?.(this.reasoningContent);
      this.onReasoningContent?.(
        parts.map((part) => part.callId),
        this.reasoningContent,
      );
    }

    this.pendingToolCalls.clear();
    this.reasoningContent = "";
    return parts;
  }
}

function extractChatCompletionParts(data: unknown): vscode.LanguageModelResponsePart[] {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return [];
  }

  const first = data.choices[0];
  if (!isRecord(first)) {
    return [];
  }

  const parts: vscode.LanguageModelResponsePart[] = [];
  const message = first.message;
  if (isRecord(message)) {
    const text = extractTextFromDelta(message);
    if (text) {
      parts.push(new vscode.LanguageModelTextPart(text));
    } else {
      const reasoning = extractReasoningFromDelta(message);
      if (reasoning.trim()) {
        // Non-stream path: emit reasoning via thinking part when the API is
        // available (so chat.agent.thinkingStyle applies), else fall back to
        // plain text. Cast needed because LanguageModelThinkingPart is in the
        // LanguageModelResponsePart2 union, not the stable LanguageModelResponsePart.
        const thinkingPart = thinkingPartConstructor
          ? (new thinkingPartConstructor(reasoning) as unknown as vscode.LanguageModelResponsePart)
          : new vscode.LanguageModelTextPart(reasoning);
        parts.push(thinkingPart);
      }
    }
    for (const toolCallPart of toolCallPartsFromOpenAiMessage(message.tool_calls)) {
      parts.push(toolCallPart);
    }
  }

  if (typeof first.text === "string") {
    parts.push(new vscode.LanguageModelTextPart(first.text));
  }

  return parts;
}

function extractTextFromDelta(delta: Record<string, unknown>): string {
  const candidates: unknown[] = [delta.content, delta.text, delta.output_text];
  let collected = "";
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      collected += candidate;
      continue;
    }
    if (Array.isArray(candidate)) {
      for (const part of candidate) {
        if (typeof part === "string") {
          collected += part;
        } else if (isRecord(part)) {
          const text = part.text ?? part.value ?? part.output_text;
          if (typeof text === "string") {
            collected += text;
          }
        }
      }
    }
  }
  return collected;
}

function extractReasoningFromDelta(delta: Record<string, unknown>): string {
  const candidates: unknown[] = [
    delta.reasoning_content,
    delta.reasoning,
    delta.thinking,
    isRecord(delta.message) ? (delta.message as Record<string, unknown>).reasoning_content : undefined,
  ];
  let collected = "";
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      collected += candidate;
    } else if (isRecord(candidate) && typeof candidate.content === "string") {
      collected += candidate.content;
    } else if (Array.isArray(candidate)) {
      for (const part of candidate) {
        if (typeof part === "string") {
          collected += part;
        } else if (isRecord(part) && typeof part.text === "string") {
          collected += part.text;
        }
      }
    }
  }
  return collected;
}

function extractAnthropicParts(data: unknown): vscode.LanguageModelResponsePart[] {
  if (!isRecord(data) || !Array.isArray(data.content)) {
    return [];
  }

  const parts: vscode.LanguageModelResponsePart[] = [];
  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const block of data.content) {
    if (!isRecord(block)) {
      continue;
    }

    if (typeof block.text === "string" && block.text.length > 0) {
      textParts.push(block.text);
      continue;
    }

    // Anthropic thinking blocks — surface via thinking part when available.
    if (
      (block.type === "thinking" || block.type === "redacted_thinking") &&
      typeof block.thinking === "string" &&
      block.thinking.length > 0
    ) {
      reasoningParts.push(block.thinking);
      continue;
    }

    if (block.type === "tool_use" && typeof block.name === "string") {
      const id = typeof block.id === "string" ? block.id : `opencodego-tool-${Date.now()}`;
      const input = isRecord(block.input) ? block.input : parseToolInput(typeof block.input === "string" ? block.input : "{}");
      parts.push(new vscode.LanguageModelToolCallPart(id, block.name, input));
    }
  }

  const text = textParts.join("");
  if (text) {
    parts.unshift(new vscode.LanguageModelTextPart(text));
  }

  // Emit accumulated reasoning via thinking part (or text fallback) at the front.
  const reasoning = reasoningParts.join("");
  if (reasoning) {
    const thinkingPart = thinkingPartConstructor
      ? (new thinkingPartConstructor(reasoning) as unknown as vscode.LanguageModelResponsePart)
      : new vscode.LanguageModelTextPart(reasoning);
    parts.unshift(thinkingPart);
  }

  return parts;
}

function toolCallPartsFromOpenAiMessage(toolCalls: unknown): vscode.LanguageModelToolCallPart[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .filter(isRecord)
    .map((toolCall, index) => {
      const fn = toolCall.function;
      const id = typeof toolCall.id === "string" ? toolCall.id : `opencodego-tool-${Date.now()}-${index}`;
      const name = isRecord(fn) && typeof fn.name === "string" ? fn.name : "";
      const args = isRecord(fn) && typeof fn.arguments === "string" ? fn.arguments : "{}";
      return name ? new vscode.LanguageModelToolCallPart(id, name, parseToolInput(args)) : undefined;
    })
    .filter((part): part is vscode.LanguageModelToolCallPart => Boolean(part));
}

function updateRequestUsageSummary(summary: RequestUsageSummary, data: unknown): void {
  if (!isRecord(data)) {
    return;
  }

  const usage = isRecord(data.usage) ? data.usage : undefined;
  if (usage) {
    // OpenAI-compatible fields
    const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
    const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
    const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
    const promptTokenDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
    const cachedTokens =
      promptTokenDetails && typeof promptTokenDetails.cached_tokens === "number" ? promptTokenDetails.cached_tokens : undefined;

    // Anthropic-compatible fields (input_tokens / output_tokens)
    const anthropicInputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
    const anthropicOutputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
    const cacheReadInputTokens = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined;

    if (promptTokens !== undefined) {
      summary.promptTokens = promptTokens;
    } else if (anthropicInputTokens !== undefined) {
      summary.promptTokens = anthropicInputTokens;
    }
    if (completionTokens !== undefined) {
      summary.completionTokens = completionTokens;
    } else if (anthropicOutputTokens !== undefined) {
      summary.completionTokens = anthropicOutputTokens;
    }
    if (totalTokens !== undefined) {
      summary.totalTokens = totalTokens;
    }
    if (cachedTokens !== undefined) {
      summary.cachedTokens = cachedTokens;
    } else if (cacheReadInputTokens !== undefined) {
      summary.cachedTokens = cacheReadInputTokens;
    }
  }

  // Anthropic message_delta reports stop_reason in delta, not in choices
  const delta = isRecord(data.delta) ? data.delta : undefined;
  if (delta && typeof delta.stop_reason === "string") {
    summary.finishReason = delta.stop_reason;
  }

  const firstChoice = Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : undefined;
  if (firstChoice && typeof firstChoice.finish_reason === "string") {
    summary.finishReason = firstChoice.finish_reason;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
