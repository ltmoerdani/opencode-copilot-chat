import * as vscode from "vscode";
import { formatCount, formatTokenCount, formatUsd, formatRelativeTime } from "../utils";
import type { PeriodUsage, UsageSummary } from "./tracker";

// ─── Formatting helpers ──────────────────────────────────────────────────────

function progressBar(percent: number, width = 10): string {
  // Clamp so out-of-range values (negative spend, >100% overage) never render
  // a bar wider than `width` or with a negative fill.
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
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
  return `Go: ${String(s)}%·${String(w)}%·${String(m)}%${warn}`;
}

/** Build Quick Pick items for the usage panel */
export function buildUsageQuickPickItems(summary: UsageSummary, syncedFromServer = false, showRollingMeter = true): vscode.QuickPickItem[] {
  const now = new Date();
  const isEmpty = !summary.hasData;

  function periodItem(icon: string, label: string, period: PeriodUsage, resetLabel: string): vscode.QuickPickItem {
    const bar = progressBar(period.percent);
    const amounts =
      period.limit === undefined
        ? `${formatUsd(period.spent)} local amount`
        : `${formatUsd(period.spent)} / ${formatUsd(period.limit)} used`;
    const resets = formatRelativeTime(period.resetsAt, now);
    return {
      label: `${icon} ${label}`,
      description: `${bar} ${String(period.percent)}%`,
      detail: `${amounts} · resets in ${resets} (${resetLabel})`,
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

  if (syncedFromServer) {
    items.push({
      label: "$(cloud) Synced from opencode.ai",
      detail: "Session/Weekly/Monthly meters are account-wide and server-accurate.",
      alwaysShow: true,
    });
  }

  // ── Period bars ──────────────────────────────────────────────────────────
  items.push({ label: "Subscription Limits", kind: vscode.QuickPickItemKind.Separator });

  if (showRollingMeter) {
    items.push(
      periodItem(
        percentColor(summary.session.percent) + " $(clock)",
        "Session (5h rolling)",
        summary.session,
        fmtDate(summary.session.resetsAt),
      ),
    );
  }

  items.push(periodItem(percentColor(summary.weekly.percent) + " $(calendar)", "Weekly", summary.weekly, fmtDate(summary.weekly.resetsAt)));

  items.push(
    periodItem(percentColor(summary.monthly.percent) + " $(graph)", "Monthly", summary.monthly, fmtDate(summary.monthly.resetsAt)),
  );

  // ── Daily summary ────────────────────────────────────────────────────────
  items.push({ label: "Daily Summary", kind: vscode.QuickPickItemKind.Separator });

  items.push({
    label: `$(history) Today`,
    description: formatUsd(summary.today.cost),
    detail: `${formatTokenCount(summary.today.tokens)} tokens · ${formatCount(summary.today.requests)} requests`,
    alwaysShow: true,
  });

  if (summary.yesterday.requests > 0 || isEmpty) {
    items.push({
      label: `$(history) Yesterday`,
      description: formatUsd(summary.yesterday.cost),
      detail: `${formatTokenCount(summary.yesterday.tokens)} tokens · ${formatCount(summary.yesterday.requests)} requests`,
      alwaysShow: true,
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  items.push({ label: "Actions", kind: vscode.QuickPickItemKind.Separator });

  items.push({
    label: "$(link-external) Open OpenCode console",
    description: "View usage at opencode.ai",
    alwaysShow: true,
    _action: "openConsole",
  } as vscode.QuickPickItem & { _action: string });

  return items;
}
