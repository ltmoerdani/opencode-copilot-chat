import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PAYLOAD_BYTES,
  MESSAGE_BYTE_BUDGET,
  trimApiMessages,
} from "../messageTrimmer.js";

/**
 * Unit tests for the byte-aware payload trimmer (issue #104).
 *
 * CONTEXT / ROOT CAUSE:
 * The OpenCode Go gateway rejects request bodies over ~400 KB with a cryptic
 * `400 Upstream response was not valid JSON` even when the model's token
 * context window is far from full, because the limit is raw JSON bytes, not
 * tokens. Long sessions accumulate history past that ceiling. The fix trims
 * older conversation turns (preserving the system prompt, the most recent
 * turns, and tool-call atomicity) before the body is built.
 */

interface Msg {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string }>;
}

function msg(role: string, content: string): Msg {
  return { role, content };
}

function bigMsg(role: string, kBytes: number): Msg {
  return { role, content: "x".repeat(kBytes * 1024) };
}

describe("trimApiMessages", () => {
  it("leaves short conversations untouched", () => {
    const messages = [msg("user", "hi"), msg("assistant", "hello")];
    const out = trimApiMessages(messages, MESSAGE_BYTE_BUDGET["chat-completions"]);
    assert.equal(out.length, 2);
    assert.equal(out[0].content, "hi");
    assert.equal(out[1].content, "hello");
  });

  it("keeps the system prompt when trimming", () => {
    const messages = [
      msg("system", "you are a helpful assistant"),
      // ~600 KB of history, way over the 200 KB budget
      ...Array.from({ length: 20 }, (_, i) => [bigMsg("user", 15), bigMsg("assistant", 15)]).flat(),
    ];
    const out = trimApiMessages(messages, MESSAGE_BYTE_BUDGET["chat-completions"]);
    assert.ok(out.length < messages.length, "expected trimming");
    assert.equal(out[0].content, "you are a helpful assistant", "system prompt must survive");
  });

  it("keeps the most recent turns (guaranteed minimum context)", () => {
    const messages = [
      msg("system", "s"),
      // 12 turns x 10 KB each = ~240 KB, over the 100 KB budget
      ...Array.from({ length: 12 }, (_, i) => [bigMsg("user", 10), bigMsg("assistant", 10)]).flat(),
      msg("user", "q-last"),
      msg("assistant", "a-last"),
    ];
    const out = trimApiMessages(messages, 100 * 1024);
    assert.ok(out.length < messages.length, "expected trimming");
    assert.equal(out[out.length - 1].content, "a-last", "last turn kept");
    assert.equal(out[out.length - 2].content, "q-last", "penultimate message kept");
  });

  it("never splits a tool-call / tool-result pair", () => {
    const messages = [
      msg("system", "s"),
      // Oldest turn — must be dropped (over budget)
      bigMsg("user", 40),
      { ...msg("assistant", ""), tool_calls: [{ id: "call_old" }] },
      { ...msg("tool", "result"), tool_call_id: "call_old" },
      bigMsg("assistant", 40),
      // Middle turn — kept by the guaranteed-minimum-context phase
      bigMsg("user", 40),
      bigMsg("assistant", 1),
      // Recent turn with a tool call — must survive intact
      msg("user", "recent question"),
      { ...msg("assistant", ""), tool_calls: [{ id: "call_new" }] },
      { ...msg("tool", "result"), tool_call_id: "call_new" },
      msg("assistant", "done"),
    ];
    const out = trimApiMessages(messages, 100 * 1024);
    assert.ok(out.length < messages.length, "expected trimming");
    const hasCall = out.some((m) => m.role === "assistant" && m.tool_calls);
    const hasResult = out.some((m) => m.role === "tool");
    assert.equal(hasCall, hasResult, "tool call and result must be kept or dropped together");
    assert.ok(
      out.some((m) => m.tool_calls?.some((t) => t.id === "call_new")),
      "recent tool call must survive",
    );
    assert.ok(
      out.some((m) => m.tool_call_id === "call_new"),
      "recent tool result must survive",
    );
    assert.ok(
      !out.some((m) => m.tool_calls?.some((t) => t.id === "call_old")),
      "old tool call must be dropped",
    );
  });

  it("keeps the resulting messages within the byte budget when possible", () => {
    const messages = [
      msg("system", "s"),
      // ~200 KB of old history (10 x 20 KB turns)
      ...Array.from({ length: 10 }, (_, i) => [bigMsg("user", 10), bigMsg("assistant", 10)]).flat(),
      msg("user", "recent question"),
      msg("assistant", "recent answer"),
    ];
    const budget = 100 * 1024;
    const out = trimApiMessages(messages, budget);
    const size = JSON.stringify(out).length;
    assert.ok(size <= budget, `trimmed payload ${size} must fit ${budget}`);
    assert.equal(out[0].content, "s");
    assert.equal(out[out.length - 1].content, "recent answer");
  });

  it("exports a per-endpoint budget for every routed endpoint kind", () => {
    for (const kind of ["chat-completions", "messages", "responses", "google"]) {
      const budget = MESSAGE_BYTE_BUDGET[kind];
      assert.ok(typeof budget === "number" && budget > 0, `budget for ${kind}`);
      assert.ok(budget < MAX_PAYLOAD_BYTES, `${kind} budget ${budget} stays under ${MAX_PAYLOAD_BYTES}`);
    }
  });
});
