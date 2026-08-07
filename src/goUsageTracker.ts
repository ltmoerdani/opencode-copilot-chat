import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execFileSync } from "child_process";
import { GO_VENDOR } from "./providerTypes";
import type { ModelCost } from "./metadata";
import type { TransportRequestSummary } from "./streaming";

/** Callback to resolve live model cost from the models.dev metadata cache. */
export type CostResolver = (modelId: string) => ModelCost | undefined;

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "opencodego.usageLog.v1";
const BASELINE_STORAGE_KEY = "opencodego.usageBaseline.v1";
const SESSION_COSTS_KEY = "opencodego.sessionCosts.v1";
const MAX_LOG_ENTRIES = 2000;

/** OpenCode Go subscription limits in USD, from https://opencode.ai/docs/go */
export const GO_LIMITS = {
  session: 12, // $12 per rolling 5-hour window
  weekly: 30, // $30 per week (Mon–Mon UTC)
  monthly: 60, // $60 per month (anchor-based)
} as const;

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Go model pricing ($/1M tokens) — bundled snapshot fallback ────────────
// This table is a static snapshot kept as a last resort. The primary source
// is the live models.dev metadata cache injected via CostResolver.

const GO_MODEL_PRICING: Record<string, ModelCost> = {
  "glm-5.1": { input: 1.4, output: 4.4, cache_read: 0.26 },
  "glm-5": { input: 1.0, output: 3.2, cache_read: 0.2 },
  "kimi-k2.6": { input: 0.95, output: 4.0, cache_read: 0.16 },
  "kimi-k2.5": { input: 0.6, output: 3.0, cache_read: 0.1 },
  "minimax-m3": { input: 0.6, output: 2.4, cache_read: 0.12 },
  "minimax-m2.7": { input: 0.3, output: 1.2, cache_read: 0.06 },
  "minimax-m2.5": { input: 0.3, output: 1.2, cache_read: 0.06 },
  "mimo-v2.5": { input: 0.14, output: 0.28, cache_read: 0.003 },
  "mimo-v2.5-pro": { input: 1.74, output: 3.48, cache_read: 0.015 },
  "mimo-v2-omni": { input: 0.14, output: 0.28, cache_read: 0.003 },
  "mimo-v2-pro": { input: 1.74, output: 3.48, cache_read: 0.015 },
  "qwen3.7-max": { input: 2.5, output: 7.5, cache_read: 0.5 },
  "qwen3.7-plus": { input: 0.4, output: 1.6, cache_read: 0.04 },
  "qwen3.6-plus": { input: 0.5, output: 3.0, cache_read: 0.05 },
  "qwen3.5-plus": { input: 0.2, output: 1.2, cache_read: 0.02 },
  "deepseek-v4-pro": { input: 1.74, output: 3.48, cache_read: 0.015 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cache_read: 0.003 },
  "hy3-preview": { input: 0.5, output: 1.5, cache_read: 0.05 },
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UsageLogEntry {
  /** Unix timestamp ms */
  timestamp: number;
  modelId: string;
  /** Estimated cost in USD */
  cost: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /** Chat session identifier (stable hash per conversation thread). */
  sessionId?: string;
  /** Credits for VS Code session cost (1 credit = $0.01). */
  copilotCredits?: number;
}

/** Aggregated cost for a single chat session. */
export interface SessionCostSummary {
  sessionId: string;
  cost: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  lastActivity: number;
}

export interface PeriodUsage {
  spent: number;
  limit: number;
  percent: number;
  resetsAt: Date;
}

export interface UsageSummary {
  session: PeriodUsage;
  weekly: PeriodUsage;
  monthly: PeriodUsage;
  today: {
    cost: number;
    requests: number;
    tokens: number;
  };
  yesterday: {
    cost: number;
    requests: number;
    tokens: number;
  };
  hasData: boolean;
  /** When true, cost data comes from the OpenCode CLI SQLite database
      (actual billed amounts). When false, costs are estimated locally. */
  sqliteAvailable: boolean;
}

interface UsageBaselinePeriod {
  amount: number;
  expiresAt: number;
}

interface UsageBaseline {
  session?: UsageBaselinePeriod;
  weekly?: UsageBaselinePeriod;
  monthly?: UsageBaselinePeriod & {
    /** The user's billing anchor day (1-31) for the monthly reset. */
    anchorDay?: number;
    /** The user's billing anchor hour (0-23 UTC) for the monthly reset. */
    anchorHour?: number;
  };
}

export interface UsageBaselineTargets {
  session: number;
  weekly: number;
  monthly: number;
  /** Day of month (1-31) when monthly counter resets. Combined with monthlyAnchorHour. */
  monthlyAnchorDay?: number;
  /** Hour of day (0-23 UTC) when monthly counter resets. Combined with monthlyAnchorDay. */
  monthlyAnchorHour?: number;
}

// ─── Time window helpers ─────────────────────────────────────────────────────

function startOfUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUtcWeek(nowMs: number): number {
  const d = new Date(nowMs);
  const offset = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function anchoredMonthStart(nowMs: number, anchorDay: number, anchorHour: number): number {
  const now = new Date(nowMs);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let candidate = Date.UTC(year, month, anchorDay, anchorHour, 0, 0, 0);
  if (candidate > nowMs) {
    if (month === 0) {
      year--;
      month = 11;
    } else {
      month--;
    }
    candidate = Date.UTC(year, month, anchorDay, anchorHour, 0, 0, 0);
  }
  return candidate;
}

function anchoredMonthEnd(startMs: number, anchorDay: number, anchorHour: number): number {
  const d = new Date(startMs);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  if (month > 11) {
    year++;
    month = 0;
  }
  return Date.UTC(year, month, anchorDay, anchorHour, 0, 0, 0);
}

/** Build the monthly window: manual anchor > auto-anchor from earliest row > calendar month. */
function buildMonthlyWindow(
  nowMs: number,
  baseline: UsageBaseline,
  earliestMs?: number | null,
): { monthStartMs: number; monthEndMs: number } {
  // Priority 1: user-configured anchor (set via "Set spent targets")
  const monthlyAnchor = baseline.monthly?.anchorDay;
  if (monthlyAnchor && monthlyAnchor >= 1 && monthlyAnchor <= 31) {
    const hour = baseline.monthly!.anchorHour ?? 0;
    const start = anchoredMonthStart(nowMs, monthlyAnchor, hour);
    const end = anchoredMonthEnd(start, monthlyAnchor, hour);
    return { monthStartMs: start, monthEndMs: end };
  }
  // Priority 2: auto-anchor from earliest SQLite row (actual billing start)
  if (earliestMs != null) {
    const d = new Date(earliestMs);
    const day = d.getUTCDate();
    const hour = d.getUTCHours();
    const start = anchoredMonthStart(nowMs, day, hour);
    const end = anchoredMonthEnd(start, day, hour);
    return { monthStartMs: start, monthEndMs: end };
  }
  // Fallback: calendar month
  const now = new Date(nowMs);
  return {
    monthStartMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    monthEndMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  };
}

/** Rolling reset: oldest entry in the current 5h window + 5h */
function nextSessionReset(entries: UsageLogEntry[], nowMs: number): Date {
  const windowStart = nowMs - FIVE_HOURS_MS;
  let oldest: number | null = null;
  for (const e of entries) {
    if (e.timestamp >= windowStart && e.timestamp < nowMs) {
      if (oldest === null || e.timestamp < oldest) oldest = e.timestamp;
    }
  }
  return new Date((oldest ?? nowMs) + FIVE_HOURS_MS);
}

// ─── Cost calculation ────────────────────────────────────────────────────────

/** Priority: caller-provided cost > live models.dev snapshot > bundled table */
export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number,
  externalCost?: ModelCost,
  liveCostResolver?: CostResolver,
): number {
  // Priority: caller-provided cost > live models.dev snapshot > bundled table
  const pricing = externalCost ?? liveCostResolver?.(modelId) ?? GO_MODEL_PRICING[modelId];
  if (!pricing) return 0;

  const billablePrompt = Math.max(0, promptTokens - cachedTokens);
  return (
    (billablePrompt * pricing.input) / 1_000_000 +
    (completionTokens * pricing.output) / 1_000_000 +
    (cachedTokens * (pricing.cache_read ?? pricing.input * 0.1)) / 1_000_000
  );
}

// ─── OpenCode SQLite history reader (same source as OpenUsage) ───────────────
// Reads from ~/.local/share/opencode/opencode.db
// SQL from https://github.com/robinebers/openusage/plugins/opencode-go/plugin.js

const OPENCODE_DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

const HISTORY_ROWS_SQL = `
  SELECT
    CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
    CAST(json_extract(data, '$.cost') AS REAL) AS cost
  FROM message
  WHERE json_valid(data)
    AND json_extract(data, '$.providerID') = 'opencode-go'
    AND json_extract(data, '$.role') = 'assistant'
    AND json_type(data, '$.cost') IN ('integer', 'real')
`;

interface HistoryRow {
  createdMs: number;
  cost: number;
}

function readOpenCodeHistory(): HistoryRow[] | null {
  if (!fs.existsSync(OPENCODE_DB_PATH)) return null;

  try {
    const result = execFileSync("sqlite3", ["-readonly", "-json", OPENCODE_DB_PATH, HISTORY_ROWS_SQL], {
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rows = JSON.parse(result);
    if (!Array.isArray(rows)) return null;
    return rows.filter(
      (r: any) =>
        r && typeof r === "object" && typeof r.createdMs === "number" && r.createdMs > 0 && typeof r.cost === "number" && r.cost >= 0,
    );
  } catch {
    return null;
  }
}

// ─── Exported tracker class ──────────────────────────────────────────────────

export class GoUsageTracker {
  private entries: UsageLogEntry[] = [];
  private baseline: UsageBaseline = {};
  private readonly log?: (msg: string) => void;
  private costResolver?: CostResolver;
  /** Per-chat-session cost accumulator. Key = sessionId. */
  private sessionCosts = new Map<string, SessionCostSummary>();
  private static readonly SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // 2h
  private static readonly MAX_SESSIONS = 50;

  constructor(
    private readonly context: vscode.ExtensionContext,
    log?: (msg: string) => void,
    costResolver?: CostResolver,
    /**
     * Per-profile storage suffix. When set, storage keys are namespaced
     * so multiple Go accounts can coexist. Empty string = legacy mode
     * (single account, shared key).
     */
    private readonly storageKeySuffix: string = "",
  ) {
    this.log = log;
    this.costResolver = costResolver;
    this.restore();
  }

  private storageKey(base: string): string {
    return this.storageKeySuffix ? `${base}.${this.storageKeySuffix}` : base;
  }

  /**
   * Copy all data from the singleton legacy keys (without suffix) into
   * this profile's namespaced storage. Called once during the first
   * activation after a single-account user upgrades to multi-account.
   */
  migrateFromSingleton(): void {
    if (!this.storageKeySuffix) return; // i am the singleton
    const hasLegacyEntries = this.context.globalState.get<unknown[]>(STORAGE_KEY, []).length > 0;
    if (!hasLegacyEntries) return;

    this.log?.("[go-tracker] migrating legacy singleton data into profile");

    // Migrate entries
    const legacyEntries = this.context.globalState.get<UsageLogEntry[]>(STORAGE_KEY, []);
    if (Array.isArray(legacyEntries) && legacyEntries.length > 0) {
      const targetKey = this.storageKey(STORAGE_KEY);
      this.context.globalState.update(targetKey, legacyEntries);
      this.context.globalState.update(STORAGE_KEY, []);
      this.entries = legacyEntries.filter((e) => typeof e.timestamp === "number" && typeof e.cost === "number");
    }

    // Migrate baseline
    const legacyBaseline = this.context.globalState.get<UsageBaseline>(BASELINE_STORAGE_KEY, {});
    if (legacyBaseline && Object.keys(legacyBaseline).length > 0) {
      const targetBase = this.storageKey(BASELINE_STORAGE_KEY);
      this.context.globalState.update(targetBase, legacyBaseline);
      this.context.globalState.update(BASELINE_STORAGE_KEY, {});
      this.baseline = legacyBaseline;
    }

    // Migrate session costs
    const legacySessions = this.context.globalState.get<SessionCostSummary[]>(SESSION_COSTS_KEY, []);
    if (Array.isArray(legacySessions) && legacySessions.length > 0) {
      const targetSess = this.storageKey(SESSION_COSTS_KEY);
      this.context.globalState.update(targetSess, legacySessions);
      this.context.globalState.update(SESSION_COSTS_KEY, []);
      for (const s of legacySessions) {
        if (s && typeof s.sessionId === "string" && typeof s.cost === "number") {
          this.sessionCosts.set(s.sessionId, s);
        }
      }
    }

    this.persist();
    this.persistBaseline();
  }

  /** Record a completed Go request. externalCost is from resolved metadata if available. */
  record(summary: TransportRequestSummary, externalCost?: ModelCost): void {
    const displayNameLower = summary.providerDisplayName.toLowerCase();
    if (!displayNameLower.includes("go")) {
      this.log?.(`[go-tracker] SKIP: providerDisplayName "${summary.providerDisplayName}" does not contain "go"`);
      return;
    }

    const prompt = summary.promptTokens ?? 0;
    const completion = summary.completionTokens ?? 0;
    const cached = summary.cachedTokens ?? 0;

    if (prompt + completion === 0) {
      this.log?.(`[go-tracker] SKIP: zero tokens (prompt=${prompt} completion=${completion}) for model=${summary.modelId}`);
      return;
    }

    const cost = estimateCost(summary.modelId, prompt, completion, cached, externalCost, this.costResolver);
    // VS Code session cost reads usage.copilotCredits (1 credit = $0.01).
    // Compute from USD cost so the session info popover shows accurate totals.
    const copilotCredits = cost * 100;

    this.log?.(
      `[go-tracker] RECORD: model=${summary.modelId} prompt=${prompt} completion=${completion} cached=${cached} cost=$${cost.toFixed(6)} credits=${copilotCredits.toFixed(4)}`,
    );

    this.entries.push({
      timestamp: Date.now(),
      modelId: summary.modelId,
      cost,
      promptTokens: prompt,
      completionTokens: completion,
      cachedTokens: cached,
      sessionId: summary.sessionId,
      copilotCredits,
    });

    // Accumulate per-session cost
    if (summary.sessionId) {
      const existing = this.sessionCosts.get(summary.sessionId);
      if (existing) {
        existing.cost += cost;
        existing.requests++;
        existing.promptTokens += prompt;
        existing.completionTokens += completion;
        existing.lastActivity = Date.now();
      } else {
        this.sessionCosts.set(summary.sessionId, {
          sessionId: summary.sessionId,
          cost,
          requests: 1,
          promptTokens: prompt,
          completionTokens: completion,
          lastActivity: Date.now(),
        });
      }
      this.pruneSessions();
    }

    this.prune();
    this.persist();
  }

  getSummary(): UsageSummary {
    const nowMs = Date.now();
    const clamp = (v: number, limit: number) => Math.round(Math.min(100, (v / limit) * 100) * 10) / 10;

    // When namespaced (per-profile), skip the shared SQLite — it has no
    // key column, so reading it would mix quota from all accounts.
    const isPerProfile = this.storageKeySuffix.length > 0;
    if (!isPerProfile) {
      const sqliteRows = readOpenCodeHistory();
      if (sqliteRows) {
        return this.buildSqliteEnrichedSummary(nowMs, sqliteRows, clamp);
      }
    }

    // Fall back to extension-tracked data (works without CLI).
    return this.buildSummaryFromTracked(nowMs, clamp);
  }

  /** Build summary from SQLite, enriched with token/request counts from tracked entries. */
  private buildSqliteEnrichedSummary(nowMs: number, rows: HistoryRow[], clamp: (v: number, limit: number) => number): UsageSummary {
    const base = this.buildSummaryFromRows(nowMs, rows, clamp, true);

    // Enrich today/yesterday tokens+requests from tracked entries (SQLite doesn't store tokens).
    const dayMs = startOfUtcDay(nowMs);
    const yesterdayMs = dayMs - 24 * 60 * 60 * 1000;
    let todayReq = base.today.requests;
    let todayTokens = 0;
    let yestReq = base.yesterday.requests;
    let yestTokens = 0;
    for (const e of this.entries) {
      if (e.timestamp >= dayMs) {
        todayTokens += e.promptTokens + e.completionTokens;
      } else if (e.timestamp >= yesterdayMs) {
        yestTokens += e.promptTokens + e.completionTokens;
      }
    }

    // Apply baselines on top of SQLite costs.
    const activeBaselineSession = this.getActiveBaselineAmount("session", nowMs);
    const activeBaselineWeekly = this.getActiveBaselineAmount("weekly", nowMs);
    const activeBaselineMonthly = this.getActiveBaselineAmount("monthly", nowMs);

    return {
      session: {
        ...base.session,
        spent: Math.round((base.session.spent + activeBaselineSession) * 10000) / 10000,
        percent: clamp(base.session.spent + activeBaselineSession, GO_LIMITS.session),
      },
      weekly: {
        ...base.weekly,
        spent: Math.round((base.weekly.spent + activeBaselineWeekly) * 10000) / 10000,
        percent: clamp(base.weekly.spent + activeBaselineWeekly, GO_LIMITS.weekly),
      },
      monthly: {
        ...base.monthly,
        spent: Math.round((base.monthly.spent + activeBaselineMonthly) * 10000) / 10000,
        percent: clamp(base.monthly.spent + activeBaselineMonthly, GO_LIMITS.monthly),
      },
      today: { ...base.today, requests: todayReq, tokens: todayTokens },
      yesterday: { ...base.yesterday, requests: yestReq, tokens: yestTokens },
      hasData: true,
      sqliteAvailable: true,
    };
  }

  /** Build summary from opencode.db rows (enrichment data from CLI history) */
  private buildSummaryFromRows(
    nowMs: number,
    rows: HistoryRow[],
    clamp: (v: number, limit: number) => number,
    hasData: boolean,
  ): UsageSummary {
    const dayMs = startOfUtcDay(nowMs);
    const yesterdayMs = dayMs - 24 * 60 * 60 * 1000;
    const weekMs = startOfUtcWeek(nowMs);
    const sessionStart = nowMs - FIVE_HOURS_MS;
    const earliest = rows.length > 0 ? Math.min(...rows.map((r) => r.createdMs)) : null;
    const { monthStartMs, monthEndMs } = buildMonthlyWindow(nowMs, this.baseline, earliest);
    const weekEnd = weekMs + WEEK_MS;

    let sessionCost = 0,
      weeklyCost = 0,
      monthlyCost = 0;
    let todayCost = 0,
      todayReq = 0;
    let yestCost = 0,
      yestReq = 0;

    for (const r of rows) {
      if (r.createdMs >= sessionStart && r.createdMs <= nowMs) sessionCost += r.cost;
      if (r.createdMs >= weekMs && r.createdMs <= nowMs) weeklyCost += r.cost;
      if (r.createdMs >= monthStartMs && r.createdMs < monthEndMs) monthlyCost += r.cost;
      if (r.createdMs >= dayMs) {
        todayCost += r.cost;
        todayReq += 1;
      } else if (r.createdMs >= yesterdayMs) {
        yestCost += r.cost;
        yestReq += 1;
      }
    }

    // Rolling 5h reset: oldest entry in window + 5h
    let oldest: number | null = null;
    for (const r of rows) {
      if (r.createdMs >= sessionStart && r.createdMs < nowMs) {
        if (oldest === null || r.createdMs < oldest) oldest = r.createdMs;
      }
    }

    // If a monthly baseline exists and is active, use its expiresAt for resetsAt.
    const monthlyResetsAt = this.baseline.monthly ? new Date(this.baseline.monthly.expiresAt) : new Date(monthEndMs);

    return {
      session: {
        spent: Math.round(sessionCost * 10000) / 10000,
        limit: GO_LIMITS.session,
        percent: clamp(sessionCost, GO_LIMITS.session),
        resetsAt: new Date((oldest ?? nowMs) + FIVE_HOURS_MS),
      },
      weekly: {
        spent: Math.round(weeklyCost * 10000) / 10000,
        limit: GO_LIMITS.weekly,
        percent: clamp(weeklyCost, GO_LIMITS.weekly),
        resetsAt: new Date(weekEnd),
      },
      monthly: {
        spent: Math.round(monthlyCost * 10000) / 10000,
        limit: GO_LIMITS.monthly,
        percent: clamp(monthlyCost, GO_LIMITS.monthly),
        resetsAt: monthlyResetsAt,
      },
      today: {
        cost: Math.round(todayCost * 10000) / 10000,
        requests: todayReq,
        tokens: 0, // not available from SQLite
      },
      yesterday: {
        cost: Math.round(yestCost * 10000) / 10000,
        requests: yestReq,
        tokens: 0,
      },
      hasData,
      sqliteAvailable: false,
    };
  }

  /** Check if opencode.db is readable and has Go history */
  get hasSQLiteData(): boolean {
    const rows = readOpenCodeHistory();
    return rows !== null && rows.length > 0;
  }

  /** Build summary from extension-tracked entries (fallback when opencode.db unavailable) */
  private buildSummaryFromTracked(nowMs: number, clamp: (v: number, limit: number) => number): UsageSummary {
    const dayMs = startOfUtcDay(nowMs);
    const yesterdayMs = dayMs - 24 * 60 * 60 * 1000;
    const weekMs = startOfUtcWeek(nowMs);
    const { monthStartMs, monthEndMs } = buildMonthlyWindow(nowMs, this.baseline);
    const sessionStart = nowMs - FIVE_HOURS_MS;

    let trackedSessionCost = 0,
      trackedWeeklyCost = 0,
      trackedMonthlyCost = 0;
    let todayCost = 0,
      todayReq = 0,
      todayTokens = 0;
    let yestCost = 0,
      yestReq = 0,
      yestTokens = 0;

    for (const e of this.entries) {
      if (e.timestamp >= sessionStart && e.timestamp <= nowMs) trackedSessionCost += e.cost;
      if (e.timestamp >= weekMs && e.timestamp <= nowMs) trackedWeeklyCost += e.cost;
      if (e.timestamp >= monthStartMs && e.timestamp < monthEndMs) trackedMonthlyCost += e.cost;
      if (e.timestamp >= dayMs) {
        todayCost += e.cost;
        todayReq += 1;
        todayTokens += e.promptTokens + e.completionTokens;
      } else if (e.timestamp >= yesterdayMs) {
        yestCost += e.cost;
        yestReq += 1;
        yestTokens += e.promptTokens + e.completionTokens;
      }
    }

    const activeBaselineSession = this.getActiveBaselineAmount("session", nowMs);
    const activeBaselineWeekly = this.getActiveBaselineAmount("weekly", nowMs);
    const activeBaselineMonthly = this.getActiveBaselineAmount("monthly", nowMs);

    const sessionCost = trackedSessionCost + activeBaselineSession;
    const weeklyCost = trackedWeeklyCost + activeBaselineWeekly;
    const monthlyCost = trackedMonthlyCost + activeBaselineMonthly;

    const weekEnd = weekMs + WEEK_MS;

    // If a monthly baseline exists and is active, use its expiresAt for resetsAt
    // instead of the anchor-based calculation (which ignores manual targets).
    const monthlyResetsAt = this.baseline.monthly ? new Date(this.baseline.monthly.expiresAt) : new Date(monthEndMs);

    return {
      session: {
        spent: Math.round(sessionCost * 10000) / 10000,
        limit: GO_LIMITS.session,
        percent: clamp(sessionCost, GO_LIMITS.session),
        resetsAt: nextSessionReset(this.entries, nowMs),
      },
      weekly: {
        spent: Math.round(weeklyCost * 10000) / 10000,
        limit: GO_LIMITS.weekly,
        percent: clamp(weeklyCost, GO_LIMITS.weekly),
        resetsAt: new Date(weekEnd),
      },
      monthly: {
        spent: Math.round(monthlyCost * 10000) / 10000,
        limit: GO_LIMITS.monthly,
        percent: clamp(monthlyCost, GO_LIMITS.monthly),
        resetsAt: monthlyResetsAt,
      },
      today: {
        cost: Math.round(todayCost * 10000) / 10000,
        requests: todayReq,
        tokens: todayTokens,
      },
      yesterday: {
        cost: Math.round(yestCost * 10000) / 10000,
        requests: yestReq,
        tokens: yestTokens,
      },
      hasData: this.entries.length > 0,
      sqliteAvailable: false,
    };
  }

  setManualSpentTargets(targets: UsageBaselineTargets): void {
    const nowMs = Date.now();

    // ── Monthly ───────────────────────────────────────────────────────────
    // When namespaced, skip SQLite — it has no key column and would mix
    // quota from all accounts.
    const isPerProfile = this.storageKeySuffix.length > 0;
    const sqliteRows = isPerProfile ? null : readOpenCodeHistory();
    let sqliteMonthlyCost = 0;
    if (sqliteRows && sqliteRows.length > 0) {
      const earliest = Math.min(...sqliteRows.map((r) => r.createdMs));
      // Build a temporary baseline to let buildMonthlyWindow find the anchor
      const tempBaseline: UsageBaseline = { ...this.baseline };
      if (targets.monthlyAnchorDay && targets.monthlyAnchorDay >= 1 && targets.monthlyAnchorDay <= 31) {
        tempBaseline.monthly = {
          ...(tempBaseline.monthly ?? { amount: 0, expiresAt: 0 }),
          anchorDay: targets.monthlyAnchorDay,
          anchorHour: targets.monthlyAnchorHour ?? 0,
        };
      }
      const { monthStartMs, monthEndMs } = buildMonthlyWindow(nowMs, tempBaseline, earliest);
      for (const r of sqliteRows) {
        if (r.createdMs >= monthStartMs && r.createdMs < monthEndMs) {
          sqliteMonthlyCost += r.cost;
        }
      }
    }

    const currentBaselineMonthly = this.getActiveBaselineAmount("monthly", nowMs);
    // trackedMonthly = what SQLite shows for the target window + tracked entries baseline adjustment
    // When no SQLite, fall back to tracked entries for the target window
    let trackedMonthly = sqliteMonthlyCost;
    if (!sqliteRows) {
      // No SQLite: compute from tracked entries using the target window
      const tempBaseline: UsageBaseline = { ...this.baseline };
      if (targets.monthlyAnchorDay && targets.monthlyAnchorDay >= 1 && targets.monthlyAnchorDay <= 31) {
        tempBaseline.monthly = {
          ...(tempBaseline.monthly ?? { amount: 0, expiresAt: 0 }),
          anchorDay: targets.monthlyAnchorDay,
          anchorHour: targets.monthlyAnchorHour ?? 0,
        };
      }
      const { monthStartMs, monthEndMs } = buildMonthlyWindow(nowMs, tempBaseline);
      for (const e of this.entries) {
        if (e.timestamp >= monthStartMs && e.timestamp < monthEndMs) {
          trackedMonthly += e.cost;
        }
      }
    }
    // If SQLite had no rows (empty array), use summary fallback
    if (sqliteRows && sqliteRows.length === 0) {
      const summary = this.getSummary();
      trackedMonthly = Math.max(0, summary.monthly.spent - currentBaselineMonthly);
    }
    // For SQLite path, subtract the current baseline so we don't double-count
    if (sqliteRows && sqliteRows.length > 0) {
      trackedMonthly = Math.max(0, trackedMonthly - currentBaselineMonthly);
    }

    // ── Session and Weekly ────────────────────────────────────────────────
    const summary = this.getSummary();
    const currentBaselineSession = this.getActiveBaselineAmount("session", nowMs);
    const currentBaselineWeekly = this.getActiveBaselineAmount("weekly", nowMs);

    const trackedSession = Math.max(0, summary.session.spent - currentBaselineSession);
    const trackedWeekly = Math.max(0, summary.weekly.spent - currentBaselineWeekly);

    this.baseline.session = {
      amount: targets.session - trackedSession,
      expiresAt: summary.session.resetsAt.getTime(),
    };
    this.baseline.weekly = {
      amount: targets.weekly - trackedWeekly,
      expiresAt: summary.weekly.resetsAt.getTime(),
    };
    this.baseline.monthly = {
      amount: targets.monthly - trackedMonthly,
      expiresAt: summary.monthly.resetsAt.getTime(),
    };

    // Override monthly expiry if caller provided anchor day + hour.
    if (targets.monthlyAnchorDay && targets.monthlyAnchorDay >= 1 && targets.monthlyAnchorDay <= 31) {
      const hour = targets.monthlyAnchorHour ?? 0;
      const now = new Date(nowMs);
      let year = now.getUTCFullYear();
      let month = now.getUTCMonth();
      let candidate = Date.UTC(year, month, targets.monthlyAnchorDay, hour, 0, 0, 0);
      if (candidate <= nowMs) {
        // If the anchor day+hour has passed this month, next reset is next month.
        month++;
        if (month > 11) {
          year++;
          month = 0;
        }
        candidate = Date.UTC(year, month, targets.monthlyAnchorDay, hour, 0, 0, 0);
      }
      this.baseline.monthly = {
        amount: this.baseline.monthly.amount,
        expiresAt: candidate,
        anchorDay: targets.monthlyAnchorDay,
        anchorHour: hour,
      };
    }

    this.persistBaseline();
  }

  clear(): void {
    this.entries = [];
    this.baseline = {};
    this.persist();
    this.persistBaseline();
  }

  private prune(): void {
    const cutoff = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days
    this.entries = this.entries.filter((e) => e.timestamp > cutoff).slice(-MAX_LOG_ENTRIES);
  }

  /** Remove idle sessions and cap total count. */
  private pruneSessions(): void {
    const now = Date.now();
    const idleCutoff = now - GoUsageTracker.SESSION_IDLE_MS;
    for (const [id, s] of this.sessionCosts) {
      if (s.lastActivity < idleCutoff) {
        this.sessionCosts.delete(id);
      }
    }
    // If still over limit, remove oldest by lastActivity
    if (this.sessionCosts.size > GoUsageTracker.MAX_SESSIONS) {
      const sorted = [...this.sessionCosts.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity);
      const toRemove = sorted.length - GoUsageTracker.MAX_SESSIONS;
      for (let i = 0; i < toRemove; i++) {
        this.sessionCosts.delete(sorted[i][0]);
      }
    }
  }

  /** Returns the most recent chat session's cost summary. */
  getCurrentSessionCost(): SessionCostSummary | undefined {
    let latest: SessionCostSummary | undefined;
    for (const s of this.sessionCosts.values()) {
      if (!latest || s.lastActivity > latest.lastActivity) {
        latest = s;
      }
    }
    return latest;
  }

  /** Returns up to `limit` most recent session cost summaries, ordered by last activity (newest first). */
  getRecentSessionCosts(limit = 5): SessionCostSummary[] {
    return [...this.sessionCosts.values()].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, limit);
  }

  private persist(): void {
    void this.context.globalState.update(this.storageKey(STORAGE_KEY), this.entries);
    void this.context.globalState.update(this.storageKey(SESSION_COSTS_KEY), [...this.sessionCosts.values()]);
  }

  private persistBaseline(): void {
    void this.context.globalState.update(this.storageKey(BASELINE_STORAGE_KEY), this.baseline);
  }

  private getActiveBaselineAmount(period: keyof UsageBaseline, nowMs: number): number {
    const entry = this.baseline[period];
    if (!entry) return 0;
    if (entry.expiresAt <= nowMs) {
      delete this.baseline[period];
      this.persistBaseline();
      return 0;
    }
    return entry.amount;
  }

  private restore(): void {
    const stored = this.context.globalState.get<UsageLogEntry[]>(this.storageKey(STORAGE_KEY), []);
    if (Array.isArray(stored)) {
      this.entries = stored.filter((e) => typeof e.timestamp === "number" && typeof e.cost === "number");
    }

    const baseline = this.context.globalState.get<UsageBaseline>(this.storageKey(BASELINE_STORAGE_KEY), {});
    if (baseline && typeof baseline === "object") {
      this.baseline = baseline;
    }

    // Restore session costs from persistence
    const storedSessions = this.context.globalState.get<SessionCostSummary[]>(this.storageKey(SESSION_COSTS_KEY), []);
    if (Array.isArray(storedSessions)) {
      for (const s of storedSessions) {
        if (s && typeof s.sessionId === "string" && typeof s.cost === "number") {
          this.sessionCosts.set(s.sessionId, s);
        }
      }
      this.pruneSessions();
    }
  }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function progressBar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function fmtRelativeTime(target: Date, from: Date = new Date()): string {
  const diffMs = target.getTime() - from.getTime();
  if (diffMs <= 0) return "now";
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function fmtDate(d: Date): string {
  return (
    d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }) + " UTC"
  );
}

function percentColor(pct: number): string {
  if (pct >= 90) return "⛔";
  if (pct >= 75) return "🟠";
  if (pct >= 50) return "🟡";
  return "🟢";
}

/** Status bar label: e.g. "Go: 27%·62%·75%" */
export function formatGoUsageStatusBarText(summary: UsageSummary): string {
  if (!summary.hasData) return "OpenCode Go";
  const s = summary.session.percent;
  const w = summary.weekly.percent;
  const m = summary.monthly.percent;
  const warn = s >= 80 || w >= 80 || m >= 80 ? " $(warning)" : "";
  return `Go: ${s}%·${w}%·${m}%${warn}`;
}

/** Multiline tooltip (VS Code renders newlines in tooltips as-is) */
export function formatGoUsageTooltip(summary: UsageSummary): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.supportThemeIcons = true;
  md.isTrusted = true;

  md.appendMarkdown("**OpenCode Go — Usage Limits**\n\n");

  for (const [label, period] of [
    ["Session (5h rolling)", summary.session],
    ["Weekly (Mon–Mon UTC)", summary.weekly],
    ["Monthly", summary.monthly],
  ] as [string, PeriodUsage][]) {
    const bar = progressBar(period.percent);
    const icon = percentColor(period.percent);
    const resets = fmtRelativeTime(period.resetsAt);
    md.appendMarkdown(
      `${icon} **${label}**\n\n` +
        `\`${bar}\` ${period.percent}% · ${fmtUsd(period.spent)} / ${fmtUsd(period.limit)} · resets in ${resets}\n\n`,
    );
  }

  md.appendMarkdown("---\n\n");
  md.appendMarkdown(
    `$(history) **Today:** ${fmtUsd(summary.today.cost)} · ${fmtTokens(summary.today.tokens)} tokens · ${summary.today.requests} req\n\n`,
  );

  if (summary.yesterday.requests > 0) {
    md.appendMarkdown(
      `$(history) **Yesterday:** ${fmtUsd(summary.yesterday.cost)} · ${fmtTokens(summary.yesterday.tokens)} tokens · ${summary.yesterday.requests} req\n\n`,
    );
  }

  md.appendMarkdown("\n$(info) Click for details");
  return md;
}

/** Compact plain-text summary used by Language Status popup. */
export function formatGoUsageLanguageStatusDetail(summary: UsageSummary): string {
  const now = new Date();

  const sessionLine = [
    `Session ${summary.session.percent}%`,
    `${fmtUsd(summary.session.spent)} / ${fmtUsd(summary.session.limit)}`,
    `resets in ${fmtRelativeTime(summary.session.resetsAt, now)}`,
  ].join(" · ");

  const weeklyLine = [
    `Weekly ${summary.weekly.percent}%`,
    `${fmtUsd(summary.weekly.spent)} / ${fmtUsd(summary.weekly.limit)}`,
    `resets in ${fmtRelativeTime(summary.weekly.resetsAt, now)}`,
  ].join(" · ");

  const monthlyLine = [
    `Monthly ${summary.monthly.percent}%`,
    `${fmtUsd(summary.monthly.spent)} / ${fmtUsd(summary.monthly.limit)}`,
    `resets in ${fmtRelativeTime(summary.monthly.resetsAt, now)}`,
  ].join(" · ");

  const todayLine = [
    `Today ${fmtUsd(summary.today.cost)}`,
    `${fmtTokens(summary.today.tokens)} tokens`,
    `${summary.today.requests} req`,
  ].join(" · ");

  return [sessionLine, weeklyLine, monthlyLine, todayLine].join("\n");
}

/** Build Quick Pick items for the usage panel */
export function buildUsageQuickPickItems(summary: UsageSummary): vscode.QuickPickItem[] {
  const now = new Date();
  const isEmpty = !summary.hasData;

  function periodItem(icon: string, label: string, period: PeriodUsage, resetLabel: string): vscode.QuickPickItem {
    const bar = progressBar(period.percent);
    const spent = fmtUsd(period.spent);
    const limit = fmtUsd(period.limit);
    const resets = fmtRelativeTime(period.resetsAt, now);
    return {
      label: `${icon} ${label}`,
      description: `${bar} ${period.percent}%`,
      detail: `${spent} / ${limit} used · resets in ${resets} (${resetLabel})`,
      alwaysShow: true,
    };
  }

  const items: vscode.QuickPickItem[] = [];

  if (isEmpty) {
    items.push({
      label: "$(info) Ready to track",
      detail: "Send a chat message to any OpenCode Go model to start tracking usage.",
      alwaysShow: true,
    });
  }

  // ── Period bars ──────────────────────────────────────────────────────────
  items.push({ label: "Subscription Limits", kind: vscode.QuickPickItemKind.Separator });

  items.push(
    periodItem(
      percentColor(summary.session.percent) + " $(clock)",
      "Session (5h rolling)",
      summary.session,
      fmtDate(summary.session.resetsAt),
    ),
  );

  items.push(periodItem(percentColor(summary.weekly.percent) + " $(calendar)", "Weekly", summary.weekly, fmtDate(summary.weekly.resetsAt)));

  items.push(
    periodItem(percentColor(summary.monthly.percent) + " $(graph)", "Monthly", summary.monthly, fmtDate(summary.monthly.resetsAt)),
  );

  // ── Daily summary ────────────────────────────────────────────────────────
  items.push({ label: "Daily Summary", kind: vscode.QuickPickItemKind.Separator });

  items.push({
    label: `$(history) Today`,
    description: fmtUsd(summary.today.cost),
    detail: `${fmtTokens(summary.today.tokens)} tokens · ${summary.today.requests} requests`,
    alwaysShow: true,
  });

  if (summary.yesterday.requests > 0 || isEmpty) {
    items.push({
      label: `$(history) Yesterday`,
      description: fmtUsd(summary.yesterday.cost),
      detail: `${fmtTokens(summary.yesterday.tokens)} tokens · ${summary.yesterday.requests} requests`,
      alwaysShow: true,
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  items.push({ label: "Actions", kind: vscode.QuickPickItemKind.Separator });

  items.push({
    label: "$(link-external) Open OpenCode console",
    description: "View usage at opencode.ai",
    alwaysShow: true,
  });

  items.push({
    label: "$(trash) Reset tracked usage data",
    description: "Clears all locally tracked data",
    alwaysShow: true,
  });

  return items;
}

export { GO_VENDOR };
