import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Regression tests for the 0.7.7 #244 follow-up: 400 "No tool output found
 * for function call call_*". The argumentsDone repair delta carried
 * `id: firstString(call_id, item_id)` — and the real luna done event has NO
 * call_id, only `item_id: "fc_1"`. ToolCallAccumulator adopted that item id,
 * REPLACING the real call_* id from output_item.added. Item ids are reused
 * across turns, so two turns both carrying `fc_1` produced two function_call
 * items with one output at the gateway → 400.
 *
 * Contract now: the done event repairs ARGUMENTS ONLY — it must never change
 * tool-call identity. Pairing additionally collapses duplicate function_call
 * items to self-heal already-poisoned histories.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-244b-")), "index.js");
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
moduleResolver._resolveFilename = function (request, parent, ...args) {
  if (request === "vscode") return vscodeMockPath;
  return originalResolveFilename.call(this, request, parent, ...args);
};

let OpenAiResponseExtractor: typeof import("../transports/extractors.js").OpenAiResponseExtractor;
let normalizeResponsesStreamEvent: typeof import("../core/routing.js").normalizeResponsesStreamEvent;
let responsesInputItemsFromMessage: typeof import("../responsesRequest.js").responsesInputItemsFromMessage;
let pairResponsesFunctionCallItems: typeof import("../responsesRequest.js").pairResponsesFunctionCallItems;

function lunaToolCallEvents(callId: string, argsChunks: string[]): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [
    { type: "response.created", sequence_number: 0, response: { id: "resp_x", status: "in_progress", output: [], usage: null } },
    {
      type: "response.output_item.added",
      sequence_number: 4,
      output_index: 1,
      item: { id: "fc_1", type: "function_call", status: "in_progress", name: "read_file", call_id: callId, arguments: "" },
    },
  ];
  let seq = 5;
  for (const chunk of argsChunks) {
    events.push({ type: "response.function_call_arguments.delta", sequence_number: seq++, output_index: 1, item_id: "fc_1", delta: chunk });
  }
  // NOTE: the real luna done event carries item_id only — NO call_id.
  events.push({
    type: "response.function_call_arguments.done",
    sequence_number: seq++,
    output_index: 1,
    item_id: "fc_1",
    arguments: argsChunks.join(""),
  });
  events.push({
    type: "response.output_item.done",
    sequence_number: seq++,
    output_index: 1,
    item: { id: "fc_1", type: "function_call", status: "completed", name: "read_file", call_id: callId, arguments: argsChunks.join("") },
  });
  events.push({
    type: "response.completed",
    sequence_number: seq++,
    response: { id: "resp_x", status: "completed", stop_reason: "tool_calls", usage: { input_tokens: 100, output_tokens: 50 } },
  });
  return events;
}

describe("#244 follow-up: done event repairs arguments, never identity", () => {
  before(async () => {
    const extractors = await import("../transports/extractors.js");
    OpenAiResponseExtractor = extractors.OpenAiResponseExtractor;
    const routing = await import("../core/routing.js");
    normalizeResponsesStreamEvent = routing.normalizeResponsesStreamEvent;
    const responses = await import("../responsesRequest.js");
    responsesInputItemsFromMessage = responses.responsesInputItemsFromMessage;
    pairResponsesFunctionCallItems = responses.pairResponsesFunctionCallItems;
  });

  it("part id stays the call_* id when done carries only item_id", () => {
    const extractor = new OpenAiResponseExtractor(undefined, undefined, undefined, undefined, undefined, undefined, false);
    const parts: Array<{ callId?: string; name?: string; input?: unknown }> = [];
    for (const event of lunaToolCallEvents("call_Vf1vzJwf5xa44CfwtrzYe4y7", ['{"', "filePath", '":"', "/x.ts", '"}'])) {
      for (const part of extractor.extractStreamParts(normalizeResponsesStreamEvent(event))) {
        parts.push(part as { callId?: string; name?: string; input?: unknown });
      }
    }
    console.log("EMITTED PARTS:", JSON.stringify(parts.map((p) => ({ callId: p.callId, name: p.name, input: p.input }))));
    const tool = parts.find((p) => typeof p.name === "string");
    assert.ok(tool, "expected a tool call part");
    assert.equal(tool.callId, "call_Vf1vzJwf5xa44CfwtrzYe4y7", "part id must remain the gateway call_id, not the fc_ item id");
  });

  it("full round-trip: wire request pairs function_call with its output", () => {
    const extractor = new OpenAiResponseExtractor(undefined, undefined, undefined, undefined, undefined, undefined, false);
    const parts: Array<{ callId?: string; name?: string; input?: unknown }> = [];
    for (const event of lunaToolCallEvents("call_ROUNDTRIP", ['{"', "filePath", '":"', "/x.ts", '"}'])) {
      for (const part of extractor.extractStreamParts(normalizeResponsesStreamEvent(event))) {
        parts.push(part as { callId?: string; name?: string; input?: unknown });
      }
    }
    const tool = parts.find((p) => typeof p.name === "string") as { callId: string; name: string; input: object };
    const assistant = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: tool.callId, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.input) } }],
    };
    const toolResult = { role: "tool", tool_call_id: tool.callId, content: "file body" };
    const items = pairResponsesFunctionCallItems([assistant, toolResult].flatMap((m) => responsesInputItemsFromMessage(m as never)));
    const calls = items.filter((i) => i.type === "function_call").map((i) => i.call_id);
    const outs = items.filter((i) => i.type === "function_call_output").map((i) => i.call_id);
    assert.deepEqual([...calls].sort(), [...outs].sort(), "every function_call must have exactly one matching output");
  });

  it("argumentsDone still repairs arguments (the #244 fix is preserved)", () => {
    const extractor = new OpenAiResponseExtractor(undefined, undefined, undefined, undefined, undefined, undefined, false);
    // Deltas mis-joined by a gateway, then the authoritative done value.
    const events: Array<Record<string, unknown>> = [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "fc_9", type: "function_call", status: "in_progress", name: "search", call_id: "call_ZZZ", arguments: "" },
      },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_9", delta: '{"query":"what' },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_9", delta: " is 2 plus 2?" },
      { type: "response.function_call_arguments.done", output_index: 0, item_id: "fc_9", arguments: '{"query":"what is 2 plus 2?"}' },
      { type: "response.completed", response: { id: "r", status: "completed", stop_reason: "tool_calls", usage: null } },
    ];
    const parts: Array<{ callId?: string; name?: string; input?: unknown }> = [];
    for (const event of events) {
      for (const part of extractor.extractStreamParts(normalizeResponsesStreamEvent(event))) {
        parts.push(part as { callId?: string; name?: string; input?: unknown });
      }
    }
    const tool = parts.find((p) => typeof p.name === "string") as { callId: string; input: object };
    assert.equal(tool.callId, "call_ZZZ", "id from output_item.added must survive");
    assert.deepEqual(tool.input, { query: "what is 2 plus 2?" }, "arguments must be the authoritative done value");
  });

  it("pairing collapses duplicate function_call items sharing one call_id (poisoned history self-heal)", () => {
    // History poisoned by 0.7.7: two turns both used item id fc_1 as the part id.
    const msg = () => ({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "fc_1", type: "function", function: { name: "read_file", arguments: '{"filePath":"x.ts"}' } }],
    });
    const result = (content: string) => ({ role: "tool", tool_call_id: "fc_1", content });
    const items = [msg(), result("a"), msg(), result("b")].flatMap((m) => responsesInputItemsFromMessage(m as never));
    const paired = pairResponsesFunctionCallItems(items);
    const calls = paired.filter((i) => i.type === "function_call");
    const outs = paired.filter((i) => i.type === "function_call_output");
    assert.equal(calls.length, 1, `expected 1 function_call after dedupe, got ${String(calls.length)}`);
    assert.equal(outs.length, 1, `expected 1 function_call_output after dedupe, got ${String(outs.length)}`);
  });
});
