import type { UsageSummary } from "./tracker";

/**
 * Official OpenCode Go usage endpoint (upstream anomalyco/opencode#16513,
 * live since 2026-08-11). Authenticates with the same `opencode-go` API key
 * the extension already stores for models/chat; returns server-accurate,
 * account-wide rolling/weekly/monthly percentages and reset times instead of
 * the per-machine estimates the extension computes locally.
 *
 * Verified against the upstream route source (packages/console/app/src/routes/
 * zen/go/v1/usage.ts): 401 = missing/invalid key, 403 = no Go subscription,
 * 200 = `{ usage: { rolling, weekly, monthly: { status, percent, resetsAt } } }`
 * where `percent` is an integer 0–100 computed server-side and `resetsAt` is
 * an ISO timestamp.
 */
import { GO_USAGE_API_URL, GO_USAGE_FETCH_TIMEOUT_MS } from "../config";

export { GO_USAGE_API_URL, GO_USAGE_SYNC_TTL_MS, GO_USAGE_FETCH_TIMEOUT_MS } from "../config";

export type GoUsagePeriodStatus = "ok" | "rate-limited";

export interface GoUsagePeriod {
  status: GoUsagePeriodStatus;
  percent: number;
  resetsAt: string;
}

export interface GoUsageApiResponse {
  usage: {
    rolling: GoUsagePeriod;
    weekly: GoUsagePeriod;
    monthly: GoUsagePeriod;
  };
}

export type GoUsageSyncFailureReason = "no-key" | "unauthorized" | "no-subscription" | "not-found" | "network" | "invalid";

export type GoUsageSyncResult = { ok: true; data: GoUsageApiResponse } | { ok: false; reason: GoUsageSyncFailureReason };

/** Minimal structural guard for the endpoint payload. */
function isGoUsageApiResponse(value: unknown): value is GoUsageApiResponse {
  if (typeof value !== "object" || value === null) return false;
  const usage = (value as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return false;
  const periods: unknown[] = ["rolling", "weekly", "monthly"].map((key) => (usage as Record<string, unknown>)[key]);
  return periods.every((period) => {
    if (typeof period !== "object" || period === null) return false;
    const p = period as Record<string, unknown>;
    return (p.status === "ok" || p.status === "rate-limited") && typeof p.percent === "number" && typeof p.resetsAt === "string";
  });
}

/**
 * Fetch server-accurate Go usage for an API key.
 *
 * CONTRACT:
 * - Never logs or persists the key; it is only sent as the Authorization
 *   header of this request.
 * - Failures are classified so callers can fall back to local estimates:
 *   401 → unauthorized, 403 → no subscription, 404 → endpoint not deployed,
 *   network/timeout errors → network, malformed payloads → invalid.
 */
export async function fetchGoUsage(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs: number = GO_USAGE_FETCH_TIMEOUT_MS,
  endpointUrl: string = GO_USAGE_API_URL,
  sessionId?: string,
): Promise<GoUsageSyncResult> {
  if (!apiKey) {
    return { ok: false, reason: "no-key" };
  }
  let response: Response;
  try {
    response = await fetcher(endpointUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        // Gateway enforcement (docs/go): auxiliary OpenCode requests also need
        // a stable session id. No conversation here — caller supplies the
        // persisted per-installation id.
        ...(sessionId ? { "x-opencode-session": sessionId } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (response.status === 401) return { ok: false, reason: "unauthorized" };
  if (response.status === 403) return { ok: false, reason: "no-subscription" };
  if (response.status === 404) return { ok: false, reason: "not-found" };
  if (!response.ok) return { ok: false, reason: "network" };

  try {
    const payload: unknown = await response.json();
    if (!isGoUsageApiResponse(payload)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, data: payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Merge server-accurate meters onto a locally-computed summary.
 *
 * The endpoint reports percent + resetsAt but not raw spend. Keep the local
 * allowance total when available instead of deriving a nominal dollar amount
 * from a hardcoded model tier. The percentage and reset time remain the only
 * server-authoritative subscription meter values. Today / Yesterday /
 * per-session spend stay local — the API does not return them.
 */
export function mergeServerUsage(
  summary: UsageSummary,
  api: GoUsageApiResponse,
  _limits: { session: number; weekly: number; monthly: number },
): UsageSummary {
  const period = (server: GoUsagePeriod, local: UsageSummary["session"]): UsageSummary["session"] => ({
    spent: local.spent,
    percent: server.percent,
    resetsAt: new Date(server.resetsAt),
  });

  return {
    ...summary,
    session: period(api.usage.rolling, summary.session),
    weekly: period(api.usage.weekly, summary.weekly),
    monthly: period(api.usage.monthly, summary.monthly),
    // Server meters are real account-wide data — never report "no data"
    // when a snapshot exists (e.g. a fresh install with CLI usage).
    hasData: true,
  };
}
