import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeFreeTierRestriction, buildOpenCodeRequestError, OpenCodeRequestError } from "../errors.js";
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
    assert.match(error.message, /muse-spark-1.2-contributor-free/);
  });
});

describe("metadata cache key (issue #231)", () => {
  it("embeds the bundled-data revision so syncing data invalidates stale caches", () => {
    assert.equal(MODEL_METADATA_CACHE_KEY, `opencode.modelMetadataCache.v6.${MODEL_METADATA_REVISION}`);
  });
});
