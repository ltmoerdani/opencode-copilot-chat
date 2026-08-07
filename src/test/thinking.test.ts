import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildThinkingPayload,
  buildFamilyThinkingSchema,
  applyRequestThinkingOverride,
  thinkingFamily,
  type ThinkingSettings,
} from "../thinking.js";

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
};

/**
 * Unit tests for the Kimi K2.7-code thinking fix (issue #25).
 *
 * ROOT CAUSE:
 * The extension sent `thinking: { type: "disabled" }` when the user kept the
 * default `kimi: "off"` setting. K2.7-code rejects "disabled" with HTTP 400:
 *   "invalid thinking: only type=enabled is allowed for this model"
 *
 * FIX: buildThinkingPayload special-cases /^kimi-k2\.7/i to always emit
 * { type: "enabled", keep: "all" } regardless of the user's thinking setting.
 */
describe("buildThinkingPayload — kimi-k2.7-code (issue #25)", () => {
  it("always emits { type: 'enabled', keep: 'all' } even when thinking.kimi is 'off'", () => {
    const payload = buildThinkingPayload("kimi-k2.7-code", { ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });

  it("emits { type: 'enabled', keep: 'all' } when thinking.kimi is 'on'", () => {
    const payload = buildThinkingPayload("kimi-k2.7-code", { ...defaultSettings, kimi: "on" });
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });

  it("matches kimi-k2.7-code-highspeed variant too (same model, faster output)", () => {
    const payload = buildThinkingPayload("kimi-k2.7-code-highspeed", defaultSettings);
    assert.deepEqual(payload, { thinking: { type: "enabled", keep: "all" } });
  });
});

describe("buildThinkingPayload — regression safety for other kimi models", () => {
  it("kimi-k2.6 with kimi='off' emits { type: 'disabled' } (still accepts disabled)", () => {
    const payload = buildThinkingPayload("kimi-k2.6", { ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("kimi-k2.6 with kimi='on' emits { type: 'enabled' }", () => {
    const payload = buildThinkingPayload("kimi-k2.6", { ...defaultSettings, kimi: "on" });
    assert.deepEqual(payload, { thinking: { type: "enabled" } });
  });

  it("kimi-k2.5 with kimi='off' emits { type: 'disabled' }", () => {
    const payload = buildThinkingPayload("kimi-k2.5", { ...defaultSettings, kimi: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });
});

describe("buildThinkingPayload — other families unchanged", () => {
  it("deepseek with 'off' emits empty object (no reasoning_effort)", () => {
    const payload = buildThinkingPayload("deepseek-v4-pro", { ...defaultSettings, deepseek: "off" });
    assert.deepEqual(payload, {});
  });

  it("deepseek with 'high' emits reasoning_effort", () => {
    const payload = buildThinkingPayload("deepseek-v4-pro", { ...defaultSettings, deepseek: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });

  it("glm with 'off' emits { type: 'disabled' }", () => {
    const payload = buildThinkingPayload("glm-5", { ...defaultSettings, glm: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("qwen with 'off' emits enable_thinking: false", () => {
    const payload = buildThinkingPayload("qwen3.6-plus", { ...defaultSettings, qwen: "off" });
    assert.deepEqual(payload, { enable_thinking: false });
  });
});

/**
 * Schema tests: the picker must show a single "Always On (K2.7)" option so
 * users understand thinking cannot be disabled, rather than hiding the picker
 * or silently forcing "on".
 */
describe("buildFamilyThinkingSchema — kimi-k2.7-code picker", () => {
  it("exposes a single 'on' option with 'Always On (K2.7)' label", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.7-code");
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["on"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Always On (K2.7)"]);
    assert.equal(reasoningEffort.default, "on");
  });

  it("mentions the Moonshot API constraint in the description", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.7-code");
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    const descriptions = reasoningEffort.enumDescriptions as string[];
    assert.ok(
      descriptions.some((d) => d.includes("Moonshot API constraint")),
      "expected description to mention the Moonshot API constraint",
    );
  });
});

describe("buildFamilyThinkingSchema — other kimi models keep off/on", () => {
  it("kimi-k2.6 exposes both 'off' and 'on'", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.6");
    assert.ok(schema);
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "on"]);
  });

  it("kimi-k2.5 exposes both 'off' and 'on'", () => {
    const schema = buildFamilyThinkingSchema("kimi-k2.5");
    assert.ok(schema);
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "on"]);
  });
});

/**
 * Override tests: even if VS Code caches a stale picker value (e.g. "off"),
 * applyRequestThinkingOverride must force kimi="on" for K2.7-code.
 */
describe("applyRequestThinkingOverride — kimi-k2.7-code defensive force-on", () => {
  it("forces kimi='on' even when override requests 'off'", () => {
    const result = applyRequestThinkingOverride("kimi-k2.7-code", defaultSettings, {
      reasoningEffort: "off",
    });
    assert.equal(result.kimi, "on");
  });

  it("forces kimi='on' even when override requests 'on' (no-op but explicit)", () => {
    const result = applyRequestThinkingOverride("kimi-k2.7-code", defaultSettings, {
      reasoningEffort: "on",
    });
    assert.equal(result.kimi, "on");
  });

  it("forces kimi='on' when override is empty (defensive against stale cache)", () => {
    const result = applyRequestThinkingOverride("kimi-k2.7-code", defaultSettings, {});
    assert.equal(result.kimi, "on");
  });
});

describe("applyRequestThinkingOverride — other kimi models respect override", () => {
  it("kimi-k2.6 respects 'off' override", () => {
    const result = applyRequestThinkingOverride("kimi-k2.6", defaultSettings, {
      reasoningEffort: "off",
    });
    assert.equal(result.kimi, "off");
  });

  it("kimi-k2.6 respects 'on' override", () => {
    const result = applyRequestThinkingOverride("kimi-k2.6", defaultSettings, {
      reasoningEffort: "on",
    });
    assert.equal(result.kimi, "on");
  });
});

describe("thinkingFamily — detection", () => {
  it("classifies kimi-k2.7-code as 'kimi'", () => {
    assert.equal(thinkingFamily("kimi-k2.7-code"), "kimi");
  });

  it("classifies kimi-k2.6 as 'kimi'", () => {
    assert.equal(thinkingFamily("kimi-k2.6"), "kimi");
  });

  it("returns null for unknown prefixes", () => {
    assert.equal(thinkingFamily("unknown-model"), null);
  });
});

/**
 * Tests for GLM models with effort-style reasoning (issue #61).
 *
 * models.dev reports:
 *   glm-5.2 → reasoning_options = [{ type: "effort", values: ["high", "max"] }]
 *   glm-5.1 → no reasoning_options (toggle-based)
 *   glm-5   → no reasoning_options (toggle-based)
 *
 * The new "high"/"max" values must map to thinking enabled in the payload,
 * and the per-model picker should expose only the relevant options.
 */
describe("buildThinkingPayload — GLM with effort values (issue #61)", () => {
  it("glm-5.2 with glm='high' emits reasoning_effort: 'high'", () => {
    const payload = buildThinkingPayload("glm-5.2", { ...defaultSettings, glm: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });

  it("glm-5.2 with glm='max' emits reasoning_effort: 'max'", () => {
    const payload = buildThinkingPayload("glm-5.2", { ...defaultSettings, glm: "max" });
    assert.deepEqual(payload, { reasoning_effort: "max" });
  });

  it("glm-5.2 with glm='off' emits thinking disabled", () => {
    const payload = buildThinkingPayload("glm-5.2", { ...defaultSettings, glm: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });

  it("glm-5 (toggle-only) with glm='high' sends reasoning_effort (gateway resolves)", () => {
    const payload = buildThinkingPayload("glm-5", { ...defaultSettings, glm: "high" });
    assert.deepEqual(payload, { reasoning_effort: "high" });
  });

  it("glm-5 (toggle-only) with glm='off' emits thinking disabled", () => {
    const payload = buildThinkingPayload("glm-5", { ...defaultSettings, glm: "off" });
    assert.deepEqual(payload, { thinking: { type: "disabled" } });
  });
});

describe("buildFamilyThinkingSchema — GLM 5.2 with reasoning_options metadata", () => {
  it("exposes off, high, max when reasoning_options has effort values", () => {
    const metadata = {
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
    const schema = buildFamilyThinkingSchema("glm-5.2", metadata);
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "high", "max"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Off", "High", "Max"]);
    assert.equal(reasoningEffort.default, "off");
  });

  it("falls back to off/high/max for GLM models without reasoning_options (no invalid 'on')", () => {
    const schema = buildFamilyThinkingSchema("glm-5");
    assert.ok(schema, "expected schema to be defined");
    const reasoningEffort = schema!.properties.reasoningEffort as Record<string, unknown>;
    assert.deepEqual(reasoningEffort.enum, ["off", "high", "max"]);
    assert.deepEqual(reasoningEffort.enumItemLabels, ["Off", "High", "Max"]);
  });
});

describe("applyRequestThinkingOverride — GLM with effort values (issue #61)", () => {
  it("accepts 'high' override for glm-5.2", () => {
    const result = applyRequestThinkingOverride("glm-5.2", defaultSettings, {
      reasoningEffort: "high",
    });
    assert.equal(result.glm, "high");
  });

  it("accepts 'max' override for glm-5.2", () => {
    const result = applyRequestThinkingOverride("glm-5.2", defaultSettings, {
      reasoningEffort: "max",
    });
    assert.equal(result.glm, "max");
  });

  it("accepts 'off' override for glm-5.2", () => {
    const result = applyRequestThinkingOverride("glm-5.2", defaultSettings, {
      reasoningEffort: "off",
    });
    assert.equal(result.glm, "off");
  });

  it("rejects invalid values like 'on' and 'medium' for glm", () => {
    const resultOn = applyRequestThinkingOverride("glm-5.2", defaultSettings, {
      reasoningEffort: "on",
    });
    assert.equal(resultOn.glm, "off"); // stays at default
    const resultMed = applyRequestThinkingOverride("glm-5.2", defaultSettings, {
      reasoningEffort: "medium",
    });
    assert.equal(resultMed.glm, "off"); // stays at default
  });
});
