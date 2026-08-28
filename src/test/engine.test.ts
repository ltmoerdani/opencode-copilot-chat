import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installVscodeMock } from "./helpers/goUsageTestUtils.js";

// engine → streamParts/chatParts/contextWindowHookBridge import "vscode" at
// runtime; install the stub before the dynamic import below resolves them.
installVscodeMock();

interface EngineModule {
  streamOpenCodeResponse: (options: Record<string, unknown>) => Promise<void>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 400 ? "Bad Request" : "OK",
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(): Response {
  const body = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * CONTRACT — regression tests for issue #199 (HTTP 400 body double-read).
 *
 * RULES:
 *   A Fetch `Response` body can be consumed exactly once. The engine's
 *   400-patch loop reads the body; whatever path it exits on (nothing
 *   recoverable, patch ladder exhausted, or patched retry recovering), the
 *   `!response.ok` handler must reuse the cached body instead of re-reading
 *   the same `Response` — a second `text()` throws undici's "Body is
 *   unusable: Body has already been read", swallowing the real error detail
 *   (reported on gpt-5.6-luna via /v1/responses, v0.7.2).
 */
describe("streamOpenCodeResponse HTTP 400 error-body handling", () => {
  async function loadEngine(): Promise<EngineModule> {
    return (await import("../transports/engine.js")) as unknown as EngineModule;
  }

  function baseOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      url: "https://example.invalid/v1/chat/completions",
      providerDisplayName: "OpenCode Go",
      apiKey: "test-key",
      modelId: "gpt-5.6-luna",
      body: { model: "gpt-5.6-luna", messages: [{ role: "user", content: "hi" }], stream_options: {} },
      requestHeaders: {},
      progress: { report: () => {} },
      token: {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
      },
      debugReasoning: false,
      requestTimeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      extractStreamParts: () => [],
      extractFullParts: () => [],
      usesDoneSentinel: true,
      ...overrides,
    };
  }

  it("surfaces the original 400 body instead of a double-read TypeError", async () => {
    const { streamOpenCodeResponse } = await loadEngine();
    const detail = { error: { message: "[invalid_prompt] unrecognized variant" } };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(jsonResponse(400, detail));

    try {
      await streamOpenCodeResponse(baseOptions());
      assert.fail("expected streamOpenCodeResponse to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!message.includes("Body is unusable"), `should not double-read the body, got: ${message}`);
      assert.ok(message.includes("[invalid_prompt]"), `should surface the original 400 detail, got: ${message}`);
      assert.ok(message.includes("400"), `should mention the HTTP status, got: ${message}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("completes a patched 400 retry that recovers to a 200 SSE stream", async () => {
    const { streamOpenCodeResponse } = await loadEngine();
    const calls: number[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      calls.push(1);
      // First call: recoverable 400 ([1210] invalid input + stream_options in
      // the body). Second call: healthy SSE stream ending with [DONE].
      return Promise.resolve(
        calls.length === 1 ? jsonResponse(400, { error: { message: "[1210] invalid input: stream_options" } }) : sseResponse(),
      );
    };

    try {
      await streamOpenCodeResponse(baseOptions());
      assert.equal(calls.length, 2, "should fetch once for the 400 and once for the patched retry");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces the LATEST 400 body after a patched retry fails again (no stale/double read)", async () => {
    const { streamOpenCodeResponse } = await loadEngine();
    const calls: number[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      calls.push(1);
      return Promise.resolve(
        calls.length === 1
          ? jsonResponse(400, { error: { message: "[1210] invalid input: stream_options" } })
          : jsonResponse(400, { error: { message: "[invalid_prompt] second failure" } }),
      );
    };

    try {
      await streamOpenCodeResponse(baseOptions());
      assert.fail("expected streamOpenCodeResponse to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!message.includes("Body is unusable"), `should not double-read the body, got: ${message}`);
      assert.ok(message.includes("[invalid_prompt] second failure"), `should surface the latest 400 detail, got: ${message}`);
      assert.ok(!message.includes("[1210]"), `should not surface the stale first 400 detail, got: ${message}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
