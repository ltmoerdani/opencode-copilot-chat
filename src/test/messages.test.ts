import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { historyByteCapForBudget, trimOldMessagesToFitContext } from "../provider/historyTrim.js";
import { HISTORY_BYTES_PER_TOKEN, HISTORY_TRIM_HEADROOM_MIN_TOKENS, MAX_REQUEST_PAYLOAD_BYTES } from "../config.js";
import type { ApiMessage } from "../request/types.js";

function textMessage(role: ApiMessage["role"], text: string): ApiMessage {
  return { role, content: text };
}

/** Effectively disables the byte-cap constraint so a test can focus on tokens. */
const NO_BYTE_CAP = Number.MAX_SAFE_INTEGER;

describe("trimOldMessagesToFitContext", () => {
  it("removes nothing when the history already fits the budget", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "system context"),
      textMessage("user", "hello"),
      textMessage("assistant", "hi there"),
    ];
    const result = trimOldMessagesToFitContext(messages, 10_000, NO_BYTE_CAP);
    assert.equal(result.removed, 0);
    assert.equal(messages.length, 3);
  });

  it("drops oldest messages until the payload fits, keeping anchor + last", () => {
    const messages: ApiMessage[] = [];
    messages.push(textMessage("user", "anchor system prompt that is fairly long to count as context"));
    for (let i = 0; i < 12; i++) {
      messages.push(textMessage("user", `repeated turn number ${i} with some padding text to grow the token estimate`));
      messages.push(textMessage("assistant", `response for turn ${i} with padding text to grow the token estimate`));
    }
    messages.push(textMessage("user", "latest prompt that must be preserved at all costs"));
    const before = messages.length;
    const result = trimOldMessagesToFitContext(messages, 200, NO_BYTE_CAP);
    assert.ok(result.removed > 0, "should have trimmed");
    assert.equal(messages.length, before - result.removed);
    // anchor (index 0) and last (current prompt) preserved
    assert.equal(messages[0].content, "anchor system prompt that is fairly long to count as context");
    assert.equal(messages[messages.length - 1].content, "latest prompt that must be preserved at all costs");
  });

  it("drops a complete tool-call group as one unit (never orphans a reference)", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "anchor"),
      textMessage("user", "old turn A padding padding padding padding padding padding padding"),
      textMessage("user", "old turn B padding padding padding padding padding padding padding"),
      {
        role: "assistant",
        content: "let me call a tool",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "fs", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "tool result text" },
      textMessage("user", "current prompt"),
    ];
    const result = trimOldMessagesToFitContext(messages, 50, NO_BYTE_CAP);
    // The whole tool group (assistant + its tool result) is dropped together,
    // so no tool reference is orphaned.
    assert.ok(result.removed >= 0);
    const hasToolCall = messages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
    const hasToolResult = messages.some((m) => m.role === "tool");
    assert.equal(hasToolCall, hasToolResult, "tool group must stay intact (both present or both gone)");
  });

  it("does not trim when only anchor + last remain", () => {
    const messages: ApiMessage[] = [textMessage("user", "anchor"), textMessage("user", "only prompt")];
    const result = trimOldMessagesToFitContext(messages, 1, NO_BYTE_CAP);
    assert.equal(result.removed, 0);
    assert.equal(messages.length, 2);
  });

  it("enforces a hard byte cap even when the token budget is generous", () => {
    const messages: ApiMessage[] = [];
    messages.push(textMessage("user", "anchor system prompt that is fairly long to count as context"));
    for (let i = 0; i < 20; i++) {
      messages.push(textMessage("user", `repeated turn number ${i} with some padding text to grow the payload size substantially`));
      messages.push(textMessage("assistant", `response for turn ${i} with padding text to grow the payload size substantially`));
    }
    messages.push(textMessage("user", "latest prompt that must be preserved at all costs"));
    const before = messages.length;
    // Token budget is huge, but the byte cap is tiny → must still trim.
    const result = trimOldMessagesToFitContext(messages, 10_000_000, 400);
    assert.ok(result.removed > 0, "byte cap should have trimmed");
    assert.equal(messages.length, before - result.removed);
    assert.equal(messages[0].content, "anchor system prompt that is fairly long to count as context");
    assert.equal(messages[messages.length - 1].content, "latest prompt that must be preserved at all costs");
    // The actual wire payload (no tools in this test) must be under the cap.
    assert.ok(JSON.stringify({ messages }).length <= 400, "payload must be under the byte cap");
  });

  it("returns the final token and byte estimates", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "anchor"),
      textMessage("user", "old turn padding padding padding padding padding padding padding padding padding padding"),
      textMessage("user", "current prompt"),
    ];
    const result = trimOldMessagesToFitContext(messages, 10, NO_BYTE_CAP);
    assert.ok(result.finalTokens > 0);
    assert.ok(result.finalBytes > 0);
    assert.equal(result.removed, 1);
  });

  it("never drops the anchor or the current prompt turn", () => {
    const messages: ApiMessage[] = [];
    messages.push(textMessage("user", "ANCHOR-CONTEXT"));
    for (let i = 0; i < 30; i++) {
      messages.push(textMessage("user", `middle turn ${i} padding padding padding padding padding padding padding padding`));
    }
    messages.push(textMessage("user", "CURRENT-PROMPT"));
    const result = trimOldMessagesToFitContext(messages, 5, 200);
    assert.equal(messages[0].content, "ANCHOR-CONTEXT");
    assert.equal(messages[messages.length - 1].content, "CURRENT-PROMPT");
    assert.ok(result.removed > 0);
  });
});

describe("historyByteCapForBudget", () => {
  it("returns the 512KB floor for small budgets", () => {
    assert.equal(historyByteCapForBudget(10_000), MAX_REQUEST_PAYLOAD_BYTES);
    assert.equal(historyByteCapForBudget(50_000), MAX_REQUEST_PAYLOAD_BYTES);
    // 100K tokens * 4.5 = 450KB < 512KB → still floor
    assert.equal(historyByteCapForBudget(100_000), MAX_REQUEST_PAYLOAD_BYTES);
  });

  it("scales linearly above the floor", () => {
    // 200K tokens * 4.5 = 900KB > 512KB → scaled
    assert.equal(historyByteCapForBudget(200_000), Math.floor(200_000 * HISTORY_BYTES_PER_TOKEN));
    assert.equal(historyByteCapForBudget(734_003), Math.floor(734_003 * HISTORY_BYTES_PER_TOKEN));
  });

  it("allows a 1M window to reach ~70% without byte-cap clamping", () => {
    // 1M window → inputBudget ≈ 734K (70% ratio), byte cap ≈ 3.3MB
    const inputBudget = Math.floor(1_048_576 * 0.7);
    const byteCap = historyByteCapForBudget(inputBudget);
    assert.ok(byteCap > 3_000_000, `1M window byte cap should exceed 3MB, got ${byteCap}`);
    // Token budget remains the limiter: byte cap in token-equivalents >> inputBudget
    assert.ok(byteCap / HISTORY_BYTES_PER_TOKEN > inputBudget * 0.95);
  });

  it("keeps the byte cap looser than the token budget across all window sizes", () => {
    for (const window of [128_000, 200_000, 262_144, 512_000, 1_048_576, 1_050_000]) {
      const inputBudget = Math.floor(window * 0.7);
      const byteCap = historyByteCapForBudget(inputBudget);
      // Byte cap expressed in tokens must cover the token budget (allow 1-token floor rounding).
      const byteCapTokens = byteCap / HISTORY_BYTES_PER_TOKEN;
      assert.ok(byteCapTokens + 1 >= inputBudget, `window ${window}: byte cap ${byteCap} too tight for budget ${inputBudget}`);
    }
  });
});

describe("trimOldMessagesToFitContext — image data excluded from byte cap (#173)", () => {
  const IMAGE_PLACEHOLDER_LEN = "[image]".length;
  /** ~1MB base64-ish image payload — far above MAX_REQUEST_PAYLOAD_BYTES. */
  function imageMessage(role: ApiMessage["role"], dataLength: number): ApiMessage {
    return { role, content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(dataLength)}` } }] };
  }

  it("does not trim text history just because images push the raw payload over the byte cap", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "anchor system prompt that is fairly long to count as context"),
      imageMessage("user", 600_000),
      textMessage("assistant", "short reply"),
      textMessage("user", "current prompt"),
    ];
    // Raw wire bytes are way above 512KB, but almost all of it is image data.
    assert.ok(JSON.stringify({ messages }).length > 512_000);
    const result = trimOldMessagesToFitContext(messages, 10_000_000, 512 * 1024);
    assert.equal(result.removed, 0, "text history must survive");
    assert.equal(messages.length, 4);
  });

  it("still trims when the TEXT portion alone exceeds the byte cap", () => {
    const messages: ApiMessage[] = [];
    messages.push(textMessage("user", "anchor system prompt that is fairly long to count as context"));
    for (let i = 0; i < 20; i++) {
      messages.push(textMessage("user", `repeated turn ${i} with plenty of padding to grow the text payload size substantially`));
      messages.push(textMessage("assistant", `response for turn ${i} with plenty of padding to grow the text payload size substantially`));
    }
    messages.push(imageMessage("user", 300_000));
    messages.push(textMessage("user", "latest prompt that must be preserved at all costs"));
    const before = messages.length;
    const result = trimOldMessagesToFitContext(messages, 10_000_000, 400);
    assert.ok(result.removed > 0, "oversized text history must still be trimmed");
    assert.equal(messages.length, before - result.removed);
    assert.equal(messages[0].content, "anchor system prompt that is fairly long to count as context");
    assert.equal(messages[messages.length - 1].content, "latest prompt that must be preserved at all costs");
  });

  it("counts hosted image URLs fully — only data: URLs are stripped", () => {
    const url = "https://example.com/i.png";
    const messages: ApiMessage[] = [
      textMessage("user", "anchor"),
      { role: "user", content: [{ type: "image_url", image_url: { url } }] },
      textMessage("user", "current prompt"),
    ];
    const result = trimOldMessagesToFitContext(messages, 10_000_000, 512 * 1024);
    assert.equal(result.removed, 0);
    // The hosted URL is plain text of trivial size: its full serialized length
    // must appear in finalBytes (not collapsed to the [image] placeholder).
    assert.ok(result.finalBytes >= JSON.stringify({ messages }).length);
    assert.ok(result.finalBytes > url.length + IMAGE_PLACEHOLDER_LEN);
  });

  it("strips every data: URL regardless of size", () => {
    const messages: ApiMessage[] = [
      textMessage("user", "anchor"),
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,iVBOR" } }] },
      textMessage("user", "current prompt"),
    ];
    const result = trimOldMessagesToFitContext(messages, 10_000_000, 512 * 1024);
    assert.equal(result.removed, 0);
    // The tiny data URL was replaced by the placeholder in the measurement.
    assert.ok(result.finalBytes < JSON.stringify({ messages }).length);
  });
});

describe("trimOldMessagesToFitContext — cache-stable headroom", () => {
  /**
   * Budget used across these tests: 100K tokens. The headroom resolves to
   * HISTORY_TRIM_HEADROOM_MIN_TOKENS (8,192): 3% of the budget (3,000) is
   * below the floor, and the floor stays under 10% of the budget — so the
   * low-water mark is 100,000 − 8,192 = 91,808 tokens.
   */
  const BUDGET = 100_000;
  const LOW_WATER = BUDGET - HISTORY_TRIM_HEADROOM_MIN_TOKENS;

  function padded(role: ApiMessage["role"], text: string, padChars: number): ApiMessage {
    return { role, content: `${text} ${"p".repeat(padChars)}` };
  }

  /** ~133K-token history (units of ~1.1K tokens) so a trim must drop many units. */
  function overBudgetHistory(): ApiMessage[] {
    const messages: ApiMessage[] = [padded("user", "ANCHOR", 200)];
    for (let i = 0; i < 120; i++) {
      messages.push(padded("user", `turn ${i}`, 4_000));
    }
    messages.push(padded("user", "CURRENT", 200));
    return messages;
  }

  it("drops below the low-water mark so the next turn does not re-trim", () => {
    const messages = overBudgetHistory();
    const result = trimOldMessagesToFitContext(messages, BUDGET, NO_BYTE_CAP);
    assert.ok(result.removed > 0, "expected a trim");
    assert.ok(
      result.finalTokens <= LOW_WATER,
      `expected finalTokens <= ${String(LOW_WATER)} (budget - headroom), got ${String(result.finalTokens)}`,
    );
    assert.ok((messages[0].content as string).startsWith("ANCHOR"));
    assert.ok((messages[messages.length - 1].content as string).startsWith("CURRENT"));
  });

  it("keeps the cut stable across following turns (no re-trim → warm prefix cache)", () => {
    const messages = overBudgetHistory();
    const first = trimOldMessagesToFitContext(messages, BUDGET, NO_BYTE_CAP);
    assert.ok(first.removed > 0, "expected the initial trim");
    const cut = messages[1].content;
    // Five small follow-up turns, together well below the 8K-token headroom.
    for (let turn = 0; turn < 5; turn++) {
      messages.push(padded("assistant", `reply ${String(turn)}`, 100));
      messages.push(padded("user", `follow-up ${String(turn)}`, 100));
      const result = trimOldMessagesToFitContext(messages, BUDGET, NO_BYTE_CAP);
      assert.equal(result.removed, 0, `turn ${String(turn)} must not move the cut point`);
      assert.equal(messages[1].content, cut, "cut point must stay put");
    }
  });

  it("holds the cut when the full history is re-supplied each turn (production shape)", () => {
    // Mirrors the live production trace (2026-09-20): VS Code re-supplies the
    // *full* history every turn, so the trimmer keeps running — but with the
    // headroom the drop count, and therefore the cut, stays constant. The sent
    // payload remains a nested prefix of the previous one, which is what keeps
    // the provider prefix cache warm through those re-trims. Uneven unit sizes
    // mirror production tool results (every fifth turn is ~6x larger).
    const full: ApiMessage[] = [padded("user", "ANCHOR", 300)];
    for (let i = 0; i < 100; i++) {
      full.push(padded("user", `turn ${String(i)}`, i % 5 === 4 ? 12_000 : 2_000));
    }
    full.push(padded("user", "CURRENT", 2_000));

    // Turn 1: the re-supplied full history is over budget and gets trimmed.
    const sent1 = [...full];
    const r1 = trimOldMessagesToFitContext(sent1, BUDGET, NO_BYTE_CAP);
    assert.ok(r1.removed > 0, "the full history must be over budget");
    assert.ok(r1.finalTokens <= LOW_WATER, "landing must sit below the low-water mark");

    // Turns 2-3: a fresh copy of the full history plus one follow-up exchange
    // (~680 tokens) each — all within the remaining headroom.
    let prior = sent1;
    for (let turn = 0; turn < 2; turn++) {
      full.push(padded("assistant", `reply ${String(turn)}`, 1_200));
      full.push(padded("user", `follow-up ${String(turn)}`, 1_200));
      const sent = [...full];
      const result = trimOldMessagesToFitContext(sent, BUDGET, NO_BYTE_CAP);
      assert.equal(result.removed, r1.removed, `turn ${String(turn)} must not move the cut`);
      assert.deepEqual(sent.slice(0, prior.length), prior, `turn ${String(turn)} payload must stay a nested prefix`);
      prior = sent;
    }
  });

  it("holds the cut across a normal follow-up turn via the cut-step grid", () => {
    // The low-water crossing alone lands within one *unit* of the mark, so in
    // sessions whose units are small relative to per-turn growth the cut still
    // moved on nearly every turn (live trace 2026-09-20 evening: a 12.4% miss
    // every 1-3 requests). The cut-step pass adds up to one
    // HISTORY_TRIM_CUT_STEP_TOKENS of slack (10K at this 100K budget), which
    // absorbs a ~1.1K-token follow-up turn — this exact scenario moves the cut
    // without the step pass (verified against the pre-step build).
    const full: ApiMessage[] = [padded("user", "ANCHOR", 200)];
    for (let i = 0; i < 150; i++) {
      full.push(padded("user", `turn ${String(i)}`, 4_000));
    }
    full.push(padded("user", "CURRENT", 200));

    const sent1 = [...full];
    const r1 = trimOldMessagesToFitContext(sent1, BUDGET, NO_BYTE_CAP);
    assert.ok(r1.removed > 0, "the full history must be over budget");

    // One follow-up turn (~1.1K tokens) — far below one cut step (10K here).
    full.push(padded("assistant", "reply", 2_000));
    full.push(padded("user", "follow-up", 2_000));
    const sent2 = [...full];
    const r2 = trimOldMessagesToFitContext(sent2, BUDGET, NO_BYTE_CAP);
    assert.equal(r2.removed, r1.removed, "the cut must not move on a normal follow-up turn");
    assert.deepEqual(sent2.slice(0, sent1.length), sent1, "payload must stay a nested prefix");
  });
});
