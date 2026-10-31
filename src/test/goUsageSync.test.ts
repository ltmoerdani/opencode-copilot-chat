import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchGoUsage, mergeServerUsage, GO_USAGE_API_URL, type GoUsageApiResponse } from "../usage/goUsageSync";
import type { UsageSummary } from "../usage/tracker";

/** Mirrors GO_LIMITS — kept literal so the test never loads goUsageTracker (vscode). */
const LIMITS = { session: 12, weekly: 30, monthly: 60 };

/** Minimal locally-computed summary used as the merge input. */
function localSummary(): UsageSummary {
  return {
    session: { spent: 1, limit: LIMITS.session, percent: 8.3, resetsAt: new Date("2026-08-11T12:00:00Z") },
    weekly: { spent: 5, limit: LIMITS.weekly, percent: 16.7, resetsAt: new Date("2026-08-17T00:00:00Z") },
    monthly: { spent: 9, limit: LIMITS.monthly, percent: 15, resetsAt: new Date("2026-08-31T00:00:00Z") },
    today: { cost: 0.4, requests: 3, tokens: 4200 },
    yesterday: { cost: 1.1, requests: 8, tokens: 9800 },
    codebase: { cost: 12.4, requests: 42, tokens: 512_000 },
    hasData: true,
    sqliteAvailable: false,
  };
}

function apiResponse(): GoUsageApiResponse {
  return {
    usage: {
      rolling: { status: "ok", percent: 27, resetsAt: "2026-08-11T14:32:10.000Z" },
      weekly: { status: "ok", percent: 62, resetsAt: "2026-08-17T00:00:00.000Z" },
      monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-31T00:00:00.000Z" },
    },
  };
}

function stubFetch(status: number, body: unknown): typeof fetch {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  return () => Promise.resolve(response);
}

test("fetchGoUsage — sends the key as Bearer to the official endpoint", async () => {
  let requestedUrl = "";
  let authHeader = "";
  const fetcher: typeof fetch = (input, init) => {
    // The production call always passes a string URL; capture it as-is.
    requestedUrl = typeof input === "string" ? input : "";
    const headers = init?.headers as Record<string, string> | undefined;
    authHeader = headers?.Authorization ?? "";
    return Promise.resolve(new Response(JSON.stringify(apiResponse()), { status: 200 }));
  };

  const result = await fetchGoUsage("sk-test", fetcher);
  assert.equal(requestedUrl, GO_USAGE_API_URL);
  assert.equal(authHeader, "Bearer sk-test");
  assert.equal(result.ok, true);
});

test("fetchGoUsage — accepts a custom usage endpoint", async () => {
  let requestedUrl = "";
  const fetcher: typeof fetch = (input) => {
    requestedUrl = typeof input === "string" ? input : "";
    return Promise.resolve(new Response(JSON.stringify(apiResponse()), { status: 200 }));
  };

  const result = await fetchGoUsage("sk-test", fetcher, undefined, "https://gateway.example.test/v1/usage");
  assert.equal(requestedUrl, "https://gateway.example.test/v1/usage");
  assert.equal(result.ok, true);
});

test("fetchGoUsage — parses a 200 payload", async () => {
  const result = await fetchGoUsage("sk-test", stubFetch(200, apiResponse()));
  assert.ok(result.ok);
  assert.equal(result.data.usage.rolling.percent, 27);
  assert.equal(result.data.usage.monthly.status, "rate-limited");
});

test("fetchGoUsage — classifies failures so callers can fall back", async () => {
  assert.deepEqual(await fetchGoUsage("sk-test", stubFetch(401, {})), { ok: false, reason: "unauthorized" });
  assert.deepEqual(await fetchGoUsage("sk-test", stubFetch(403, {})), { ok: false, reason: "no-subscription" });
  assert.deepEqual(await fetchGoUsage("sk-test", stubFetch(404, {})), { ok: false, reason: "not-found" });
  assert.deepEqual(await fetchGoUsage("sk-test", stubFetch(500, {})), { ok: false, reason: "network" });
});

test("fetchGoUsage — missing key is refused without any request", async () => {
  let called = false;
  const fetcher: typeof fetch = () => {
    called = true;
    return Promise.resolve(new Response("", { status: 200 }));
  };
  assert.deepEqual(await fetchGoUsage("", fetcher), { ok: false, reason: "no-key" });
  assert.equal(called, false);
});

test("fetchGoUsage — malformed payloads and network errors are classified", async () => {
  assert.deepEqual(await fetchGoUsage("sk-test", stubFetch(200, { nope: true })), { ok: false, reason: "invalid" });
  assert.deepEqual(await fetchGoUsage("sk-test", stubFetch(200, "not json")), { ok: false, reason: "invalid" });
  const throwing: typeof fetch = () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await fetchGoUsage("sk-test", throwing), { ok: false, reason: "network" });
});

test("mergeServerUsage — overlays server percent and resetsAt per period", () => {
  const merged = mergeServerUsage(localSummary(), apiResponse(), LIMITS);
  assert.equal(merged.session.percent, 27);
  assert.equal(merged.session.resetsAt.toISOString(), "2026-08-11T14:32:10.000Z");
  assert.equal(merged.weekly.percent, 62);
  assert.equal(merged.monthly.percent, 100);
  assert.equal(merged.monthly.resetsAt.toISOString(), "2026-08-31T00:00:00.000Z");
});

test("mergeServerUsage — derives spent from the authoritative percent", () => {
  const merged = mergeServerUsage(localSummary(), apiResponse(), LIMITS);
  assert.equal(merged.session.spent, localSummary().session.spent);
  assert.equal(merged.weekly.spent, localSummary().weekly.spent);
  assert.equal(merged.monthly.spent, localSummary().monthly.spent);
  assert.equal(merged.session.limit, undefined);
  assert.equal(merged.weekly.limit, undefined);
  assert.equal(merged.monthly.limit, undefined);
});

test("mergeServerUsage — keeps local today/yesterday and metadata", () => {
  const merged = mergeServerUsage(localSummary(), apiResponse(), LIMITS);
  assert.deepEqual(merged.today, localSummary().today);
  assert.deepEqual(merged.yesterday, localSummary().yesterday);
  assert.equal(merged.hasData, true);
  assert.equal(merged.sqliteAvailable, false);
});

test("mergeServerUsage — server meters imply hasData (fresh install with CLI usage)", () => {
  const empty: UsageSummary = { ...localSummary(), hasData: false };
  const merged = mergeServerUsage(empty, apiResponse(), LIMITS);
  assert.equal(merged.hasData, true, "status bar must not say 'no data' when server meters exist");
  assert.equal(merged.monthly.percent, 100);
});
