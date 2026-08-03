import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  GO_DEFAULT_BASE_URL,
  buildProviderUrls,
} from "../providerUrls";

describe("buildProviderUrls", () => {
  it("uses the default OpenCode Go endpoints when no override is provided", () => {
    assert.deepEqual(buildProviderUrls(GO_DEFAULT_BASE_URL), {
      modelsUrl: "https://opencode.ai/zen/go/v1/models",
      chatCompletionsUrl: "https://opencode.ai/zen/go/v1/chat/completions",
      messagesUrl: "https://opencode.ai/zen/go/v1/messages",
      responsesUrl: "https://opencode.ai/zen/go/v1/responses",
    });
  });

  it("replaces the base URL while preserving endpoint paths", () => {
    assert.deepEqual(buildProviderUrls(
      GO_DEFAULT_BASE_URL,
      "https://example.com/custom/gateway/v1",
    ), {
      modelsUrl: "https://example.com/custom/gateway/v1/models",
      chatCompletionsUrl: "https://example.com/custom/gateway/v1/chat/completions",
      messagesUrl: "https://example.com/custom/gateway/v1/messages",
      responsesUrl: "https://example.com/custom/gateway/v1/responses",
    });
  });

  it("accepts a trailing slash on the override", () => {
    assert.deepEqual(buildProviderUrls(
      GO_DEFAULT_BASE_URL,
      "https://example.com/custom/gateway/v1/",
    ), {
      modelsUrl: "https://example.com/custom/gateway/v1/models",
      chatCompletionsUrl: "https://example.com/custom/gateway/v1/chat/completions",
      messagesUrl: "https://example.com/custom/gateway/v1/messages",
      responsesUrl: "https://example.com/custom/gateway/v1/responses",
    });
  });
});