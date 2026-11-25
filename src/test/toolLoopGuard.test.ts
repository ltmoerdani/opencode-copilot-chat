import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BEAM_TOOL_LOOP_TURN_LIMIT, detectBeamToolLoop, detectMuseRepetitionLoop, MUSE_REPETITION_TURN_LIMIT } from "../toolLoopGuard.js";
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

const repeatedAnswer = "第三方源码不动是对的——我换一种做法：上游文件一个字节都不碰，只动我们自己的 port 层和工程配置。";

function museLoopMessages(turns: number, texts: readonly string[] = []): ApiMessage[] {
  const messages: ApiMessage[] = [{ role: "user", content: "finish the port migration" }];
  for (let i = 0; i < turns; i++) {
    const id = `call_${String(i)}`;
    messages.push({
      role: "assistant",
      content: texts[i] ?? repeatedAnswer,
      tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `/file-${String(i)}.ts` }) } }],
    });
    messages.push({ role: "tool", tool_call_id: id, content: "file content" });
  }
  return messages;
}

describe("detectMuseRepetitionLoop (#284)", () => {
  it("stops three consecutive identical Muse answers even with tool calls between them", () => {
    const warning = detectMuseRepetitionLoop("muse-spark-1.3-contributor", museLoopMessages(MUSE_REPETITION_TURN_LIMIT));
    assert.match(warning ?? "", /tool-free final-answer recovery/);
  });

  it("does not fire for two repeats or for varying answers", () => {
    assert.equal(detectMuseRepetitionLoop("muse-spark-1.3-contributor", museLoopMessages(2)), undefined);
    const varying = museLoopMessages(3, [
      "first distinct answer that is long enough to count",
      "second distinct answer that is long enough to count",
      "third distinct answer that is long enough to count",
    ]);
    assert.equal(detectMuseRepetitionLoop("muse-spark-1.3-contributor", varying), undefined);
  });

  it("ignores short answers and non-Muse models", () => {
    const short = museLoopMessages(3, ["ok", "ok", "ok"]);
    assert.equal(detectMuseRepetitionLoop("muse-spark-1.3-contributor", short), undefined);
    assert.equal(detectMuseRepetitionLoop("deepseek-v4.1-flash", museLoopMessages(10)), undefined);
  });
});
