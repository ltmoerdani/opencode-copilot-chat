import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Regression for #283: Gemini's FunctionResponse requires `name` + `response`.
 * Commit ec92a44 (2026-07-20) replaced the valid `{ name, response: {...} }`
 * shape with `{ name, content }`, which strict validators (gemini-4-argon)
 * reject with `Unknown name "content" at function_response`.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-google-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";\nclass LanguageModelChatToolMode { static Required = "required"; }\nmodule.exports = { LanguageModelChatToolMode };\n`,
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

let buildGoogleGenerateContentBody: typeof import("../request/google.js").buildGoogleGenerateContentBody;

const settings = {
  temperature: 0.2,
  thinking: {},
  maxOutputTokensOverride: 0,
  maxInputTokensOverride: 0,
  debugReasoning: false,
  requestTimeoutMs: 0,
  streamIdleTimeoutMs: 0,
  stripThinkTags: "auto",
} as unknown as import("../request/types.js").ApiSettings;
const metadata = {} as unknown as import("../models/metadata.js").ResolvedModelMetadata;
const limits = { maxOutputTokens: 4096 } as unknown as import("../models/modelLimits.js").ModelLimits;
const options = {} as unknown as import("vscode").ProvideLanguageModelChatResponseOptions;

interface FunctionResponsePart {
  functionResponse?: Record<string, unknown>;
}

function functionResponseFor(content: import("../request/types.js").ApiMessage["content"]): Record<string, unknown> {
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
    },
    { role: "tool", content, tool_call_id: "call_1" },
  ] as import("../request/types.js").ApiMessage[];
  const body = buildGoogleGenerateContentBody("gemini-4-argon", messages, options, settings, metadata, limits);
  const contents = body.contents as Array<{ parts: FunctionResponsePart[] }>;
  const part = contents.flatMap((entry) => entry.parts).find((candidate) => candidate.functionResponse !== undefined);
  assert.ok(part?.functionResponse, "expected a functionResponse part");
  return part.functionResponse;
}

before(async () => {
  ({ buildGoogleGenerateContentBody } = await import("../request/google.js"));
});

describe("Gemini functionResponse wire shape (#283)", () => {
  it("sends text tool results inside response, never as a top-level content field", () => {
    const response = functionResponseFor("file contents");
    assert.deepEqual(response, { name: "read_file", response: { content: "file contents" } });
    assert.equal("content" in response, false);
  });

  it("keeps multimodal parts at functionResponse level with a valid response object", () => {
    const response = functionResponseFor([
      { type: "text", text: "screenshot" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
    assert.deepEqual(response.response, { content: "screenshot" });
    assert.deepEqual(response.parts, [{ text: "screenshot" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }]);
    assert.equal("content" in response, false);
  });

  it("still emits a response object for null tool content", () => {
    const response = functionResponseFor(null);
    assert.deepEqual(response, { name: "read_file", response: { content: '""' } });
  });
});
