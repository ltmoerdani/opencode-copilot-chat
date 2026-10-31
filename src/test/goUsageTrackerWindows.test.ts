import { describe, it, before } from "node:test";
import type { HistoryRow, UsageSeries } from "../usage/history.js";
import type { UsageLogEntry } from "../usage/tracker.js";
import type { GoUsageApiResponse } from "../usage/goUsageSync";
import { GO_SERVER_USAGE_KEY } from "../config.js";
import assert from "node:assert/strict";
import { createMockContext, installVscodeMock, type GoUsageTrackerConstructor } from "./helpers/goUsageTestUtils.js";

installVscodeMock();

let sumDailyUsage: (
  rows: HistoryRow[],
  entries: UsageLogEntry[],
  dayStartMs: number,
  source?: "auto" | "cli" | "extension",
) => ReturnType<typeof import("../usage/history.js").sumDailyUsage>;
let buildUsageSeries: (
  rows: HistoryRow[],
  entries: UsageLogEntry[],
  days: number,
  dayStartMs: number,
  source?: "auto" | "cli" | "extension",
) => UsageSeries;
let isCwdInWorkspace: (cwd: string | undefined, workspaceFolders: readonly string[]) => boolean;
let normalizeCwd: (value: string) => string;
let startOfLocalDay: (nowMs: number) => number;
let GoUsageTracker: GoUsageTrackerConstructor;

describe("goUsageTracker windows & persistence", () => {
  before(async () => {
    const trackerMod = await import("../usage/tracker.js");
    const historyMod = await import("../usage/history.js");
    sumDailyUsage = historyMod.sumDailyUsage;
    buildUsageSeries = historyMod.buildUsageSeries;
    isCwdInWorkspace = trackerMod.isCwdInWorkspace;
    normalizeCwd = trackerMod.normalizeCwd;
    startOfLocalDay = trackerMod.startOfLocalDay;
    GoUsageTracker = trackerMod.GoUsageTracker as unknown as GoUsageTrackerConstructor;
  });

  describe("sumDailyUsage", () => {
    const now = new Date();
    const dayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const rows: HistoryRow[] = [
      {
        createdMs: dayMs + 1000,
        cost: 0.1,
        tokensInput: 100,
        tokensOutput: 50,
        tokensReasoning: 20,
        tokensCacheRead: 10,
        cwd: "/repo",
        tokensTotal: 180,
      },
      {
        createdMs: dayMs - 60_000,
        cost: 0.2,
        tokensInput: 200,
        tokensOutput: 100,
        tokensReasoning: 0,
        tokensCacheRead: 0,
        cwd: "/repo",
        tokensTotal: 300,
      },
    ];
    const entries: UsageLogEntry[] = [
      {
        timestamp: dayMs + 500,
        modelId: "qwen3.6-plus",
        cost: 0.05,
        promptTokens: 30,
        completionTokens: 10,
        cachedTokens: 0,
        sessionId: "s1",
      },
    ];

    it("merges CLI rows and extension entries in auto mode", () => {
      const total = sumDailyUsage(rows, entries, dayMs, "auto");
      assert.equal(total.requests, 2);
      assert.equal(total.tokens, 220, "row total includes cache.read (180) plus the entry (40)");
      assert.ok(Math.abs(total.cost - 0.15) < 1e-9, `expected ~0.15, got ${String(total.cost)}`);
    });

    it("excludes rows before the day window", () => {
      const total = sumDailyUsage(rows, [], dayMs, "cli");
      assert.equal(total.requests, 1, "only the row inside the window counts");
      assert.equal(total.tokens, 180, "input + output + reasoning + cache.read");
    });

    it("cli source ignores extension entries", () => {
      const total = sumDailyUsage([], entries, dayMs, "cli");
      assert.deepEqual(total, { cost: 0, requests: 0, tokens: 0 });
    });

    it("extension source ignores CLI rows", () => {
      const total = sumDailyUsage(rows, entries, dayMs, "extension");
      assert.equal(total.requests, 1);
      assert.equal(total.tokens, 40);
    });
  });

  describe("isCwdInWorkspace / normalizeCwd", () => {
    it("normalizes trailing separators", () => {
      assert.equal(normalizeCwd("/repo/"), "/repo");
      assert.equal(normalizeCwd("/repo//"), "/repo");
    });

    it("matches exact, parent and subfolder layouts", () => {
      assert.ok(isCwdInWorkspace("/repo", ["/repo"]));
      assert.ok(isCwdInWorkspace("/repo/src", ["/repo"]), "CLI ran in a subfolder of the opened repo");
      assert.ok(isCwdInWorkspace("/repo", ["/repo/src"]), "user opened a subfolder of the project");
    });

    it("rejects unrelated directories and missing input", () => {
      assert.ok(!isCwdInWorkspace("/other", ["/repo"]));
      assert.ok(!isCwdInWorkspace(undefined, ["/repo"]));
      assert.ok(!isCwdInWorkspace("/repo", []));
    });
  });

  describe("startOfLocalDay", () => {
    it("returns the local midnight of the given time", () => {
      const now = new Date();
      const localMidnight = startOfLocalDay(now.getTime());
      const d = new Date(localMidnight);
      assert.equal(d.getHours(), 0);
      assert.equal(d.getMinutes(), 0);
      assert.equal(d.getSeconds(), 0);
      assert.ok(localMidnight <= now.getTime());
    });
  });

  describe("server usage snapshot persistence", () => {
    const snapshot: GoUsageApiResponse = {
      usage: {
        rolling: { status: "ok", percent: 27, resetsAt: "2026-08-13T14:32:10.000Z" },
        weekly: { status: "ok", percent: 62, resetsAt: "2026-08-17T00:00:00.000Z" },
        monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-31T00:00:00.000Z" },
      },
    };

    it("restores the persisted snapshot on construction (instant startup)", () => {
      const tracker = new GoUsageTracker(createMockContext({ [GO_SERVER_USAGE_KEY]: snapshot }));
      assert.equal(tracker.hasServerUsage, true, "snapshot must be available before any network fetch");
      const summary = tracker.getSummary();
      assert.equal(summary.session.percent, 27);
      assert.equal(summary.weekly.percent, 62);
      assert.equal(summary.monthly.percent, 100);
    });

    it("uses namespaced storage for per-profile trackers", () => {
      const tracker = new GoUsageTracker(createMockContext(), undefined, undefined, "fp-1234");
      const summary = tracker.getSummary();
      // No snapshot stored for this profile yet → meters fall back to local estimates.
      assert.equal(tracker.hasServerUsage, false);
      assert.ok((summary.weekly.limit ?? 0) > 0);
    });
  });

  describe("buildUsageSeries", () => {
    const now = new Date();
    const dayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const DAY = 24 * 60 * 60 * 1000;

    const rows: HistoryRow[] = [
      {
        createdMs: dayMs - DAY,
        cost: 0.1,
        tokensInput: 100,
        tokensOutput: 50,
        tokensReasoning: 0,
        tokensCacheRead: 0,
        tokensTotal: 150,
        cwd: "/repo",
        modelId: "qwen3.6-plus",
      },
      {
        createdMs: dayMs - DAY + 1000,
        cost: 0.2,
        tokensInput: 200,
        tokensOutput: 100,
        tokensReasoning: 0,
        tokensCacheRead: 0,
        tokensTotal: 300,
        cwd: "/repo",
        modelId: "deepseek-v4-flash",
      },
      {
        createdMs: dayMs,
        cost: 0.3,
        tokensInput: 300,
        tokensOutput: 150,
        tokensReasoning: 0,
        tokensCacheRead: 0,
        tokensTotal: 450,
        cwd: "/repo",
        modelId: "qwen3.6-plus",
      },
      {
        createdMs: dayMs + DAY * 5,
        cost: 0.4,
        tokensInput: 400,
        tokensOutput: 200,
        tokensReasoning: 0,
        tokensCacheRead: 0,
        tokensTotal: 600,
        cwd: "/repo",
        modelId: "qwen3.6-plus",
      },
    ];
    const entries: UsageLogEntry[] = [
      { timestamp: dayMs, modelId: "glm-5", cost: 0.05, promptTokens: 30, completionTokens: 10, cachedTokens: 0, sessionId: "s1" },
    ];

    it("buckets rows and entries into per-day totals over the window", () => {
      const series = buildUsageSeries(rows, entries, 14, dayMs, "auto");
      assert.equal(series.days.length, 14);
      const oldest = series.days[0]; // oldest bucket = dayMs - 13*DAY
      assert.equal(oldest.dayStart, dayMs - 13 * DAY);
      assert.equal(oldest.cost, 0, "day before any usage stays zero");

      const yesterday = series.days[13 - 1];
      assert.equal(yesterday.requests, 2);
      assert.ok(Math.abs(yesterday.cost - 0.3) < 1e-9);
      assert.equal(yesterday.tokens, 450);

      const today = series.days[13];
      assert.equal(today.requests, 2, "row + entry on the last day");
      assert.equal(today.tokens, 450 + 40);
    });

    it("excludes rows outside the window", () => {
      const series = buildUsageSeries(rows, [], 3, dayMs, "cli");
      // A 3-day window ending at dayMs covers dayMs-2*DAY .. dayMs; the
      // dayMs + DAY*5 row is outside and must be excluded.
      const total = series.days.reduce((sum, d) => sum + d.requests, 0);
      assert.equal(total, 3, "three rows are inside the 3-day window, the future one is not");
    });

    it("groups per-model per-day rows with correct totals", () => {
      const series = buildUsageSeries(rows, entries, 14, dayMs, "auto");
      const qwen = series.byModel.filter((p) => p.model === "qwen3.6-plus");
      assert.equal(qwen.length, 2, "the dayMs + DAY*5 row is outside the 14-day window ending at dayMs");
      const qwenToday = qwen.find((p) => p.dayStart === dayMs);
      assert.equal(qwenToday?.cost, 0.3);
      const glm = series.byModel.find((p) => p.model === "glm-5");
      assert.equal(glm?.requests, 1);
    });

    it("cli source ignores extension entries", () => {
      const series = buildUsageSeries(rows, entries, 14, dayMs, "cli");
      assert.ok(!series.byModel.some((p) => p.model === "glm-5"));
    });

    it("counts cached tokens in daily totals (tokens.input excludes cache)", () => {
      const cached: HistoryRow[] = [
        {
          createdMs: dayMs,
          cost: 0.1,
          tokensInput: 152,
          tokensOutput: 209,
          tokensReasoning: 0,
          tokensCacheRead: 699_392,
          tokensTotal: 699_753,
          cwd: "/repo",
          modelId: "deepseek-v4-flash",
        },
      ];
      const series = buildUsageSeries(cached, [], 1, dayMs, "cli");
      assert.equal(series.days[0].tokens, 699_753, "cache.read must be part of the token total");
    });

    it("lifetime windows (days=0) span from the earliest usage day", () => {
      const series = buildUsageSeries(rows, entries, 0, dayMs, "auto");
      // earliest row = dayMs - DAY → 2 buckets: yesterday + today
      assert.equal(series.days.length, 2);
      assert.equal(series.days[0].dayStart, dayMs - DAY);
      assert.equal(series.days[1].dayStart, dayMs);
      assert.equal(series.days[0].requests, 2);
      assert.equal(series.days[1].requests, 2);
    });

    it("keeps a mid-day event in its own day bucket (floor, not round)", () => {
      const midDay: HistoryRow[] = [
        {
          createdMs: dayMs - DAY + DAY * 0.6, // afternoon of the previous day
          cost: 0.1,
          tokensInput: 10,
          tokensOutput: 10,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensTotal: 20,
          cwd: "/repo",
          modelId: "qwen3.6-plus",
        },
      ];
      const series = buildUsageSeries(midDay, [], 2, dayMs, "cli");
      // Window: dayMs-1*DAY .. dayMs → the afternoon event belongs to yesterday.
      assert.equal(series.days[0].dayStart, dayMs - DAY);
      assert.equal(series.days[0].requests, 1);
      assert.equal(series.days[1].requests, 0);
    });
  });
});
