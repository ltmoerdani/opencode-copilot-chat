import * as vscode from "vscode";
import { GO_LIMITS } from "../../config";
import { GoUsageTracker, type UsageBaselineTargets } from "../tracker";

export function parseCurrencyInput(value: string): number {
  // Allow only digits, one comma or dot, and optional leading minus
  if (!/^-?\d+[.,]?\d*$/.test(value)) return NaN;
  return parseFloat(value.replace(",", "."));
}

export async function showUsageTargetEditor(tracker: GoUsageTracker): Promise<UsageBaselineTargets | undefined> {
  const summary = tracker.getSummary();

  // Ask for session spent (pre-filled with current tracked value)
  const sessionStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Session Spent",
    prompt: `Total spent in the 5-hour rolling window (fallback limit: $${String(GO_LIMITS.session)}).`,
    placeHolder: "e.g. 3.50",
    value: summary.session.spent.toFixed(2),
    validateInput: (value: string) => {
      const n = parseCurrencyInput(value);
      if (isNaN(n) || n < 0) return "Enter a valid number using digits and . or , as decimal separator (e.g. 3.50).";
      if (n > GO_LIMITS.session)
        return `Session limit is $${String(GO_LIMITS.session)}. Enter a value between 0 and ${String(GO_LIMITS.session)}.`;
      return undefined;
    },
  });
  if (sessionStr === undefined) return undefined;

  // Ask for weekly spent (pre-filled)
  const weeklyStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Weekly Spent",
    prompt: `Total spent this week Mon–Mon UTC (fallback limit: $${String(GO_LIMITS.weekly)}).`,
    placeHolder: "e.g. 12.00",
    value: summary.weekly.spent.toFixed(2),
    validateInput: (value: string) => {
      const n = parseCurrencyInput(value);
      if (isNaN(n) || n < 0) return "Enter a valid number using digits and . or , as decimal separator (e.g. 12.00).";
      if (n > GO_LIMITS.weekly)
        return `Weekly limit is $${String(GO_LIMITS.weekly)}. Enter a value between 0 and ${String(GO_LIMITS.weekly)}.`;
      return undefined;
    },
  });
  if (weeklyStr === undefined) return undefined;

  // Ask for monthly spent (pre-filled)
  const monthlyStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Monthly Spent",
    prompt: `Total spent this month (fallback limit: $${String(GO_LIMITS.monthly)}).`,
    placeHolder: "e.g. 25.00",
    value: summary.monthly.spent.toFixed(2),
    validateInput: (value: string) => {
      const n = parseCurrencyInput(value);
      if (isNaN(n) || n < 0) return "Enter a valid number using digits and . or , as decimal separator (e.g. 25.00).";
      if (n > GO_LIMITS.monthly)
        return `Monthly limit is $${String(GO_LIMITS.monthly)}. Enter a value between 0 and ${String(GO_LIMITS.monthly)}.`;
      return undefined;
    },
  });
  if (monthlyStr === undefined) return undefined;

  // Ask for monthly reset day (1-31) — pre-filled
  const monthlyDayStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Monthly Reset Day",
    prompt: "Day of month when monthly usage resets (1-31). Press Enter to keep current.",
    placeHolder: "e.g. 10",
    value: summary.monthly.resetsAt.getUTCDate().toString(),
    validateInput: (value: string) => {
      if (!value) return undefined;
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 31) return "Enter a day between 1 and 31.";
      return undefined;
    },
  });
  if (monthlyDayStr === undefined) return undefined;

  // Ask for monthly reset hour (0-23 UTC) — pre-filled
  const monthlyHourStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Monthly Reset Hour",
    prompt: "Hour (UTC, 0-23) when monthly usage resets. Press Enter to keep current.",
    placeHolder: "e.g. 0",
    value: summary.monthly.resetsAt.getUTCHours().toString(),
    validateInput: (value: string) => {
      if (!value) return undefined;
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 0 || n > 23) return "Enter an hour between 0 and 23 (UTC).";
      return undefined;
    },
  });
  if (monthlyHourStr === undefined) return undefined;

  const monthlyAnchorDay = monthlyDayStr ? parseInt(monthlyDayStr, 10) : undefined;
  const monthlyAnchorHour = monthlyHourStr ? parseInt(monthlyHourStr, 10) : undefined;

  return {
    session: parseCurrencyInput(sessionStr),
    weekly: parseCurrencyInput(weeklyStr),
    monthly: parseCurrencyInput(monthlyStr),
    monthlyAnchorDay,
    monthlyAnchorHour,
  };
}
