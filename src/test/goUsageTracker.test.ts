import { describe, it, mock, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { ModelCost } from "../models/metadata.js";

import type { GoUsageTrackerInstance, SessionSummary } from "./helpers/goUsageTestUtils.js";
import { GO_USAGE_BASELINE_KEY, GO_SESSION_IDLE_MS, GO_MAX_SESSIONS, GO_SESSION_COSTS_KEY, GO_USAGE_LOG_KEY } from "../config.js";

import { createMockContext, installVscodeMock, makeSummary, type GoUsageTrackerConstructor } from "./helpers/goUsageTestUtils.js";

installVscodeMock();

// ── Types (populated by dynamic import in before()) ────────────────────────

let estimateCost: (
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number,
  externalCost?: ModelCost,
  liveCostResolver?: (modelId: string) => ModelCost | undefined,
) => number;
let GoUsageTracker: GoUsageTrackerConstructor;

describe("goUsageTracker", () => {
  // ── Bootstrap: dynamically import module under test ──
  // (vscode mock is already installed via Module._resolveFilename above)

  before(async () => {
    const trackerMod = await import("../usage/tracker.js");
    const pricingMod = await import("../usage/pricing.js");
    estimateCost = pricingMod.estimateCost;
    GoUsageTracker = trackerMod.GoUsageTracker as GoUsageTrackerConstructor;
  });

  // ════════════════════════════════════════════════════════════════════════
  // estimateCost()
  // ════════════════════════════════════════════════════════════════════════

  describe("estimateCost()", () => {
    it("uses bundled snapshot pricing for a known model (qwen3.6-plus)", () => {
      const cost = estimateCost("qwen3.6-plus", 100, 50, 10);
      // billablePrompt = max(0, 100-10) = 90
      // pricing: { input: 0.50, output: 3.00, cache_read: 0.05 }
      // 90 * 0.5/1M   = 0.000045
      // 50 * 3.0/1M   = 0.00015
      // 10 * 0.05/1M  = 0.0000005
      assert.equal(cost, 0.0001955);
    });

    it("uses bundled snapshot pricing for deepseek-v4-flash", () => {
      const cost = estimateCost("deepseek-v4-flash", 1000, 500, 200);
      // billablePrompt = 800
      // pricing: { input: 0.22, output: 0.66, cache_read: 0.007 }
      // 800 * 0.22/1M  = 0.000176
      // 500 * 0.66/1M  = 0.00033
      // 200 * 0.007/1M = 0.0000014
      assert.equal(cost, 0.0005074);
    });

    it("estimates a conservative cost for an unknown model with no resolver", () => {
      // Unknown models use the fallback price (0.5 in / 2.0 out per 1M) instead
      // of silently tracking $0 (which reads as free).
      const cost = estimateCost("nonexistent-model-v99", 100, 50, 0);
      assert.ok(cost > 0, "unknown model must not track as $0");
      assert.ok(cost < 0.001, "fallback estimate stays small");
    });

    it("prefers externalCost over the bundled table", () => {
      const external: ModelCost = { input: 1.0, output: 2.0, cache_read: 0.1 };
      const cost = estimateCost("qwen3.6-plus", 100, 50, 10, external);
      // billablePrompt = 90
      // 90 * 1.0/1M  = 0.00009
      // 50 * 2.0/1M  = 0.0001
      // 10 * 0.1/1M  = 0.000001
      assert.equal(cost, 0.000191);
    });

    it("prefers liveCostResolver over the bundled table when externalCost absent", () => {
      const resolver = (id: string): ModelCost | undefined => (id === "custom-model" ? { input: 2.0, output: 4.0 } : undefined);
      const cost = estimateCost("custom-model", 100, 50, 0, undefined, resolver);
      // billablePrompt = 100
      // 100 * 2.0/1M  = 0.0002
      // 50  * 4.0/1M  = 0.0002
      assert.equal(cost, 0.0004);
    });

    it("falls back to bundled table when resolver returns undefined", () => {
      const resolver = (): ModelCost | undefined => undefined;
      const cost = estimateCost("qwen3.6-plus", 100, 50, 0, undefined, resolver);
      // 100 * 0.5/1M  = 0.00005
      // 50  * 3.0/1M  = 0.00015
      // IEEE 754: 0.05 + 0.00015 = 0.00019999999999999998
      assert.ok(Math.abs(cost - 0.0002) < 1e-12, `expected ~0.0002, got ${String(cost)}`);
    });

    it("subtracts cached tokens from prompt tokens for billing", () => {
      const cost = estimateCost("qwen3.6-plus", 100, 50, 40);
      // billablePrompt = 60
      // 60 * 0.5/1M   = 0.00003
      // 50 * 3.0/1M   = 0.00015
      // 40 * 0.05/1M  = 0.000002
      // IEEE 754: 0.00003 + 0.00015 + 0.000002 = 0.00018199999999999998
      assert.ok(Math.abs(cost - 0.000182) < 1e-12, `expected ~0.000182, got ${String(cost)}`);
    });

    it("handles all-cached requests (billable prompt = 0)", () => {
      const cost = estimateCost("qwen3.6-plus", 100, 50, 200);
      // billablePrompt = max(0, 100-200) = 0
      // 0 * 0.5/1M    = 0
      // 50 * 3.0/1M   = 0.00015
      // 200 * 0.05/1M = 0.00001
      // IEEE 754: 0 + 0.00015 + 0.00001 = 0.00015999999999999999
      assert.ok(Math.abs(cost - 0.00016) < 1e-12, `expected ~0.00016, got ${String(cost)}`);
    });

    it("handles zero tokens gracefully", () => {
      const cost = estimateCost("qwen3.6-plus", 0, 0, 0);
      assert.equal(cost, 0);
    });

    it("uses explicit cache_read when provided in pricing", () => {
      const external: ModelCost = { input: 1.0, output: 2.0, cache_read: 0.5 };
      const cost = estimateCost("any-model", 200, 100, 50, external);
      // billablePrompt = 150
      // 150 * 1.0/1M  = 0.00015
      // 100 * 2.0/1M  = 0.0002
      // 50  * 0.5/1M  = 0.000025
      assert.equal(cost, 0.000375);
    });

    it("falls back to input * 0.1 when cache_read is missing", () => {
      const external: ModelCost = { input: 2.0, output: 4.0 }; // no cache_read
      const cost = estimateCost("any-model", 100, 50, 10, external);
      // billablePrompt = 90
      // 90 * 2.0/1M      = 0.00018
      // 50 * 4.0/1M      = 0.0002
      // 10 * (2.0*0.1)/1M = 0.000002
      assert.equal(cost, 0.000382);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // GoUsageTracker
  // ════════════════════════════════════════════════════════════════════════

  describe("GoUsageTracker", () => {
    // ── record() ────────────────────────────────────────────────────────

    describe("record()", () => {
      it("accumulates cost for the same sessionId", () => {
        const tracker = new GoUsageTracker(createMockContext());

        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 100, completionTokens: 50, cachedTokens: 0 }));
        // Cost for s1: 100 * 0.5/1M + 50 * 3.0/1M = 0.0002

        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 200, completionTokens: 100, cachedTokens: 0 }));
        // Additional: 200 * 0.5/1M + 100 * 3.0/1M = 0.0004
        // Total: 0.0006

        const session = tracker.getCurrentSessionCost();
        assert.equal(session?.sessionId, "s1");
        assert.equal(session.cost, 0.0006);
        assert.equal(session.requests, 2);
        assert.equal(session.promptTokens, 300);
        assert.equal(session.completionTokens, 150);
      });

      it("skips records when providerDisplayName does not contain 'go'", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ providerDisplayName: "OpenCode Zen", sessionId: "s1" }));

        assert.equal(tracker.getCurrentSessionCost(), undefined);
      });

      it("skips records when prompt+completion tokens are zero", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 0, completionTokens: 0, cachedTokens: 0 }));

        assert.equal(tracker.getCurrentSessionCost(), undefined);
      });

      it("creates separate entries for different sessionIds", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 100, completionTokens: 50 }));
        tracker.record(makeSummary({ sessionId: "s2", promptTokens: 10, completionTokens: 5 }));

        assert.equal(tracker.getRecentSessionCosts(5).length, 2);
      });

      it("accepts an externalCost override", () => {
        const tracker = new GoUsageTracker(createMockContext());
        const externalCost: ModelCost = { input: 10, output: 20 };
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 100, completionTokens: 50, cachedTokens: 0 }), externalCost);

        const session = tracker.getCurrentSessionCost();
        // 100 * 10/1M + 50 * 20/1M = 0.001 + 0.001 = 0.002
        assert.equal(session?.cost, 0.002);
      });

      it("uses the upstream Go allowance instead of local model pricing", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(
          makeSummary({
            sessionId: "s1",
            promptTokens: 100,
            completionTokens: 50,
            cachedTokens: 0,
            allowance: 1.25,
            listCost: 4.5,
          }),
        );

        assert.equal(tracker.getCurrentSessionCost()?.cost, 1.25);
        const storedEntries = tracker.getSummary();
        assert.equal(storedEntries.today.cost, 1.25);
      });

      it("delegates to costResolver when no externalCost is passed", () => {
        const resolver = (id: string): ModelCost | undefined => (id === "custom-resolved" ? { input: 5, output: 10 } : undefined);
        const tracker = new GoUsageTracker(createMockContext(), undefined, resolver);

        tracker.record(
          makeSummary({ modelId: "custom-resolved", sessionId: "s1", promptTokens: 100, completionTokens: 50, cachedTokens: 0 }),
        );

        const session = tracker.getCurrentSessionCost();
        // 100 * 5/1M + 50 * 10/1M = 0.0005 + 0.0005 = 0.001
        assert.equal(session?.cost, 0.001);
      });

      it("persists data to globalState after record()", () => {
        const context = createMockContext();
        const tracker = new GoUsageTracker(context);

        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 100, completionTokens: 50 }));

        const storedEntries = context.globalState.get(GO_USAGE_LOG_KEY, []);
        assert.equal(storedEntries.length, 1);

        const storedSessions = context.globalState.get<SessionSummary[]>(GO_SESSION_COSTS_KEY, []);
        assert.equal(storedSessions.length, 1);
        assert.equal(storedSessions[0].sessionId, "s1");
      });
    });

    // ── getCurrentSessionCost() ─────────────────────────────────────────

    describe("getCurrentSessionCost()", () => {
      it("returns the most recently active session", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "old", promptTokens: 1, completionTokens: 0 }));
        // Ensure distinct timestamps for deterministic ordering
        const t1 = Date.now();
        while (Date.now() === t1) {} // wait for next millisecond
        tracker.record(makeSummary({ sessionId: "new", promptTokens: 1, completionTokens: 0 }));

        assert.equal(tracker.getCurrentSessionCost()?.sessionId, "new");
      });

      it("returns the aggregated cost for the most recent session", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 100, completionTokens: 50, cachedTokens: 0 }));
        tracker.record(makeSummary({ sessionId: "s2", promptTokens: 200, completionTokens: 100, cachedTokens: 0 }));
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 50, completionTokens: 25, cachedTokens: 0 }));

        // s1: 0.0002 + 0.0001 = 0.0003
        // s2: 0.0004 — most recent
        const session = tracker.getCurrentSessionCost();
        assert.equal(session?.sessionId, "s1"); // s1 was last to be active
        assert.equal(session.cost, 0.0003);
        assert.equal(session.requests, 2);
      });

      it("returns undefined when no sessions have been recorded", () => {
        const tracker = new GoUsageTracker(createMockContext());
        assert.equal(tracker.getCurrentSessionCost(), undefined);
      });
    });

    // ── getRecentSessionCosts() ─────────────────────────────────────────

    describe("getRecentSessionCosts()", () => {
      /** Ensure each record gets a distinct timestamp for deterministic ordering. */
      function recordWithDistinctTimestamp(tracker: GoUsageTrackerInstance, sessionId: string): void {
        tracker.record(makeSummary({ sessionId, promptTokens: 1, completionTokens: 0 }));
        const t = Date.now();
        while (Date.now() === t) {} // wait for next millisecond
      }

      it("returns sessions ordered by lastActivity descending", () => {
        const tracker = new GoUsageTracker(createMockContext());
        recordWithDistinctTimestamp(tracker, "a");
        recordWithDistinctTimestamp(tracker, "b");
        recordWithDistinctTimestamp(tracker, "c");

        const sessions = tracker.getRecentSessionCosts(5);
        assert.equal(sessions.length, 3);
        assert.equal(sessions[0].sessionId, "c");
        assert.equal(sessions[1].sessionId, "b");
        assert.equal(sessions[2].sessionId, "a");
      });

      it("respects the limit parameter", () => {
        const tracker = new GoUsageTracker(createMockContext());
        for (let i = 0; i < 10; i++) {
          tracker.record(makeSummary({ sessionId: `s${String(i)}`, promptTokens: 1, completionTokens: 0 }));
        }

        assert.equal(tracker.getRecentSessionCosts(3).length, 3);
        assert.equal(tracker.getRecentSessionCosts(10).length, 10);
        // Requesting more than available returns all
        assert.equal(tracker.getRecentSessionCosts(100).length, 10);
      });

      it("returns empty array when no sessions exist", () => {
        const tracker = new GoUsageTracker(createMockContext());
        assert.deepEqual(tracker.getRecentSessionCosts(), []);
      });
    });

    // ── State restoration from globalState ──────────────────────────────

    describe("state restoration from globalState", () => {
      it("restores entries and session costs from stored state", () => {
        const now = Date.now();
        const initial: Record<string, unknown> = {
          [GO_USAGE_LOG_KEY]: [
            {
              timestamp: now,
              modelId: "qwen3.6-plus",
              cost: 0.5,
              promptTokens: 100,
              completionTokens: 50,
              cachedTokens: 0,
              sessionId: "restored-session",
            },
          ],
          [GO_SESSION_COSTS_KEY]: [
            {
              sessionId: "restored-session",
              cost: 0.5,
              requests: 3,
              promptTokens: 150,
              completionTokens: 75,
              lastActivity: now,
            },
          ],
          [GO_USAGE_BASELINE_KEY]: {},
        };

        const tracker = new GoUsageTracker(createMockContext(initial));

        const session = tracker.getCurrentSessionCost();
        assert.equal(session?.sessionId, "restored-session");
        assert.equal(session.cost, 0.5);
        assert.equal(session.requests, 3);
        assert.equal(session.promptTokens, 150);
        assert.equal(session.completionTokens, 75);
      });

      it("filters invalid entries during restore", () => {
        const initial: Record<string, unknown> = {
          [GO_USAGE_LOG_KEY]: [
            { timestamp: Date.now(), modelId: "valid", cost: 0.1, promptTokens: 10, completionTokens: 5, cachedTokens: 0, sessionId: "s1" },
            { modelId: "no-timestamp", cost: 0.1, promptTokens: 10, completionTokens: 5, cachedTokens: 0 }, // missing timestamp
            { timestamp: "string-not-number", modelId: "bad-type", cost: 0.1, promptTokens: 10, completionTokens: 5, cachedTokens: 0 }, // timestamp wrong type
          ],
          [GO_SESSION_COSTS_KEY]: [
            { sessionId: "s1", cost: 0.1, requests: 1, promptTokens: 10, completionTokens: 5, lastActivity: Date.now() },
            { cost: 0.2, requests: 1, promptTokens: 20, completionTokens: 10 }, // missing sessionId
          ],
          [GO_USAGE_BASELINE_KEY]: {},
        };

        const tracker = new GoUsageTracker(createMockContext(initial));

        // Only s1 should survive
        const session = tracker.getCurrentSessionCost();
        assert.equal(session?.sessionId, "s1");
        const sessions = tracker.getRecentSessionCosts(5);
        assert.equal(sessions.length, 1);
      });

      it("starts clean when no state is stored", () => {
        const tracker = new GoUsageTracker(createMockContext());
        assert.equal(tracker.getCurrentSessionCost(), undefined);
        assert.deepEqual(tracker.getRecentSessionCosts(), []);
      });
    });

    // ── Pruning behavior ────────────────────────────────────────────────

    describe("pruning behavior", () => {
      afterEach(() => {
        mock.timers.reset();
      });

      it("removes idle sessions (older than 2h) on record()", () => {
        mock.timers.enable({ apis: ["Date"] });
        const baseTime = 1_000_000_000_000;
        mock.timers.setTime(baseTime);

        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "old", promptTokens: 1, completionTokens: 0 }));

        // Advance past the 2-hour idle threshold
        mock.timers.tick(GO_SESSION_IDLE_MS + 1000);

        tracker.record(makeSummary({ sessionId: "new", promptTokens: 1, completionTokens: 0 }));

        const session = tracker.getCurrentSessionCost();
        assert.equal(session?.sessionId, "new", "old session should have been pruned");

        const sessions = tracker.getRecentSessionCosts(5);
        assert.equal(sessions.length, 1);
      });

      it("removes multiple idle sessions at once", () => {
        mock.timers.enable({ apis: ["Date"] });
        mock.timers.setTime(1_000_000_000_000);

        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 1, completionTokens: 0 }));
        tracker.record(makeSummary({ sessionId: "s2", promptTokens: 1, completionTokens: 0 }));

        // Advance past idle threshold
        mock.timers.tick(GO_SESSION_IDLE_MS + 1000);

        tracker.record(makeSummary({ sessionId: "s3", promptTokens: 1, completionTokens: 0 }));

        assert.equal(tracker.getRecentSessionCosts(5).length, 1);
        assert.equal(tracker.getCurrentSessionCost()?.sessionId, "s3");
      });

      it("caps at MAX_SESSIONS (50) and removes oldest", () => {
        const tracker = new GoUsageTracker(createMockContext());
        // Create 51 sessions
        for (let i = 0; i < 51; i++) {
          tracker.record(makeSummary({ sessionId: `s${String(i)}`, promptTokens: 1, completionTokens: 0 }));
        }

        const sessions = tracker.getRecentSessionCosts(100);
        assert.equal(sessions.length, GO_MAX_SESSIONS, "should be capped at MAX_SESSIONS");
        // The oldest session (s0) should have been removed
        assert.equal(
          sessions.find((s) => s.sessionId === "s0"),
          undefined,
          "oldest session s0 should have been pruned",
        );
        // The newest session (s50) should still be present
        assert.ok(
          sessions.find((s) => s.sessionId === "s50"),
          "newest session s50 should survive",
        );
      });
    });

    // ── Edge cases ──────────────────────────────────────────────────────

    describe("edge cases", () => {
      it("handles missing sessionId (no session cost tracked)", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: undefined, promptTokens: 100, completionTokens: 50 }));

        assert.equal(tracker.getCurrentSessionCost(), undefined);
        assert.equal(tracker.getRecentSessionCosts().length, 0);
      });

      it("estimates a conservative cost for unknown modelId", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(
          makeSummary({
            modelId: "completely-unknown-model",
            sessionId: "s1",
            promptTokens: 100,
            completionTokens: 50,
          }),
        );

        const session = tracker.getCurrentSessionCost();
        assert.equal(session?.sessionId, "s1");
        assert.ok(session.cost > 0, "unknown model must not track as $0");
        assert.ok(session.cost < 0.001, "fallback estimate stays small");
        assert.equal(session.requests, 1);
      });

      it("handles record with only cached tokens (no prompt or completion)", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 0, completionTokens: 0, cachedTokens: 100 }));

        // Zero prompt+completion → record is skipped
        assert.equal(tracker.getCurrentSessionCost(), undefined);
      });

      it("handles record with only cached tokens but non-zero prompt", () => {
        const tracker = new GoUsageTracker(createMockContext());
        tracker.record(makeSummary({ sessionId: "s1", promptTokens: 50, completionTokens: 0, cachedTokens: 50 }));

        // prompt+completion = 50 > 0 → record proceeds
        // billablePrompt = max(0, 50-50) = 0
        // cost = 0 * 0.5/1M + 0 * 3.0/1M + 50 * 0.05/1M = 0.0000025
        const session = tracker.getCurrentSessionCost();
        assert.equal(session?.sessionId, "s1");
        assert.equal(session.cost, 0.0000025);
      });

      it("handles multiple records in the same session with reset in between", () => {
        const context = createMockContext();
        const tracker1 = new GoUsageTracker(context);
        tracker1.record(makeSummary({ sessionId: "shared", promptTokens: 100, completionTokens: 50, cachedTokens: 0 }));

        // Create a new tracker from the same context to simulate restart
        const tracker2 = new GoUsageTracker(context);
        tracker2.record(makeSummary({ sessionId: "shared", promptTokens: 50, completionTokens: 25, cachedTokens: 0 }));

        // First tracker's session
        assert.equal(tracker1.getCurrentSessionCost()?.sessionId, "shared");
        // Second tracker should have restored state and accumulated further
        const session = tracker2.getCurrentSessionCost();
        assert.equal(session?.cost, 0.0003); // 0.0002 + 0.0001
        assert.equal(session.requests, 2);
      });
    });
  });
});
