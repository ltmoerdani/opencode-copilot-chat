**Status:** ✅ Solved

# Usage Monitor SVG Card Width Fix — Issue #85

**Topic:** usage / status-bar / svg / ui / layout
**Updated:** 2026-08-03
**Tags:** #usage #svg #ui #layout #issue-85
**Issue:** [#85](https://github.com/ltmoerdani/opencode-copilot-chat/issues/85)

---

## Problem

The usage monitor SVG card (shown in both the status bar tooltip and the webview panel) was too narrow at 330px (or 345px with session data). This caused the bottom statistics section — which packs 6 values (label + cost + "Requests:" + count + "Tokens:" + count) into a single line — to be hard to read, with values appearing cramped and overlapping for longer numbers.

### Root Cause

Hardcoded SVG dimensions and column positions in `buildUsageTooltipSvg()` were too tight:

| Element                    | Old X Position     | Issue                          |
| -------------------------- | ------------------ | ------------------------------ |
| Progress bar width         | 256px              | Narrow for wider card          |
| "Resets in X" / Percentage | x=306 (end anchor) | Too close to edge              |
| "Requests:" label          | x=138              | Only 33px after cost column    |
| Request count              | x=202              | Only 64px for "Requests:" text |
| "Tokens:" label            | x=236              | Only 34px gap                  |
| Token count                | x=296              | 49px to edge at 345px width    |

---

## Solution

Widened the SVG card and adjusted all column positions proportionally:

| Element                        | New Value | Change            |
| ------------------------------ | --------- | ----------------- |
| SVG width (no session)         | 420px     | was 330px (+90px) |
| SVG width (with session)       | 440px     | was 345px (+95px) |
| Cost column (cx, no session)   | x=80      | was x=60          |
| Cost column (cx, with session) | x=120     | was x=105         |
| Progress bar width             | 340px     | was 256px (+84px) |
| "Resets in X"                  | x=410     | was x=306         |
| Percentage                     | x=410     | was x=306         |
| Line separator x2              | 416       | was 316           |
| "Requests:" label              | x=200     | was x=138         |
| Request count                  | x=280     | was x=202         |
| "Tokens:" label                | x=320     | was x=236         |
| Token count                    | x=400     | was x=296         |
| Tooltip img width              | 420px     | was 330px         |
| Webview max-width              | 560px     | was 480px         |

### Column Spacing After Fix

| Gap                 | Before | After |
| ------------------- | ------ | ----- |
| Label → Cost        | 91px   | 106px |
| Cost → "Requests:"  | 33px   | 80px  |
| "Requests:" → Count | 64px   | 80px  |
| Count → "Tokens:"   | 34px   | 40px  |
| "Tokens:" → Count   | 60px   | 80px  |
| Count → Edge        | 49px   | 40px  |

The minimum gap increased from 33px to 40px, with most gaps now at 80px — providing comfortable readability for all value lengths.

### Files Changed

- `src/extension.ts` — `buildUsageTooltipSvg()` (column positions, SVG dimensions), `buildUsageTooltip()` (img width), `updateWebviewContent()` (webview max-width)

---

## Verification

- ✅ `npm run compile` passes with zero errors
- ✅ No TypeScript errors in `src/extension.ts`
- ✅ NoData SVG case automatically uses wider dimensions via shared `width` variable
- ✅ Tooltip and webview panel both reflect new dimensions
