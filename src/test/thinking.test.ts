import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bodyRequestsThinking,
  extractThinkingOverride,
  resolveThinkingConfig,
  thinkingFamily,
  thinkingProviderFor,
  type ThinkingSettings,
} from "../thinking.js";
import { THINKING_DEFAULTS } from "../config.js";

/** Baseline settings used across tests — mirrors the default workspace config. */
const defaultSettings: ThinkingSettings = {
  deepseek: "off",
  glm: "off",
  kimi: "off",
  minimax: "off",
  openai: "off",
  qwen: "off",
  qwenBudget: "auto",
  mimo: "off",
  muse: "off",
};

/** Minimal reasoning-capable metadata used for schema tests. */
const reasoningMetadata = {
  reasoning: true,
  reasoningOptions: [{ type: "effort" as const, values: ["high", "max"] }],
  contextWindow: 202752,
  maxOutputTokens: 32768,
  supportsVision: false,
  supportsAudio: false,
  supportsVideo: false,
  supportsPdf: false,
  source: "models.dev" as const,
};

/**
 * Kimi K2.7-code thinking fix (issue #25):
 * the payload must always emit { thinking: { type: "enabled", keep: "all" } }
 * and the resolved setting is forced on — "disabled" is rejected with HTTP 400.
 */
describe("KimiThinking — kimi-k2.7-code (issue #25)", () => {
  it("always emits { type: 'enabled', keep: 'all' } even when thinking.kimi is 'off'", () => {
    const payload = thinkingProviderFor("kimi-k2.7-code").buildPayload({ ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });

  it("emits { type: 'enabled', keep: 'all' } when thinking.kimi is 'on'", () => {
    const payload = thinkingProviderFor("kimi-k2.7-code").buildPayload({ ...defaultSettings, kimi: "on" });
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });

  it("matches kimi-k2.7-code-highspeed variant too (same model, faster output)", () => {
    const payload = thinkingProviderFor("kimi-k2.7-code-highspeed").buildPayload(defaultSettings);
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });

  it("forces kimi='on' through resolve even when override requests 'off'", () => {
    const resolved = resolveThinkingConfig({
      modelId: "kimi-k2.7-code",
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.kimi, "on");
  });

  it("forces kimi='on' even with no override at all (defensive against stale cache)", () => {
    const resolved = resolveThinkingConfig({ modelId: "kimi-k2.7-code", workspace: defaultSettings });
    assert.equal(resolved.settings.kimi, "on");
  });
});

describe("KimiThinking — other kimi models", () => {
  it("kimi-k2.6 with kimi='off' emits { type: 'disabled' } (still accepts disabled)", () => {
    const payload = thinkingProviderFor("kimi-k2.6").buildPayload({ ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("kimi-k2.6 with kimi='on' emits { type: 'enabled' }", () => {
    const payload = thinkingProviderFor("kimi-k2.6").buildPayload({ ...defaultSettings, kimi: "on" });
    assert.deepEqual(payload, { thinking: { type: "enabled" } });
  });

  it("kimi-k2.5 with kimi='off' emits { type: 'disabled' }", () => {
    const payload = thinkingProviderFor("kimi-k2.5").buildPayload({ ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("respects 'off' override", () => {
    const resolved = resolveThinkingConfig({
      modelId: "kimi-k2.6",
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.kimi, "off");
  });

  it("respects 'on' override", () => {
    const resolved = resolveThinkingConfig({
      modelId: "kimi-k2.6",
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "on" },
    });
    assert.equal(resolved.settings.kimi, "on");
  });
});

describe("KimiThinking — picker schema", () => {
  it("kimi-k2.7-code exposes a single 'on' option with 'Always On (K2.7)' label", () => {
    const schema = thinkingProviderFor("kimi-k2.7-code").schema();
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["on"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Always On (K2.7)"]);
    assert.equal(reasoningEffort.default, "on");
  });

  it("kimi-k2.7-code description mentions the Moonshot API constraint", () => {
    const schema = thinkingProviderFor("kimi-k2.7-code").schema();
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    const descriptions = reasoningEffort.enumDescriptions as string[];
    assert.ok(
      descriptions.some((d) => d.includes("Moonshot API constraint")),
      "expected description to mention the Moonshot API constraint",
    );
  });

  it("kimi-k2.6 / kimi-k2.5 keep off/on", () => {
    for (const id of ["kimi-k2.6", "kimi-k2.5"]) {
      const schema = thinkingProviderFor(id).schema();
      assert.ok(schema);
      const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
      assert.deepEqual(reasoningEffort.enum, ["off", "on"]);
    }
  });
});

describe("DeepSeekThinking — payload", () => {
  it("deepseek with 'off' emits empty object (no reasoning_effort)", () => {
    const payload = thinkingProviderFor("deepseek-v4-pro").buildPayload({ ...defaultSettings, deepseek: "off" });
    assert.deepEqual(payload, {});
  });

  it("deepseek with 'high' emits reasoning_effort", () => {
    const payload = thinkingProviderFor("deepseek-v4-pro").buildPayload({ ...defaultSettings, deepseek: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });

  it("deepseek with 'max' emits reasoning_effort", () => {
    const payload = thinkingProviderFor("deepseek-v4-pro").buildPayload({ ...defaultSettings, deepseek: "max" });
    assert.deepEqual(payload, { reasoning_effort: "max" });
  });
});

describe("DeepSeekThinking — display (native reasoning model)", () => {
  it("never treats reasoning_content as visible content, even with thinking off on the Go gateway", () => {
    const provider = thinkingProviderFor("deepseek-v4-flash");
    assert.equal(
      provider.treatReasoningAsContent("https://opencode.ai/zen/go/v1/chat/completions", { ...defaultSettings, deepseek: "off" }),
      false,
    );
    assert.equal(
      provider.treatReasoningAsContent("https://opencode.ai/zen/go/v1/chat/completions", { ...defaultSettings, deepseek: "max" }),
      false,
    );
  });

  it("requestsThinking reflects the payload", () => {
    const provider = thinkingProviderFor("deepseek-v4-flash");
    assert.equal(provider.requestsThinking({ ...defaultSettings, deepseek: "off" }), false);
    assert.equal(provider.requestsThinking({ ...defaultSettings, deepseek: "high" }), true);
  });
});

describe("FallbackThinking — generic payload (issue #207)", () => {
  it("big-pickle gets a sampling-level repetition_penalty", () => {
    const payload = thinkingProviderFor("big-pickle").buildPayload(defaultSettings);
    assert.deepEqual(payload, { repetition_penalty: 1.2 });
  });

  it("requestsThinking stays false — the penalty is not a thinking request", () => {
    const provider = thinkingProviderFor("big-pickle");
    assert.equal(provider.requestsThinking(defaultSettings), false);
  });

  it("other unknown-family models emit no thinking fields", () => {
    const payload = thinkingProviderFor("hy3-preview").buildPayload(defaultSettings);
    assert.deepEqual(payload, {});
  });
});

describe("MimoThinking — payload + display (native reasoning model)", () => {
  it("mimo 'off' emits only repetition_penalty", () => {
    const payload = thinkingProviderFor("mimo-v2.5").buildPayload({ ...defaultSettings, mimo: "off" });
    assert.deepEqual(payload, { repetition_penalty: 1.2 });
  });

  it("mimo 'medium' emits reasoning_effort + budget_tokens + repetition_penalty", () => {
    const payload = thinkingProviderFor("mimo-v2.5").buildPayload({ ...defaultSettings, mimo: "medium" });
    assert.deepEqual(payload, { reasoning_effort: "medium", budget_tokens: 16384, repetition_penalty: 1.2 });
  });

  it("never surfaces reasoning_content as visible text (native reasoning model)", () => {
    const provider = thinkingProviderFor("mimo-v2.5");
    const goUrl = "https://opencode.ai/zen/go/v1/chat/completions";
    assert.equal(provider.treatReasoningAsContent(goUrl, { ...defaultSettings, mimo: "off" }), false);
    assert.equal(provider.treatReasoningAsContent(goUrl, { ...defaultSettings, mimo: "high" }), false);
    assert.equal(
      provider.treatReasoningAsContent("https://opencode.ai/zen/v1/chat/completions", { ...defaultSettings, mimo: "off" }),
      false,
    );
  });
});

describe("MuseThinking — payload + display (native reasoning model)", () => {
  it("muse 'off' emits empty object (no reasoning fields)", () => {
    const payload = thinkingProviderFor("muse-spark-1.2-contributor").buildPayload({ ...defaultSettings, muse: "off" });
    assert.deepEqual(payload, {});
  });

  it("muse 'high' emits nested reasoning.effort (Responses API)", () => {
    const payload = thinkingProviderFor("muse-spark-1.2-contributor").buildPayload({ ...defaultSettings, muse: "high" });
    assert.deepEqual(payload, { reasoning: { effort: "high" } });
  });

  it("never surfaces reasoning_content as visible text (native reasoning model)", () => {
    const provider = thinkingProviderFor("muse-spark-1.2-contributor");
    const responsesUrl = "https://opencode.ai/zen/go/v1/responses";
    assert.equal(provider.treatReasoningAsContent(responsesUrl, { ...defaultSettings, muse: "off" }), false);
    assert.equal(provider.treatReasoningAsContent(responsesUrl, { ...defaultSettings, muse: "high" }), false);
  });
});

describe("GLMThinking — payload (issue #61)", () => {
  it("glm-5.2 with glm='high' emits reasoning_effort: 'high'", () => {
    const payload = thinkingProviderFor("glm-5.2").buildPayload({ ...defaultSettings, glm: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });

  it("glm-5.2 with glm='max' emits reasoning_effort: 'max'", () => {
    const payload = thinkingProviderFor("glm-5.2").buildPayload({ ...defaultSettings, glm: "max" });
    assert.deepEqual(payload, { reasoning_effort: "max" });
  });

  it("glm-5.2 with glm='off' emits thinking disabled", () => {
    const payload = thinkingProviderFor("glm-5.2").buildPayload({ ...defaultSettings, glm: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("glm-5 (toggle-only) with glm='high' sends reasoning_effort (gateway resolves)", () => {
    const payload = thinkingProviderFor("glm-5").buildPayload({ ...defaultSettings, glm: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });
});

describe("GLMThinking — override (issue #61)", () => {
  it("accepts 'high' / 'max' / 'off' overrides for glm-5.2", () => {
    for (const value of ["high", "max", "off"]) {
      const resolved = resolveThinkingConfig({
        modelId: "glm-5.2",
        workspace: defaultSettings,
        modelConfiguration: { reasoningEffort: value },
      });
      assert.equal(resolved.settings.glm, value);
    }
  });

  it("rejects invalid values like 'on' and 'medium' for glm", () => {
    for (const value of ["on", "medium"]) {
      const resolved = resolveThinkingConfig({
        modelId: "glm-5.2",
        workspace: defaultSettings,
        modelConfiguration: { reasoningEffort: value },
      });
      assert.equal(resolved.settings.glm, "off"); // stays at default
    }
  });
});

describe("GLMThinking — picker schema", () => {
  it("exposes off/high/max when reasoning_options has effort values", () => {
    const schema = thinkingProviderFor("glm-5.2").schema(reasoningMetadata);
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "high", "max"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Off", "High", "Max"]);
    assert.equal(reasoningEffort.default, "off");
  });

  it("falls back to off/high/max for GLM models without reasoning_options (no invalid 'on')", () => {
    const schema = thinkingProviderFor("glm-5").schema();
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "high", "max"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Off", "High", "Max"]);
  });
});

describe("GLMThinking — glm-5.3 always-thinking (issue #162)", () => {
  it("forces glm='high' through resolve even with no override (defensive default)", () => {
    const resolved = resolveThinkingConfig({ modelId: "glm-5.3", workspace: defaultSettings });
    assert.equal(resolved.settings.glm, "high");
  });

  it("forces glm='high' even when override requests 'off' (stale cache)", () => {
    const resolved = resolveThinkingConfig({
      modelId: "glm-5.3",
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.glm, "high");
  });

  it("respects a valid 'max' override for glm-5.3", () => {
    const resolved = resolveThinkingConfig({
      modelId: "glm-5.3",
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "max" },
    });
    assert.equal(resolved.settings.glm, "max");
  });

  it("glm-5.3 with glm='high' emits reasoning_effort: 'high' (never disabled)", () => {
    const payload = thinkingProviderFor("glm-5.3").buildPayload({ ...defaultSettings, glm: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });

  it("glm-5.3 with glm='max' emits reasoning_effort: 'max'", () => {
    const payload = thinkingProviderFor("glm-5.3").buildPayload({ ...defaultSettings, glm: "max" });
    assert.deepEqual(payload, { reasoning_effort: "max" });
  });

  it("picker schema exposes only high/max (no 'off') and defaults to 'high'", () => {
    const schema = thinkingProviderFor("glm-5.3").schema();
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["high", "max"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["High", "Max"]);
    assert.equal(reasoningEffort.default, "high");
  });

  it("detects glm-5.3 variants (dot/hyphen, free/suffix) as always-thinking", () => {
    for (const id of ["glm-5.3", "glm-5.3-free", "glm-5-3", "glm-5.10", "glm-5.3-code"]) {
      const resolved = resolveThinkingConfig({ modelId: id, workspace: defaultSettings });
      assert.equal(resolved.settings.glm, "high", `expected ${id} to force thinking on`);
    }
  });

  it("still allows glm-5.2 / glm-5.1 / glm-5 to disable thinking", () => {
    for (const id of ["glm-5.2", "glm-5.1", "glm-5"]) {
      const payload = thinkingProviderFor(id).buildPayload({ ...defaultSettings, glm: "off" });
      assert.deepEqual(payload, { thinking: { type: "disabled" } }, `expected ${id} to allow disabled`);
    }
  });
});

describe("QwenThinking — payload per endpoint", () => {
  it("chat endpoint with qwen='off' emits enable_thinking: false", () => {
    const payload = thinkingProviderFor("qwen3.6-plus").buildPayload({ ...defaultSettings, qwen: "off" });
    assert.deepEqual(payload, { enable_thinking: false });
  });

  it("chat endpoint with qwen='on' + budget emits enable_thinking + thinking_budget", () => {
    const payload = thinkingProviderFor("qwen3.6-plus").buildPayload({ ...defaultSettings, qwen: "on", qwenBudget: "4096" });
    assert.deepEqual(payload, { enable_thinking: true, thinking_budget: 4096 });
  });

  it("messages endpoint with qwen='on' emits Anthropic thinking block", () => {
    const payload = thinkingProviderFor("qwen3.6-plus").buildPayload(
      { ...defaultSettings, qwen: "on", qwenBudget: "4096" },
      { endpoint: "messages" },
    );
    assert.deepEqual(payload, { thinking: { type: "enabled", budget_tokens: 4096 } });
  });

  it("messages endpoint with qwen='off' emits Anthropic disabled", () => {
    const payload = thinkingProviderFor("qwen3.6-plus").buildPayload({ ...defaultSettings, qwen: "off" }, { endpoint: "messages" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("messages endpoint with qwen='auto' emits nothing", () => {
    const payload = thinkingProviderFor("qwen3.6-plus").buildPayload({ ...defaultSettings, qwen: "auto" }, { endpoint: "messages" });
    assert.deepEqual(payload, {});
  });
});

describe("OpenAiThinking / MiniMaxThinking — payload shapes", () => {
  it("openai 'high' emits nested reasoning.effort (Responses API)", () => {
    const payload = thinkingProviderFor("gpt-5.6-luna").buildPayload({ ...defaultSettings, openai: "high" });
    assert.deepEqual(payload, { reasoning: { effort: "high" } });
  });

  it("openai 'off' emits nothing", () => {
    const payload = thinkingProviderFor("gpt-5.6-luna").buildPayload(defaultSettings);
    assert.deepEqual(payload, {});
  });

  it("minimax-m2 on emits Anthropic enabled; minimax-m3 on emits adaptive", () => {
    const m2 = thinkingProviderFor("minimax-m2.7").buildPayload({ ...defaultSettings, minimax: "on" });
    assert.deepEqual(m2, { thinking: { type: "enabled" } });
    const m3 = thinkingProviderFor("minimax-m3").buildPayload({ ...defaultSettings, minimax: "on" });
    assert.deepEqual(m3, { thinking: { type: "adaptive" } });
  });
});

describe("thinkingFamily — detection", () => {
  it("classifies kimi-k2.7-code as 'kimi'", () => {
    assert.equal(thinkingFamily("kimi-k2.7-code"), "kimi");
  });

  it("classifies kimi-k2.6 as 'kimi'", () => {
    assert.equal(thinkingFamily("kimi-k2.6"), "kimi");
  });

  it("classifies muse-spark-1.2-contributor as 'muse'", () => {
    assert.equal(thinkingFamily("muse-spark-1.2-contributor"), "muse");
  });

  it("returns null for unknown prefixes", () => {
    assert.equal(thinkingFamily("unknown-model"), null);
  });
});

describe("resolveThinkingConfig — provenance & priority", () => {
  it("modelConfiguration wins over the workspace default", () => {
    const resolved = resolveThinkingConfig({
      modelId: "deepseek-v4-pro",
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "max" },
    });
    assert.equal(resolved.settings.deepseek, "max");
    assert.equal(resolved.source, "modelConfiguration");
    assert.equal(resolved.overrideApplied, true);
  });

  it("falls back to workspace when no override exists", () => {
    const resolved = resolveThinkingConfig({ modelId: "deepseek-v4-pro", workspace: defaultSettings });
    assert.equal(resolved.settings.deepseek, "off");
    assert.equal(resolved.source, "workspace");
    assert.equal(resolved.overrideApplied, false);
  });

  it("a delivered modelConfiguration equal to workspace still reports modelConfiguration source", () => {
    const resolved = resolveThinkingConfig({
      modelId: "deepseek-v4-pro",
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.deepseek, "off");
    assert.equal(resolved.source, "modelConfiguration");
  });
});

describe("extractThinkingOverride", () => {
  it("picks string thinking keys only", () => {
    assert.deepEqual(extractThinkingOverride({ reasoningEffort: "max", contextSize: 131072 }), { reasoningEffort: "max" });
  });

  it("returns undefined for empty / absent config", () => {
    assert.equal(extractThinkingOverride(undefined), undefined);
    assert.equal(extractThinkingOverride({}), undefined);
    assert.equal(extractThinkingOverride({ contextSize: 5 }), undefined);
  });
});

describe("schema defaults stay aligned with THINKING_DEFAULTS", () => {
  it("reasoningEffort defaults match the workspace defaults per family", () => {
    const cases: Array<[string, string]> = [
      ["deepseek-v4-pro", "deepseek"],
      ["glm-5.2", "glm"],
      ["kimi-k2.6", "kimi"],
      ["minimax-m3", "minimax"],
      ["gpt-5.6-luna", "openai"],
      ["qwen3.6-plus", "qwen"],
      ["mimo-v2.5", "mimo"],
      ["muse-spark-1.2-contributor", "muse"],
    ];
    for (const [modelId, key] of cases) {
      const schema = thinkingProviderFor(modelId).schema();
      assert.ok(schema, `expected schema for ${modelId}`);
      const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
      assert.equal(reasoningEffort.default, THINKING_DEFAULTS[key as keyof typeof THINKING_DEFAULTS], `default mismatch for ${modelId}`);
    }
  });

  it("qwen thinkingBudget default matches THINKING_DEFAULTS.qwenBudget", () => {
    const schema = thinkingProviderFor("qwen3.6-plus").schema();
    assert.ok(schema);
    const budget = schema.properties.thinkingBudget as Record<string, unknown>;
    assert.equal(budget.default, THINKING_DEFAULTS.qwenBudget);
  });
});

describe("bodyRequestsThinking", () => {
  it("detects reasoning_effort", () => {
    assert.equal(bodyRequestsThinking({ reasoning_effort: "high" }), true);
  });

  it("detects budget_tokens", () => {
    assert.equal(bodyRequestsThinking({ budget_tokens: 8192 }), true);
  });

  it("detects enable_thinking: true", () => {
    assert.equal(bodyRequestsThinking({ enable_thinking: true }), true);
    assert.equal(bodyRequestsThinking({ enable_thinking: false }), false);
  });

  it("detects Anthropic-style thinking blocks (Kimi K2.7 / MiniMax M3)", () => {
    assert.equal(bodyRequestsThinking({ thinking: { type: "enabled", keep: "all" } }), true);
    assert.equal(bodyRequestsThinking({ thinking: { type: "adaptive" } }), true);
    assert.equal(bodyRequestsThinking({ thinking: { type: "disabled" } }), false);
  });

  it("returns false for empty or thinking-off bodies", () => {
    assert.equal(bodyRequestsThinking(undefined), false);
    assert.equal(bodyRequestsThinking({}), false);
    assert.equal(bodyRequestsThinking({ temperature: 0.2 }), false);
  });
});
