/**
 * Pure tool-call accumulation for OpenAI-style streaming responses.
 *
 * This module is intentionally free of any `vscode` import so it can be
 * unit-tested in plain Node (see AGENTS.md and the `src/thinking.ts`
 * convention). `OpenAiResponseExtractor` in `streaming.ts` delegates its
 * tool-call collection and flush decisions here and maps the results onto
 * VS Code `LanguageModelToolCallPart`s.
 */

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface FlushedToolCall {
  id: string;
  name: string;
  input: object;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parse a streamed tool-call arguments string into an object. */
export function parseToolInput(value: string): object {
  if (!value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Accumulates tool-call deltas streamed in OpenAI chat-completions format
 * (`choices[0].delta.tool_calls`) across many SSE chunks, keyed by `index`.
 *
 * Tool calls arrive fragmented: the first chunk carries `id`/`name` and an
 * empty `arguments` string, subsequent chunks append `arguments` fragments,
 * and the final chunk reports `finish_reason: "tool_calls"`. Flushing must
 * therefore happen only when the batch is complete — either on the
 * `"tool_calls"` finish reason, or once at end-of-stream for gateways that
 * omit it (see issue #93 / #98).
 */
export class ToolCallAccumulator {
  private readonly pending = new Map<number, PendingToolCall>();

  /** Number of tool calls currently accumulated (not yet flushed). */
  get size(): number {
    return this.pending.size;
  }

  /** Accumulate a batch of tool-call deltas from one stream chunk. */
  collect(toolCalls: unknown): void {
    if (!Array.isArray(toolCalls)) {
      return;
    }

    for (const toolCall of toolCalls) {
      if (!isRecord(toolCall)) {
        continue;
      }

      const index = typeof toolCall.index === "number" ? toolCall.index : this.pending.size;
      const pending = this.pending.get(index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      if (typeof toolCall.id === "string") {
        pending.id = toolCall.id;
      }

      const fn = toolCall.function;
      if (isRecord(fn)) {
        if (typeof fn.name === "string") {
          pending.name += fn.name;
        }
        if (typeof fn.arguments === "string") {
          pending.arguments += fn.arguments;
        }
      }

      this.pending.set(index, pending);
    }
  }

  /**
   * Whether an event whose `finish_reason` is `finishReason` marks the end
   * of a complete tool-call batch that should be flushed now.
   *
   * Only the OpenAI `"tool_calls"` finish reason is a reliable signal.
   * Intermediate chunks always carry `finish_reason: null`, so they must NOT
   * trigger a flush — flushing there emits an incomplete tool call with empty
   * arguments (rendered by VS Code as `<invoke>` without `<parameter>`).
   * Gateways that omit `finish_reason` entirely are handled by
   * `flushRemainingToolCalls()` at end-of-stream.
   */
  static shouldFlushOnFinishReason(finishReason: unknown): boolean {
    return finishReason === "tool_calls";
  }

  /**
   * Flush accumulated tool calls, returning them as complete calls.
   * Deltas that never supplied a `name` (arguments-only fragments) are
   * dropped.
   */
  flush(): FlushedToolCall[] {
    const calls = Array.from(this.pending.values())
      .filter((call) => call.name)
      .map((call) => ({
        id: call.id,
        name: call.name,
        input: parseToolInput(call.arguments),
      }));
    this.pending.clear();
    return calls;
  }

  /**
   * Flush any remaining accumulated tool calls at end-of-stream. Used for
   * gateways that omit the final `finish_reason: "tool_calls"` event. Safe
   * no-op when nothing is pending.
   */
  flushRemainingToolCalls(): FlushedToolCall[] {
    if (this.pending.size === 0) {
      return [];
    }
    return this.flush();
  }
}
