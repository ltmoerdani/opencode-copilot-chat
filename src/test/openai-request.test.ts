import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Tests covering one of the fixes for #165 (and the Beam follow-up): the OpenAI-format upstreams reject tool names longer than 64 characters. The truncation strategy is to keep the first 55 characters, append an underscore, and then append an 8-character hash of the original name. This ensures that the truncated name is unique and deterministic.
 * The truncation is deterministic and includes a hash suffix to avoid collisions.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-openai-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
class LanguageModelChatToolMode { static Required = "required"; }
module.exports = { LanguageModelChatToolMode };
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

let buildResponsesRequestBody: typeof import("../request/openai.js").buildResponsesRequestBody;
let buildChatCompletionsRequestBody: typeof import("../request/openai.js").buildChatCompletionsRequestBody;
let isMuseFamily: typeof import("../request/openai.js").isMuseFamily;
let needsToolNameTruncation: typeof import("../request/openai.js").needsToolNameTruncation;
let truncateToolName: typeof import("../request/openai.js").truncateToolName;
let buildToolNameMap: typeof import("../request/openai.js").buildToolNameMap;

const longToolName = "a".repeat(72);
const shortToolName = "read_file";
const exactly64 = "b".repeat(64);

const makeTool = (name: string) => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: "object", properties: {} },
});

const baseArgs: {
  messages: import("../request/types.js").ApiMessage[];
  settings: import("../request/types.js").ApiSettings;
  metadata: import("../models/metadata.js").ResolvedModelMetadata;
  limits: import("../models/modelLimits.js").ModelLimits;
} = {
  messages: [{ role: "user", content: "hello" }],
  settings: {
    temperature: 0.2,
    thinking: {},
    maxOutputTokensOverride: 0,
    maxInputTokensOverride: 0,
    debugReasoning: false,
    requestTimeoutMs: 0,
    streamIdleTimeoutMs: 0,
    stripThinkTags: "auto",
  } as unknown as import("../request/types.js").ApiSettings,
  metadata: {} as unknown as import("../models/metadata.js").ResolvedModelMetadata,
  limits: { maxOutputTokens: 4096 } as unknown as import("../models/modelLimits.js").ModelLimits,
};

function opts(tools: ReturnType<typeof makeTool>[]): import("vscode").ProvideLanguageModelChatResponseOptions {
  // ProvideLanguageModelChatResponseOptions in the proposed API only declares
  // requestInitiator/modelConfiguration; tools/toolMode are supplied at runtime
  // by VS Code but not yet in the d.ts. Cast is intentional and matches the
  // runtime shape the request builders read.
  return { tools } as unknown as import("vscode").ProvideLanguageModelChatResponseOptions;
}

describe("buildResponsesRequestBody — Muse Spark tool name truncation", () => {
  before(async () => {
    const mod = await import("../request/openai.js");
    buildResponsesRequestBody = mod.buildResponsesRequestBody;
    buildChatCompletionsRequestBody = mod.buildChatCompletionsRequestBody;
    isMuseFamily = mod.isMuseFamily;
    needsToolNameTruncation = mod.needsToolNameTruncation;
    truncateToolName = mod.truncateToolName;
    buildToolNameMap = mod.buildToolNameMap;
  });

  it("truncates long tool names for Muse Spark", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      opts([makeTool(longToolName)]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.ok(tool.name.length <= 64, `expected ≤64 chars, got ${tool.name.length}`);
    assert.ok(tool.name !== longToolName, "name should have been truncated");
    assert.ok(tool.name.includes("_"), "truncated name should contain underscore separator");
  });

  it("truncates long tool names for Muse Spark free variant", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor-free",
      baseArgs.messages,
      opts([makeTool(longToolName)]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.ok(tool.name.length <= 64, `expected ≤64 chars, got ${tool.name.length}`);
  });

  it("does NOT truncate tool names for non-Muse models", () => {
    const body = buildResponsesRequestBody(
      "gpt-5.6-luna",
      baseArgs.messages,
      opts([makeTool(longToolName)]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.equal(tool.name, longToolName, "non-Muse models should pass names through unchanged");
  });

  it("does NOT truncate short tool names even for Muse Spark", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      opts([makeTool(shortToolName)]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.equal(tool.name, shortToolName, "short names should pass through unchanged");
  });

  it("does NOT truncate names that are exactly 64 characters", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      opts([makeTool(exactly64)]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { name: string }[])[0];
    assert.equal(tool.name, exactly64, "exactly-64-char names should not be truncated");
  });

  it("produces deterministic truncation", () => {
    const make = () =>
      buildResponsesRequestBody(
        "muse-spark-1.2-contributor",
        baseArgs.messages,
        opts([makeTool(longToolName)]),
        baseArgs.settings,
        baseArgs.metadata,
        baseArgs.limits,
      );
    const name1 = (make().tools as { name: string }[])[0].name;
    const name2 = (make().tools as { name: string }[])[0].name;
    assert.equal(name1, name2, "same input should produce same output");
  });

  it("produces unique names for different long tool names", () => {
    const body = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      opts([makeTool("a".repeat(72)), makeTool("b".repeat(72))]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tools = body.tools as { name: string }[];
    assert.equal(tools.length, 2);
    assert.notEqual(tools[0].name, tools[1].name, "different long names should produce different truncated names");
  });

  it("sends truncation: disabled for Muse Spark, auto for others", () => {
    const museBody = buildResponsesRequestBody(
      "muse-spark-1.2-contributor",
      baseArgs.messages,
      opts([]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    assert.equal(museBody.truncation, "disabled");
    const gptBody = buildResponsesRequestBody(
      "gpt-5.6-luna",
      baseArgs.messages,
      opts([]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    assert.equal(gptBody.truncation, "auto");
  });
});

describe("isMuseFamily — registry single source of truth", () => {
  it("returns true for Muse Spark variants, false otherwise", () => {
    assert.equal(isMuseFamily("muse-spark-1.2-contributor"), true);
    assert.equal(isMuseFamily("muse-spark-1.2-contributor-free"), true);
    assert.equal(isMuseFamily("MUSE-spark-1.2-contributor"), true);
    assert.equal(isMuseFamily("gpt-5.6-luna"), false);
    assert.equal(isMuseFamily(""), false);
  });
});

describe("buildChatCompletionsRequestBody — tool name truncation (Beam)", () => {
  it("truncates long tool names for beam-free (upstream 64-char limit)", () => {
    const body = buildChatCompletionsRequestBody(
      "beam-free",
      baseArgs.messages,
      opts([makeTool(longToolName)]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { function: { name: string } }[])[0];
    assert.ok(tool.function.name.length <= 64, `expected ≤64 chars, got ${tool.function.name.length}`);
    assert.ok(tool.function.name !== longToolName, "name should have been truncated");
  });

  it("does NOT truncate tool names for ungated chat-completions models", () => {
    const body = buildChatCompletionsRequestBody(
      "deepseek-v4.1-flash",
      baseArgs.messages,
      opts([makeTool(longToolName)]),
      baseArgs.settings,
      baseArgs.metadata,
      baseArgs.limits,
    );
    const tool = (body.tools as { function: { name: string } }[])[0];
    assert.equal(tool.function.name, longToolName, "ungated models should pass names through unchanged");
  });
});

describe("needsToolNameTruncation — muse + beam gate", () => {
  it("returns true for muse and beam families", () => {
    assert.equal(needsToolNameTruncation("muse-spark-1.2-contributor"), true);
    assert.equal(needsToolNameTruncation("beam-free"), true);
    assert.equal(needsToolNameTruncation("BEAM-free"), true);
  });

  it("returns false for other families and empty ids", () => {
    assert.equal(needsToolNameTruncation("gpt-5.6-luna"), false);
    assert.equal(needsToolNameTruncation("deepseek-v4.1-flash"), false);
    assert.equal(needsToolNameTruncation(""), false);
  });
});

describe("buildToolNameMap — truncated → original round-trip", () => {
  const makeToolLocal = (name: string) => ({
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
  });

  it("maps truncated names back to originals for Muse Spark", () => {
    const longName = "a".repeat(72);
    const truncated = truncateToolName(longName);
    const map = buildToolNameMap([makeToolLocal(longName), makeToolLocal("read_file")], "muse-spark-1.2-contributor");
    assert.equal(map.get(truncated), longName);
    assert.equal(map.size, 1);
  });

  it("maps truncated names back to originals for beam-free", () => {
    const longName = "mcp__postman-api_create-collection-request-with-new-api-definition-and-versions";
    const truncated = truncateToolName(longName);
    const map = buildToolNameMap([makeToolLocal(longName)], "beam-free");
    assert.equal(map.get(truncated), longName);
  });

  it("returns empty map for ungated models", () => {
    const map = buildToolNameMap([makeToolLocal("a".repeat(72))], "gpt-5.6-luna");
    assert.equal(map.size, 0);
  });

  it("returns empty map when no tools or empty modelId", () => {
    assert.equal(buildToolNameMap([], "muse-spark-1.2-contributor").size, 0);
    assert.equal(buildToolNameMap(undefined, "muse-spark-1.2-contributor").size, 0);
    assert.equal(buildToolNameMap([makeToolLocal("a".repeat(72))], "").size, 0);
  });
});
