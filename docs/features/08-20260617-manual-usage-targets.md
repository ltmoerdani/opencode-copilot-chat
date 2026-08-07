**Status:** ✅ Solved

# Manual Usage Targets & Live Pricing for Go Usage Tracker

**Topic:** usage / features / status-bar / pricing / byok
**Updated:** 2026-06-17
**Tags:** #usage #features #status-bar #go-usage #pricing #byok
**Supersedes:** —
**Related:** [`03-20260605-go-usage-tracker.md`](./03-20260605-go-usage-tracker.md)

---

## Overview

Adds manual Go usage target configuration and switches cost estimation to use the live `models.dev` pricing snapshot (with the bundled static table kept only as a last-resort fallback). Closes [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23). Landed via PR [#50](https://github.com/ltmoerdani/opencode-copilot-chat/pull/50) by [@Wallacy](https://github.com/Wallacy).

This builds directly on the Go Usage Tracker introduced in [`03-20260605-go-usage-tracker.md`](./03-20260605-go-usage-tracker.md). Readers should be familiar with `GoUsageTracker`, `UsageBaseline`, and the two summary builders (`buildSummaryFromRows` for the `opencode.db` SQLite path, `buildSummaryFromTracked` for the extension-tracked entries path).

---

## Background

### Problem

The original tracker auto-calculated everything from request logs:

1. **No manual override.** Users who topped up mid-cycle, or whose real OpenCode Go dashboard showed a different spent amount than the client-side estimate, had no way to reconcile the tracker with reality. The displayed percentages drifted from the actual subscription state.
2. **Stale pricing.** `GO_MODEL_PRICING` (in `src/goUsageTracker.ts`) is a hand-maintained snapshot sourced from `https://opencode.ai/docs/go`. When providers change prices or new models ship, the table goes stale until a manual code update + release. The tracker then silently under/over-estimates cost.
3. **Monthly reset ignored manual anchors.** Even when a monthly baseline existed, both summary builders returned the auto-calculated `monthEndMs` as `resetsAt` — so the "resets in Xd Yh" tooltip text contradicted the user-set monthly anchor.

### Goal

- Let users set their own spent targets for the three periods (session / weekly / monthly) plus a custom monthly reset anchor (day + hour, UTC).
- Reflect that anchor in the displayed `resetsAt` everywhere it is shown.
- Prefer live pricing from the `models.dev` cache, while never breaking the extension when the live fetch fails.

---

## Implementation

### Files Touched

| File                    | Change                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`          | New command contribution: `opencodego.setUsageTargets` → "OpenCode Go: Set Usage Targets…"                                                                                                                                                                                                               |
| `src/extension.ts`      | Register the command; construct `GoUsageTracker` with a `CostResolver` closure; `showUsageTargetEditor()` 5-step input flow; tooltip gains a command link; webview `enableScripts: false`; status bar click disabled                                                                                     |
| `src/goUsageTracker.ts` | `CostResolver` type + constructor parameter; `setCostResolver()` setter; `estimateCost()` priority chain; `UsageBaselineTargets` exported with `monthlyAnchorDay` / `monthlyAnchorHour`; both summary builders honour `baseline.monthly.expiresAt`; `setManualSpentTargets()` honours the monthly anchor |

### New Command: `opencodego.setUsageTargets`

Registered in `src/extension.ts`:

```ts
vscode.commands.registerCommand("opencodego.setUsageTargets", async () => {
  if (!goUsageTracker) return;
  const targets = await showUsageTargetEditor(goUsageTracker);
  if (targets) {
    goUsageTracker.setManualSpentTargets(targets);
    vscode.window.showInformationMessage("OpenCode Go usage targets updated.");
  }
}),
```

### `showUsageTargetEditor()` — 5-Step Input Flow

Sequential `vscode.window.showInputBox` calls, each pre-filled with the current tracked value so Enter keeps the existing number and Escape cancels the entire flow.

| Step | Title                         | Pre-fill source                          | Validation      |
| ---- | ----------------------------- | ---------------------------------------- | --------------- |
| 1    | Session Spent (5h rolling)    | `summary.session.spent`                  | `0 ≤ n ≤ 12`    |
| 2    | Weekly Spent (Mon–Mon UTC)    | `summary.weekly.spent`                   | `0 ≤ n ≤ 30`    |
| 3    | Monthly Spent                 | `summary.monthly.spent`                  | `0 ≤ n ≤ 60`    |
| 4    | Monthly Reset Day (1–31)      | `summary.monthly.resetsAt.getUTCDate()`  | integer `1..31` |
| 5    | Monthly Reset Hour (0–23 UTC) | `summary.monthly.resetsAt.getUTCHours()` | integer `0..23` |

Returns a `UsageBaselineTargets` object, or `undefined` if any step is cancelled.

### Persistence: `setManualSpentTargets()`

```ts
this.baseline.session = { amount: max(0, targets.session - trackedSession), expiresAt: summary.session.resetsAt.getTime() };
this.baseline.weekly = { amount: max(0, targets.weekly - trackedWeekly), expiresAt: summary.weekly.resetsAt.getTime() };
this.baseline.monthly = { amount: max(0, targets.monthly - trackedMonthly), expiresAt: summary.monthly.resetsAt.getTime() };
```

Then, if `monthlyAnchorDay` is supplied (1–31), the monthly `expiresAt` is overridden:

```ts
let candidate = Date.UTC(year, month, day, hour, 0, 0, 0);
if (candidate <= nowMs) {
  // Anchor already passed this month → next reset is next month.
  month++;
  if (month > 11) {
    year++;
    month = 0;
  }
  candidate = Date.UTC(year, month, day, hour, 0, 0, 0);
}
this.baseline.monthly.expiresAt = candidate;
```

This correctly rolls the anchor into the next month when the configured day/hour has already passed in the current month.

### Monthly Reset Display Fix

Both summary builders (`buildSummaryFromRows` and `buildSummaryFromTracked`) now resolve `resetsAt` symmetrically:

```ts
const monthlyResetsAt = this.baseline.monthly ? new Date(this.baseline.monthly.expiresAt) : new Date(monthEndMs);
```

This guarantees the "resets in Xd Yh" tooltip text reflects the user-configured anchor regardless of which data source (SQLite history vs. extension-tracked entries) is active.

### Live Pricing: `CostResolver`

New exported type in `src/goUsageTracker.ts`:

```ts
export type CostResolver = (modelId: string) => ModelCost | undefined;
```

Injected via the `GoUsageTracker` constructor from `src/extension.ts`:

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

| Priority | Source                                                | When it wins                                                                                      |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1        | `externalCost` (`metadata.cost` passed to `record()`) | Model is present in the models.dev snapshot — the common case                                     |
| 2        | `liveCostResolver?.(modelId)`                         | Snapshot miss but resolver still has the entry (defense-in-depth)                                 |
| 3        | `GO_MODEL_PRICING[modelId]`                           | Both above miss — bundled static fallback so the extension stays functional when live fetch fails |

> **Invariant preserved:** `GO_MODEL_PRICING` is never removed. It is the last-resort fallback required by the repo's "extension must keep working when live fetch fails" rule.

### Webview & Status Bar Hardening

- `showUsageWebview()` now opens the panel with `enableScripts: false`. The panel is display-only (SVG render); message handlers and button scripts removed.
- Status bar item no longer has a `command` — click does nothing. Usage details are visible via hover tooltip only.
- Tooltip (`buildUsageTooltip`) sets `md.isTrusted = true` and appends a command link:

  ```ts
  md.appendMarkdown("\n\n[$(pencil) Set spent targets](command:opencodego.setUsageTargets)");
  ```

---

## Verification

| Check                                                     | Result                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| CI (`CI/build`, GitGuardian)                              | ✅ Passing                                                   |
| Mergeable status                                          | `MERGEABLE` / `CLEAN`                                        |
| Both summary builders honour `baseline.monthly.expiresAt` | ✅ Verified via diff (two `monthlyResetsAt` blocks)          |
| `GO_MODEL_PRICING` retained as fallback                   | ✅ Verified — comment updated to "bundled snapshot fallback" |
| Cost priority chain matches PR description                | ✅ `externalCost → liveCostResolver → GO_MODEL_PRICING`      |

---

## Known Follow-ups (Non-blocking)

These were noted during review and are **not** merge blockers. Tracked for future polish:

1. **`setCostResolver()` is currently dead code.** The constructor closure already captures the live `modelMetadataSnapshot` variable, so the setter is never called from `extension.ts`. Either wire it up after metadata refresh, or remove it to keep the API surface honest.
2. **Validation limits are hardcoded in `showUsageTargetEditor`.** `$12`, `$30`, `$60` duplicate `GO_LIMITS` in `goUsageTracker.ts`. If the limits change, validation silently goes stale. Importing `GO_LIMITS` directly prevents drift.
3. **`md.isTrusted = true` without `supportedCommands`.** The tooltip command link may render as plain text in some VS Code versions. Adding `md.supportedCommands = ["opencodego.setUsageTargets"]` makes the intent explicit. Worth a quick hover test to confirm the link is clickable.

---

## References

- Original tracker: [`03-20260605-go-usage-tracker.md`](./03-20260605-go-usage-tracker.md)
- Issue: [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23)
- PR: [#50](https://github.com/ltmoerdani/opencode-copilot-chat/pull/50) by [@Wallacy](https://github.com/Wallacy)
