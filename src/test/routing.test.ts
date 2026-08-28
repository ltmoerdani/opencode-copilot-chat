import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// ── vscode stub ─────────────────────────────────────────────────────────────
// routing.ts transitively imports vscode (via providerTypes); redirect
// require("vscode") to a tiny stub like the other vscode-dependent tests do.
const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-routing-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
module.exports = {};
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

let normalizeResponsesStreamEvent: typeof import("../core/routing.js").normalizeResponsesStreamEvent;

describe("normalizeResponsesStreamEvent — finish_reason mapping", () => {
  before(async () => {
    const routing = await import("../core/routing.js");
    normalizeResponsesStreamEvent = routing.normalizeResponsesStreamEvent;
  });

  it("maps an unrecognized-but-valid stop_reason (max_tool_calls) to 'stop'", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.completed", response: { stop_reason: "max_tool_calls" } }) as {
      choices: { finish_reason: string | null }[];
    };
    assert.equal(result.choices[0]?.finish_reason, "stop");
  });

  it("keeps recognized values mapped (completed → stop)", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.completed", response: { stop_reason: "completed" } }) as {
      choices: { finish_reason: string | null }[];
    };
    assert.equal(result.choices[0]?.finish_reason, "stop");
  });

  it("defaults finish_reason to 'stop' when no stop_reason is present", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.completed", response: {} }) as {
      choices: { finish_reason: string | null }[];
    };
    assert.equal(result.choices[0]?.finish_reason, "stop");
  });
});

describe("normalizeResponsesStreamEvent — output_text.done and output_item.done (#197)", () => {
  before(async () => {
    const routing = await import("../core/routing.js");
    normalizeResponsesStreamEvent = routing.normalizeResponsesStreamEvent;
  });

  it("maps response.output_text.done to responseDoneText in delta", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.output_text.done", text: "Hello!" }) as {
      choices: { delta: { responseDoneText: string } }[];
    };
    assert.equal(result.choices[0]?.delta.responseDoneText, "Hello!");
  });

  it("maps response.output_item.done (message) to responseDoneText", () => {
    const result = normalizeResponsesStreamEvent({
      type: "response.output_item.done",
      item: { type: "message", content: [{ type: "output_text", text: "Hi there!" }] },
    }) as { choices: { delta: { responseDoneText: string } }[] };
    assert.equal(result.choices[0]?.delta.responseDoneText, "Hi there!");
  });

  it("ignores response.output_item.done for non-message items", () => {
    const result = normalizeResponsesStreamEvent({
      type: "response.output_item.done",
      item: { type: "function_call", name: "get_weather" },
    }) as { choices: unknown[] };
    assert.equal(result.choices.length, 0);
  });

  it("returns empty choices for response.output_text.done with no text", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.output_text.done" }) as { choices: unknown[] };
    assert.equal(result.choices.length, 0);
  });
});

describe("normalizeResponsesStreamEvent — output_text.delta whitespace preservation (#192)", () => {
  before(async () => {
    const routing = await import("../core/routing.js");
    normalizeResponsesStreamEvent = routing.normalizeResponsesStreamEvent;
  });

  it("preserves a trailing space in a delta chunk", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: "hello " }) as {
      choices: { delta: { content: string } }[];
    };
    assert.equal(result.choices[0]?.delta.content, "hello ");
  });

  it("preserves a leading space in a delta chunk", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: " world" }) as {
      choices: { delta: { content: string } }[];
    };
    assert.equal(result.choices[0]?.delta.content, " world");
  });

  it("preserves internal whitespace across fragments (the reported bug)", () => {
    // Simulate two consecutive deltas that together form "hello world".
    const first = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: "hello " }) as {
      choices: { delta: { content: string } }[];
    };
    const second = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: "world" }) as {
      choices: { delta: { content: string } }[];
    };
    const joined = first.choices[0]?.delta.content + second.choices[0]?.delta.content;
    assert.equal(joined, "hello world");
  });

  it("falls back to the text field when delta is absent", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.output_text.delta", text: " spaced " }) as {
      choices: { delta: { content: string } }[];
    };
    assert.equal(result.choices[0]?.delta.content, " spaced ");
  });

  it("preserves newlines and tabs in delta chunks", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: "line1\n\nline2\tindented" }) as {
      choices: { delta: { content: string } }[];
    };
    assert.equal(result.choices[0]?.delta.content, "line1\n\nline2\tindented");
  });

  it("handles empty delta gracefully (no choices emitted)", () => {
    const result = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: "" }) as {
      choices?: { delta?: { content?: string } }[];
    };
    // Empty string should produce no choices (firstStringRaw returns undefined for empty)
    assert.equal(result.choices?.length, 0);
  });

  it("reproduces a realistic multi-chunk scenario: 'This is a test sentence with multiple   spaces'", () => {
    // Simulate the full accumulation of a Responses API stream: each chunk
    // is normalized individually, then the caller accumulates the text.
    // This is exactly what happens at runtime in extractTextFromDelta.
    const chunks = ["This ", "is ", "a ", "test ", "sentence", " with ", "multiple   ", "spaces"];

    const normalized = chunks.map((chunk) => {
      const result = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: chunk }) as {
        choices: { delta: { content: string } }[];
      };
      return result.choices[0]?.delta.content ?? "";
    });

    const accumulated = normalized.join("");
    assert.equal(accumulated, "This is a test sentence with multiple   spaces");
  });

  it("reproduces the exact bug scenario: 'thisiswhattheresponselookslike' with no spaces in deltas", () => {
    // Baseline: if the delta string has no whitespace, the result should
    // be the same concatenated string (no bug).
    const chunks = ["this", "is", "what", "the", "response", "looks", "like"];
    const normalized = chunks.map((chunk) => {
      const result = normalizeResponsesStreamEvent({ type: "response.output_text.delta", delta: chunk }) as {
        choices: { delta: { content: string } }[];
      };
      return result.choices[0]?.delta.content ?? "";
    });
    assert.equal(normalized.join(""), "thisiswhattheresponselookslike");
  });
});
