import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BEAM_TOOL_LOOP_TURN_LIMIT, detectBeamToolLoop } from "../toolLoopGuard.js";
import type { ApiMessage } from "../request/types.js";

function loopMessages(turns: number, repeated = false): ApiMessage[] {
  const messages: ApiMessage[] = [{ role: "user", content: "finish the task" }];
  for (let i = 0; i < turns; i++) {
    const path = repeated ? "/same.ts" : `/file-${String(i)}.ts`;
    const id = `call_${String(i)}`;
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path }) } }],
    });
    messages.push({ role: "tool", tool_call_id: id, content: "file content" });
  }
  return messages;
}

describe("detectBeamToolLoop", () => {
  it("stops repeated Beam tool calls early", () => {
    const warning = detectBeamToolLoop("beam-free", loopMessages(3, true));
    assert.match(warning ?? "", /tool-free final-answer recovery/);
  });

  it("stops a long wandering Beam tool-only run even when paths vary", () => {
    const warning = detectBeamToolLoop("beam-free", loopMessages(BEAM_TOOL_LOOP_TURN_LIMIT));
    assert.match(warning ?? "", /tool-free final-answer recovery/);
  });

  it("does not guard other models or short runs", () => {
    assert.equal(detectBeamToolLoop("deepseek-v4.1-flash", loopMessages(20, true)), undefined);
    assert.equal(detectBeamToolLoop("beam-free", loopMessages(2, true)), undefined);
    assert.equal(detectBeamToolLoop("beam-free", loopMessages(BEAM_TOOL_LOOP_TURN_LIMIT - 1)), undefined);
  });
});
