import * as vscode from "vscode";
import type { GoUsageTracker } from "../tracker";
import { escapeHtml, formatCount, formatRelativeTime, formatTokenCount, formatUsd } from "../../utils";
import { findProfile, nonLegacyCount } from "../usageProfile";
import { activeProfileFingerprint, profilesCache, usageCodebaseRowVisible, usageRollingMeterVisible } from "./state";

/** Build the status-bar hover card. */
export function buildUsageTooltip(s: ReturnType<GoUsageTracker["getSummary"]>): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;
  const activeProfile = findProfile(profilesCache, activeProfileFingerprint);
  const profileLabel = activeProfile?.label ?? "OpenCode Go";

  // The hover shows the summary card only; Set spent targets / Rename are
  // available from the Command Palette (opencodego.setUsageTargets,
  // opencodego.renameActiveProfile).
  md.appendMarkdown(`<img alt="Go usage summary" src="${usageTooltipSvgDataUri(s, profileLabel)}" width="440">`);
  return md;
}
type _UsageSummary = ReturnType<GoUsageTracker["getSummary"]>;

function usageTooltipSvgDataUri(s: _UsageSummary, profileLabel?: string): string {
  const svg = buildUsageTooltipSvg(s, profileLabel);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Build the status-bar hover card. */
export function buildUsageTooltipSvg(s: _UsageSummary, profileLabel?: string): string {
  // Stable geometry: fixed card width and fixed columns, so the layout never
  // shifts when session data appears or a day has no usage yet.
  const width = 440;
  const padX = 14;
  const right = width - padX;
  const fg = "#d4d4d4";
  const muted = "#a6a6a6";
  const track = "#3c3c3c";
  const accent = "#73c991";
  const line = "#333333";
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const svgTitle = escapeHtml(profileLabel ? `${profileLabel} - Usage` : "OpenCode Go - Usage");
  const noDataMsg = s.hasData ? null : nonLegacyCount(profilesCache) > 0 ? "No data yet for this profile." : "No usage data yet.";

  const text = (value: string, x: number, y: number, size: number, weight = 400, color = fg, anchor: "start" | "end" = "start"): string =>
    `<text x="${String(x)}" y="${String(y)}" fill="${color}" font-family="${font}" font-size="${String(size)}" font-weight="${String(weight)}" text-anchor="${anchor}">${escapeHtml(value)}</text>`;

  const bar = (pct: number, x: number, y: number, barWidth: number): string => {
    const clamped = Math.min(Math.max(pct, 0), 100);
    const fillWidth = Math.max(0, Math.round((clamped / 100) * barWidth));
    return [
      `<rect x="${String(x)}" y="${String(y)}" width="${String(barWidth)}" height="5" rx="2.5" fill="${track}"/>`,
      fillWidth > 0 ? `<rect x="${String(x)}" y="${String(y)}" width="${String(fillWidth)}" height="5" rx="2.5" fill="${accent}"/>` : "",
    ].join("");
  };

  // Meter block with a uniform 14px gutter between blocks: label row with the
  // reset time right-aligned at the card's right padding, then the bar and
  // the spent/limit line below it.
  const period = (label: string, p: _UsageSummary["session"], y: number): string =>
    [
      text(label, padX, y, 14, 700),
      text(`Resets in ${formatRelativeTime(p.resetsAt)}`, right, y, 12, 400, muted, "end"),
      bar(p.percent, padX, y + 14, 340),
      text(`${p.percent.toFixed(1)}%`, right, y + 21, 14, 700, fg, "end"),
      text(
        p.limit === undefined ? `${formatUsd(p.spent)} local amount` : `${formatUsd(p.spent)} / ${formatUsd(p.limit)} used`,
        padX,
        y + 36,
        13,
        400,
        fg,
      ),
    ].join("");

  // Device-local rows share one fixed column grid: label, cost, requests,
  // tokens. Always rendered (zeros included) so the card height is stable.
  const deviceRow = (label: string, cost: number, requests: number, tokenCount: number, y: number): string =>
    [
      text(label, padX, y, 13, 400, muted),
      text(formatUsd(cost), 120, y, 13, 700),
      text("Requests:", 190, y, 13, 400, muted),
      text(formatCount(requests), 262, y, 13, 700),
      text("Tokens:", 305, y, 13, 400, muted),
      text(formatTokenCount(tokenCount), 385, y, 13, 700),
    ].join("");

  if (!s.hasData) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="70" viewBox="0 0 ${width} 70">${text(svgTitle, padX, 28, 16, 700)}
${text(noDataMsg ?? "No usage data yet. Send a chat message to start tracking.", padX, 52, 12, 400, muted)}
</svg>`;
  }

  // Title starts at the same 14px gutter as the sides. Meter rows, the
  // divider and the device rows keep a consistent 14px rhythm.
  const meterRows = [
    ...(usageRollingMeterVisible() ? ([["Session (5h rolling)", s.session, 56]] as const) : []),
    ["Weekly", s.weekly, 116],
    ["Monthly", s.monthly, 176],
  ] as const;
  const dividerY = 46 + meterRows.length * 60;
  const firstRowY = dividerY + 22;
  const rowGap = 24;
  // All three rows are always rendered (zeros included) so the card is
  // stable regardless of whether a session is currently active.
  const deviceRows: Array<[string, number, number, number, number]> = [];
  if (usageCodebaseRowVisible()) {
    deviceRows.push(["Codebase:", s.codebase.cost, s.codebase.requests, s.codebase.tokens, firstRowY]);
  }
  const codebaseOffset = usageCodebaseRowVisible() ? 1 : 0;
  deviceRows.push(["Today:", s.today.cost, s.today.requests, s.today.tokens, firstRowY + codebaseOffset * rowGap]);
  deviceRows.push(["Yesterday:", s.yesterday.cost, s.yesterday.requests, s.yesterday.tokens, firstRowY + (codebaseOffset + 1) * rowGap]);

  const height = firstRowY + (deviceRows.length - 1) * rowGap + 14;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${text(svgTitle, padX, 28, 16, 700)}
${meterRows.map(([label, periodValue, y]) => period(label, periodValue, y)).join("")}
<line x1="${padX}" y1="${dividerY}" x2="${right}" y2="${dividerY}" stroke="${line}" stroke-width="1"/>
${deviceRows.map(([label, cost, requests, tokenCount, y]) => deviceRow(label, cost, requests, tokenCount, y)).join("")}</svg>`;
}
