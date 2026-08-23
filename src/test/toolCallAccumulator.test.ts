import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToolInput, ToolCallAccumulator } from "../toolCallAccumulator.js";

/**
 * Unit tests for the pure tool-call accumulator (issues #93 / #98).
 *
 * CONTEXT / ROOT CAUSE:
 * OpenCode's OpenAI-compatible SSE streams deliver tool calls as deltas across
 * MANY chunks: the first chunk carries `id`/`name` with an empty `arguments`,
 * subsequent chunks append `arguments` fragments, and every intermediate chunk
 * reports `finish_reason: null` (only the final chunk says `"tool_calls"`).
 *
 * 0.4.4 (#93) added a flush condition `finish_reason == null && pending.size > 0`
 * that fired on the FIRST tool-call delta chunk, emitting an incomplete call
 * (empty input) — rendered by VS Code as `<invoke>` without `<parameter>`,
 * causing an unrecoverable tool-call loop (issue #98).
 *
 * The accumulator must therefore ONLY flush on `finish_reason === "tool_calls"`
 * (or via `flushRemainingToolCalls()` at end-of-stream for gateways that omit it), never
 * on intermediate `finish_reason: null` chunks.
 */

/** Build a delta chunk like `choices[0].delta` seen by collect(). */
function deltaChunk(toolCalls: unknown): unknown {
  return toolCalls;
}

const nameChunk = deltaChunk([
  {
    index: 0,
    id: "call_1",
    type: "function",
    function: { name: "grep_search", arguments: "" },
  },
]);

const argsChunk1 = deltaChunk([{ index: 0, function: { arguments: '{"query":' } }]);

const argsChunk2 = deltaChunk([{ index: 0, function: { arguments: '"search"}' } }]);

describe("ToolCallAccumulator — no premature flush on intermediate chunks (#98)", () => {
  it("does not flush while finish_reason is null, even with pending tool calls", () => {
    const acc = new ToolCallAccumulator();
    acc.collect(nameChunk);
    acc.collect(argsChunk1);
    acc.collect(argsChunk2);

    // All deltas accumulated, nothing flushed yet.
    assert.equal(acc.size, 1);
    // The chunk carrying the first tool-call delta has finish_reason: null —
    // it must NOT trigger a flush (this is the regression from #93).
    assert.equal(ToolCallAccumulator.shouldFlushOnFinishReason(null), false);
    assert.equal(ToolCallAccumulator.shouldFlushOnFinishReason(undefined), false);
  });

  it("flushes exactly ONE complete tool call when finish_reason is 'tool_calls'", () => {
    const acc = new ToolCallAccumulator();
    acc.collect(nameChunk);
    acc.collect(argsChunk1);
    acc.collect(argsChunk2);

    assert.equal(ToolCallAccumulator.shouldFlushOnFinishReason("tool_calls"), true);
    const flushed = acc.flush();

    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].id, "call_1");
    assert.equal(flushed[0].name, "grep_search");
    // Fragmented arguments fully assembled and parsed.
    assert.deepEqual(flushed[0].input, { query: "search" });
    // Accumulator is empty after flush.
    assert.equal(acc.size, 0);
    // A second flush yields nothing.
    assert.deepEqual(acc.flush(), []);
  });

  it("is a no-op when nothing was collected", () => {
    const acc = new ToolCallAccumulator();
    assert.deepEqual(acc.flush(), []);
    assert.deepEqual(acc.flushRemainingToolCalls(), []);
    assert.equal(acc.size, 0);
  });
});

describe("ToolCallAccumulator — end-of-stream flush for gateways omitting finish_reason (#93)", () => {
  it("flushRemainingToolCalls emits the complete call when the gateway never sends 'tool_calls'", () => {
    const acc = new ToolCallAccumulator();
    acc.collect(nameChunk);
    acc.collect(argsChunk1);
    acc.collect(argsChunk2);

    // No finish_reason anywhere in the stream — emulate gpt-5.6-luna on Go.
    assert.equal(ToolCallAccumulator.shouldFlushOnFinishReason(null), false);
    const flushed = acc.flushRemainingToolCalls();

    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].name, "grep_search");
    assert.deepEqual(flushed[0].input, { query: "search" });
    assert.equal(acc.size, 0);
  });

  it("flushRemainingToolCalls is a no-op after a normal finish_reason flush", () => {
    const acc = new ToolCallAccumulator();
    acc.collect(nameChunk);
    acc.collect(argsChunk1);
    acc.collect(argsChunk2);
    acc.flush();
    assert.deepEqual(acc.flushRemainingToolCalls(), []);
  });
});

describe("ToolCallAccumulator — delta handling edge cases", () => {
  it("ignores non-array and non-record deltas", () => {
    const acc = new ToolCallAccumulator();
    acc.collect(undefined);
    acc.collect("not an array");
    acc.collect([null, 42, "x"]);
    assert.equal(acc.size, 0);
  });

  it("filters out arguments-only deltas that never supplied a name", () => {
    const acc = new ToolCallAccumulator();
    acc.collect([{ index: 0, function: { arguments: '{"a":1}' } }]);
    assert.equal(acc.size, 1);
    const flushed = acc.flush();
    // The pending entry has an empty name → dropped.
    assert.deepEqual(flushed, []);
  });

  it("accumulates multiple tool calls independently by index", () => {
    const acc = new ToolCallAccumulator();
    acc.collect([
      { index: 0, id: "a", function: { name: "read_file", arguments: '{"path":' } },
      { index: 1, id: "b", function: { name: "grep_search", arguments: '{"query":' } },
    ]);
    acc.collect([
      { index: 0, function: { arguments: '"/x.ts"}' } },
      { index: 1, function: { arguments: '"foo"}' } },
    ]);

    const flushed = acc.flush();
    assert.equal(flushed.length, 2);
    assert.equal(flushed[0].name, "read_file");
    assert.deepEqual(flushed[0].input, { path: "/x.ts" });
    assert.equal(flushed[1].name, "grep_search");
    assert.deepEqual(flushed[1].input, { query: "foo" });
  });

  it("appends name fragments (name split across chunks)", () => {
    const acc = new ToolCallAccumulator();
    acc.collect([{ index: 0, function: { name: "read_" } }]);
    acc.collect([{ index: 0, function: { name: "file" } }]);
    const flushed = acc.flush();
    assert.equal(flushed[0]?.name, "read_file");
  });
});

describe("parseToolInput", () => {
  it("returns {} for empty or whitespace-only input", () => {
    assert.deepEqual(parseToolInput(""), {});
    assert.deepEqual(parseToolInput("   "), {});
  });

  it("returns {} for partial / invalid JSON", () => {
    assert.deepEqual(parseToolInput('{"a":'), {});
    assert.deepEqual(parseToolInput("not json"), {});
  });

  it("parses valid JSON objects", () => {
    assert.deepEqual(parseToolInput('{"a":1}'), { a: 1 });
    assert.deepEqual(parseToolInput("{}"), {});
  });

  it("returns {} for non-object JSON scalars (strings, numbers)", () => {
    assert.deepEqual(parseToolInput('"str"'), {});
    assert.deepEqual(parseToolInput("42"), {});
  });

  it("passes through JSON arrays (isRecord treats arrays as objects — original semantics)", () => {
    assert.deepEqual(parseToolInput("[1,2]"), [1, 2]);
  });
});

describe("ToolCallAccumulator — hasCompletePendingCalls (#184)", () => {
  it("returns true with no pending calls", () => {
    const acc = new ToolCallAccumulator();
    assert.equal(acc.hasCompletePendingCalls(), true);
  });

  it("returns true when all named calls have parseable object arguments", () => {
    const acc = new ToolCallAccumulator();
    acc.collect([{ index: 0, id: "a", function: { name: "fs", arguments: "" } }]);
    acc.collect([{ index: 0, function: { arguments: '{"path":"x"}' } }]);
    acc.collect([{ index: 1, id: "b", function: { name: "web", arguments: '{"q":1}' } }]);
    assert.equal(acc.hasCompletePendingCalls(), true);
  });

  it("returns false when arguments JSON is truncated mid-stream", () => {
    const acc = new ToolCallAccumulator();
    acc.collect([{ index: 0, id: "a", function: { name: "fs", arguments: '{"path":' } }]);
    assert.equal(acc.hasCompletePendingCalls(), false);
  });

  it("returns false when arguments never arrived (empty string)", () => {
    const acc = new ToolCallAccumulator();
    acc.collect([{ index: 0, id: "a", function: { name: "fs" } }]);
    assert.equal(acc.hasCompletePendingCalls(), false);
  });

  it("ignores nameless fragments (same as flush)", () => {
    const acc = new ToolCallAccumulator();
    acc.collect([{ index: 0, function: { arguments: '{"x":1}' } }]);
    assert.equal(acc.hasCompletePendingCalls(), true);
  });
});
