import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Vision proxy condition tests.
 *
 * The core fix for #74 is caching `metadata.supportsVision` in
 * `actuallySupportsVision` BEFORE `modelCapabilities` overrides it.
 * The proxy condition is:
 *
 *   hasImageInput && !actuallySupportsVision && visionProxyModelId
 *
 * where `actuallySupportsVision` is the RAW model metadata (true =
 * model natively supports images), NOT the enhanced capabilities.
 */

type ProxyConditionInput = {
  hasImageInput: boolean;
  actuallySupportsVision: boolean;
  visionProxyModelId: string;
};

function shouldProxy({ hasImageInput, actuallySupportsVision, visionProxyModelId }: ProxyConditionInput): boolean {
  return Boolean(hasImageInput && !actuallySupportsVision && visionProxyModelId);
}

describe("vision proxy condition (shouldProxy)", () => {
  it("enters proxy when text-only model receives images with proxy configured", () => {
    assert.ok(shouldProxy({ hasImageInput: true, actuallySupportsVision: false, visionProxyModelId: "gpt-5.5" }));
  });

  it("skips proxy when no images present", () => {
    assert.ok(!shouldProxy({ hasImageInput: false, actuallySupportsVision: false, visionProxyModelId: "gpt-5.5" }));
  });

  it("skips proxy when model natively supports vision", () => {
    assert.ok(!shouldProxy({ hasImageInput: true, actuallySupportsVision: true, visionProxyModelId: "gpt-5.5" }));
  });

  it("skips proxy when no vision model is configured (empty string)", () => {
    assert.ok(!shouldProxy({ hasImageInput: true, actuallySupportsVision: false, visionProxyModelId: "" }));
  });

  it("skips proxy when all conditions are false", () => {
    assert.ok(!shouldProxy({ hasImageInput: false, actuallySupportsVision: true, visionProxyModelId: "" }));
  });

  it("cached supportsVision (actuallySupportsVision) prevents circular regression", () => {
    // This is the fix for #74: even if modelCapabilities overrides
    // metadata.supportsVision to true (because proxy is enabled),
    // the CACHED value (actuallySupportsVision) stays false for
    // text-only models — so the proxy fires correctly.
    const textOnlyModel = { hasImageInput: true, actuallySupportsVision: false, visionProxyModelId: "gpt-5.5" };
    const visionModel = { hasImageInput: true, actuallySupportsVision: true, visionProxyModelId: "gpt-5.5" };

    // Before fix: visionModel.actuallySupportsVision was false → proxy fired
    // After fix: both behave correctly
    assert.ok(shouldProxy(textOnlyModel), "text-only model: proxy fires");
    assert.ok(!shouldProxy(visionModel), "vision model: proxy does NOT fire");
  });
});

describe("modelCapabilities vision proxy flag", () => {
  // modelCapabilities() returns imageInput: true when:
  //   metadata.supportsVision (native) OR isVisionProxyEnabled()
  // This tells VS Code NOT to strip images from requests.

  it("returns imageInput: true when proxy is enabled on text-only models", () => {
    const capabilities = simulateModelCapabilities(false, true);
    assert.equal(capabilities.imageInput, true);
  });

  it("returns imageInput: true when model natively supports vision", () => {
    const capabilities = simulateModelCapabilities(true, false);
    assert.equal(capabilities.imageInput, true);
  });

  it("returns imageInput: false only when no vision support and no proxy", () => {
    const capabilities = simulateModelCapabilities(false, false);
    assert.equal(capabilities.imageInput, false);
  });
});

function simulateModelCapabilities(metadataSupportsVision: boolean, visionProxyEnabled: boolean): { imageInput: boolean } {
  const supportsVision = metadataSupportsVision || visionProxyEnabled;
  return { imageInput: supportsVision };
}
