import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Tests for issue #274 — when `trimOldMessagesToFitContext` drops old
 * messages to fit the context window, a single user-role `[Context notice]`
 * message must be inserted at the cut boundary so the model knows earlier
 * context is missing, and the returned estimates must include the notice.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-274-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
class LanguageModelTextPart { constructor(value) { this.value = value; } }
class LanguageModelThinkingPart { constructor(text) { this.text = text; } }
class LanguageModelToolCallPart { constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; } }
class LanguageModelToolResultPart { constructor(callId, content) { this.callId = callId; this.content = content; } }
module.exports = { LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolResultPart };
`,
  "utf-8",
);

type ResolveFilename = (request: string, parent: unknown, ...args: unknown[]) => string;
const moduleResolver = Module as unknown as { _resolveFilename: ResolveFilename };
const originalResolveFilename = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function (request: string, parent: unknown, ...args: unknown[]): string {
  if (request === "vscode") {
    return vscodeMockPath;
  }
  return originalResolveFilename.call(this, request, parent, ...args);
};

let trimOldMessagesToFitContext: typeof import("../provider/historyTrim.js").trimOldMessagesToFitContext;

type ApiMessage = Record<string, unknown>;

const TOKEN_BUDGET = 200;
const MAX_BYTES = 100_000;

/** Build a history big enough that trimming must drop middle messages. */
function oversizedHistory(turnCount: number): ApiMessage[] {
  const messages: ApiMessage[] = [{ role: "system", content: "You are a helpful assistant." }];
  for (let t = 0; t < turnCount; t++) {
    messages.push({ role: "user", content: `Question ${t}: ${"detail ".repeat(30)}` });
    messages.push({ role: "assistant", content: `Answer ${t}: ${"explanation ".repeat(30)}` });
  }
  messages.push({ role: "user", content: "Final prompt: please summarize." });
  return messages;
}

function noticeMessages(messages: ApiMessage[]): ApiMessage[] {
  return messages.filter((m) => m.role === "user" && typeof m.content === "string" && m.content.includes("[Context notice]"));
}

before(async () => {
  ({ trimOldMessagesToFitContext } = await import("../provider/historyTrim.js"));
});

describe("#274 context notice on history trim", () => {
  it("inserts a user-role notice at the cut boundary with the dropped count", () => {
    const messages = oversizedHistory(40);
    const anchor = messages[0];
    const last = messages[messages.length - 1];
    const result = trimOldMessagesToFitContext(messages as never, TOKEN_BUDGET, MAX_BYTES);
    assert.ok(result.removed >= 1, "trim must drop messages");
    const notices = noticeMessages(messages);
    assert.strictEqual(notices.length, 1, "exactly one notice message");
    const notice = notices[0];
    assert.strictEqual(notice.role, "user");
    assert.ok((notice.content as string).includes(String(result.removed)), "notice mentions the removed count");
    // The notice sits at the cut boundary: right after the anchor message.
    assert.strictEqual(messages[1], notice, "notice is the first message after the anchor");
    // Anchor and current prompt untouched.
    assert.strictEqual(messages[0], anchor);
    assert.strictEqual(messages[messages.length - 1], last);
  });

  it("does not insert a notice when the history fits the budget", () => {
    const messages = oversizedHistory(2);
    const before = messages.length;
    const result = trimOldMessagesToFitContext(messages as never, 10_000, 10_000_000);
    assert.strictEqual(result.removed, 0);
    assert.strictEqual(messages.length, before);
    assert.strictEqual(noticeMessages(messages).length, 0);
  });

  it("does not duplicate the notice when trimming an already-trimmed history", () => {
    const messages = oversizedHistory(40);
    const first = trimOldMessagesToFitContext(messages as never, TOKEN_BUDGET, MAX_BYTES);
    const noticesAfterFirst = noticeMessages(messages).length;
    const second = trimOldMessagesToFitContext(messages as never, TOKEN_BUDGET, MAX_BYTES);
    assert.strictEqual(noticeMessages(messages).length, noticesAfterFirst, "exactly one notice after the second call");
    assert.ok(noticesAfterFirst === 1 || second.removed === 0, "second trim is a no-op or keeps a single notice");
    assert.ok(first.finalTokens >= 0 && second.finalTokens >= 0);
  });

  it("drops tool-call groups whole and never places the notice inside one", () => {
    const messages: ApiMessage[] = [{ role: "system", content: "You are a helpful assistant." }];
    for (let t = 0; t < 20; t++) {
      const callId = `call_${t}`;
      messages.push({ role: "user", content: `Turn ${t}: ${"context ".repeat(30)}` });
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{ id: callId, type: "function", function: { name: "read_file", arguments: `{"filePath":"f${t}.ts"}` } }],
      });
      messages.push({ role: "tool", tool_call_id: callId, content: "x".repeat(120) });
    }
    messages.push({ role: "user", content: "Final prompt: done?" });
    const result = trimOldMessagesToFitContext(messages as never, TOKEN_BUDGET, MAX_BYTES);
    assert.ok(result.removed >= 1);
    const noticeIndex = messages.findIndex(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("[Context notice]"),
    );
    assert.ok(noticeIndex > 0, "notice present at the cut boundary");
    // No orphaned tool result: every tool message is immediately preceded by
    // the assistant message carrying its tool_call id.
    for (let i = 1; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "tool") {
        const prev = messages[i - 1];
        assert.strictEqual(prev.role, "assistant");
        const callIds = (prev.tool_calls as Array<{ id: string }>).map((tc) => tc.id);
        assert.ok(callIds.includes(m.tool_call_id as string), "tool result follows its assistant call");
      }
    }
    // The notice itself must not split a tool group (a tool message is never
    // the first message after the notice).
    assert.notStrictEqual(messages[noticeIndex + 1]?.role, "tool");
  });
});
