import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldEchoThinkingHistory, inlineThinkingForHistory, thinkingTextFromValue } from "../reasoningHistory";

test("thinkingTextFromValue — passes plain strings through", () => {
  assert.equal(thinkingTextFromValue("hello"), "hello");
});

test("thinkingTextFromValue — joins string chunk arrays", () => {
  assert.equal(thinkingTextFromValue(["think ", "step", " 1"]), "think \nstep\n 1");
});

test("thinkingTextFromValue — drops non-string chunks", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(thinkingTextFromValue(["a", 42 as any, "b"]), "a\nb");
});

test("thinkingTextFromValue — empty inputs", () => {
  assert.equal(thinkingTextFromValue(""), "");
  assert.equal(thinkingTextFromValue([]), "");
});

test("shouldEchoThinkingHistory — undefined model id is never echoed", () => {
  assert.equal(shouldEchoThinkingHistory(undefined), false);
});

test("shouldEchoThinkingHistory — OpenAI-compatible reasoning families require the echo", () => {
  assert.equal(shouldEchoThinkingHistory("deepseek-v4-flash"), true);
  assert.equal(shouldEchoThinkingHistory("deepseek-v4-pro"), true);
  assert.equal(shouldEchoThinkingHistory("kimi-k2.6"), true);
  assert.equal(shouldEchoThinkingHistory("glm-5.2"), true);
  assert.equal(shouldEchoThinkingHistory("qwen3.6-plus"), true);
  assert.equal(shouldEchoThinkingHistory("beam-free"), true);
});

test("shouldEchoThinkingHistory — MiniMax replays thinking inline, not as a field", () => {
  // MiniMax is an interleaved thinking model: reasoning must be replayed as
  // <think> tags inside content (see inlineThinkingForHistory), never as
  // reasoning_content — the upstream drops the field (MiniMax-M2 README).
  assert.equal(shouldEchoThinkingHistory("minimax-m2.7"), false);
  assert.equal(shouldEchoThinkingHistory("minimax-m3.1"), false);
});

test("inlineThinkingForHistory — wraps trimmed thinking in <think> tags", () => {
  assert.equal(inlineThinkingForHistory(" plan "), "<think>plan</think>\n");
});

test("inlineThinkingForHistory — empty or missing thinking produces no prefix", () => {
  assert.equal(inlineThinkingForHistory(undefined), "");
  assert.equal(inlineThinkingForHistory("   "), "");
});

test("shouldEchoThinkingHistory — Gemini needs the echo for thought parts", () => {
  assert.equal(shouldEchoThinkingHistory("gemini-3.5-pro"), true);
});

test("shouldEchoThinkingHistory — families that reject or ignore the field", () => {
  assert.equal(shouldEchoThinkingHistory("mimo-v2.5"), false);
  assert.equal(shouldEchoThinkingHistory("gpt-5.6"), false);
  assert.equal(shouldEchoThinkingHistory("claude-sonnet-4.6"), false);
});

test("shouldEchoThinkingHistory — unknown families are left untouched", () => {
  assert.equal(shouldEchoThinkingHistory("some-future-model"), false);
});
