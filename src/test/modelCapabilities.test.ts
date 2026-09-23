import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requiresStringToolContent } from "../models/modelCapabilities.js";

describe("requiresStringToolContent", () => {
  it("defers tool images to a user message for glm-5.3* (issue #233)", () => {
    assert.equal(requiresStringToolContent("glm-5.3-flash"), "defer");
    assert.equal(requiresStringToolContent("glm-5.3"), "defer");
  });

  it("drops tool images for MiMo (issue #38 behavior preserved)", () => {
    assert.equal(requiresStringToolContent("mimo-v2.5"), "drop");
  });

  it("keeps multimodal tool content for other families", () => {
    assert.equal(requiresStringToolContent("glm-5.2"), null);
    assert.equal(requiresStringToolContent("kimi-k3"), null);
    assert.equal(requiresStringToolContent("deepseek-v4.1-flash"), null);
    assert.equal(requiresStringToolContent(undefined), null);
  });
});
