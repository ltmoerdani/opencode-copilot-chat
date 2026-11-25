/**
 * Detect bounded Beam tool-call loops before another model turn is sent.
 *
 * CONTRACT: pure only — no `vscode` import and no side effects. This is a
 * last-resort harness guard for a model that keeps producing tool calls after
 * many consecutive tool-call turns; it does not try to judge whether an
 * individual tool call is correct.
 */
import { joinedTextContent } from "./responsesRequest";
import type { ApiMessage, OpenAiToolCall } from "./request/types";

/** Number of consecutive Beam tool-call turns tolerated before stopping. */
export const BEAM_TOOL_LOOP_TURN_LIMIT = 8;
const BEAM_REPEATED_TOOL_CALL_TURN_LIMIT = 3;

/** Consecutive identical assistant answers that trigger the Muse guard (#284). */
export const MUSE_REPETITION_TURN_LIMIT = 3;
const MUSE_REPETITION_MIN_CHARS = 40;
const MUSE_REPETITION_SIGNATURE_CHARS = 200;

/** Return a recovery instruction when Beam is stuck in a tool loop. */
export function detectBeamToolLoop(modelId: string, messages: readonly ApiMessage[]): string | undefined {
  if (!/^beam-/i.test(modelId)) return undefined;

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const turns = messages
    .slice(lastUserIndex + 1)
    .filter((message) => message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
  if (turns.length < BEAM_REPEATED_TOOL_CALL_TURN_LIMIT) return undefined;

  const recentSignatures = turns.slice(-BEAM_TOOL_LOOP_TURN_LIMIT).map((message) => toolCallTurnSignature(message.tool_calls ?? []));
  const repeatedSignature = recentSignatures.some(
    (signature, index) => recentSignatures.slice(index + 1).filter((candidate) => candidate === signature).length >= 2,
  );

  // Repeated exact calls are a strong loop signal. A long run of tool-only
  // turns is also guarded because Beam can vary the path/arguments while still
  // wandering without ever producing a final answer.
  if (!repeatedSignature && turns.length < BEAM_TOOL_LOOP_TURN_LIMIT) return undefined;
  return `[Beam tool-call loop detected after ${String(turns.length)} consecutive tool-calling turns. Switching to a tool-free final-answer recovery turn.]`;
}

/**
 * Detect a Muse Spark answer-repetition loop: the same visible assistant text
 * reappears in consecutive turns, typically with tool calls in between (#284).
 *
 * CONTRACT: pure, Muse-only. Short answers are ignored, and only a run of
 * identical normalized signatures at the tail of the current user turn fires.
 * The caller turns the warning into a tool-free recovery turn.
 */
export function detectMuseRepetitionLoop(modelId: string, messages: readonly ApiMessage[]): string | undefined {
  if (!/^muse-/i.test(modelId)) {
    return undefined;
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  const signatures = messages
    .slice(lastUserIndex + 1)
    .filter((message) => message.role === "assistant")
    .map((message) => repetitionSignature(joinedTextContent(message.content)))
    .filter((signature): signature is string => signature !== undefined);
  if (signatures.length < MUSE_REPETITION_TURN_LIMIT) {
    return undefined;
  }

  const tail = signatures.slice(-MUSE_REPETITION_TURN_LIMIT);
  if (tail.every((signature) => signature === tail[0])) {
    return `[Muse repetition loop detected: the same answer text repeated in ${String(tail.length)} consecutive turns. Switching to a tool-free final-answer recovery turn.]`;
  }
  return undefined;
}

function repetitionSignature(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < MUSE_REPETITION_MIN_CHARS) {
    return undefined;
  }
  return normalized.slice(0, MUSE_REPETITION_SIGNATURE_CHARS);
}

function toolCallTurnSignature(toolCalls: readonly OpenAiToolCall[]): string {
  return toolCalls.map((call) => `${call.function.name}:${canonicalArguments(call.function.arguments)}`).join("|");
}

function canonicalArguments(argumentsText: string): string {
  try {
    return JSON.stringify(JSON.parse(argumentsText));
  } catch {
    return argumentsText.trim();
  }
}
