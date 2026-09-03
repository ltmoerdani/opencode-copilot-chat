import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveModelRouting } from "../core/routing.js";
import { lookupModelRegistryEntry, MODEL_REGISTRY } from "../core/registry.js";
import { thinkingFamily } from "../thinking.js";
import type { ProviderRoutingDefinition } from "../providerTypes.js";

/** Fixture provider definitions (URLs are arbitrary — only the shape matters). */
const goProvider: ProviderRoutingDefinition = {
  vendor: "opencodego",
  chatCompletionsUrl: "https://go.example/v1/chat/completions",
  messagesUrl: "https://go.example/v1/messages",
  modelsUrl: "https://go.example/v1/models",
  responsesUrl: "https://go.example/v1/responses",
};
const zenProvider: ProviderRoutingDefinition = {
  vendor: "opencodezen",
  chatCompletionsUrl: "https://zen.example/v1/chat/completions",
  messagesUrl: "https://zen.example/v1/messages",
  modelsUrl: "https://zen.example/v1/models",
  responsesUrl: "https://zen.example/v1/responses",
};

describe("model registry — data-driven transport routing", () => {
  it("routes GPT models to the Responses API on every vendor", () => {
    assert.deepEqual(resolveModelRouting("gpt-5.6-luna", goProvider), {
      endpointKind: "responses",
      endpointUrl: goProvider.responsesUrl,
      sdkPackage: "@ai-sdk/openai",
    });
    assert.equal(resolveModelRouting("gpt-5", zenProvider).endpointKind, "responses");
  });

  it("routes Claude models to the Anthropic Messages API on every vendor", () => {
    assert.equal(resolveModelRouting("claude-sonnet-4-6", goProvider).endpointKind, "messages");
    assert.equal(resolveModelRouting("claude-opus-4-7", zenProvider).endpointKind, "messages");
  });

  it("routes MiniMax m2.x to Messages on Go but chat-completions on Zen", () => {
    assert.equal(resolveModelRouting("minimax-m2.7", goProvider).endpointKind, "messages");
    assert.equal(resolveModelRouting("minimax-m2.5-free", goProvider).endpointKind, "messages");
    assert.equal(resolveModelRouting("minimax-m2.7", zenProvider).endpointKind, "chat-completions");
    // m3 has no m2-prefix → chat-completions everywhere
    assert.equal(resolveModelRouting("minimax-m3", goProvider).endpointKind, "chat-completions");
  });

  it("routes the Messages-API Qwen models to Messages on every vendor", () => {
    for (const modelId of ["qwen3.5-plus", "qwen3.6-plus", "qwen3.6-plus-free", "qwen3.7-max"]) {
      assert.equal(resolveModelRouting(modelId, goProvider).endpointKind, "messages", modelId);
      assert.equal(resolveModelRouting(modelId, zenProvider).endpointKind, "messages", modelId);
    }
  });

  it("routes Gemini to the Google API on Zen but chat-completions on Go", () => {
    assert.equal(resolveModelRouting("gemini-3.5-flash", zenProvider).endpointKind, "google");
    assert.equal(resolveModelRouting("gemini-3.5-flash", zenProvider).endpointUrl, `${zenProvider.modelsUrl}/gemini-3.5-flash`);
    assert.equal(resolveModelRouting("gemini-3.5-flash", goProvider).endpointKind, "chat-completions");
  });

  it("routes Muse Spark to the Responses API on every vendor", () => {
    assert.equal(resolveModelRouting("muse-spark-1.2-contributor", goProvider).endpointKind, "responses");
    assert.equal(resolveModelRouting("muse-spark-1.2-contributor", goProvider).endpointUrl, goProvider.responsesUrl);
    assert.equal(resolveModelRouting("muse-spark-1.2-contributor-free", zenProvider).endpointKind, "responses");
    assert.equal(resolveModelRouting("muse-spark-1.2-contributor-free", zenProvider).endpointUrl, zenProvider.responsesUrl);
  });

  it("routes Grok to the Responses API on every vendor (issue #208)", () => {
    for (const modelId of ["grok-4.6", "grok-4.5", "grok-build-0.1"]) {
      assert.equal(resolveModelRouting(modelId, goProvider).endpointKind, "responses", modelId);
      assert.equal(resolveModelRouting(modelId, goProvider).endpointUrl, goProvider.responsesUrl, modelId);
      assert.equal(resolveModelRouting(modelId, zenProvider).endpointKind, "responses", modelId);
    }
  });

  it("defaults every other known family to chat-completions", () => {
    for (const modelId of ["deepseek-v4-flash", "glm-5.1", "kimi-k2.6", "mimo-v2.5", "qwen3.8-max"]) {
      assert.equal(resolveModelRouting(modelId, goProvider).endpointKind, "chat-completions", modelId);
      assert.equal(resolveModelRouting(modelId, zenProvider).endpointKind, "chat-completions", modelId);
    }
  });

  it("falls back to chat-completions for unknown models", () => {
    assert.equal(resolveModelRouting("hy3-preview", goProvider).endpointKind, "chat-completions");
    assert.equal(resolveModelRouting("big-pickle", zenProvider).endpointKind, "chat-completions");
  });

  it("resolves agent-host vendors to their base vendor before routing", () => {
    const agentGo: ProviderRoutingDefinition = { ...goProvider, vendor: "opencodego-agent" };
    assert.equal(resolveModelRouting("gpt-5", agentGo).endpointKind, "responses");
    assert.equal(resolveModelRouting("minimax-m2.7", agentGo).endpointKind, "messages");
  });
});

describe("model registry — data-driven thinking family", () => {
  it("maps every family to its thinking strategy", () => {
    assert.equal(thinkingFamily("deepseek-v4-flash"), "deepseek");
    assert.equal(thinkingFamily("glm-5.1"), "glm");
    assert.equal(thinkingFamily("kimi-k2.7-code"), "kimi");
    assert.equal(thinkingFamily("minimax-m2.7"), "minimax");
    assert.equal(thinkingFamily("minimax-m3"), "minimax");
    assert.equal(thinkingFamily("gpt-5.6-luna"), "openai");
    assert.equal(thinkingFamily("qwen3.5-plus"), "qwen");
    assert.equal(thinkingFamily("qwen3.7-max"), "qwen");
    assert.equal(thinkingFamily("mimo-v2.5"), "mimo");
    assert.equal(thinkingFamily("muse-spark-1.2-contributor"), "muse");
  });

  it("returns null for families without a dedicated strategy", () => {
    assert.equal(thinkingFamily("claude-sonnet-4-6"), null);
    assert.equal(thinkingFamily("gemini-3.5-flash"), null);
    assert.equal(thinkingFamily("hy3-preview"), null);
    assert.equal(thinkingFamily("unknown-model"), null);
  });
});

describe("model registry — lookup mechanics", () => {
  it("honors vendor restrictions when a vendor is given", () => {
    assert.equal(lookupModelRegistryEntry("gemini-3.5-flash", "opencodezen").endpointKind, "google");
    assert.equal(lookupModelRegistryEntry("gemini-3.5-flash", "opencodego").endpointKind, "chat-completions");
    assert.equal(lookupModelRegistryEntry("minimax-m2.7", "opencodego").endpointKind, "messages");
    assert.equal(lookupModelRegistryEntry("minimax-m2.7", "opencodezen").endpointKind, "chat-completions");
  });

  it("ignores vendor restrictions when no vendor is given (thinking-family lookup)", () => {
    assert.equal(lookupModelRegistryEntry("gemini-3.5-flash").thinkingFamily, null);
    assert.equal(lookupModelRegistryEntry("minimax-m2.7").thinkingFamily, "minimax");
  });

  it("keeps the specific minimax-m2 row before the generic minimax row", () => {
    const indexOf = (family: string): number => MODEL_REGISTRY.findIndex((entry) => entry.family === family);
    assert.ok(indexOf("minimax-m2") >= 0);
    assert.ok(indexOf("minimax-m2") < indexOf("minimax"), "specific row must precede the generic row");
  });

  it("always resolves (the default catch-all row matches anything)", () => {
    assert.equal(lookupModelRegistryEntry("").family, "default");
    assert.equal(lookupModelRegistryEntry("anything-else").family, "default");
  });
});
