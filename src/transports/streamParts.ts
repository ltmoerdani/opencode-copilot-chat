import * as vscode from "vscode";
import { reportProgressWithContextWindowRequest } from "../contextWindowHookBridge";
import type { StreamRequestOptions } from "../core/transport";

interface StreamOpenCodeResponseOptions extends StreamRequestOptions {
  extractStreamParts: (data: unknown) => vscode.LanguageModelResponsePart[];
  extractFullParts: (data: unknown) => vscode.LanguageModelResponsePart[];
  /**
   * Whether the upstream transport terminates a successful stream with a
   * `data: [DONE]` SSE sentinel. OpenAI-style transports (chat-completions,
   * Responses API) do; Google (`streamGenerateContent?alt=sse`, native SSE) and
   * Anthropic (`/messages`, `message_stop`) do NOT. The engine only treats a
   * missing `[DONE]` as truncation for transports that send it — the others can
   * legitimately end a healthy stream without `[DONE]` or with a `null`
   * `finishReason`, so gating there would cause false-positive errors.
   */
  usesDoneSentinel: boolean;
  /**
   * Internal: how many times this invocation is a retry for a stream that
   * failed before any content was emitted (truncated connection or idle
   * stall). `0` (or undefined) means the original attempt. The engine retries
   * up to `STREAM_FAILURE_MAX_RETRIES` times; each retry increments this so
   * the budget is shared across both failure modes and never exceeded. Never
   * set by transport adapters.
   */
  streamFailureRetryAttempt?: number;
  /**
   * Optional consult before the engine treats an unterminated `[DONE]`
   * -transport stream (content already delivered) as successful. Returns
   * `true` when everything received is usable — e.g. all pending tool calls
   * carry complete, parseable arguments. When it returns `false` the engine
   * throws the truncation error instead, because flushing half-streamed tool
   * arguments would execute the tool with silently-corrupted input (#184).
   * Absent → the stream is treated as successful (pre-#184 behavior).
   */
  hasCompletePendingWork?: () => boolean;
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

export { StreamOpenCodeResponseOptions, RequestUsageSummary, reportProgressPart, thinkingPartConstructor, emitThinkingPart };
