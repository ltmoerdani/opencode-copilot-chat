import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fallbackModelMetadata,
  getContextSizeOptionsForModel,
  normalizeLiveModelMetadata,
  resolveModelMetadata,
  VISION_CAPABLE_MODELS,
  type CachedModelMetadataSnapshot,
} from "../models/metadata.js";
import { GO_VENDOR, ZEN_VENDOR } from "../providerTypes.js";

/**
 * Unit tests for the kimi-k2.7-code fallback metadata fix (issue #25).
 *
 * CONTEXT:
 * kimi-k2.7-code is a new Moonshot model with breaking changes:
 * 1. `thinking.type` only accepts "enabled" (not "disabled")
 * 2. The `temperature` request parameter is rejected (only 1 is allowed)
 *
 * These tests verify the bundled fallback metadata is correct even when the
 * live models.dev fetch is unavailable.
 */
describe("fallbackModelMetadata — kimi-k2.7-code (issue #25)", () => {
  it("returns metadata for kimi-k2.7-code on GO_VENDOR", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.ok(meta, "expected fallback metadata to be defined");
  });

  it("reports temperature: false (Moonshot rejects non-default temperature)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.temperature, false);
  });

  it("reports correct context/output limits (models.dev: 256000 / 262144)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.contextWindow, 256000);
    assert.equal(meta.maxOutputTokens, 262144);
  });

  it("reports vision capability (models.dev attachment: true)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.supportsVision, true);
  });

  it("reports reasoning capability (supportsReasoning matches /^kimi-/i)", () => {
    const meta = fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR);
    assert.equal(meta?.reasoning, true);
  });
});

describe("fallbackModelMetadata — deepseek-v4-flash completion cap (issue #171)", () => {
  it("reports the Go gateway completion cap (131072), not the stale models.dev value", () => {
    const meta = fallbackModelMetadata("deepseek-v4-flash", GO_VENDOR);
    assert.ok(meta, "expected fallback metadata to be defined");
    assert.equal(meta.contextWindow, 1000000);
    assert.equal(meta.maxOutputTokens, 131072);
  });
});

describe("fallbackModelMetadata — regression safety for other kimi models", () => {
  it("kimi-k2.6 does NOT report temperature: false (still accepts temperature)", () => {
    const meta = fallbackModelMetadata("kimi-k2.6", GO_VENDOR);
    // temperature should be undefined (not false) so the request body still
    // includes the configured temperature for k2.6.
    assert.notEqual(meta?.temperature, false);
  });

  it("kimi-k2.5 does NOT report temperature: false", () => {
    const meta = fallbackModelMetadata("kimi-k2.5", GO_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });
});

describe("fallbackModelMetadata — non-kimi models unaffected", () => {
  it("glm-5 does not report temperature: false", () => {
    const meta = fallbackModelMetadata("glm-5", GO_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });

  it("deepseek-v4-pro does not report temperature: false", () => {
    const meta = fallbackModelMetadata("deepseek-v4-pro", GO_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });

  it("claude-opus-4-7 on ZEN does not report temperature: false", () => {
    const meta = fallbackModelMetadata("claude-opus-4-7", ZEN_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });
});

describe("VISION_CAPABLE_MODELS", () => {
  it("includes known vision models (minimax-m2.7, kimi-k2.6, mimo-v2.5)", () => {
    assert.ok(VISION_CAPABLE_MODELS.has("minimax-m2.7"));
    assert.ok(VISION_CAPABLE_MODELS.has("kimi-k2.6"));
    assert.ok(VISION_CAPABLE_MODELS.has("mimo-v2.5"));
    assert.ok(VISION_CAPABLE_MODELS.has("glm-5.1"));
    assert.ok(VISION_CAPABLE_MODELS.has("mimo-v2.5-pro"));
  });

  it("does NOT include text-only models (deepseek-v4-flash, hy3-preview, big-pickle)", () => {
    assert.ok(!VISION_CAPABLE_MODELS.has("deepseek-v4-flash"));
    assert.ok(!VISION_CAPABLE_MODELS.has("deepseek-v4-pro"));
    assert.ok(!VISION_CAPABLE_MODELS.has("hy3-preview"));
    assert.ok(!VISION_CAPABLE_MODELS.has("big-pickle"));
  });

  it("includes both Muse Spark 1.2 variants (models.dev lists image input) (#183)", () => {
    assert.ok(VISION_CAPABLE_MODELS.has("muse-spark-1.2-contributor"));
    assert.ok(VISION_CAPABLE_MODELS.has("muse-spark-1.2-contributor-free"));
  });

  it("is an exported Set", () => {
    assert.ok(VISION_CAPABLE_MODELS instanceof Set);
    assert.ok(VISION_CAPABLE_MODELS.size > 10);
  });
});

describe("getContextSizeOptionsForModel — Kimi context tiers (issue #87)", () => {
  it("offers 256K and the full window when Kimi has a larger context", () => {
    const options = getContextSizeOptionsForModel("kimi-k3", { input: 3, output: 15 }, 1_048_576);

    assert.deepEqual(
      options?.map((option) => option.value),
      [256_000, 1_048_576],
    );
    assert.equal(options[0].isDefault, true);
    assert.equal(options[1].description, "Higher pricing");
  });

  it("recognizes the official short K3 model id", () => {
    const options = getContextSizeOptionsForModel("k3", undefined, 1_000_000);
    assert.deepEqual(
      options?.map((option) => option.value),
      [256_000, 1_000_000],
    );
  });

  it("does not add a redundant tier to a 256K Kimi model", () => {
    assert.equal(getContextSizeOptionsForModel("kimi-k2.6", { input: 0.95, output: 4 }, 262_144), undefined);
  });

  it("prefers explicit models.dev pricing tiers", () => {
    const options = getContextSizeOptionsForModel(
      "kimi-k3",
      {
        input: 3,
        output: 15,
        tiers: [{ input: 3, output: 15, tier: { type: "context", size: 200_000 } }],
      },
      1_048_576,
    );

    assert.deepEqual(
      options?.map((option) => option.value),
      [200_000, 1_048_576],
    );
  });
});

describe("resolveModelMetadata — cold-start temperature chain", () => {
  const emptySnapshot: CachedModelMetadataSnapshot = { fetchedAt: 0, providers: { opencodego: {}, opencodezen: {} } };

  it("propagates the bundled temperature:false when no live/cached metadata exists", () => {
    const resolved = resolveModelMetadata("kimi-k2.7-code", GO_VENDOR, emptySnapshot, new Map());
    assert.equal(resolved.temperature, false, "cold start must omit temperature for kimi-k2.7-code");
  });

  it("keeps temperature undefined for models without the restriction", () => {
    const resolved = resolveModelMetadata("glm-5", GO_VENDOR, emptySnapshot, new Map());
    assert.notEqual(resolved.temperature, false);
  });
});

describe("normalizeLiveModelMetadata — modality-based vision detection", () => {
  it("advertises vision only for actual image modalities", () => {
    const imageModel = normalizeLiveModelMetadata({ id: "m", modalities: { input: ["text", "image"] } });
    assert.equal(imageModel?.supportsVision, true);
  });

  it("does NOT advertise vision for audio/pdf/video-only models", () => {
    const audioOnly = normalizeLiveModelMetadata({ id: "m", modalities: { input: ["text", "audio"] } });
    assert.notEqual(audioOnly?.supportsVision, true);
    const pdfOnly = normalizeLiveModelMetadata({ id: "m", modalities: { input: ["text", "pdf"] } });
    assert.notEqual(pdfOnly?.supportsVision, true);
    const videoOnly = normalizeLiveModelMetadata({ id: "m", modalities: { input: ["text", "video"] } });
    assert.notEqual(videoOnly?.supportsVision, true);
  });

  it("still distinguishes audio/video/pdf flags", () => {
    const audioModel = normalizeLiveModelMetadata({ id: "m", modalities: { input: ["audio", "text"] } });
    assert.ok(audioModel);
    assert.equal(audioModel.supportsAudio, true);
    assert.equal(audioModel.supportsVision, undefined);
    const videoModel = normalizeLiveModelMetadata({ id: "m", modalities: { input: ["video", "text"] } });
    assert.ok(videoModel);
    assert.equal(videoModel.supportsVideo, true);
    const pdfModel = normalizeLiveModelMetadata({ id: "m", modalities: { input: ["pdf", "text"] } });
    assert.ok(pdfModel);
    assert.equal(pdfModel.supportsPdf, true);
  });

  it("falls back to the attachment hint when modalities are absent", () => {
    const attached = normalizeLiveModelMetadata({ id: "m", attachment: true });
    assert.equal(attached?.supportsVision, true);
    const plain = normalizeLiveModelMetadata({ id: "m" });
    assert.notEqual(plain?.supportsVision, true);
  });
});

describe("fallbackModelMetadata — Muse Spark 1.2 limits", () => {
  it("returns context/output limits for the Go contributor variant", () => {
    const meta = fallbackModelMetadata("muse-spark-1.2-contributor", GO_VENDOR);
    assert.ok(meta, "expected fallback metadata for muse-spark-1.2-contributor");
    assert.equal(meta.contextWindow, 1_048_576);
    assert.equal(meta.maxOutputTokens, 131_072);
  });

  it("returns context/output limits for the Zen free variant", () => {
    const meta = fallbackModelMetadata("muse-spark-1.2-contributor-free", ZEN_VENDOR);
    assert.ok(meta, "expected fallback metadata for muse-spark-1.2-contributor-free");
    assert.equal(meta.contextWindow, 1_048_576);
    assert.equal(meta.maxOutputTokens, 131_072);
  });

  it("does NOT report temperature: false (temperature is accepted)", () => {
    const meta = fallbackModelMetadata("muse-spark-1.2-contributor", GO_VENDOR);
    assert.notEqual(meta?.temperature, false);
  });
});
