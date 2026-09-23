import type * as vscode from "vscode";
import {
  HISTORY_BYTES_PER_TOKEN,
  HISTORY_TRIM_CUT_STEP_TOKENS,
  HISTORY_TRIM_HEADROOM_MAX_TOKENS,
  HISTORY_TRIM_HEADROOM_MIN_TOKENS,
  HISTORY_TRIM_HEADROOM_RATIO,
  MAX_REQUEST_PAYLOAD_BYTES,
} from "../config";
import type { ApiMessage, OpenAiContentPart } from "../request/types";
import { estimatePromptTokenCount, estimateTokenCount } from "../tokenEstimate";

/**
 * Result of trimming old conversation messages to fit the request budget.
 */
export interface HistoryTrimResult {
  /** Number of messages removed from the array (for diagnostics). */
  removed: number;
  /** Estimated prompt tokens after trimming (includes tools). */
  finalTokens: number;
  /** Approximate serialized payload bytes after trimming (includes tools). */
  finalBytes: number;
}

/**
 * Trim the oldest conversation messages so the request payload fits BOTH the
 * model's input context window (token budget) AND a hard byte ceiling.
 *
 * Long multi-turn conversations (or many repeated turns without running Compact
 * Conversation) can grow past the model's context limit. The upstream then
 * rejects the oversized request (HTTP 400/503) or returns an empty stream,
 * which VS Code surfaces as "No response came" / "Sorry, no response was
 * returned", and a huge payload also makes the upstream hang (10-minute
 * request timeout) and slows the extension session down. This bounds the
 * history the same way image trimming bounds image weight.
 *
 * CONTRACT:
 *   - Never drops the first message (system/anchor context) or the last message
 *     (the current prompt turn).
 *   - Never splits a tool-call group: an assistant message carrying `tool_calls`
 *     and its following `tool` results are kept (or dropped) together as one
 *     unit, so trimming never orphans a tool reference. A group is only dropped
 *     when every one of its tool results is contained in the group range.
 *   - Mutates the input array in place (safe: the caller does not reuse it).
 *   - Runs in O(n): the full history is estimated once, then each dropped unit's
 *     size is subtracted incrementally (no per-candidate re-stringification of
 *     the whole array), so it stays fast even for very long histories.
 *   - Base64 image data is EXCLUDED from the byte ceiling (issue #173): image
 *     weight is already bounded by the image-history trimmer, and counting it
 *     made vision payloads trigger futile text-history drops.
 *   - Cache-stable cut (low-water hysteresis + cut steps): when a trim is
 *     unavoidable the oldest droppable units are dropped past the minimal fit
 *     down to the low-water mark (`budget − headroom`, see
 *     `HISTORY_TRIM_HEADROOM_*`), then on to the next step boundary of dropped
 *     payload (`HISTORY_TRIM_CUT_STEP_TOKENS`). The step is what keeps the cut
 *     still: the crossing alone lands within one unit of the mark, so the
 *     slack for the following turns would be bounded by a single unit's size —
 *     live sessions with ~2.7K-token units advanced the cut every 1-3 requests
 *     (~12.4% cache hits), while a step alignment holds it for roughly
 *     `step / per-turn growth` turns. Bounded by the droppable units; overshoot
 *     is at most one unit past the step target.
 *
 * @param messages ApiMessage[] (chronological, oldest first). Mutated in place.
 * @param budgetTokens Maximum input tokens the trimmed history may occupy.
 * @param maxBytes Hard ceiling on the serialized payload size in bytes.
 * @param tools Tools passed to the request (included in the size estimate).
 * @returns Trim result (removed count + final token/byte estimates).
 */
export function trimOldMessagesToFitContext(
  messages: ApiMessage[],
  budgetTokens: number,
  maxBytes: number,
  tools?: readonly vscode.LanguageModelChatTool[],
): HistoryTrimResult {
  const lastIndex = messages.length - 1;
  // Need at least the anchor (index 0) and the current prompt (last index).
  if (lastIndex < 2) {
    return noTrim(messages, tools);
  }

  const fullTokens = estimatePromptTokenCount(messages, tools);
  const fullBytes = payloadBytes(messages, tools);
  if (fullTokens <= budgetTokens && fullBytes <= maxBytes) {
    return { removed: 0, finalTokens: fullTokens, finalBytes: fullBytes };
  }

  // Group messages into drop units. A tool-call group (assistant tool_calls +
  // its immediately-following tool results) is a single unit so it is never
  // split. units[0] is the anchor (kept); units[last] is the current prompt
  // (kept).
  const units = buildDropUnits(messages);
  if (units.length < 3) {
    return noTrim(messages, tools);
  }

  // Per-unit size estimates. The running remainder keeps the JSON structure
  // overhead, so the estimate is slightly pessimistic — we never under-trim.
  const unitTokens = units.map((u) => sumUnit(messages, u, (m) => estimateTokenCount(JSON.stringify(m))));
  const unitBytes = units.map((u) => sumUnit(messages, u, messageBytes));

  // Low-water mark for the cache-stable cut (see HISTORY_TRIM_HEADROOM_RATIO).
  // The floor never dominates a small budget (≤10% of it), and the byte mark
  // mirrors the token mark via the same ratio so both ceilings leave slack.
  const headroomFloorTokens = Math.min(HISTORY_TRIM_HEADROOM_MIN_TOKENS, Math.floor(budgetTokens * 0.1));
  const headroomTokens = Math.max(
    headroomFloorTokens,
    Math.min(HISTORY_TRIM_HEADROOM_MAX_TOKENS, Math.floor(budgetTokens * HISTORY_TRIM_HEADROOM_RATIO)),
  );
  const lowWaterTokens = Math.max(1, budgetTokens - headroomTokens);
  const headroomBytes = Math.min(Math.floor(headroomTokens * HISTORY_BYTES_PER_TOKEN), Math.floor(maxBytes * HISTORY_TRIM_HEADROOM_RATIO));
  const lowWaterBytes = Math.max(1, maxBytes - headroomBytes);

  let remainingTokens = fullTokens;
  let remainingBytes = fullBytes;
  // Drop units[1..dropUpToUnit] (inclusive) — the oldest droppable turns.
  let dropUpToUnit = 0;

  for (let u = 1; u < units.length - 1; u++) {
    const afterTokens = remainingTokens - unitTokens[u];
    const afterBytes = remainingBytes - unitBytes[u];
    const fits = afterTokens <= budgetTokens && afterBytes <= maxBytes;
    if (fits) {
      dropUpToUnit = u;
      remainingTokens = afterTokens;
      remainingBytes = afterBytes;
      break;
    }
    // Dropping a tool group whose results spill outside the unit would orphan a
    // tool reference — stop before it rather than risk a 400.
    if (isUnsafeToolGroup(messages, units[u])) {
      break;
    }
    remainingTokens = afterTokens;
    remainingBytes = afterBytes;
    dropUpToUnit = u;
  }

  if (dropUpToUnit >= 1) {
    // Low-water pass: keep dropping (same unit granularity and safety rules)
    // while the payload is above the low-water mark, so the cut stays put for
    // the turns that follow. A minimal fit leaves ~zero slack; the next turn
    // would move the cut and cold-cache the provider prefix. Bounded by the
    // droppable units — overshoot is at most one unit.
    for (let u = dropUpToUnit + 1; u < units.length - 1; u++) {
      if (remainingTokens <= lowWaterTokens && remainingBytes <= lowWaterBytes) {
        break;
      }
      if (isUnsafeToolGroup(messages, units[u])) {
        break;
      }
      remainingTokens -= unitTokens[u];
      remainingBytes -= unitBytes[u];
      dropUpToUnit = u;
    }
    // Cut-step pass (see HISTORY_TRIM_CUT_STEP_TOKENS): the low-water crossing
    // above still hugs the mark within one unit, so once per-turn growth nears
    // one unit's size the cut would advance on nearly every turn. Advancing it
    // to the next step boundary of *dropped* payload leaves up to one step of
    // slack, so the following turns' growth fits without moving the cut.
    const cutStepTokens = Math.max(1, Math.min(HISTORY_TRIM_CUT_STEP_TOKENS, Math.floor(budgetTokens * 0.1)));
    const cutStepBytes = Math.max(1, Math.min(Math.floor(cutStepTokens * HISTORY_BYTES_PER_TOKEN), Math.floor(maxBytes * 0.1)));
    const stepTargetTokens = Math.ceil((fullTokens - remainingTokens) / cutStepTokens) * cutStepTokens;
    const stepTargetBytes = Math.ceil((fullBytes - remainingBytes) / cutStepBytes) * cutStepBytes;
    for (let u = dropUpToUnit + 1; u < units.length - 1; u++) {
      if (fullTokens - remainingTokens >= stepTargetTokens && fullBytes - remainingBytes >= stepTargetBytes) {
        break;
      }
      if (isUnsafeToolGroup(messages, units[u])) {
        break;
      }
      remainingTokens -= unitTokens[u];
      remainingBytes -= unitBytes[u];
      dropUpToUnit = u;
    }
    const dropStart = units[1].start;
    const dropEnd = units[dropUpToUnit].end;
    const removed = dropEnd - dropStart + 1;
    messages.splice(dropStart, removed);
    return { removed, finalTokens: remainingTokens, finalBytes: remainingBytes };
  }
  return noTrim(messages, tools);
}

function noTrim(messages: ApiMessage[], tools?: readonly vscode.LanguageModelChatTool[]): HistoryTrimResult {
  return {
    removed: 0,
    finalTokens: estimatePromptTokenCount(messages, tools),
    finalBytes: payloadBytes(messages, tools),
  };
}

/** Placeholder substituted for base64 image data when measuring byte weight. */
const IMAGE_DATA_PLACEHOLDER = "[image]";
/**
 * Serialized size of one message, excluding base64 image payloads (#173).
 *
 * The gateway accepts multi-megabyte bodies (#44), so a vision payload can
 * legitimately sit above `MAX_REQUEST_PAYLOAD_BYTES` purely from the images
 * that survived image trimming (`MAX_HISTORY_IMAGES_KEPT`). Counting those
 * bytes made the trimmer drop the whole text history for nothing — and still
 * fail, since the images remained. Image weight is already bounded by the
 * image trimmer; the byte ceiling exists to bound *text* growth, so image
 * data is excluded here while the JSON structure overhead stays counted
 * (slightly pessimistic — we never under-trim).
 */
function messageBytes(m: ApiMessage): number {
  return JSON.stringify(stripImageData(m)).length;
}

function payloadBytes(messages: ApiMessage[], tools?: readonly vscode.LanguageModelChatTool[]): number {
  return JSON.stringify({ messages: messages.map(stripImageData), ...(tools?.length ? { tools } : {}) }).length;
}

/**
 * Shallow clone of `m` with base64 data-URL image payloads replaced by a short
 * placeholder. Only `data:` URLs are stripped — a hosted `https://` image URL
 * is plain text of trivial size and never carries the payload weight that
 * caused #173, so it stays counted as-is. Returns `m` itself when there is
 * nothing to strip (the common case).
 */
function stripImageData(m: ApiMessage): ApiMessage {
  if (!Array.isArray(m.content)) {
    return m;
  }
  // Copy-on-write: only clone the array when an oversized data URL is found.
  let stripped: OpenAiContentPart[] | undefined;
  for (let i = 0; i < m.content.length; i++) {
    const part = m.content[i];
    const url = part.type === "image_url" ? part.image_url?.url : undefined;
    if (typeof url === "string" && url.startsWith("data:")) {
      stripped ??= [...m.content];
      stripped[i] = { ...part, image_url: { url: IMAGE_DATA_PLACEHOLDER } };
    }
  }
  return stripped ? { ...m, content: stripped } : m;
}

function sumUnit(messages: ApiMessage[], unit: DropUnit, measure: (m: ApiMessage) => number): number {
  let total = 0;
  for (let i = unit.start; i <= unit.end; i++) {
    total += measure(messages[i]);
  }
  return total;
}

interface DropUnit {
  /** Inclusive start index in `messages`. */
  start: number;
  /** Inclusive end index in `messages`. */
  end: number;
}

/**
 * Group messages into drop units. A tool-call group — an assistant message with
 * `tool_calls` followed by its `tool` results — becomes a single unit so it is
 * dropped (or kept) whole. All other messages are their own unit.
 */
function buildDropUnits(messages: ApiMessage[]): DropUnit[] {
  const units: DropUnit[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const toolCalls = msg.tool_calls;
    const isToolGroupHead = msg.role === "assistant" && Array.isArray(toolCalls) && toolCalls.length > 0;
    if (isToolGroupHead) {
      const callIds = new Set(toolCalls.map((tc) => tc.id));
      let end = i;
      let j = i + 1;
      // Include immediately-following tool results that belong to this call.
      while (j < messages.length && messages[j].role === "tool" && callIds.has(messages[j].tool_call_id ?? "")) {
        end = j;
        j++;
      }
      units.push({ start: i, end });
      i = j;
    } else {
      units.push({ start: i, end: i });
      i++;
    }
  }
  return units;
}

/**
 * A tool group is unsafe to drop if any of its tool results lives outside the
 * unit range — dropping the unit would orphan that reference and 400 the request.
 */
function isUnsafeToolGroup(messages: ApiMessage[], unit: DropUnit): boolean {
  const head = messages[unit.start];
  const headToolCalls = head.tool_calls;
  if (!(head.role === "assistant" && Array.isArray(headToolCalls) && headToolCalls.length > 0)) {
    return false;
  }
  const callIds = new Set(headToolCalls.map((tc) => tc.id));
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "tool" && callIds.has(m.tool_call_id ?? "") && (i < unit.start || i > unit.end)) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the effective byte cap for history trimming. Scales with the token
 * budget so 1M windows aren't clamped to ~13% (512KB ≈ 128K tokens), while
 * small windows keep the 512KB floor that prevents 503s on large payloads.
 */
export function historyByteCapForBudget(inputBudgetTokens: number): number {
  return Math.max(MAX_REQUEST_PAYLOAD_BYTES, Math.floor(inputBudgetTokens * HISTORY_BYTES_PER_TOKEN));
}
