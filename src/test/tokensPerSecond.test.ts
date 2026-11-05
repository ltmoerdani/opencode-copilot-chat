import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import type { GoUsageTrackerConstructor } from "./helpers/goUsageTestUtils.js";
import { createMockContext, installVscodeMock, makeSummary } from "./helpers/goUsageTestUtils.js";

installVscodeMock();

let computeTokensPerSecond: (
  completionTokens: number | undefined,
  durationMs: number | undefined,
  ttfbMs: number | undefined,
) => number | undefined;
let GoUsageTracker: GoUsageTrackerConstructor;

describe("tokensPerSecond", () => {
  // ── Bootstrap: dynamically import module under test ──
  before(async () => {
    const transportMod = await import("../core/transport.js");
    const trackerMod = await import("../usage/tracker.js");
    computeTokensPerSecond = transportMod.computeTokensPerSecond;
    GoUsageTracker = trackerMod.GoUsageTracker as GoUsageTrackerConstructor;
  });

  // ════════════════════════════════════════════════════════════════════════
  // computeTokensPerSecond()
  // ════════════════════════════════════════════════════════════════════════

  describe("computeTokensPerSecond()", () => {
    it("computes completionTokens over the generation window (durationMs - ttfbMs)", () => {
      // 100 tokens over (2000ms - 500ms) = 1.5s → 66.66… tok/s
      assert.equal(computeTokensPerSecond(100, 2000, 500), 100 / 1.5);
    });

    it("treats a missing ttfbMs as a full-duration generation window", () => {
      // 100 tokens over 2s → 50 tok/s
      assert.equal(computeTokensPerSecond(100, 2000, undefined), 50);
    });

    it("returns undefined when completionTokens is missing", () => {
      assert.equal(computeTokensPerSecond(undefined, 2000, 500), undefined);
    });

    it("returns undefined when durationMs is missing", () => {
      assert.equal(computeTokensPerSecond(100, undefined, 500), undefined);
    });

    it("returns undefined when the generation window is zero (durationMs == ttfbMs)", () => {
      assert.equal(computeTokensPerSecond(100, 500, 500), undefined);
    });

    it("returns undefined when the generation window is negative (durationMs < ttfbMs)", () => {
      assert.equal(computeTokensPerSecond(100, 400, 500), undefined);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Tracker persistence
  // ════════════════════════════════════════════════════════════════════════

  describe("GoUsageTracker.record()", () => {
    it("rounds tokensPerSecond to 1 decimal when persisting the log entry", () => {
      const tracker = new GoUsageTracker(createMockContext(), undefined, undefined);
      tracker.record(makeSummary({ tokensPerSecond: 66.666666 }));
      const stored = (tracker as unknown as { entries: Array<{ tokensPerSecond?: number }> }).entries;
      assert.equal(stored.length, 1);
      assert.equal(stored[0].tokensPerSecond, 66.7);
    });

    it("omits tokensPerSecond when the summary does not report it", () => {
      const tracker = new GoUsageTracker(createMockContext(), undefined, undefined);
      tracker.record(makeSummary({}));
      const stored = (tracker as unknown as { entries: Array<{ tokensPerSecond?: number }> }).entries;
      assert.equal(stored.length, 1);
      assert.equal(stored[0].tokensPerSecond, undefined);
    });
  });
});
