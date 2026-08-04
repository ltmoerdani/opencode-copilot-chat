// ---------------------------------------------------------------------------
// Byte-aware message trimming for the OpenCode Go gateway payload limit.
// ---------------------------------------------------------------------------
// The OpenCode Go API proxy rejects request bodies over ~400 KB with a
// wrapped 4xx/5xx (observed as "Upstream request failed: ... Upstream
// response was not valid JSON"). Long chat sessions plus tool definitions
// can exceed that ceiling even when the model's token context window (e.g.
// 1M tokens on deepseek-v4-flash) is nowhere near full, because the request
// is raw JSON bytes, not tokens.
//
// This module provides `trimApiMessages()`, which prunes older conversation
// turns while preserving:
//   - The system prompt (first message)
//   - The most recent conversation turns (guaranteed minimum context)
//   - Tool-call / tool-result atomicity
// ---------------------------------------------------------------------------

/** Hard uncompressed payload limit enforced by the gateway (bytes). */
export const MAX_PAYLOAD_BYTES = 380_000;

/**
 * Message byte budgets for the trimmer.
 *
 * These budgets control how large the messages portion of the payload is
 * allowed to grow before trimming kicks in. They sit well below
 * `MAX_PAYLOAD_BYTES` to leave headroom for the rest of the request body
 * (model name, tool definitions, temperature, stream flag, etc.), which can
 * add ~80-100 KB on top of the messages.
 */
const MESSAGE_BUDGET_CHAT_COMPLETIONS = 200_000;
const MESSAGE_BUDGET_MESSAGES = 200_000;
const MESSAGE_BUDGET_RESPONSES = 200_000;
const MESSAGE_BUDGET_GOOGLE = 200_000;

/** Map endpoint kind -> byte budget for the messages array (pre-compression). */
export const MESSAGE_BYTE_BUDGET: Record<string, number> = {
  "chat-completions": MESSAGE_BUDGET_CHAT_COMPLETIONS,
  messages: MESSAGE_BUDGET_MESSAGES,
  responses: MESSAGE_BUDGET_RESPONSES,
  google: MESSAGE_BUDGET_GOOGLE,
};

/**
 * Trim `messages` so the JSON-serialized size of the messages array stays
 * within `maxMessageBytes`. Always preserves the first message (system
 * prompt). Keeps the last `MIN_TURNS` conversation turns unconditionally so
 * the model retains recent context, then adds older turns newest-first as
 * long as they fit within the byte budget. Drops whole turns — a turn is
 * everything from a user message up to (but not including) the next user
 * message — which guarantees tool-call / tool-result pairs are never broken.
 *
 * The function is generic: it accepts and returns the caller's own message
 * type `T` as long as it has at least a `role` field.
 *
 * @returns A new array with the same message objects (not cloned). If no
 *          trimming is needed the original array is returned.
 */
export function trimApiMessages<T extends { role?: unknown }>(
  messages: readonly T[],
  maxMessageBytes: number,
): T[] {
  // Fast path — short conversations don't need trimming.
  if (messages.length <= 2) {
    return [...messages];
  }
  const sizes = messages.map((m) => JSON.stringify(m).length);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  if (totalSize <= maxMessageBytes) {
    return [...messages];
  }
  // ------------------------------------------------------------------
  // Find user-message boundaries. The first message is always a user
  // message (the system prompt). Subsequent user messages mark the
  // start of new conversation turns.
  // ------------------------------------------------------------------
  const userIndices = [0]; // system prompt
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "user") {
      userIndices.push(i);
    }
  }
  // ------------------------------------------------------------------
  // Always keep the system prompt.
  // ------------------------------------------------------------------
  const keep = new Set<number>([0]);
  let usedBytes = sizes[0];
  // ------------------------------------------------------------------
  // Phase 1 — Guaranteed minimum context.
  // Always keep the last MIN_TURNS conversation turns, even if they
  // exceed the byte budget. This ensures the model always has enough
  // recent context to give coherent answers.
  // ------------------------------------------------------------------
  const MIN_TURNS = 2;
  const totalTurns = userIndices.length - 1; // excluding system prompt
  const guaranteedTurns = Math.min(MIN_TURNS, totalTurns);
  for (let ui = userIndices.length - 1; ui >= userIndices.length - guaranteedTurns; ui--) {
    const turnStart = userIndices[ui];
    const turnEnd = ui + 1 < userIndices.length ? userIndices[ui + 1] : messages.length;
    let turnSize = 0;
    for (let i = turnStart; i < turnEnd; i++) {
      turnSize += sizes[i];
    }
    for (let i = turnStart; i < turnEnd; i++) {
      keep.add(i);
    }
    usedBytes += turnSize;
  }
  // ------------------------------------------------------------------
  // Phase 2 — Fill remaining budget with older turns (newest first).
  // Walk backwards from the oldest guaranteed turn, adding additional
  // turns as long as they fit within the byte budget.
  // ------------------------------------------------------------------
  const startUi = userIndices.length - 1 - guaranteedTurns;
  for (let ui = startUi; ui >= 1; ui--) {
    const turnStart = userIndices[ui];
    const turnEnd = ui + 1 < userIndices.length ? userIndices[ui + 1] : messages.length;
    let turnSize = 0;
    for (let i = turnStart; i < turnEnd; i++) {
      turnSize += sizes[i];
    }
    if (usedBytes + turnSize <= maxMessageBytes) {
      for (let i = turnStart; i < turnEnd; i++) {
        keep.add(i);
      }
      usedBytes += turnSize;
    } else {
      // This turn doesn't fit — and all older turns are even less
      // recent, so they don't fit either.
      break;
    }
  }
  // ------------------------------------------------------------------
  // Reconstruct in original order.
  // ------------------------------------------------------------------
  const kept: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (keep.has(i)) {
      kept.push(messages[i]);
    }
  }
  return kept;
}
