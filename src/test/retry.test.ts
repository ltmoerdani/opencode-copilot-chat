import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeHttp400ForRetry, isTransientFetchError, isTransientServerError } from "../retry.js";

describe("analyzeHttp400ForRetry — thinking errors", () => {
  it("patches 'only type=enabled is allowed' to force thinking.type='enabled'", () => {
    const body = { model: "kimi-k2.5", thinking: { type: "disabled" } };
    const result = analyzeHttp400ForRetry("invalid thinking: only type=enabled is allowed for this model", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body, { model: "kimi-k2.5", thinking: { type: "enabled" } });
    assert.match(result.reason, /thinking/i);
  });

  it("patches 'only type=disabled is allowed' by removing thinking", () => {
    const body = { model: "some-model", thinking: { type: "enabled" } };
    const result = analyzeHttp400ForRetry("invalid thinking: only type=disabled is allowed", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body, { model: "some-model" });
  });

  it("patches generic 'invalid thinking' by removing thinking field", () => {
    const body = { model: "test", thinking: { type: "disabled" }, temperature: 0.2 };
    const result = analyzeHttp400ForRetry("invalid thinking parameter", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body, { model: "test", temperature: 0.2 });
  });

  it("patches GLM 'cannot be disabled' by removing thinking (issue #162)", () => {
    const body = { model: "glm-5.3", thinking: { type: "disabled" } };
    const result = analyzeHttp400ForRetry(
      "Upstream request failed: [1210] This model always engages in thinking and cannot be disabled; please use low, high, or max",
      body,
    );
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body, { model: "glm-5.3" });
    assert.match(result.reason, /cannot disable thinking/i);
  });

  it("does not patch unrelated errors that merely contain 'cannot be disabled'", () => {
    const body = { model: "glm-5.3", thinking: { type: "disabled" } };
    const result = analyzeHttp400ForRetry("feature X cannot be disabled for this account", body);
    assert.equal(result, undefined);
  });
});

describe("analyzeHttp400ForRetry — temperature errors", () => {
  it("patches 'invalid temperature: only 1 is allowed' by removing temperature", () => {
    const body = { model: "kimi-k2.7-code", temperature: 0.2 };
    const result = analyzeHttp400ForRetry("invalid temperature: only 1 is allowed for this model", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body, { model: "kimi-k2.7-code" });
  });
});

describe("analyzeHttp400ForRetry — enable_thinking errors", () => {
  it("patches 'Extra inputs are not permitted, field: enable_thinking'", () => {
    const body = { model: "kimi-k2.5", enable_thinking: false };
    const result = analyzeHttp400ForRetry("Extra inputs are not permitted, field: 'enable_thinking', value: False", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body, { model: "kimi-k2.5" });
  });
});

describe("analyzeHttp400ForRetry — reasoning_effort errors", () => {
  it("patches reasoning_effort rejection", () => {
    const body = { model: "minimax-m2.7", reasoning_effort: "high" };
    const result = analyzeHttp400ForRetry("MiniMax M2 only accepts string reasoning_effort values ('low', 'medium', 'high')", body);
    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body, { model: "minimax-m2.7" });
  });
});

describe("analyzeHttp400ForRetry — non-recoverable errors", () => {
  it("returns undefined for auth errors", () => {
    const body = { model: "test" };
    const result = analyzeHttp400ForRetry("unauthorized", body);
    assert.equal(result, undefined);
  });

  it("returns undefined for unrelated errors", () => {
    const body = { model: "test" };
    const result = analyzeHttp400ForRetry("model not found", body);
    assert.equal(result, undefined);
  });
});

describe("analyzeHttp400ForRetry — context overflow", () => {
  it("reduces max_tokens using the authoritative counts from issue #109", () => {
    const body = { model: "deepseek-v4-flash", max_tokens: 384_000 };
    const result = analyzeHttp400ForRetry(
      "This model's maximum context length is 1048576 tokens. However, you requested 1050237 tokens (666237 in the messages, 384000 in the completion).",
      body,
    );

    assert.ok(result, "should be recoverable");
    assert.equal(result.body?.max_tokens, 381_290);
    assert.match(result.reason, /upstream context counts/i);
  });

  it("supports Responses-style max_output_tokens and formatted counts", () => {
    const body = { model: "gpt-test", max_output_tokens: 32_000 };
    const result = analyzeHttp400ForRetry(
      "Maximum context length is 128,000 tokens; you requested 130,000 tokens (98,000 in the input, 32,000 in the output).",
      body,
    );

    assert.ok(result, "should be recoverable");
    assert.equal(result.body?.max_output_tokens, 29_744);
  });

  it("patches the nested Google output budget", () => {
    const body = { model: "gemini-test", generationConfig: { maxOutputTokens: 32_000, temperature: 0.2 } };
    const result = analyzeHttp400ForRetry(
      "Maximum context length is 128,000 tokens; you requested 130,000 tokens (98,000 in the input, 32,000 in the output).",
      body,
    );

    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body?.generationConfig, { maxOutputTokens: 29_744, temperature: 0.2 });
  });

  it("does not retry when reducing completion cannot fit the prompt", () => {
    const result = analyzeHttp400ForRetry(
      "Maximum context length is 1,000 tokens. You requested 1,500 tokens (1,400 in the messages, 100 in the completion).",
      { model: "test", max_tokens: 100 },
    );

    assert.equal(result, undefined);
  });
});

describe("analyzeHttp400ForRetry — upstream completion cap (#171)", () => {
  it("caps max_tokens to the limit reported by OpenCode Go", () => {
    const body = { model: "deepseek-v4-flash", max_tokens: 384_000 };
    const result = analyzeHttp400ForRetry(
      "bad request: max_tokens is too large: 384000. This model supports at most 131072 completion tokens.",
      body,
    );

    assert.ok(result, "should be recoverable");
    assert.equal(result.body?.max_tokens, 131_072);
    assert.match(result.reason, /capped max_tokens from 384000 to 131072/i);
  });

  it("caps comma-formatted counts and Responses-style keys", () => {
    const body = { model: "gpt-test", max_output_tokens: 256_000 };
    const result = analyzeHttp400ForRetry("max_tokens is too large: 256,000. This model supports at most 131,072 completion tokens.", body);

    assert.ok(result, "should be recoverable");
    assert.equal(result.body?.max_output_tokens, 131_072);
  });

  it("caps the nested Google output budget", () => {
    const body = { model: "gemini-test", generationConfig: { maxOutputTokens: 200_000, temperature: 0.2 } };
    const result = analyzeHttp400ForRetry("max_tokens is too large: 200000. This model supports at most 65536 completion tokens.", body);

    assert.ok(result, "should be recoverable");
    assert.deepEqual(result.body?.generationConfig, { maxOutputTokens: 65_536, temperature: 0.2 });
  });

  it("does not patch when the configured budget is already within the cap", () => {
    const result = analyzeHttp400ForRetry("max_tokens is too large: 65536. This model supports at most 131072 completion tokens.", {
      model: "test",
      max_tokens: 65_536,
    });

    assert.equal(result, undefined);
  });

  it("returns undefined when the body carries no output budget", () => {
    const result = analyzeHttp400ForRetry("max_tokens is too large: 384000. This model supports at most 131072 completion tokens.", {
      model: "test",
    });

    assert.equal(result, undefined);
  });
});

describe("isTransientServerError", () => {
  it("flags 502/503/504 as transient", () => {
    assert.equal(isTransientServerError(502, "Bad Gateway"), true);
    assert.equal(isTransientServerError(503, "Service Unavailable"), true);
    assert.equal(isTransientServerError(504, "Gateway Timeout"), true);
  });

  it("flags a 500 whose body names Router.Unavailable as transient", () => {
    assert.equal(isTransientServerError(500, '{"error":{"type":"Router.Unavailable"}}'), true);
  });

  it("treats 500 with unrelated body as permanent", () => {
    assert.equal(isTransientServerError(500, "Internal Server Error"), false);
  });

  it("treats non-5xx statuses as permanent", () => {
    assert.equal(isTransientServerError(429, "Too Many Requests"), false);
  });

  it("matches Router.Unavailable case-insensitively", () => {
    assert.equal(isTransientServerError(500, "type: router.unavailable"), true);
  });
});

describe("isTransientFetchError", () => {
  it("retries the generic undici 'TypeError: fetch failed' wrapper", () => {
    assert.equal(isTransientFetchError(new TypeError("fetch failed")), true);
  });

  it("retries undici network error codes via error.cause", () => {
    for (const code of ["ECONNRESET", "EAI_AGAIN", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]) {
      const err = new Error("fetch failed", { cause: { code } });
      assert.equal(isTransientFetchError(err), true, `expected ${code} to be transient`);
    }
  });

  it("retries UND_ERR_* connect/socket timeouts via error.cause.name", () => {
    for (const name of ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_REQUEST_TIMEOUT"]) {
      const err = new Error("fetch failed", { cause: { name } });
      assert.equal(isTransientFetchError(err), true, `expected ${name} to be transient`);
    }
  });

  it("retries AbortSignal.timeout TimeoutError but not cancellation AbortError", () => {
    assert.equal(isTransientFetchError(new DOMException("Aborted", "AbortError")), false);
    assert.equal(isTransientFetchError(new DOMException("Timeout", "TimeoutError")), true);
  });

  it("retries HTTP 408/429/5xx surfaced as a message but not 4xx", () => {
    assert.equal(isTransientFetchError(new Error("Model list request failed (503): upstream down")), true);
    assert.equal(isTransientFetchError(new Error("Model list request failed (429): rate limited")), true);
    assert.equal(isTransientFetchError(new Error("Model list request failed (408): timeout")), true);
    assert.equal(isTransientFetchError(new Error("Model list request failed (400): bad request")), false);
  });

  it("treats an unknown plain error as permanent", () => {
    assert.equal(isTransientFetchError(new Error("something unexpected")), false);
  });
});

describe("analyzeHttp400ForRetry — [1210] invalid input degradation (#190)", () => {
  const ERROR = "Upstream request failed: [1210] Invalid API parameter, please check the documentation.invalid input";

  it("first degrades by dropping stream_options", () => {
    const body = { model: "ox-alpha-free", messages: [], stream: true, stream_options: { include_usage: true }, temperature: 0.2 };
    const result = analyzeHttp400ForRetry(ERROR, body);
    assert.ok(result, "should be recoverable");
    assert.equal(result.body?.stream_options, undefined);
    assert.equal(result.body?.temperature, 0.2);
    assert.match(result.reason, /stream_options/);
  });

  it("then drops temperature once stream_options is gone", () => {
    const body = { model: "ox-alpha-free", messages: [], stream: true, temperature: 0.2 };
    const result = analyzeHttp400ForRetry(ERROR, body);
    assert.ok(result, "should be recoverable");
    assert.equal(result.body?.temperature, undefined);
    assert.match(result.reason, /temperature/);
  });

  it("then strips image parts while keeping text", () => {
    const body = {
      model: "ox-alpha-free",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
        { role: "assistant", content: "ok" },
      ],
    };
    const result = analyzeHttp400ForRetry(ERROR, body);
    assert.ok(result, "should be recoverable");
    const msgs = result.body?.messages as { content: { type: string }[] }[];
    assert.equal(
      msgs[0].content.some((p) => p.type === "image_url"),
      false,
      "image part must be removed",
    );
    assert.equal(msgs[1].content, "ok", "non-image messages untouched");
    assert.match(result.reason, /image parts/);
  });

  it("returns undefined when nothing optional remains (real failure surfaces)", () => {
    const body = { model: "ox-alpha-free", messages: [{ role: "user", content: "hi" }], stream: true };
    const result = analyzeHttp400ForRetry(ERROR, body);
    assert.equal(result, undefined);
  });

  it("does not fire for other 400 errors", () => {
    const body = { model: "x", messages: [], stream_options: { include_usage: true }, temperature: 0.2 };
    const result = analyzeHttp400ForRetry("invalid thinking: only type=enabled is allowed for this model", body);
    assert.equal(result, undefined);
  });
});
