import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/*
 * Regression for Gemini 4 Hydrogen on Zen: Google requires the opaque
 * `thoughtSignature` from a response to be replayed on the next turn for
 * Gemini 3+ with thinking enabled. The old normalizers dropped it, so every
 * follow-up turn failed with MISSING_THOUGHT_SIGNATURE.
 */

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-thought-signature-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
class LanguageModelChatToolMode { static Required = "required"; }
class LanguageModelDataPart {
  constructor(data, mimeType) {
    this.data = data;
    this.mimeType = mimeType;
  }
}
module.exports = { LanguageModelChatToolMode, LanguageModelDataPart };
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

let normalizeGoogleStreamEvent: typeof import("../core/routing.js").normalizeGoogleStreamEvent;
let normalizeGoogleFullResponse: typeof import("../core/routing.js").normalizeGoogleFullResponse;
let buildGoogleGenerateContentBody: typeof import("../request/google.js").buildGoogleGenerateContentBody;
let createThoughtSignaturePart: typeof import("../chatParts.js").createThoughtSignaturePart;
let isThoughtSignaturePart: typeof import("../chatParts.js").isThoughtSignaturePart;
let readThoughtSignaturePart: typeof import("../chatParts.js").readThoughtSignaturePart;
let isInternalDataPart: typeof import("../chatParts.js").isInternalDataPart;
let normalizeMessages: typeof import("../provider/messages.js").normalizeMessages;

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

interface GoogleContent {
  role: string;
  parts: Record<string, unknown>[];
}

function contentsFor(messages: import("../request/types.js").ApiMessage[]): GoogleContent[] {
  const body = buildGoogleGenerateContentBody("gemini-4-hydrogen", messages, options, settings, metadata, limits);
  return body.contents as GoogleContent[];
}

before(async () => {
  ({ normalizeGoogleStreamEvent, normalizeGoogleFullResponse } = await import("../core/routing.js"));
  ({ buildGoogleGenerateContentBody } = await import("../request/google.js"));
  ({ createThoughtSignaturePart, isThoughtSignaturePart, readThoughtSignaturePart, isInternalDataPart } = await import("../chatParts.js"));
  ({ normalizeMessages } = await import("../provider/messages.js"));
});

describe("Google normalizers — thoughtSignature preservation", () => {
  it("keeps signatures from thought, functionCall and trailing parts in order", () => {
    const result = normalizeGoogleStreamEvent({
      candidates: [
        {
          content: {
            parts: [
              { text: "planning", thought: true, thoughtSignature: "sig-thought" },
              { functionCall: { name: "read_file", args: { path: "a" } }, thoughtSignature: "sig-call" },
              { text: "", thoughtSignature: "sig-final" },
            ],
          },
          finishReason: "STOP",
        },
      ],
    }) as { choices: { delta: { thought_signatures?: string[] } }[] };
    assert.deepEqual(result.choices[0]?.delta.thought_signatures, ["sig-thought", "sig-call", "sig-final"]);
  });

  it("does not discard a signature-only event as empty", () => {
    const result = normalizeGoogleStreamEvent({
      candidates: [{ content: { parts: [{ text: "", thoughtSignature: "sig-only" }] } }],
    }) as { choices: unknown[] };
    assert.equal(result.choices.length, 1);
  });

  it("keeps signatures on the non-streaming full-response path", () => {
    const result = normalizeGoogleFullResponse({
      candidates: [{ content: { parts: [{ text: "answer" }, { text: "", thoughtSignature: "sig-full" }] } }],
    }) as { choices: { message: { thought_signatures?: string[] } }[] };
    assert.deepEqual(result.choices[0]?.message.thought_signatures, ["sig-full"]);
  });

  it("emits no signature field when the response has none", () => {
    const result = normalizeGoogleStreamEvent({
      candidates: [{ content: { parts: [{ text: "answer" }] } }],
    }) as { choices: { delta: { thought_signatures?: string[] } }[] };
    assert.equal(result.choices[0]?.delta.thought_signatures, undefined);
  });
});

describe("Thought signature transcript part", () => {
  it("round-trips signatures and is classified as an internal data part", () => {
    const part = createThoughtSignaturePart(["sig-a", "sig-b"]);
    assert.equal(isThoughtSignaturePart(part), true);
    assert.equal(isInternalDataPart(part), true);
    assert.deepEqual(readThoughtSignaturePart(part), ["sig-a", "sig-b"]);
  });

  it("ignores malformed payloads and foreign parts", () => {
    const malformed = {
      data: new TextEncoder().encode("not json"),
      mimeType: "application/vnd.opencode.thought-signature+json",
    };
    assert.equal(readThoughtSignaturePart(malformed), undefined);
    const foreign = createThoughtSignaturePart(["x"]);
    const foreignPart = { data: foreign.data, mimeType: "application/vnd.opencode.usage+json" };
    assert.equal(isThoughtSignaturePart(foreignPart), false);
  });
});

describe("Gemini request builder — thoughtSignature replay", () => {
  it("replays the signature as a trailing part on the model turn", () => {
    const contents = contentsFor([
      { role: "user", content: "first" },
      { role: "assistant", content: "answer", thought_signatures: ["sig-1"] },
      { role: "user", content: "second" },
    ]);
    assert.deepEqual(contents[1], {
      role: "model",
      parts: [{ text: "answer" }, { text: "", thoughtSignature: "sig-1" }],
    });
  });

  it("replays signatures after function calls on a tool turn", () => {
    const contents = contentsFor([
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: null,
        thought_signatures: ["sig-2"],
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
      },
    ]);
    assert.deepEqual(contents[1].parts, [{ functionCall: { name: "read_file", args: {} } }, { text: "", thoughtSignature: "sig-2" }]);
  });

  it("adds no extra parts when no signature was received", () => {
    const contents = contentsFor([
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ]);
    assert.deepEqual(contents[1].parts, [{ text: "answer" }]);
  });
});

describe("History normalization — signature retention", () => {
  it("keeps a signature-only assistant turn", () => {
    const messages = normalizeMessages([
      { role: "user", content: "first" },
      { role: "assistant", content: null, thought_signatures: ["sig-only"] },
    ]);
    assert.deepEqual(messages[1]?.thought_signatures, ["sig-only"]);
  });

  it("concatenates signatures when adjacent assistant messages merge", () => {
    const messages = normalizeMessages([
      { role: "user", content: "first" },
      { role: "assistant", content: "part one", thought_signatures: ["sig-a"] },
      { role: "assistant", content: "part two", thought_signatures: ["sig-b"] },
    ]);
    assert.deepEqual(messages[1]?.thought_signatures, ["sig-a", "sig-b"]);
  });
});
