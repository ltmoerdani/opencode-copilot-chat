**Status:** ✅ Solved

# Issue #273 — Dynamic Go Allowance Tracking

**Topic:** usage / streaming / provider / billing
**Updated:** 2026-10-31
**Tags:** #usage #streaming #provider #billing #go
**Related:** [issue #273](https://github.com/ltmoerdani/opencode-copilot-chat/issues/273), [OpenCode inference cost fields](https://dev.opencode.ai/v2/docs/console/api/inference#cost)

---

## Problem

The usage panel derived server-reported percentages from the global `$12 / $30 / $60` `GO_LIMITS` constants. That made the dollar display wrong when OpenCode changed model weighting or listed limits, as reported for DeepSeek V4.1 Flash in issue #273.

## Research

OpenCode documents `usage.opencode.allowance` as the amount a Go response counted toward usage limits. It is different from `usage.opencode.list_cost` and already includes upstream model/policy weighting. This is the correct dynamic value for a request; the extension must not reconstruct it from local model prices.

The separate `/zen/go/v1/usage` endpoint exposes account-wide percentage and reset timestamps, but not a raw dollar allowance or denominator. Therefore the extension treats those two fields as authoritative and does not infer a nominal dollar limit from `GO_LIMITS` when a server snapshot is present.

## Implementation

- Added `allowance`, `listCost`, and `billingSource` to the shared transport summary.
- Extracted `usage.opencode` from top-level and nested Responses usage payloads.
- Applied the upstream `allowance` to every Go tracker entry, regardless of model or transport family.
- Preserved the existing local pricing fallback when allowance metadata is absent.
- Kept non-Go providers unchanged; the tracker still exits before recording them.
- Removed hardcoded nominal dollar derivation from server-meter merging. Server percentage/reset values remain authoritative.
- Updated tooltip, Quick Pick, and webview to label server-backed local dollar values as local amounts rather than account-wide limits.

## Regression coverage

- Chat/Responses-style nested usage extraction with valid OpenCode billing metadata.
- Malformed billing metadata does not affect token extraction.
- Go tracker prefers upstream allowance over local model pricing.
- Existing fallback pricing and non-Go behavior remain covered.
- Server percentage/reset merge no longer uses the hardcoded nominal limit.

## Verification

- `npm run lint` — passed all seven checks.
- `npm run test-retry` — passed, 9/9 mock HTTP retry scenarios.
- No live authenticated Go request was made by the test suite; live response validation requires a user-provided API key and should be performed manually after reload.

## Limitation

OpenCode's usage endpoint does not currently return the account's raw dollar denominator. The UI therefore displays the authoritative percentage and reset time, plus the locally observed amount, without claiming that the amount is the full account-wide allowance.
