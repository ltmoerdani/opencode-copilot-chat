import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bodyRequestsThinking,
  extractThinkingOverride,
  resolveThinkingConfig,
  stripSchemaDefaultEcho,
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
  gemini: "off",
  generic: "off",
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
 * A model that reports reasoning support but declares no `reasoning_options` —
 * the "new model this build has never heard of" case (e.g. `space-bunny-free`).
 */
const genericReasoningMetadata = {
  reasoning: true,
  contextWindow: 202752,
  maxOutputTokens: 32768,
  supportsVision: false,
  supportsAudio: false,
  supportsVideo: false,
  supportsPdf: false,
  source: "models.dev" as const,
};

/** A model that reports NO reasoning support. */
const nonReasoningMetadata = {
  reasoning: false,
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
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.kimi, "on");
  });

  it("forces kimi='on' even with no override at all (defensive against stale cache)", () => {
    const resolved = resolveThinkingConfig({ modelId: "kimi-k2.7-code", metadata: genericReasoningMetadata, workspace: defaultSettings });
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
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.kimi, "off");
  });

  it("respects 'on' override", () => {
    const resolved = resolveThinkingConfig({
      modelId: "kimi-k2.6",
      metadata: genericReasoningMetadata,
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
    const payload = thinkingProviderFor("hy3").buildPayload(defaultSettings);
    assert.deepEqual(payload, {});
  });
});

/**
 * Generic reasoning support for models released after this build: the
 * models.dev `reasoning` flag alone decides whether a model gets a picker and
 * a `reasoning_effort`, with no per-family code involved.
 */
describe("FallbackThinking — unknown reasoning-capable models", () => {
  it("gets the generic off→max schema when it declares no reasoning_options", () => {
    const schema = thinkingProviderFor("space-bunny-free", genericReasoningMetadata).schema(genericReasoningMetadata);
    assert.ok(schema, "expected a generic reasoning schema");
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Off", "Low", "Medium", "High", "XHigh", "Max"]);
    assert.equal(reasoningEffort.default, "off");
  });

  it("the generic schema default tracks THINKING_DEFAULTS.generic", () => {
    const schema = thinkingProviderFor("space-bunny-free", genericReasoningMetadata).schema(genericReasoningMetadata);
    assert.ok(schema);
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    assert.equal(reasoningEffort.default, THINKING_DEFAULTS.generic);
  });

  it("emits a plain OpenAI-compatible reasoning_effort for every non-off level", () => {
    const provider = thinkingProviderFor("space-bunny-free", genericReasoningMetadata);
    for (const level of ["low", "medium", "high", "xhigh", "max"]) {
      const payload = provider.buildPayload({ ...defaultSettings, generic: level });
      assert.deepEqual(payload, { reasoning_effort: level }, `expected ${level} to be emitted`);
    }
  });

  it("'off' — the default — emits nothing and reports no thinking request", () => {
    const provider = thinkingProviderFor("space-bunny-free", genericReasoningMetadata);
    assert.deepEqual(provider.buildPayload(defaultSettings), {});
    assert.equal(provider.requestsThinking(defaultSettings), false);
    assert.equal(provider.requestsThinking({ ...defaultSettings, generic: "high" }), true);
  });

  it("carries a picker pick all the way to the request body", () => {
    // The full production path: VS Code delivers the pick in modelConfiguration,
    // resolveThinkingConfig maps it onto the family settings, and the request
    // builder spreads buildPayload into the body.
    const resolved = resolveThinkingConfig({
      modelId: "space-bunny-free",
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "max" },
    });
    assert.equal(resolved.source, "modelConfiguration");
    const payload = thinkingProviderFor("space-bunny-free", genericReasoningMetadata).buildPayload(resolved.settings);
    assert.deepEqual(payload, { reasoning_effort: "max" });
  });

  it("strips the schema-default 'off' echo so the workspace setting still wins (issue #226)", () => {
    // Depends on `metadata` reaching resolveThinkingConfig: without it the
    // picker schema is unknown, no default is stripped, and VS Code's "off"
    // baseline would clobber the user's workspace pick.
    const resolved = resolveThinkingConfig({
      modelId: "space-bunny-free",
      metadata: genericReasoningMetadata,
      workspace: { ...defaultSettings, generic: "high" },
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.generic, "high");
    assert.equal(resolved.source, "workspace");
  });

  it("prefers the model's own models.dev reasoning_options when it declares them", () => {
    const schema = thinkingProviderFor("hy4", reasoningMetadata).schema(reasoningMetadata);
    assert.ok(schema);
    const reasoningEffort = schema.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "high", "max"]);
  });

  it("applies an override for its own picker levels, not just the generic ladder", () => {
    const resolved = resolveThinkingConfig({
      modelId: "hy4",
      metadata: reasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "max" },
    });
    assert.equal(resolved.settings.generic, "max");
    assert.equal(resolved.source, "modelConfiguration");
  });

  it("keeps the repetition penalty alongside the effort for penalised models", () => {
    const provider = thinkingProviderFor("big-pickle", genericReasoningMetadata);
    assert.deepEqual(provider.buildPayload(defaultSettings), { repetition_penalty: 1.2 });
    assert.deepEqual(provider.buildPayload({ ...defaultSettings, generic: "high" }), {
      repetition_penalty: 1.2,
      reasoning_effort: "high",
    });
  });
});

describe("FallbackThinking — unknown models without reasoning support", () => {
  it("gets no schema at all, so no picker is shown", () => {
    assert.equal(thinkingProviderFor("hy3", nonReasoningMetadata).schema(nonReasoningMetadata), undefined);
  });

  it("emits no reasoning payload even if a pick is somehow delivered", () => {
    const provider = thinkingProviderFor("hy3", nonReasoningMetadata);
    assert.deepEqual(provider.buildPayload({ ...defaultSettings, generic: "high" }), {});
    assert.equal(provider.requestsThinking({ ...defaultSettings, generic: "high" }), false);
  });

  it("a model with no metadata at all stays inert (metadata unknown, not assumed capable)", () => {
    const provider = thinkingProviderFor("hy3");
    assert.equal(provider.schema(), undefined);
    assert.deepEqual(provider.buildPayload({ ...defaultSettings, generic: "high" }), {});
  });
});

describe("FallbackThinking — family-less models on non-chat endpoints stay inert", () => {
  // `reasoning_effort` means nothing on these wire formats, so a picker there
  // would be a control that silently does nothing (or 400s the request).
  // gemini-* used to sit here too — it now owns a Google-native strategy (see
  // the GeminiThinking block).
  it("claude-* and grok-* get neither picker nor payload", () => {
    for (const id of ["claude-sonnet-4.6", "grok-4.6"]) {
      const provider = thinkingProviderFor(id, genericReasoningMetadata);
      assert.equal(provider.schema(genericReasoningMetadata), undefined, `expected no picker for ${id}`);
      assert.deepEqual(provider.buildPayload({ ...defaultSettings, generic: "high" }), {}, `expected no payload for ${id}`);
    }
  });
});

describe("known families keep their own strategy (generic setting must not leak)", () => {
  it("each known family still builds its family-specific payload shape", () => {
    const cases: Array<[string, ThinkingSettings, Record<string, unknown>]> = [
      ["deepseek-v4-pro", { ...defaultSettings, deepseek: "high" }, { reasoning_effort: "high" }],
      ["glm-5.2", { ...defaultSettings, glm: "max" }, { reasoning_effort: "max" }],
      ["kimi-k2.6", { ...defaultSettings, kimi: "on" }, { thinking: { type: "enabled" } }],
      ["minimax-m3", { ...defaultSettings, minimax: "on" }, { thinking: { type: "adaptive" } }],
      ["mimo-v2.5", { ...defaultSettings, mimo: "medium" }, { reasoning_effort: "medium", budget_tokens: 16384, repetition_penalty: 1.2 }],
      ["qwen3.6-plus", { ...defaultSettings, qwen: "on" }, { enable_thinking: true }],
      ["gpt-5.6-luna", { ...defaultSettings, openai: "high" }, { reasoning: { effort: "high" } }],
      ["muse-spark-1.2-contributor", { ...defaultSettings, muse: "high" }, { reasoning: { effort: "high" } }],
    ];
    for (const [modelId, settings, expected] of cases) {
      assert.deepEqual(thinkingProviderFor(modelId).buildPayload(settings), expected, `payload changed for ${modelId}`);
    }
  });

  it("the generic setting never reaches a known family's payload", () => {
    for (const modelId of [
      "deepseek-v4-pro",
      "glm-5.2",
      "kimi-k2.6",
      "minimax-m3",
      "mimo-v2.5",
      "qwen3.6-plus",
      "gpt-5.6-luna",
      "muse-spark-1.2-contributor",
    ]) {
      // Same body with and without a generic pick — the family keeps its own shape.
      const provider = thinkingProviderFor(modelId, genericReasoningMetadata);
      assert.deepEqual(
        provider.buildPayload({ ...defaultSettings, generic: "high" }),
        provider.buildPayload(defaultSettings),
        `${modelId} must ignore the generic effort`,
      );
    }
  });

  it("a known family's override still maps onto its own field", () => {
    const resolved = resolveThinkingConfig({
      modelId: "deepseek-v4-pro",
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "max" },
    });
    assert.equal(resolved.settings.deepseek, "max");
    assert.equal(resolved.settings.generic, "off");
  });

  it("ignores a delivered pick for a model metadata says cannot reason", () => {
    const resolved = resolveThinkingConfig({
      modelId: "hy3",
      metadata: nonReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "high" },
    });
    assert.equal(resolved.settings.generic, "off");
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

describe("GeminiThinking — payload (Google thinkingConfig)", () => {
  it("gemini 'off' emits empty object (model default, no thinking config)", () => {
    const payload = thinkingProviderFor("gemini-4-argon-contributor").buildPayload({ ...defaultSettings, gemini: "off" });
    assert.deepEqual(payload, {});
  });

  it("gemini 'high' emits thinkingConfig.thinkingLevel + includeThoughts", () => {
    const payload = thinkingProviderFor("gemini-4-argon-contributor").buildPayload(
      { ...defaultSettings, gemini: "high" },
      { endpoint: "google" },
    );
    assert.deepEqual(payload, { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } });
  });

  it("gemini 'on' surfaces thoughts without pinning a level", () => {
    const payload = thinkingProviderFor("gemini-4-argon-contributor").buildPayload({ ...defaultSettings, gemini: "on" });
    assert.deepEqual(payload, { thinkingConfig: { includeThoughts: true } });
  });

  it("requestsThinking mirrors the picked level", () => {
    const provider = thinkingProviderFor("gemini-4-argon-contributor");
    assert.equal(provider.requestsThinking({ ...defaultSettings, gemini: "off" }), false);
    assert.equal(provider.requestsThinking({ ...defaultSettings, gemini: "low" }), true);
  });

  it("never surfaces reasoning_content as visible text (thought parts are CoT)", () => {
    const provider = thinkingProviderFor("gemini-3.5-flash");
    assert.equal(
      provider.treatReasoningAsContent("https://opencode.ai/zen/v1/models/gemini-3.5-flash", { ...defaultSettings, gemini: "high" }),
      false,
    );
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
        metadata: genericReasoningMetadata,
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
        metadata: genericReasoningMetadata,
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
    const resolved = resolveThinkingConfig({ modelId: "glm-5.3", metadata: genericReasoningMetadata, workspace: defaultSettings });
    assert.equal(resolved.settings.glm, "high");
  });

  it("forces glm='high' even when override requests 'off' (stale cache)", () => {
    const resolved = resolveThinkingConfig({
      modelId: "glm-5.3",
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.glm, "high");
  });

  it("respects a valid 'max' override for glm-5.3", () => {
    const resolved = resolveThinkingConfig({
      modelId: "glm-5.3",
      metadata: genericReasoningMetadata,
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
      const resolved = resolveThinkingConfig({ modelId: id, metadata: genericReasoningMetadata, workspace: defaultSettings });
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
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "max" },
    });
    assert.equal(resolved.settings.deepseek, "max");
    assert.equal(resolved.source, "modelConfiguration");
    assert.equal(resolved.overrideApplied, true);
  });

  it("falls back to workspace when no override exists", () => {
    const resolved = resolveThinkingConfig({ modelId: "deepseek-v4-pro", metadata: genericReasoningMetadata, workspace: defaultSettings });
    assert.equal(resolved.settings.deepseek, "off");
    assert.equal(resolved.source, "workspace");
    assert.equal(resolved.overrideApplied, false);
  });

  it("a delivered schema-default echo is ignored so the workspace default wins (issue #226)", () => {
    const resolved = resolveThinkingConfig({
      modelId: "deepseek-v4-pro",
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.deepseek, "off");
    assert.equal(resolved.source, "workspace");
    assert.equal(resolved.overrideApplied, false);
  });

  it("a schema-default echo does not mask a non-default workspace setting (issue #226)", () => {
    const resolved = resolveThinkingConfig({
      modelId: "deepseek-v4-pro",
      metadata: genericReasoningMetadata,
      workspace: { ...defaultSettings, deepseek: "high" },
      modelConfiguration: { reasoningEffort: "off" },
    });
    assert.equal(resolved.settings.deepseek, "high");
    assert.equal(resolved.source, "workspace");
    assert.equal(resolved.overrideApplied, false);
  });

  it("echo stripping is per-key: a real choice beside an echo still applies", () => {
    const resolved = resolveThinkingConfig({
      modelId: "qwen3.6-plus",
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "off", thinkingBudget: "16384" },
    });
    assert.equal(resolved.settings.qwenBudget, "16384");
    assert.equal(resolved.source, "modelConfiguration");
  });

  it("models whose schema default is not 'off' strip their own default too (kimi-k2.7-code)", () => {
    const resolved = resolveThinkingConfig({
      modelId: "kimi-k2.7-code",
      metadata: genericReasoningMetadata,
      workspace: defaultSettings,
      modelConfiguration: { reasoningEffort: "on" },
    });
    assert.equal(resolved.source, "workspace");
    assert.equal(resolved.overrideApplied, false);
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

  it("stripSchemaDefaultEcho drops keys equal to the declared default and keeps the rest", () => {
    const defaults = { reasoningEffort: "off", thinkingBudget: "auto" };
    assert.equal(stripSchemaDefaultEcho(undefined, defaults), undefined);
    assert.deepEqual(stripSchemaDefaultEcho({ reasoningEffort: "off" }, defaults), undefined);
    assert.deepEqual(stripSchemaDefaultEcho({ reasoningEffort: "high" }, defaults), { reasoningEffort: "high" });
    // Keys without a declared default are kept as-is.
    assert.deepEqual(stripSchemaDefaultEcho({ reasoningEffort: "on" }, {}), { reasoningEffort: "on" });
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
      ["gemini-4-argon-contributor", "gemini"],
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
