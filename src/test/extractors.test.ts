import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Tests for the Responses extractor truncated → original tool name round-trip
 * (PR #168 review). Muse Spark truncates tool names >64 chars at request
 * build time; the extractor must reverse-lookup before emitting
 * LanguageModelToolCallPart so VS Code resolves the original tool.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-extractors-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
class LanguageModelTextPart { constructor(value) { this.value = value; } }
class LanguageModelThinkingPart { constructor(text) { this.text = text; } }
class LanguageModelToolCallPart {
  constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; }
}
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

let OpenAiResponseExtractor: typeof import("../transports/extractors.js").OpenAiResponseExtractor;
let AnthropicResponseExtractor: typeof import("../transports/extractors.js").AnthropicResponseExtractor;
let ThinkTagFilter: typeof import("../transports/thinkTags.js").ThinkTagFilter;
let truncateToolName: typeof import("../request/openai.js").truncateToolName;

describe("OpenAiResponseExtractor — truncated tool name round-trip", () => {
  before(async () => {
    const extractors = await import("../transports/extractors.js");
    OpenAiResponseExtractor = extractors.OpenAiResponseExtractor;
    AnthropicResponseExtractor = extractors.AnthropicResponseExtractor;
    const thinkTags = await import("../transports/thinkTags.js");
    ThinkTagFilter = thinkTags.ThinkTagFilter;
    const openai = await import("../request/openai.js");
    truncateToolName = openai.truncateToolName;
  });

  function makeExtractor(toolNameMap?: ReadonlyMap<string, string>) {
    // Constructor: onReasoningContent, onReasoningDebug, thinkFilter, progress, localRequestId, output, treatReasoningAsContent, toolNameMap
    return new OpenAiResponseExtractor(undefined, undefined, undefined, undefined, undefined, undefined, false, toolNameMap);
  }

  function toolCallDelta(name: string, args: string, index = 0, id = "call_1") {
    return {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index, id, type: "function", function: { name, arguments: args } }],
          },
          finish_reason: null,
        },
      ],
    };
  }

  function finishReasonChunk(reason: string) {
    return {
      choices: [{ index: 0, delta: {}, finish_reason: reason }],
    };
  }

  it("emits original name when model returned truncated name", () => {
    const longName = "a".repeat(72);
    const truncated = truncateToolName(longName);
    assert.notEqual(truncated, longName);
    const map = new Map<string, string>([[truncated, longName]]);
    const extractor = makeExtractor(map);

    extractor.extractStreamParts(toolCallDelta(truncated, '{"q":"x"}'));
    const parts = extractor.extractStreamParts(finishReasonChunk("tool_calls")) as { name: string }[];
    assert.equal(parts.length, 1);
    assert.equal(parts[0].name, longName);
  });

  it("passes through name unchanged when no map entry", () => {
    const extractor = makeExtractor(new Map());
    extractor.extractStreamParts(toolCallDelta("read_file", '{"path":"/x"}'));
    const parts = extractor.extractStreamParts(finishReasonChunk("tool_calls")) as { name: string }[];
    assert.equal(parts[0].name, "read_file");
  });

  it("passes through name unchanged when no map provided", () => {
    const extractor = makeExtractor(undefined);
    extractor.extractStreamParts(toolCallDelta("grep_search", '{"query":"foo"}'));
    const parts = extractor.extractStreamParts(finishReasonChunk("tool_calls")) as { name: string }[];
    assert.equal(parts[0].name, "grep_search");
  });

  it("flushRemainingToolCalls also reverse-maps truncated names", () => {
    const longName = "b".repeat(72);
    const truncated = truncateToolName(longName);
    const map = new Map<string, string>([[truncated, longName]]);
    const extractor = makeExtractor(map);
    // Minimal progress stub — extractor reports via reportProgressPart
    const emitted: unknown[] = [];
    const progress: import("vscode").Progress<import("vscode").LanguageModelResponsePart2> = {
      report: (part) => {
        emitted.push(part);
      },
    };
    extractor.extractStreamParts(toolCallDelta(truncated, '{"q":"y"}'));
    // No finish_reason flush; use end-of-stream flush (gateway omits finish_reason)
    // flushRemainingToolCalls takes (progress, localRequestId)
    extractor.flushRemainingToolCalls(progress, undefined);
    // When progress is provided, flushRemainingToolCalls reports via progress, not return
    assert.equal(emitted.length, 1);
    assert.equal((emitted[0] as { name: string }).name, longName);
  });
});

describe("OpenAiResponseExtractor — reasoning surfacing invariants (issue #196)", () => {
  let Extractor: typeof import("../transports/extractors.js").OpenAiResponseExtractor;

  before(async () => {
    const extractors = await import("../transports/extractors.js");
    Extractor = extractors.OpenAiResponseExtractor;
  });

  // Mock parts have shape: ThinkingPart { text } vs TextPart { value } vs ToolCallPart { callId }
  const isThinkingPart = (p: object): boolean => "text" in p && !("value" in p) && !("callId" in p);
  const isTextPart = (p: object): boolean => "value" in p && !("text" in p);

  type ProgressStub = { report: (p: object) => void };
  function makeProgress(): { reported: object[]; progress: ProgressStub } {
    const reported: object[] = [];
    return {
      reported,
      progress: {
        report: (p) => {
          reported.push(p);
        },
      },
    };
  }

  function reasoningDelta(reasoningContent: string, content?: string) {
    return {
      choices: [
        {
          delta: { ...(content !== undefined ? { content } : {}), reasoning_content: reasoningContent },
          finish_reason: null,
        },
      ],
    };
  }

  it("reasoning_content + content: reasoning goes to progress as ThinkingPart, text in returned parts", () => {
    const { reported, progress } = makeProgress();
    const extractor = new Extractor(undefined, undefined, undefined, progress, undefined, undefined, false);

    const parts = extractor.extractStreamParts(reasoningDelta("thinking...", "hello"));

    assert.equal(parts.length, 1, "only text part in returned array");
    assert.ok(isTextPart(parts[0]), "returned part is TextPart");
    assert.equal(reported.length, 1, "one progress.report call for reasoning");
    assert.ok(isThinkingPart(reported[0]), "reported part is ThinkingPart");
  });

  it("reasoning_content only: ThinkingPart via progress, empty returned parts", () => {
    const { reported, progress } = makeProgress();
    const extractor = new Extractor(undefined, undefined, undefined, progress, undefined, undefined, false);

    const parts = extractor.extractStreamParts(reasoningDelta("chain of thought"));

    assert.equal(parts.length, 0, "nothing in returned parts");
    assert.equal(reported.length, 1);
    assert.ok(isThinkingPart(reported[0]));
  });

  it("no progress sink at construction: flushReasoningFallback emits ThinkingPart, not TextPart", () => {
    const { reported: flushReported, progress: flushProgress } = makeProgress();
    const extractor = new Extractor(
      undefined,
      undefined,
      undefined,
      undefined, // no live progress — reasoning accumulates but is never streamed
      undefined,
      undefined,
      false,
    );

    extractor.extractStreamParts(reasoningDelta("thinking...", "answer"));
    extractor.flushReasoningFallback(flushProgress, undefined);

    assert.equal(flushReported.length, 1, "flush emits exactly one part");
    assert.ok(isThinkingPart(flushReported[0]), "flushed part is ThinkingPart (not leaked as TextPart)");
  });
});

describe("OpenAiResponseExtractor — responseDoneText fallback for delta-less models (#197)", () => {
  before(async () => {
    const extractors = await import("../transports/extractors.js");
    OpenAiResponseExtractor = extractors.OpenAiResponseExtractor;
  });

  function makeExtractor() {
    return new OpenAiResponseExtractor(undefined, undefined, undefined, undefined, undefined, undefined, false);
  }

  it("emits text from responseDoneText when no delta text was seen", () => {
    const extractor = makeExtractor();
    const parts = extractor.extractStreamParts({
      choices: [{ index: 0, delta: { responseDoneText: "Hello!" }, finish_reason: null }],
    }) as { value?: string }[];
    assert.equal(parts.length, 1);
    assert.equal(parts[0].value, "Hello!");
  });

  it("skips responseDoneText when delta text was already emitted", () => {
    const extractor = makeExtractor();
    // Emit text via delta first
    extractor.extractStreamParts({ choices: [{ index: 0, delta: { content: "Hi " }, finish_reason: null }] });
    // Now responseDoneText should be skipped (would duplicate)
    const parts = extractor.extractStreamParts({
      choices: [{ index: 0, delta: { responseDoneText: "Hi there!" }, finish_reason: null }],
    }) as unknown[];
    assert.equal(parts.length, 0);
  });

  it("ignores empty responseDoneText", () => {
    const extractor = makeExtractor();
    const parts = extractor.extractStreamParts({
      choices: [{ index: 0, delta: { responseDoneText: "" }, finish_reason: null }],
    }) as unknown[];
    assert.equal(parts.length, 0);
  });
});

describe("updateRequestUsageSummary — Responses nested usage", () => {
  let updateRequestUsageSummary: typeof import("../transports/extract.js").updateRequestUsageSummary;

  before(async () => {
    const mod = await import("../transports/extract.js");
    updateRequestUsageSummary = mod.updateRequestUsageSummary;
  });

  it("sets finishReason to 'stop' on response.completed without stop_reason", () => {
    const summary: { finishReason?: string } = {};
    updateRequestUsageSummary(summary, { type: "response.completed", response: {} });
    assert.equal(summary.finishReason, "stop");
  });

  it("sets finishReason from stop_reason on response.completed", () => {
    const summary: { finishReason?: string } = {};
    updateRequestUsageSummary(summary, { type: "response.completed", response: { stop_reason: "completed" } });
    assert.equal(summary.finishReason, "completed");
  });

  it("reads usage from response.usage (Responses response.completed)", () => {
    const summary: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      cachedTokens?: number;
      allowance?: number;
      listCost?: number;
      billingSource?: string;
    } = {};
    updateRequestUsageSummary(summary, {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 231407,
          output_tokens: 45,
          total_tokens: 231452,
          input_tokens_details: { cached_tokens: 230961 },
          opencode: { allowance: 0.00309, list_cost: 0.00412, billing_source: "go" },
        },
      },
    });
    assert.equal(summary.promptTokens, 231407);
    assert.equal(summary.completionTokens, 45);
    assert.equal(summary.totalTokens, 231452);
    assert.equal(summary.cachedTokens, 230961);
    assert.equal(summary.allowance, 0.00309);
    assert.equal(summary.listCost, 0.00412);
    assert.equal(summary.billingSource, "go");
  });

  it("ignores malformed OpenCode billing metadata without affecting token usage", () => {
    const summary: { promptTokens?: number; allowance?: number } = {};
    updateRequestUsageSummary(summary, {
      usage: { prompt_tokens: 10, opencode: { allowance: "0.1", list_cost: -1 } },
    });
    assert.equal(summary.promptTokens, 10);
    assert.equal(summary.allowance, undefined);
  });

  it("prefers top-level usage over response.usage when both present", () => {
    const summary: { promptTokens?: number; completionTokens?: number } = {};
    updateRequestUsageSummary(summary, {
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      response: { usage: { input_tokens: 999, output_tokens: 999 } },
    });
    assert.equal(summary.promptTokens, 10);
    assert.equal(summary.completionTokens, 5);
  });

  it("still reads top-level usage for OpenAI/Anthropic shapes", () => {
    const summary: { promptTokens?: number; completionTokens?: number; totalTokens?: number; allowance?: number } = {};
    updateRequestUsageSummary(summary, {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        opencode: { allowance: 0.75 },
      },
    });
    assert.equal(summary.promptTokens, 100);
    assert.equal(summary.completionTokens, 20);
    assert.equal(summary.totalTokens, 120);
    assert.equal(summary.allowance, 0.75);
  });
});

describe("updateRequestUsageSummary — Google usageMetadata + finishReason", () => {
  let updateRequestUsageSummary: typeof import("../transports/extract.js").updateRequestUsageSummary;

  before(async () => {
    const mod = await import("../transports/extract.js");
    updateRequestUsageSummary = mod.updateRequestUsageSummary;
  });

  it("maps usageMetadata counts (thoughts + cached content included)", () => {
    const summary: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cachedTokens?: number } = {};
    updateRequestUsageSummary(summary, {
      candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 38026,
        candidatesTokenCount: 78,
        thoughtsTokenCount: 620,
        totalTokenCount: 38724,
        cachedContentTokenCount: 32768,
      },
    });
    assert.equal(summary.promptTokens, 38026);
    assert.equal(summary.completionTokens, 698);
    assert.equal(summary.totalTokens, 38724);
    assert.equal(summary.cachedTokens, 32768);
  });

  it("maps candidates[].finishReason (STOP → stop, MAX_TOKENS → length)", () => {
    const summary: { finishReason?: string } = {};
    updateRequestUsageSummary(summary, { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] });
    assert.equal(summary.finishReason, "stop");

    const lengthSummary: { finishReason?: string } = {};
    updateRequestUsageSummary(lengthSummary, { candidates: [{ finishReason: "MAX_TOKENS" }] });
    assert.equal(lengthSummary.finishReason, "length");
  });

  it("maps a Gemini tool-call finish to 'tool_calls'", () => {
    const summary: { finishReason?: string } = {};
    updateRequestUsageSummary(summary, {
      candidates: [{ content: { parts: [{ functionCall: { name: "read_file" } }] }, finishReason: "STOP" }],
    });
    assert.equal(summary.finishReason, "tool_calls");
  });
});

describe("OpenAiResponseExtractor — thinkTag carry flushing before tool calls", () => {
  it("emits pending thinkFilter carry as TextPart before tool calls on finish_reason: 'tool_calls'", () => {
    const filter = new ThinkTagFilter();
    const extractor = new OpenAiResponseExtractor(undefined, undefined, filter);

    // Delta with text ending in a partial tag '<thi'
    const parts1 = extractor.extractStreamParts({
      choices: [
        {
          index: 0,
          delta: {
            content: "Calling tool <thi",
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "test_tool", arguments: '{"a":1}' } }],
          },
          finish_reason: null,
        },
      ],
    }) as { value?: string }[];

    // First chunk emits the safe portion
    assert.equal(parts1.length, 1);
    assert.equal(parts1[0].value, "Calling tool ");

    // Second chunk triggers finish_reason: "tool_calls"
    const parts2 = extractor.extractStreamParts({
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    }) as { value?: string; callId?: string; name?: string }[];

    // Second chunk must emit '<thi' as TextPart BEFORE the ToolCallPart!
    assert.equal(parts2.length, 2);
    assert.equal(parts2[0].value, "<thi");
    assert.equal(parts2[1].callId, "call_1");
    assert.equal(parts2[1].name, "test_tool");
    assert.equal(extractor.emittedText, "Calling tool <thi".length);
  });

  it("flushRemainingToolCalls flushes pending thinkFilter carry before reporting tool calls", () => {
    const filter = new ThinkTagFilter();
    const extractor = new OpenAiResponseExtractor(undefined, undefined, filter);

    extractor.extractStreamParts({
      choices: [
        {
          index: 0,
          delta: {
            content: "Run command <",
            tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "run_cmd", arguments: '{"cmd":"ls"}' } }],
          },
          finish_reason: null,
        },
      ],
    });

    const emitted: { value?: string; callId?: string; name?: string }[] = [];
    const progress: import("vscode").Progress<import("vscode").LanguageModelResponsePart2> = {
      report: (part) => {
        emitted.push(part as unknown as { value?: string; callId?: string; name?: string });
      },
    };

    extractor.flushRemainingToolCalls(progress, undefined);

    assert.equal(emitted.length, 2);
    assert.equal(emitted[0].value, "<");
    assert.equal(emitted[1].callId, "call_2");
    assert.equal(emitted[1].name, "run_cmd");
  });
});

describe("AnthropicResponseExtractor — thinkTag carry flushing before tool calls", () => {
  it("flushes pending thinkFilter carry before emitting tool calls on message_delta", () => {
    const filter = new ThinkTagFilter();
    const extractor = new AnthropicResponseExtractor(undefined, undefined, filter);

    // Initial content block start with tool_use
    extractor.extractStreamParts({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "anthropic_call_1", name: "search" },
    });
    // Text block delta that leaves carry
    extractor.extractStreamParts({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Searching <thi" },
    });
    // Tool argument delta
    extractor.extractStreamParts({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"q":"test"}' },
    });

    // message_delta with stop_reason
    const parts = extractor.extractStreamParts({
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
    }) as { value?: string; callId?: string; name?: string }[];

    assert.equal(parts.length, 2);
    assert.equal(parts[0].value, "<thi");
    assert.equal(parts[1].callId, "anthropic_call_1");
    assert.equal(parts[1].name, "search");
  });

  it("flushes pending thinkFilter carry on message_stop", () => {
    const filter = new ThinkTagFilter();
    const extractor = new AnthropicResponseExtractor(undefined, undefined, filter);

    extractor.extractStreamParts({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "anthropic_call_2", name: "calculate" },
    });
    extractor.extractStreamParts({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Result: 5 <" },
    });
    extractor.extractStreamParts({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"x":5}' },
    });

    // message_stop without prior message_delta stop_reason
    const parts = extractor.extractStreamParts({
      type: "message_stop",
    }) as { value?: string; callId?: string; name?: string }[];

    assert.equal(parts.length, 2);
    assert.equal(parts[0].value, "<");
    assert.equal(parts[1].callId, "anthropic_call_2");
    assert.equal(parts[1].name, "calculate");
  });
});
