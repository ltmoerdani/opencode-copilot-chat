import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// ── vscode stub ─────────────────────────────────────────────────────────────
// modelList.ts transitively imports vscode-dependent modules (definitions,
// request/headers); redirect require("vscode") to a tiny stub like the
// other vscode-dependent tests do (pattern: routing.test.ts).
// `extensions.getExtension` is needed by getUserAgent(); workspace stays
// absent — configuredApiBaseUrl() is written to tolerate that (structural
// view) so PROVIDERS can be derived in bare test environments.
const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-modellist-")), "index.js");
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";
module.exports = { extensions: { getExtension: () => undefined } };
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

type ModelListFetcherLike = new (deps: unknown) => { fetch(apiKey?: string): Promise<string[]> };

let ModelListFetcher: ModelListFetcherLike;
const originalFetch = globalThis.fetch;
let logs: string[] = [];
let fetchCalls = 0;

before(async () => {
  const mod = (await import("../provider/modelList.js")) as unknown as { ModelListFetcher: ModelListFetcherLike };
  ModelListFetcher = mod.ModelListFetcher;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  logs = [];
  fetchCalls = 0;
});

function stubFetchStatus(status: number, statusText: string): void {
  globalThis.fetch = (): Promise<Response> => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status, statusText }));
  };
}

function makeFetcher(fallbackModels: string[]): InstanceType<ModelListFetcherLike> {
  return new ModelListFetcher({
    context: { globalState: { get: () => undefined, update: () => undefined } },
    definition: {
      vendor: "opencodego",
      displayName: "OpenCode Go",
      modelsUrl: "https://gateway.example/v1/models",
      fallbackModels,
    },
    log: (message: string) => logs.push(message),
    replaceLiveModelMetadata: () => {},
    filterAvailableModels: (modelIds: string[]) => Promise.resolve(modelIds),
  });
}

describe("ModelListFetcher — 401 handling (issue #269)", () => {
  it("falls back to the bundled list and logs an actionable key hint without retrying", async () => {
    stubFetchStatus(401, "Unauthorized");
    const models = await makeFetcher(["bundled-fallback"]).fetch("sk-rejected");
    assert.deepEqual(models, ["bundled-fallback"]);
    // 401 is permanent — exactly one attempt, no retry/backoff.
    assert.equal(fetchCalls, 1);
    const hint = logs.find((line) => line.includes("stored API key was rejected"));
    assert.ok(hint, `expected a 401 hint line, got: ${logs.join(" | ")}`);
    assert.match(hint, /Manage Provider/);
    assert.ok(logs.some((line) => line.includes("Using bundled model list")));
  });

  it("does not log the key hint for non-401 permanent failures", async () => {
    stubFetchStatus(400, "Bad Request");
    const models = await makeFetcher(["bundled-fallback"]).fetch("sk-whatever");
    assert.deepEqual(models, ["bundled-fallback"]);
    assert.equal(fetchCalls, 1);
    assert.ok(!logs.some((line) => line.includes("stored API key was rejected")));
  });
});
