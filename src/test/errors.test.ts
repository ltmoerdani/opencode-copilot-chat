import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeEndpointUnavailable, describeFreeTierRestriction, buildOpenCodeRequestError, OpenCodeRequestError } from "../errors.js";
import { MODEL_METADATA_CACHE_KEY, MODEL_METADATA_REVISION } from "../config.js";

describe("describeFreeTierRestriction (issues #235/#240)", () => {
  it("matches the upstream free-tier rejection message", () => {
    const hint = describeFreeTierRestriction("Error from provider: OpenCode's free tier can only be used from within OpenCode");
    assert.ok(hint, "should produce a hint");
    assert.match(hint, /restricts this free-tier model/);
    assert.match(hint, /paid OpenCode Go model/);
  });

  it("returns undefined for unrelated messages", () => {
    assert.equal(describeFreeTierRestriction("Model is unavailable"), undefined);
    assert.equal(describeFreeTierRestriction(""), undefined);
  });

  it("surfaces the hint through buildOpenCodeRequestError", () => {
    const response = new Response(null, { status: 403 });
    const error = buildOpenCodeRequestError(
      "OpenCode Zen",
      response,
      JSON.stringify({
        error: { message: "OpenCode's free tier can only be used from within OpenCode" },
      }),
      "muse-spark-1.2-contributor-free",
      1234,
      "",
    );
    assert.ok(error instanceof OpenCodeRequestError);
    assert.match(error.userMessage, /restricts this free-tier model to their official app/);
    // Chat renders `message` (issue #258): the hint must be there too, and the
    // raw gateway text must not leak into the user-facing message.
    assert.match(error.message, /restricts this free-tier model to their official app/);
    assert.match(error.message, /muse-spark-1.2-contributor-free/);
    assert.doesNotMatch(error.message, /can only be used from within OpenCode/);
  });
});

describe("describeEndpointUnavailable (longcat-2.5-preview-free 402)", () => {
  it("matches the upstream endpoint-unavailable message", () => {
    const hint = describeEndpointUnavailable("Upstream request failed: Endpoint is unavailable.");
    assert.ok(hint, "should produce a hint");
    assert.match(hint, /unavailable right now/);
    assert.match(hint, /status\.opencode\.ai/);
    assert.match(hint, /switch to another model/);
  });

  it("returns undefined for unrelated messages", () => {
    assert.equal(describeEndpointUnavailable("Model is unavailable"), undefined);
    assert.equal(describeEndpointUnavailable(""), undefined);
  });

  it("surfaces the hint through buildOpenCodeRequestError on HTTP 402", () => {
    const response = new Response(null, { status: 402 });
    const error = buildOpenCodeRequestError(
      "OpenCode Go",
      response,
      JSON.stringify({
        error: { type: "server_error", message: "Upstream request failed: Endpoint is unavailable." },
      }),
      "longcat-2.5-preview-free",
      200952,
      "",
    );
    assert.ok(error instanceof OpenCodeRequestError);
    assert.match(error.userMessage, /upstream for this model is unavailable right now/);
    // Chat renders `message` (issue #258): hint present, raw text not leaked.
    assert.match(error.message, /upstream for this model is unavailable right now/);
    assert.match(error.message, /longcat-2.5-preview-free/);
    assert.doesNotMatch(error.message, /Upstream request failed: Endpoint is unavailable/);
  });
});

describe("metadata cache key (issue #231)", () => {
  it("embeds the bundled-data revision so syncing data invalidates stale caches", () => {
    assert.equal(MODEL_METADATA_CACHE_KEY, `opencode.modelMetadataCache.v6.${MODEL_METADATA_REVISION}`);
  });
});
