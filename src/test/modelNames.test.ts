import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatModelName, providerModelDisplayName } from "../modelNames.js";

describe("provider model display names", () => {
  it("formats numeric model versions like the existing picker", () => {
    assert.equal(formatModelName("gpt-5-6-luna"), "Gpt 5.6 Luna");
  });

  it("includes the provider prefix by default", () => {
    assert.equal(providerModelDisplayName("OpenCode Go", "kimi-k3"), "OpenCode Go / Kimi K3");
  });

  it("can hide the provider prefix without changing the model name", () => {
    assert.equal(providerModelDisplayName("OpenCode Zen", "kimi-k3", false), "Kimi K3");
  });
});
