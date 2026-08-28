import type * as vscode from "vscode";
import {
  buildOpenCodeRequestError,
  formatDuration,
  formatRateLimitSummary,
  OpenCodeRequestError,
  readRateLimitInfo,
  truncateForLog,
} from "../errors";
import {
  analyzeHttp400ForRetry,
  isTransientFetchError,
  isTransientServerError,
  TRANSIENT_5XX_MAX_RETRIES,
  TRANSIENT_5XX_RETRY_BASE_MS,
  TRANSIENT_5XX_RETRY_JITTER_MS,
} from "../retry";
import { TRANSIENT_FETCH_MAX_RETRIES, TRANSIENT_FETCH_RETRY_BASE_MS, TRANSIENT_FETCH_RETRY_JITTER_MS } from "../config";
import { createUsageDataParts } from "../chatParts";
import {
  clearContextWindowRequest,
  reportUsageToContextWindowForRequest,
  setContextWindowOutputBufferForRequest,
} from "../contextWindowHookBridge";
import { formatUsageLogLine } from "../usage/usage";
import { getErrorMessage, sleepWithCancellation } from "../utils";
import { parseServerSentEvent, isStreamTruncated } from "./sse";
import { reportProgressPart, type RequestUsageSummary, type StreamOpenCodeResponseOptions } from "./streamParts";
import type { TransportRequestSummary } from "../core/transport";
import { updateRequestUsageSummary } from "./extract";

/**
 * Maximum number of transparent retries for a stream that fails *before any
 * user-visible content is emitted* (truncated connection or idle stall).
 *
 * Gated on `extractedPartCount === 0` so a retry can never duplicate chat
 * content that VS Code already rendered — when the provider throws, VS Code
 * flushes the streamed parts before showing the error (see
 * extHostLanguageModels.ts `$reportResponseDone`), so re-emitting a full
 * response after a partial one would garble the chat. A few attempts recover
 * the transient gateway drops that plague models like Ox Alpha Stealth (#181)
 * and GPT 5.6 Luna tool calls (#184) without risking duplication.
 */
const STREAM_FAILURE_MAX_RETRIES = 3;

/**
 * Maximum number of HTTP-400 patch retries per request. Each iteration
 * re-analyzes the latest 400 body against the latest patched payload, so a
 * multi-step degradation ladder (e.g. `patchInvalidInput`'s stream_options →
 * temperature → images) can complete within one request.
 */
const MAX_400_PATCH_ATTEMPTS = 3;

/**
 * Core streaming engine shared by every transport: performs the HTTP POST
 * (with HTTP-400 body patching and transient-5xx backoff retries), parses the
 * SSE stream, routes each event through the injected extractor, and emits a
 * per-request `TransportRequestSummary` on completion.
 */
export async function streamOpenCodeResponse(options: StreamOpenCodeResponseOptions): Promise<void> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const localRequestId = options.requestHeaders["x-opencode-request"];
  let firstByteAt: number | undefined;
  const usageSummary: RequestUsageSummary = {};
  let abortReason: "request-timeout" | "stream-idle-timeout" | "cancelled" | undefined;
  // Parts reported to VS Code so far — shared between the stream loop and the
  // catch block so the one-shot failure retries know whether anything
  // user-visible was already emitted (retrying after that would duplicate it).
  let extractedPartCount = 0;
  let responseStatus: number | undefined;
  let responseContentType: string | undefined;
  let emittedSummary = false;
  const abort = (reason: typeof abortReason) => {
    abortReason ??= reason;
    controller.abort();
  };
  const cancellation = options.token.onCancellationRequested(() => {
    abort("cancelled");
  });
  const requestTimeout = setTimeout(() => {
    abort("request-timeout");
  }, options.requestTimeoutMs);
  let streamIdleTimeout: ReturnType<typeof setTimeout> | undefined;
  const resetStreamIdleTimeout = () => {
    if (streamIdleTimeout) {
      clearTimeout(streamIdleTimeout);
    }
    streamIdleTimeout = setTimeout(() => {
      abort("stream-idle-timeout");
    }, options.streamIdleTimeoutMs);
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
      `[response-summary] status=${String(summary.status ?? "n/a")} durationMs=${String(summary.durationMs)} ttfbMs=${String(summary.ttfbMs ?? "n/a")} promptTokens=${String(summary.promptTokens ?? "n/a")} completionTokens=${String(summary.completionTokens ?? "n/a")} totalTokens=${String(summary.totalTokens ?? "n/a")} cachedTokens=${String(summary.cachedTokens ?? "n/a")} finishReason=${summary.finishReason ?? "<unknown>"} totalBytes=${String(summary.totalBytes)} totalEvents=${String(summary.totalEvents)}`,
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

    let rawPayload = JSON.stringify(options.body);

    // Log request for debugging latency.
    options.output?.appendLine(
      `[request] url=${options.url} payloadBytes=${String(rawPayload.length)} requestTimeoutMs=${String(options.requestTimeoutMs)} streamIdleTimeoutMs=${String(options.streamIdleTimeoutMs)}`,
    );

    // ------------------------------------------------------------------
    // NOTE: We do NOT gzip-compress the payload.  The OpenCode proxy
    // does not support Content-Encoding: gzip and returns HTTP 500.
    // ------------------------------------------------------------------
    let payload = rawPayload;
    const fetchHeaders: Record<string, string> = {
      ...(options.authHeaders ?? { Authorization: `Bearer ${options.apiKey}` }),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.requestHeaders,
    };
    const fetchWithBody = (body: string) =>
      fetch(options.url, {
        method: "POST",
        headers: fetchHeaders,
        body,
        signal: controller.signal,
      });

    /**
     * POST the request body, retrying transient network-level failures that
     * `fetch()` *throws* (undici `TypeError: fetch failed` — ECONNRESET,
     * EAI_AGAIN, UND_ERR_CONNECT_TIMEOUT, socket reuse races per
     * nodejs/undici#5450). These are distinct from HTTP error responses (handled
     * separately below): a thrown fetch error means no response was received at
     * all, and without this retry it surfaces directly to the user as a hard
     * "Sorry, your request failed".
     *
     * AbortError (user cancellation or our own request/stream timeout) is NEVER
     * retried — it propagates immediately so cancellation stays responsive.
     */
    const fetchWithTransientRetry = async (body: string): Promise<Response> => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= TRANSIENT_FETCH_MAX_RETRIES; attempt++) {
        try {
          return await fetchWithBody(body);
        } catch (error) {
          lastError = error;
          // Non-transient (incl. AbortError from cancellation/timeout) — bail now.
          if (!isTransientFetchError(error)) {
            throw error;
          }
          if (attempt === TRANSIENT_FETCH_MAX_RETRIES) {
            break;
          }
          const backoffMs = Math.round(TRANSIENT_FETCH_RETRY_BASE_MS * 2 ** attempt + Math.random() * TRANSIENT_FETCH_RETRY_JITTER_MS);
          options.output?.appendLine(
            `[retry] transient fetch error (attempt ${String(attempt + 1)}/${String(TRANSIENT_FETCH_MAX_RETRIES + 1)}): ${getErrorMessage(error)}. Retrying in ${String(backoffMs)}ms…`,
          );
          await sleepWithCancellation(backoffMs, options.token);
          if (options.token.isCancellationRequested) {
            throw new DOMException("Aborted", "AbortError");
          }
        }
      }
      // All attempts failed with transient network errors — surface a clear,
      // actionable error instead of the raw undici "fetch failed" wrapper.
      const networkError = lastError instanceof Error ? lastError : new Error(getErrorMessage(lastError));
      const requestError = new OpenCodeRequestError(
        `${options.providerDisplayName} request failed (network error after ${String(TRANSIENT_FETCH_MAX_RETRIES + 1)} attempts): ${getErrorMessage(networkError)}`,
        `${options.providerDisplayName} couldn't reach the gateway (network error). Check your connection, VPN, or firewall, then try again.`,
      );
      throw requestError;
    };

    let response = await fetchWithTransientRetry(payload);

    // --- Runtime retry for recoverable HTTP 400 errors ---
    // If the upstream rejects a parameter or reports an exact context overflow,
    // patch the body and retry. Loops up to MAX_400_PATCH_ATTEMPTS times so
    // multi-step degradations (e.g. the [1210] invalid-input ladder in
    // `patchInvalidInput`: stream_options → temperature → images) can run
    // end-to-end within a single request instead of stopping after one patch.
    // Each iteration re-analyzes against the LATEST body (`rawPayload` is kept
    // in sync), because the next-relevant parameter may only become visible
    // after the previous one was removed.
    let consumedErrorBody: string | undefined;
    for (let patchAttempt = 0; patchAttempt < MAX_400_PATCH_ATTEMPTS && response.status === 400; patchAttempt++) {
      const errorDetail = consumedErrorBody ?? (await response.text());
      // Cache the body we just read: if `analyzeHttp400ForRetry` finds nothing
      // recoverable we break out with `response.status === 400`, and the
      // `!response.ok` handler below must not re-read the same Response — a
      // Fetch body can be consumed exactly once, so a second `text()` throws
      // undici's "Body is unusable: Body has already been read" (#199).
      consumedErrorBody ??= errorDetail;
      options.output?.appendLine(`[http-error-body] ${errorDetail.trim() ? truncateForLog(errorDetail) : "<empty>"}`);
      const parsedBody = JSON.parse(rawPayload) as Record<string, unknown>;
      const patch = analyzeHttp400ForRetry(errorDetail, parsedBody);
      if (!patch) {
        break;
      }
      options.output?.appendLine(`[retry] HTTP 400 recoverable: ${patch.reason}. Retrying with patched body…`);
      payload = JSON.stringify(patch.body);
      rawPayload = payload;
      response = await fetchWithTransientRetry(payload);
      options.output?.appendLine(`[retry] Response after patch: ${String(response.status)} ${response.statusText}`);
      // If the retry also returned 400, consume its body so the next loop
      // iteration (or the error handler below) doesn't try to re-read it.
      consumedErrorBody = !response.ok && response.status === 400 ? await response.text() : undefined;
    }

    // --- Transient 5xx retry (gateway/router capacity) ---
    // Retry a small number of times with exponential backoff (plus jitter)
    // when the gateway is momentarily unavailable (502/503/504, or 5xx body
    // that names Router.Unavailable). Cancellation aborts the wait immediately.
    let attempt = 0;
    while (attempt < TRANSIENT_5XX_MAX_RETRIES) {
      // Consume a 5xx body so body-named transient conditions (Router.
      // Unavailable) are recognized by isTransientServerError, and the same
      // body is reused for the error message if the retries are exhausted.
      // (502/503/504 are retried by status alone, but reading the small error
      // body once here also covers the body-scanned 5xx cases.)
      if (response.status >= 500 && consumedErrorBody === undefined) {
        consumedErrorBody = await response.text();
      }
      if (!isTransientServerError(response.status, consumedErrorBody ?? "")) {
        break;
      }
      attempt += 1;
      // Jitter spreads concurrent retries so they don't pile on the gateway
      // at the same timestamp.
      const backoffMs = Math.round(TRANSIENT_5XX_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * TRANSIENT_5XX_RETRY_JITTER_MS);
      options.output?.appendLine(
        `[retry] transient ${String(response.status)} (attempt ${String(attempt)}/${String(TRANSIENT_5XX_MAX_RETRIES)}); retrying in ${String(backoffMs)}ms…`,
      );
      await sleepWithCancellation(backoffMs, options.token);
      if (options.token.isCancellationRequested) {
        break;
      }
      response = await fetchWithTransientRetry(payload);
      // A fresh response may carry a new error body; drop stale detail.
      consumedErrorBody = undefined;
    }

    // A cancellation during the backoff wait means the user aborted while we
    // were retrying a stale 5xx response. Fail cleanly as "cancelled" rather
    // than surfacing the stale gateway error as if it were a fresh failure.
    // (Read into a local so the throw does not narrow the token property for
    // the rest of the function and trip no-unnecessary-condition.)
    const cancelledDuringBackoff = options.token.isCancellationRequested;
    if (cancelledDuringBackoff) {
      abort("cancelled");
      throw new DOMException("Aborted", "AbortError");
    }

    responseStatus = response.status;
    responseContentType = response.headers.get("content-type") ?? "";
    options.output?.appendLine(`[http] ${String(response.status)} ${response.statusText} content-type=${responseContentType || "<none>"}`);
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
    // Whether we received OpenCode's `data: [DONE]` stream-terminator. A
    // successful stream always sends it; its absence at connection close
    // signals a truncated/aborted response (see isStreamTruncated below).
    const streamFlags: { sawDone: boolean } = { sawDone: false };
    resetStreamIdleTimeout();

    while (!options.token.isCancellationRequested && !streamFlags.sawDone) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      resetStreamIdleTimeout();

      totalBytes += value.byteLength;
      if (firstByteAt === undefined && value.byteLength > 0) {
        firstByteAt = Date.now();
      }
      const chunk = decoder.decode(value, { stream: true });
      if (options.debugReasoning && options.output && chunk) {
        options.output.appendLine(`[sse-raw bytes=${String(value.byteLength)}] ${truncateForLog(chunk)}`);
      }
      buffer += chunk;
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        totalEvents += 1;
        if (options.debugReasoning && options.output && event.trim()) {
          options.output.appendLine(`[sse] ${truncateForLog(event)}`);
        }
        for (const part of parseServerSentEvent(
          event,
          options.extractStreamParts,
          (data) => {
            updateRequestUsageSummary(usageSummary, data);
            rawSseData.push(data);
          },
          () => {
            streamFlags.sawDone = true;
          },
        )) {
          extractedPartCount += 1;
          reportProgressPart(localRequestId, options.progress, part);
        }
      }
    }

    if (buffer.trim()) {
      if (options.debugReasoning && options.output) {
        options.output.appendLine(`[sse-tail] ${truncateForLog(buffer)}`);
      }
      for (const part of parseServerSentEvent(
        buffer,
        options.extractStreamParts,
        (data) => {
          updateRequestUsageSummary(usageSummary, data);
          rawSseData.push(data);
        },
        () => {
          streamFlags.sawDone = true;
        },
      )) {
        extractedPartCount += 1;
        reportProgressPart(localRequestId, options.progress, part);
      }
    }

    if (options.debugReasoning && options.output) {
      options.output.appendLine(
        `[sse-stats] totalBytes=${String(totalBytes)} totalEvents=${String(totalEvents)} bufferTailLen=${String(buffer.length)}`,
      );
    }

    // Diagnostic: when the gateway reported completion tokens but our
    // extractor found nothing, dump raw SSE data to identify format mismatches.
    // This helps diagnose issues like #93 where the model generates tokens
    // but the response content is in an unrecognized format.
    if (usageSummary.completionTokens && usageSummary.completionTokens > 0 && extractedPartCount === 0 && rawSseData.length > 0) {
      options.output?.appendLine(
        `[diag-empty-response] model=${options.modelId} completionTokens=${String(usageSummary.completionTokens)} totalEvents=${String(totalEvents)} rawSseDataCount=${String(rawSseData.length)}`,
      );
      for (let i = 0; i < rawSseData.length; i++) {
        options.output?.appendLine(`[diag-sse-event-${String(i)}] ${truncateForLog(JSON.stringify(rawSseData[i]))}`);
      }
    }

    // Detect abnormal stream termination. OpenCode always terminates a
    // successful stream with a `data: [DONE]` sentinel, and the extractors
    // capture a `finish_reason`/`stop_reason` from the final chunk. A stream
    // that ends (connection closed) WITHOUT either signal while we had already
    // extracted content was truncated or aborted (gateway dropped the
    // connection, proxy reset, upstream crash). Previously this was treated as
    // a silent success, leaving the user with a partial/empty response and no
    // indication of what happened — the "model stopped working / session ended
    // with no warning" bug.
    if (
      isStreamTruncated({
        usesDoneSentinel: options.usesDoneSentinel,
        sawDone: streamFlags.sawDone,
        finishReason: usageSummary.finishReason,
        extractedPartCount,
        totalBytes,
      })
    ) {
      // Nothing user-visible was emitted yet — a transparent retry is safe
      // (no duplicated chat content). Recovers transient gateway drops that
      // kill the stream before the first extractable part. Retry a bounded
      // number of times so flaky models (Ox Alpha Stealth #181, GPT 5.6 Luna
      // tool calls #184) self-heal instead of surfacing an error every turn.
      const attempt = options.streamFailureRetryAttempt ?? 0;
      if (extractedPartCount === 0 && attempt < STREAM_FAILURE_MAX_RETRIES && !options.token.isCancellationRequested) {
        const nextAttempt = attempt + 1;
        options.output?.appendLine(
          `[retry] stream truncated before any content (${String(totalBytes)} bytes / ${String(totalEvents)} events); retry ${String(nextAttempt)}/${String(STREAM_FAILURE_MAX_RETRIES)}…`,
        );
        emitSummary(totalBytes, totalEvents, {
          abortedReason: "truncated-retry",
          errorMessage: `stream truncated before any content — retried ${String(nextAttempt)}/${String(STREAM_FAILURE_MAX_RETRIES)}`,
        });
        await streamOpenCodeResponse({ ...options, streamFailureRetryAttempt: nextAttempt });
        return;
      }
      // Content was already delivered to VS Code — the response is usable even
      // though the stream lacked [DONE] / finish_reason (e.g. Muse Spark on
      // the Responses API, or any OpenCode Zen model whose gateway drops the
      // connection without the sentinel). Log the anomaly but don't throw,
      // since the user already received their content and throwing after
      // delivery creates a confusing "Try again" error popup on an otherwise
      // successful response (issue #193).
      //
      // NOTE: The transport's `finally` block already calls
      // `flushRemainingToolCalls()`, which drops incomplete tool calls
      // (arguments cut mid-JSON) without emitting them (#184/#188). So the
      // engine does NOT need to guard against corrupted tool-call emission
      // here — the transport handles it. Returning success is always safe
      // when content was delivered.
      if (extractedPartCount > 0) {
        options.output?.appendLine(
          `[warn] stream ended without [DONE] / finish_reason but ${String(extractedPartCount)} parts were delivered (${String(totalBytes)} bytes / ${String(totalEvents)} events)`,
        );
        emitSummary(totalBytes, totalEvents, {
          rateLimitSummary,
        });
        return;
      }
      const requestError = new OpenCodeRequestError(
        `${options.providerDisplayName} response stream ended before completion (no [DONE] or finish_reason after ${String(totalBytes)} bytes / ${String(totalEvents)} events${localRequestId ? `, request ${localRequestId}` : ""}).`,
        `${options.providerDisplayName} stopped sending data before the response was complete (the connection closed unexpectedly). Your message may be cut off — try sending it again; a single resend usually succeeds. If this keeps happening, check your connection, VPN, or firewall.`,
      );
      emitSummary(totalBytes, totalEvents, {
        errorMessage: requestError.message,
        rateLimitSummary,
      });
      throw requestError;
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
      // Nothing user-visible was emitted yet — a transparent retry is safe
      // (no duplicated chat content). Covers half-dead connections that stop
      // delivering frames before the first extractable part. Retry a bounded
      // number of times; a model that legitimately pauses longer than the idle
      // timeout will stall again on each retry and fail with the same error —
      // bounded extra latency, no loops.
      const attempt = options.streamFailureRetryAttempt ?? 0;
      if (extractedPartCount === 0 && attempt < STREAM_FAILURE_MAX_RETRIES && !options.token.isCancellationRequested) {
        const nextAttempt = attempt + 1;
        options.output?.appendLine(
          `[retry] stream stalled before any content (${formatDuration(options.streamIdleTimeoutMs)} without data); retry ${String(nextAttempt)}/${String(STREAM_FAILURE_MAX_RETRIES)}…`,
        );
        emitSummary(0, 0, {
          abortedReason: "stalled-retry",
          errorMessage: `stream stalled before any content — retried ${String(nextAttempt)}/${String(STREAM_FAILURE_MAX_RETRIES)}`,
        });
        await streamOpenCodeResponse({ ...options, streamFailureRetryAttempt: nextAttempt });
        return;
      }
      const requestError = new OpenCodeRequestError(
        `${options.providerDisplayName} stream stalled for ${formatDuration(options.streamIdleTimeoutMs)} without new data.`,
        `${options.providerDisplayName} stopped sending stream data for ${formatDuration(options.streamIdleTimeoutMs)}, so the request was cancelled to avoid leaving Copilot stuck. Try sending your message again; if you use a model with long silent reasoning pauses, raise the streamIdleTimeoutSeconds setting for this provider.`,
      );
      emitSummary(0, 0, {
        abortedReason: "stream-idle-timeout",
        errorMessage: requestError.message,
      });
      throw requestError;
    }
    emitSummary(0, 0, {
      errorMessage: getErrorMessage(error),
    });
    throw error;
  } finally {
    clearTimeout(requestTimeout);
    if (streamIdleTimeout) {
      clearTimeout(streamIdleTimeout);
    }
    // Release the connection deterministically: the read loop breaks as soon
    // as it sees the `[DONE]` sentinel, which can leave the socket open (the
    // server may keep its side alive for reuse). Aborting the controller here
    // closes any still-open response body on every exit path. The body is
    // already fully consumed on normal completion, so this is a no-op there.
    controller.abort();
    cancellation.dispose();
    if (localRequestId) {
      clearContextWindowRequest(localRequestId);
    }
  }
}

export function createReasoningDebugger(
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
