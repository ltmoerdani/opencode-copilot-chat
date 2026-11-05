import * as vscode from "vscode";
import { completionUsageToSeries, type CompletionUsageDay } from "../../autocomplete/usage";
import { COMPLETION_USAGE_KEY, CONFIG_SECTION, SETTING_USAGE_DAY_BOUNDARY } from "../../config";
import { formatRelativeTime } from "../../utils";
import type { GoUsageTracker } from "../tracker";
import { findProfile, nonLegacyCount } from "../usageProfile";
import {
  _extensionContext,
  activeGoUsageTracker,
  activeProfileFingerprint,
  goUsageTracker,
  profilesCache,
  usageChartWindowDays,
  usageRollingMeterVisible,
} from "./state";

/** Build the chart/stat payload shown by the usage webview. */
export function usageWebviewData(): Record<string, unknown> | undefined {
  if (!goUsageTracker) return undefined;
  const tracker = activeGoUsageTracker();
  if (!tracker) return undefined;
  const s = tracker.getSummary();
  const windowDays = usageChartWindowDays;
  const series = tracker.getUsageSeries(windowDays);
  const completionDays = contextCompletionUsage();
  // The completion series must share the EXACT day buckets of the usage
  // series (they can differ in length on lifetime windows), otherwise the
  // charts misalign and hovers resolve to undefined values.
  const completions = completionUsageToSeries(
    completionDays,
    trackerDayStart(tracker),
    windowDays,
    series.days.length > 0 ? series.days[0].dayStart : undefined,
  );
  const activeProfile = findProfile(profilesCache, activeProfileFingerprint);
  const showRolling = usageRollingMeterVisible();
  const avgTokensPerSecond = tracker.averageTokensPerSecond();

  const rings = [
    ...(showRolling
      ? [
          {
            key: "session",
            label: "Session (5h)",
            percent: s.session.percent,
            spent: s.session.spent,
            limit: s.session.limit,
            resetsIn: formatRelativeTime(s.session.resetsAt),
          },
        ]
      : []),
    {
      key: "weekly",
      label: "Weekly",
      percent: s.weekly.percent,
      spent: s.weekly.spent,
      limit: s.weekly.limit,
      resetsIn: formatRelativeTime(s.weekly.resetsAt),
    },
    {
      key: "monthly",
      label: "Monthly",
      percent: s.monthly.percent,
      spent: s.monthly.spent,
      limit: s.monthly.limit,
      resetsIn: formatRelativeTime(s.monthly.resetsAt),
    },
  ];

  return {
    profile: activeProfile?.label ?? "OpenCode Go",
    showRename: nonLegacyCount(profilesCache) > 0,
    windowDays,
    completions,
    rings,
    stats: {
      total: { label: "Codebase", cost: s.codebase.cost, tokens: s.codebase.tokens, requests: s.codebase.requests },
      today: { label: "Today", cost: s.today.cost, tokens: s.today.tokens, requests: s.today.requests },
      yesterday: { label: "Yesterday", cost: s.yesterday.cost, tokens: s.yesterday.tokens, requests: s.yesterday.requests },
    },
    days: series.days,
    byModel: series.byModel,
    // Mean generation speed (tok/s) across tracked requests; undefined → "-" in the panel.
    ...(avgTokensPerSecond === undefined ? {} : { tokensPerSecond: Math.round(avgTokensPerSecond * 10) / 10 }),
  };
}

/** Read the persisted per-day completion counters. */
function contextCompletionUsage(): CompletionUsageDay[] {
  const stored = _extensionContext?.globalState.get<CompletionUsageDay[]>(COMPLETION_USAGE_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

/** Day-start used by the current tracker (matches the chart boundary). */
function trackerDayStart(_tracker: GoUsageTracker): number {
  const now = new Date();
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<"utc" | "local">(SETTING_USAGE_DAY_BOUNDARY, "utc") === "local"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
