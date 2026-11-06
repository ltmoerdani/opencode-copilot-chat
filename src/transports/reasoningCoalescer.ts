import * as vscode from "vscode";
import { emitThinkingPart } from "./streamParts";

/**
 * Coalesced live emission of reasoning as `LanguageModelThinkingPart`s.
 *
 * CONTRACT — Mitigation for VS Code 1.145 thinking-part fragmentation
 * (upstream microsoft/vscode#345390, fixed by #346106 in 1.146):
 *
 * RULES:
 *   1. VS Code 1.145 stamps every thinking part crossing `progress.report()`
 *      with client-side timing and treats parts with different downstream ids
 *      as separate reasoning runs, so one streamed reasoning run renders as
 *      one "Thought for Xs" card PER DELTA (thousands of cards, ~11 chars
 *      each on the OpenCode gateway). The ids are assigned below
 *      `progress.report()`, so the extension cannot prevent the split —
 *      only shrink it by reporting fewer, larger parts.
 *   2. Buffer reasoning and emit one thinking part per
 *      `REASONING_COALESCE_MAX_CHARS` chars. Always flush before any
 *      visible/tool part is emitted and at end-of-stream, so a reasoning run
 *      produces tens of parts instead of thousands.
 *   3. Every emitted part carries a stable per-request run id. Hosts that
 *      preserve provider ids merge same-id parts into ONE card (1.145.0's
 *      `differentId` check, 1.146's `differentReasoningRun` check); hosts
 *      that overwrite ids ignore it harmlessly.
 *
 * INVARIANTS:
 *   - Ordering: callers flush before emitting later-reported visible/tool
 *     parts, so reasoning never appears after the text it produced.
 *   - Idempotent: flush is a no-op on an empty buffer or without a live
 *     progress sink (the extractor's `reasoningContent` still retains the
 *     full text for tool-call replication and the end-of-stream fallback).
 *   - Never throws: emission failures are swallowed by `emitThinkingPart`;
 *     the buffer is still cleared so a failing sink can't grow memory.
 */
const REASONING_COALESCE_MAX_CHARS = 512;

let nextReasoningRunCounter = 0;

class ReasoningCoalescer {
  private buffer = "";
  private readonly runId: string;

  constructor(
    private readonly localRequestId: string | undefined,
    private readonly progress: vscode.Progress<vscode.LanguageModelResponsePart2> | undefined,
  ) {
    nextReasoningRunCounter += 1;
    this.runId = `rc-${Date.now().toString(36)}-${String(nextReasoningRunCounter)}`;
  }

  /** Stable id shared by every thinking part of this reasoning run. */
  get reasoningRunId(): string {
    return this.runId;
  }

  /** Buffered-but-unemitted chars (diagnostics/tests). */
  get bufferedLength(): number {
    return this.buffer.length;
  }

  /** Buffer a reasoning chunk; flush when the coalescing window is full. */
  append(reasoning: string): void {
    if (!reasoning || !this.progress) {
      return;
    }
    this.buffer += reasoning;
    if (this.buffer.length >= REASONING_COALESCE_MAX_CHARS) {
      this.flush();
    }
  }

  /** Emit the buffered reasoning as a single thinking part (no-op when empty). */
  flush(): void {
    if (!this.buffer || !this.progress) {
      return;
    }
    const chunk = this.buffer;
    this.buffer = "";
    emitThinkingPart(this.localRequestId, this.progress, chunk, this.runId);
  }
}

export { ReasoningCoalescer, REASONING_COALESCE_MAX_CHARS };
