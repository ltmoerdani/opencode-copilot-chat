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
let truncateToolName: typeof import("../request/openai.js").truncateToolName;

describe("OpenAiResponseExtractor — truncated tool name round-trip", () => {
  before(async () => {
    const extractors = await import("../transports/extractors.js");
    OpenAiResponseExtractor = extractors.OpenAiResponseExtractor;
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

describe("updateRequestUsageSummary — Responses nested usage", () => {
  let updateRequestUsageSummary: typeof import("../transports/extract.js").updateRequestUsageSummary;

  before(async () => {
    const mod = await import("../transports/extract.js");
    updateRequestUsageSummary = mod.updateRequestUsageSummary;
  });

  it("reads usage from response.usage (Responses response.completed)", () => {
    const summary: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cachedTokens?: number } = {};
    updateRequestUsageSummary(summary, {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 231407,
          output_tokens: 45,
          total_tokens: 231452,
          input_tokens_details: { cached_tokens: 230961 },
        },
      },
    });
    assert.equal(summary.promptTokens, 231407);
    assert.equal(summary.completionTokens, 45);
    assert.equal(summary.totalTokens, 231452);
    assert.equal(summary.cachedTokens, 230961);
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
    const summary: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
    updateRequestUsageSummary(summary, {
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
    assert.equal(summary.promptTokens, 100);
    assert.equal(summary.completionTokens, 20);
    assert.equal(summary.totalTokens, 120);
  });
});
