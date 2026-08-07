**Status:** ✅ Solved

# PR #50 — Manual Usage Targets + Live Pricing for Go Usage Tracker

**Topic:** usage / features / status-bar / pricing / byok
**Updated:** 2026-06-17
**Tags:** #usage #go-usage #pricing #byok #targets #status-bar #community #wallacy
**Supersedes:** —

---

## Overview

PR #50 adds manual Go usage target configuration and switches cost estimation to use the live `models.dev` pricing snapshot. Previously the tracker auto-calculated everything from request logs with no way for users to override — and if pricing drifted, cost estimates silently went stale.

**Documented:** 2026-06-17
**Shipped in:** v0.3.3 (PR [#50](https://github.com/ltmoerdani/opencode-copilot-chat/pull/50), merged 2026-06-17)
**Issues:** [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23)
**Contributor:** [@Wallacy](https://github.com/Wallacy)

---

## Problem

### 1 — No Manual Override

Users who topped up mid-cycle, or whose real OpenCode Go dashboard showed a different spent amount than the client-side estimate, had no way to reconcile the tracker with reality. The displayed percentages drifted from the actual subscription state, making the usage indicator unreliable.

### 2 — Stale Pricing

`GO_MODEL_PRICING` in `src/goUsageTracker.ts` is a hand-maintained snapshot sourced from `opencode.ai/docs/go`. When providers change prices or new models ship, the table goes stale until a manual code update + release. The tracker then silently under- or over-estimates cost.

### 3 — Monthly Reset Display Ignored Manual Anchors

Even when a monthly baseline existed, both summary builders (`buildSummaryFromRows` for `opencode.db` SQLite, `buildSummaryFromTracked` for extension-tracked entries) returned the auto-calculated `monthEndMs` as `resetsAt` — so the "resets in Xd Yh" tooltip text contradicted the user-set monthly anchor.

---

## Root Cause

The original tracker (`src/goUsageTracker.ts`) was designed as a **fully automatic** system — read logs, estimate cost, display percentages. There was no mechanism for users to input their real dashboard values. The monthly `resetsAt` was computed from `anchoredMonthEnd()` using the earliest request as an activation date, which ignored any stored `baseline.monthly.expiresAt`. The pricing fallback chain was `externalCost → GO_MODEL_PRICING` with no intermediate live source.

---

## Solution

### Manual Usage Targets (`showUsageTargetEditor`)

New command `opencodego.setUsageTargets` registered in `extension.ts`:

```ts
vscode.commands.registerCommand("opencodego.setUsageTargets", async () => {
  if (!goUsageTracker) return;
  const targets = await showUsageTargetEditor(goUsageTracker);
  if (targets) {
    goUsageTracker.setManualSpentTargets(targets);
    vscode.window.showInformationMessage("OpenCode Go usage targets updated.");
  }
});
```

5 sequential `showInputBox` calls, each pre-filled with current value:

| Step | Title                      | Pre-fill                 | Validation   |
| ---- | -------------------------- | ------------------------ | ------------ |
| 1    | Session Spent (5h rolling) | `summary.session.spent`  | `0 ≤ n ≤ 12` |
| 2    | Weekly Spent (Mon–Mon UTC) | `summary.weekly.spent`   | `0 ≤ n ≤ 30` |
| 3    | Monthly Spent              | `summary.monthly.spent`  | `0 ≤ n ≤ 60` |
| 4    | Monthly Reset Day          | `resetsAt.getUTCDate()`  | `1–31`       |
| 5    | Monthly Reset Hour         | `resetsAt.getUTCHours()` | `0–23`       |

Enter keeps current value; Escape cancels entire flow. Returns `UsageBaselineTargets` (now exported) with optional `monthlyAnchorDay` and `monthlyAnchorHour`.

### Monthly Reset Display Fix

Both `buildSummaryFromRows` and `buildSummaryFromTracked` now use the same pattern:

```ts
const monthlyResetsAt = this.baseline.monthly ? new Date(this.baseline.monthly.expiresAt) : new Date(monthEndMs);
```

This ensures the "resets in Xd Yh" text reflects the user-configured anchor regardless of which data source is active.

### Monthly Anchor Rollover

`setManualSpentTargets()` now accepts and applies the anchor:

```ts
if (targets.monthlyAnchorDay && targets.monthlyAnchorDay >= 1 && targets.monthlyAnchorDay <= 31) {
  const hour = targets.monthlyAnchorHour ?? 0;
  const now = new Date(nowMs);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let candidate = Date.UTC(year, month, targets.monthlyAnchorDay, hour, 0, 0, 0);
  if (candidate <= nowMs) {
    month++;
    if (month > 11) {
      year++;
      month = 0;
    }
    candidate = Date.UTC(year, month, targets.monthlyAnchorDay, hour, 0, 0, 0);
  }
  this.baseline.monthly.expiresAt = candidate;
}
```

### Live Pricing via `CostResolver`

New exported type in `goUsageTracker.ts`:

```ts
export type CostResolver = (modelId: string) => ModelCost | undefined;
```

Injected via constructor from `extension.ts`:

```ts
goUsageTracker = new GoUsageTracker(
  context,
  (msg) => {
    goUsageLogChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
  },
  (modelId) => {
    return modelMetadataSnapshot?.providers[GO_VENDOR]?.[modelId]?.cost;
  },
);
```

`estimateCost()` priority chain:

```ts
const pricing = externalCost ?? liveCostResolver?.(modelId) ?? GO_MODEL_PRICING[modelId];
```

| Priority | Source                                                | When it wins                                               |
| -------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| 1        | `externalCost` (`metadata.cost` passed to `record()`) | Model present in snapshot — the common case                |
| 2        | `liveCostResolver`                                    | Snapshot miss but resolver still has entry                 |
| 3        | `GO_MODEL_PRICING`                                    | Both miss — bundled fallback so extension stays functional |

> **Invariant preserved:** `GO_MODEL_PRICING` is never removed. It is the last-resort fallback required by the repo's "extension must keep working when live fetch fails" rule.

### Webview & Status Bar Hardening

- `showUsageWebview()`: `enableScripts: false` — panel is display-only (SVG), no message handlers.
- Status bar: no `command` — hover tooltip only.
- Tooltip (`buildUsageTooltip`) adds command link: `[$(pencil) Set spent targets](command:opencodego.setUsageTargets)` with `md.isTrusted = true`.

---

## Review Notes

PR was reviewed locally on 2026-06-17 against the diff. Three minor non-blocking issues identified:

1. **`setCostResolver()` dead code.** Constructor closure already captures the live variable; setter is never called. Either wire up post-refresh or remove.
2. **Validation limits hardcoded.** `$12/$30/$60` in `showUsageTargetEditor` duplicate `GO_LIMITS`. Should import directly to prevent drift.
3. **`md.isTrusted = true` without `supportedCommands`.** Command link may render as plain text in some VS Code versions. Adding `md.supportedCommands` makes intent explicit.

None are merge blockers. All noted for future follow-up.

---

## Verification

| Check                                                     | Result                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| CI (`CI/build`, GitGuardian)                              | ✅ Passing                                                   |
| Mergeable status                                          | `MERGEABLE` / `CLEAN`                                        |
| Both summary builders honour `baseline.monthly.expiresAt` | ✅ Verified (two `monthlyResetsAt` blocks in diff)           |
| `GO_MODEL_PRICING` retained as fallback                   | ✅ Verified — comment updated to "bundled snapshot fallback" |
| Monthly anchor rollover correct                           | ✅ Handles "next month if already passed" edge case          |
| Compile after merge                                       | ✅ Pass                                                      |
| Install locally                                           | ✅ v0.3.3 installed via VSIX                                 |
| Feature doc                                               | ✅ `docs/features/08-20260617-manual-usage-targets.md`       |
| CHANGELOG                                                 | ✅ `## [0.3.3] — 2026-06-17`                                 |

---

## Lessons Learned

1. **Diff context matters.** During review, initially misread the diff thinking only `buildSummaryFromTracked` was fixed — both builders are actually patched. Always grep for the full variable/function name across the diff, not just the first hunk.
2. **Cost priority chain needs pre-PR analysis.** Before claiming "new code could over-estimate," check where `externalCost` originates (`metadata.cost` from `resolveModelMetadata()`). In this case, `metadata.cost` already uses models.dev pricing, so the new `CostResolver` is defense-in-depth — not the primary pricing path.
3. **Minor issues are follow-up, not blockers.** Dead code (`setCostResolver`), hardcoded limits, and `supportedCommands` are all valid improvements, but none affect correctness. Noting them in the review comment is sufficient; creating separate follow-up issues can be done later.

---

## Related Docs

- Feature doc: [`docs/features/08-20260617-manual-usage-targets.md`](../features/08-20260617-manual-usage-targets.md)
- Original tracker: [`docs/features/03-20260605-go-usage-tracker.md`](../features/03-20260605-go-usage-tracker.md)
- Issue: [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23)
- PR: [#50](https://github.com/ltmoerdani/opencode-copilot-chat/pull/50) by [@Wallacy](https://github.com/Wallacy)
