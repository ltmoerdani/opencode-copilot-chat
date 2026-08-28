import * as vscode from "vscode";
import { createReasoningMarkerPart } from "../chatParts";
import { parseToolInput, ToolCallAccumulator, type PendingToolCall } from "../toolCallAccumulator";
import { isRecord } from "../utils";
import type { ThinkTagFilter } from "./thinkTags";
import { emitThinkingPart, reportProgressPart, thinkingPartConstructor } from "./streamParts";
import { extractReasoningFromDelta, extractTextFromDelta } from "./extract";

/**
 * Shared state + behavior for the OpenAI- and Anthropic-style stream
 * extractors: text/reasoning accounting, think-tag filtering, live reasoning
 * emission, and the end-of-stream reasoning fallback.
 */
abstract class BaseResponseExtractor {
  protected reasoningContent = "";
  protected emittedTextLength = 0;
  protected emittedToolCallsCount = 0;
  /**
   * Total reasoning characters seen across the entire stream (monotonic).
   * Unlike `reasoningContent` (cleared by tool-call flushes), this counter is
   * used for the [stream-summary] log line so metrics stay accurate.
   */
  protected totalReasoningChars = 0;

  constructor(
    protected readonly onReasoningContent?: (toolCallIds: string[], reasoningContent: string) => void,
    protected readonly onReasoningDebug?: (reasoningContent: string) => void,
    protected readonly thinkFilter?: ThinkTagFilter,
    protected readonly progress?: vscode.Progress<vscode.LanguageModelResponsePart2>,
    protected readonly localRequestId?: string,
    protected readonly output?: vscode.OutputChannel,
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

  /** Split text through the think-tag filter (if active). */
  protected filterText(text: string): { visible: string; thinking: string } {
    if (!text) {
      return { visible: "", thinking: "" };
    }
    if (!this.thinkFilter) {
      return { visible: text, thinking: "" };
    }
    return this.thinkFilter.process(text);
  }

  /**
   * Accumulate reasoning for tool-call replication and — when the thinking
   * part API is available — stream it live to the Copilot Chat UI as
   * `LanguageModelThinkingPart` so `chat.agent.thinkingStyle` applies.
   */
  protected handleReasoning(reasoning: string): string {
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

  /** Emit the shared end-of-stream reasoning fallback. */
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
    // Happy path: ThinkingPart API available AND live streaming happened.
    // Reasoning was already streamed per-chunk via handleReasoning(); the
    // accumulated copy is retained only for tool-call replication.
    if (thinkingPartConstructor && this.progress) {
      this.reasoningContent = "";
      return;
    }
    // ThinkingPart API available but no live stream (progress absent at
    // construction time, e.g. non-standard call paths). Emit now via the
    // flush-time progress sink so the thinking panel still receives it.
    if (thinkingPartConstructor) {
      reportProgressPart(localRequestId, progress, new thinkingPartConstructor(reasoning));
      this.reasoningContent = "";
      return;
    }
    // Legacy fallback (ThinkingPart API unavailable): emit reasoning as plain
    // text only when the response is otherwise empty, to avoid polluting a
    // response that already has visible content.
    if (this.emittedTextLength > 0 || this.emittedToolCallsCount > 0) {
      this.output?.appendLine(
        `[warn] ${String(this.totalReasoningChars)}ch of reasoning dropped: thinking API unavailable and response has visible content`,
      );
      this.reasoningContent = "";
      return;
    }
    this.onReasoningDebug?.(this.reasoningContent);
    reportProgressPart(localRequestId, progress, new vscode.LanguageModelTextPart(reasoning));
    this.emittedTextLength += reasoning.length;
    this.reasoningContent = "";
  }
}

class OpenAiResponseExtractor extends BaseResponseExtractor {
  private readonly toolCallAccumulator = new ToolCallAccumulator();
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
  /** Reasoning emitted as visible text (gateway bug #37635, thinking OFF). */
  private reasoningAsContent = "";

  constructor(
    onReasoningContent?: (toolCallIds: string[], reasoningContent: string) => void,
    onReasoningDebug?: (reasoningContent: string) => void,
    thinkFilter?: ThinkTagFilter,
    progress?: vscode.Progress<vscode.LanguageModelResponsePart2>,
    localRequestId?: string,
    output?: vscode.OutputChannel,
    /**
     * Display seam: whether `reasoning_content` should be emitted as a visible
     * `LanguageModelTextPart` instead of a thinking part.
     *
     * Computed upstream by the thinking provider strategy. Currently always
     * false — reasoning models emit genuine CoT in `reasoning_content`, so it
     * goes to the thinking panel. (The old gateway #37635 mislabel is not
     * worked around.)
     */
    private readonly treatReasoningAsContent = false,
    /**
     * Truncated → original tool name map for the Responses API round-trip.
     * Muse Spark truncates names >64 chars at request build time; the model
     * returns the truncated name, so we reverse-lookup before emitting the
     * `LanguageModelToolCallPart` so VS Code can resolve the original tool.
     * Mirrors `toolNamesById` in `src/request/google.ts`.
     */
    private readonly toolNameMap?: ReadonlyMap<string, string>,
  ) {
    super(onReasoningContent, onReasoningDebug, thinkFilter, progress, localRequestId, output);
  }

  /** Whether the reasoning loop suppression was triggered. */
  get reasoningLoopSuppressed(): boolean {
    return this._reasoningLoopSuppressed;
  }

  /**
   * Emit an internal marker part carrying the reasoning that was surfaced as
   * visible text, so the next turn can echo it back as reasoning_content.
   * Called after the stream completes; the transcript keeps the marker.
   */
  flushReasoningMarker(): vscode.LanguageModelResponsePart2 | undefined {
    if (!this.treatReasoningAsContent || !this.reasoningAsContent) {
      return undefined;
    }
    const part = createReasoningMarkerPart(this.reasoningAsContent);
    this.reasoningAsContent = "";
    return part;
  }

  /**
   * Accumulate reasoning for tool-call replication, and — when the thinking
   * part API is available — stream it live to the Copilot Chat UI.
   *
   * Also detects reasoning loops: if the same 40-char suffix repeats across
   * 6+ consecutive chunks, the model is stuck and further thinking parts are
   * suppressed (accumulation continues for tool-call replication).
   */
  override handleReasoning(reasoning: string): string {
    if (!reasoning) {
      return "";
    }
    this.reasoningContent += reasoning;
    this.totalReasoningChars += reasoning.length;

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
        if (this.reasoningFragmentSuffixes.length >= OpenAiResponseExtractor.REASONING_LOOP_SUFFIX_MATCHES) {
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

    const first: unknown = data.choices[0];
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
        // Dormant display seam: were treatReasoningAsContent true AND
        // delta.content empty, reasoning_content would be emitted as visible
        // text (old gateway #37635 mislabel). Never set today — reasoning is
        // genuine CoT and goes to the thinking panel. Loop guard still applies.
        if (this.treatReasoningAsContent && !visible && text.length === 0) {
          if (!this.shouldSuppressThinkingEmit(reasoning)) {
            this.emittedTextLength += reasoning.length;
            this.reasoningAsContent += reasoning;
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

  override flushReasoningFallback(progress: vscode.Progress<vscode.LanguageModelResponsePart2>, localRequestId?: string): void {
    // Emit a visible warning if a reasoning loop was detected and suppressed
    if (this._reasoningLoopSuppressed && !this.reasoningLoopWarningEmitted) {
      this.reasoningLoopWarningEmitted = true;
      const warning = "[Reasoning loop detected — thinking output suppressed]";
      reportProgressPart(localRequestId, progress, new vscode.LanguageModelTextPart(warning));
      this.emittedTextLength += warning.length;
    }
    super.flushReasoningFallback(progress, localRequestId);
  }

  private collectOpenAiToolCalls(toolCalls: unknown): void {
    this.toolCallAccumulator.collect(toolCalls);
  }

  private flushToolCalls(): vscode.LanguageModelToolCallPart[] {
    const calls = this.toolCallAccumulator.flush();
    const parts = calls.map((call, index) => {
      const resolvedName = this.toolNameMap?.get(call.name) ?? call.name;
      return new vscode.LanguageModelToolCallPart(
        call.id || `opencodego-tool-${String(Date.now())}-${String(index)}`,
        resolvedName,
        call.input,
      );
    });

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
   *
   * SKIPS incomplete calls (#184): when a pending call's arguments are empty
   * or truncated JSON, flushing would emit a `LanguageModelToolCallPart`
   * whose input silently coerced to `{}` — the tool executes with corrupted
   * input even though the engine threw the truncation error. Incomplete calls
   * are dropped here; the engine's truncation error tells the user to resend.
   */
  flushRemainingToolCalls(progress: vscode.Progress<vscode.LanguageModelResponsePart2>, localRequestId?: string): void {
    if (this.toolCallAccumulator.size === 0) {
      return;
    }
    if (!this.toolCallAccumulator.hasCompletePendingCalls()) {
      this.output?.appendLine(
        `[warn] dropping ${String(this.toolCallAccumulator.size)} incomplete tool call(s) from a truncated stream (arguments cut mid-JSON)`,
      );
      this.toolCallAccumulator.flush();
      return;
    }
    const toolParts = this.flushToolCalls();
    this.emittedToolCallsCount += toolParts.length;
    for (const part of toolParts) {
      reportProgressPart(localRequestId, progress, part);
    }
  }
}

class AnthropicResponseExtractor extends BaseResponseExtractor {
  private readonly pendingToolCalls = new Map<number, PendingToolCall>();

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

    // 3. message_delta: contains stop_reason and usage. Usage is already
    //    collected via the onData callback in parseServerSentEvent (which
    //    updates the real RequestUsageSummary); here we only flush tool calls.
    if (eventType === "message_delta" && delta) {
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

  private flushToolCalls(): vscode.LanguageModelToolCallPart[] {
    const toolCalls = Array.from(this.pendingToolCalls.values()).filter((toolCall) => toolCall.name);
    const parts = toolCalls.map(
      (toolCall, index) =>
        new vscode.LanguageModelToolCallPart(
          toolCall.id || `opencodego-tool-${String(Date.now())}-${String(index)}`,
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

export { BaseResponseExtractor, OpenAiResponseExtractor, AnthropicResponseExtractor };
