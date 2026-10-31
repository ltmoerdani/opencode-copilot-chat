/**
 * Public data shapes for the Go usage tracker. Pure types — the tracker class
 * lives in `tracker.ts`, aggregation helpers in `trackerSummary.ts`.

 */
import type { UsageTodayYesterdaySource } from "../config";
import type { UsageDaily } from "./history";

export interface UsageLogEntry {
  /** Unix timestamp ms */
  timestamp: number;
  modelId: string;
  /** Estimated cost in USD */
  cost: number;
  /** Actual Go allowance counted by OpenCode, when reported by the response. */
  allowance?: number;
  /** Go list-price equivalent, when reported by the response. */
  listCost?: number;
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
  /** Known only for local fallback summaries; server meters expose percentage/reset only. */
  limit?: number;
  percent: number;
  resetsAt: Date;
}

export interface UsageSummary {
  session: PeriodUsage;
  weekly: PeriodUsage;
  monthly: PeriodUsage;
  today: UsageDaily;
  yesterday: UsageDaily;
  /** All-time usage in the CURRENT workspace (from OpenCode CLI history). */
  codebase: UsageDaily;
  hasData: boolean;
  /** When true, cost data comes from the OpenCode CLI SQLite database
            (actual billed amounts). When false, costs are estimated locally. */
  sqliteAvailable: boolean;
}

/**
 * Per-view knobs resolved live so the user can pick how usage is presented.
 * All resolvers are optional — the tracker falls back to sensible defaults.
 */
export interface GoUsageTrackerOptions {
  /** Absolute paths of the current VS Code workspace folders. */
  resolveWorkspaceFolders?: () => readonly string[];
  /** Source of the Today/Yesterday rows (default "auto"). */
  resolveTodayYesterdaySource?: () => UsageTodayYesterdaySource;
  /** Codebase window in days; 0 = forever (default). */
  resolveCodebaseWindowDays?: () => number;
  /** Day boundary for Today/Yesterday ("utc" default | "local"). */
  resolveDayBoundary?: () => "utc" | "local";
  /** Usage endpoint derived from the configured Go API base URL. */
  resolveUsageUrl?: () => string;
}

export interface UsageBaselinePeriod {
  amount: number;
  expiresAt: number;
}

export interface UsageBaseline {
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
