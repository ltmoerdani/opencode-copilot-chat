**Status:** ✅ Solved

# PR #68 — GLM Thinking Values, Output Popup Removal, Enabled Models Filter

**Topic:** thinking / models / provider / bugfix
**Updated:** 2026-07-02
**Tags:** #thinking #glm #models #provider #bugfix #output #byok #community
**Supersedes:** —

---

## Overview

PR #68 fixes three reported bugs in a single changeset:

1. **#61 — GLM thinking accepts invalid values.** The `opencodego.thinking.glm` setting only offered `on`/`off`, but GLM 5.2 (per models.dev) requires `reasoning_effort` with values `high`/`max`, not a `thinking.type` toggle. Selecting `"on"` sent `thinking: { type: "enabled" }` to the gateway, which GLM 5.2 silently ignores or rejects.

2. **#67 — Annoying output channel popup.** Three `this.getOutputChannel().show(true)` calls in `testConnection()` and `provideLanguageModelChatResponse()` error path forced the Output panel open during normal requests and connection tests.

3. **#62 — Model list fetches without Authorization header.** `fetchModels()` called `fetch(this.definition.modelsUrl)` without sending the API key in an `Authorization` header. The gateway returned a model list filtered to unauthenticated (or incorrectly filtered) models, so disabled/unavailable models appeared in the picker.

**Documented:** 2026-07-02
**Fixed in:** v0.3.5 (PR [#68](https://github.com/ltmoerdani/opencode-copilot-chat/pull/68), merged 2026-07-02)
**Issues:** [#61](https://github.com/ltmoerdani/opencode-copilot-chat/issues/61), [#62](https://github.com/ltmoerdani/opencode-copilot-chat/issues/62), [#67](https://github.com/ltmoerdani/opencode-copilot-chat/issues/67)
**Contributor:** [@Wallacy](https://github.com/Wallacy)

---

## Problem

### #61 — GLM thinking invalid values

Before this fix, the `opencodego.thinking.glm` enum was `["on", "off"]`, and `buildThinkingPayload` mapped both to `thinking: { type: "enabled" | "disabled" }`. This worked for GLM 5/5.1 (toggle-based reasoning), but GLM 5.2 uses `reasoning_effort` (effort-based reasoning), and only accepts `high`/`max` — sending `thinking: { type: "enabled" }` to GLM 5.2 is silently ignored or causes an error.

The per-model picker (`buildFamilyThinkingSchema`) also exposed `on`/`off` for all GLM models, which is wrong for 5.2.

### #67 — Output channel popup

Three calls to `this.getOutputChannel().show(true)` in `testConnection()` (success + error paths) and `provideLanguageModelChatResponse()` error catch forced the Output panel to pop up on every connection test and every failed request. This was intrusive during normal usage and blocked the user's view of the chat.

### #62 — Model list missing Authorization header

`fetchModels()` made a raw `fetch(this.definition.modelsUrl)` without any headers. The gateway's model list endpoint returns different results depending on the `Authorization` header — without it, the list may include models the user is not authorized for or exclude models they should see. This caused disabled/unavailable models to appear in the picker.

---

## Root Cause

### #61 — GLM thinking

The GLM family has **two generations** with different reasoning interfaces:

| Model      | Reasoning Interface                           | Accepted Values |
| ---------- | --------------------------------------------- | --------------- |
| GLM 5, 5.1 | `thinking: { type: "enabled" \| "disabled" }` | Toggle          |
| GLM 5.2    | `reasoning_effort: "high" \| "max"`           | Effort-based    |

Before this fix, a single code path treated all GLM models identically. The setting enum `["on", "off"]` and `buildThinkingPayload` logic had no awareness of the model-generation split.

**Evidence from models.dev (GLM 5.2):**

```json
{
  "reasoning": true,
  "reasoning_options": [{ "type": "effort", "values": ["high", "max"] }]
}
```

### #67 — Output popup

`show(true)` was added as a diagnostic convenience during early development. It was never gated behind a debug flag and fired unconditionally.

### #62 — Missing Authorization

`fetchModels()` was written before the BYOK flow was finalized. The API key was only read inside `provideLanguageModelChatInformation()` and stored in `apiKeysByModelId`, but never passed down to `fetchModels()`. The gateway requires `Authorization: Bearer <key>` for personalized model lists.

---

## Solution

### #61 — GLM thinking with effort values

| Change                      | Detail                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` enum         | `["on", "off"]` → `["off", "high", "max"]`                                                                                                         |
| `buildThinkingPayload`      | GLM now sends `reasoning_effort: "high"\|"max"` instead of `thinking: { type: "enabled" }`. Only `"off"` maps to `thinking: { type: "disabled" }`. |
| `buildFamilyThinkingSchema` | Split GLM and Kimi into separate blocks (were combined). GLM schema now exposes `off`/`high`/`max` with correct `enumItemLabels`.                  |
| `showThinkingEffortPicker`  | GLM label updated to include `glm-5.2`; options changed to `["off", "high", "max"]`.                                                               |
| `validate-models.mts`       | GLM tests now use `high`/`max` instead of `on`.                                                                                                    |

**Behavioral mapping:**

```
GLM 5.2 + glm="high"  → { reasoning_effort: "high" }
GLM 5.2 + glm="max"   → { reasoning_effort: "max" }
GLM 5.2 + glm="off"   → { thinking: { type: "disabled" } }
GLM 5.1 + glm="high"  → { reasoning_effort: "high" }  (gateway resolves to toggle)
GLM 5.1 + glm="off"   → { thinking: { type: "disabled" } }
```

### #67 — Output popup removed

All three `this.getOutputChannel().show(true)` calls deleted from `src/extension.ts`. Errors still log to the Output channel and show via `showErrorMessage` / `showInformationMessage`. The panel no longer forces itself open.

### #62 — Authorization header on model list fetch

`fetchModels()` signature changed from `fetchModels()` to `fetchModels(apiKey?: string)`. When an API key is provided, it sends `Authorization: Bearer <key>` in the fetch headers. The call site in `provideLanguageModelChatInformation()` now passes the resolved API key explicitly.

```typescript
// Before:
const models = await this.fetchModels();

// After:
const models = await this.fetchModels(apiKey);
```

---

## Files Changed

| #   | Change                                     | Files                                                      | Impact                                                                                                           |
| --- | ------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P0  | GLM enum `on/off` → `off/high/max`         | `package.json`                                             | Setting now accepts valid GLM 5.2 effort values                                                                  |
| P0  | `buildThinkingPayload` GLM effort path     | `src/thinking.ts`                                          | GLM 5.2 gets `reasoning_effort`, older GLM gets same (gateway resolves)                                          |
| P0  | `buildFamilyThinkingSchema` GLM/Kimi split | `src/thinking.ts`                                          | Per-model picker shows correct options per model generation                                                      |
| P0  | `fetchModels` Authorization header         | `src/extension.ts`                                         | Model list now returns correct authorized models                                                                 |
| P0  | Remove 3x `show(true)`                     | `src/extension.ts`                                         | Output panel no longer forces open on errors/tests                                                               |
| P1  | Thinking effort picker GLM label           | `src/extension.ts`                                         | Options updated to `["off", "high", "max"]`                                                                      |
| P1  | `validate-models.mts` GLM tests            | `scripts/validate-models.mts`                              | GLM validation uses `high`/`max` instead of `on`                                                                 |
| T1  | 105 lines of GLM thinking tests            | `src/test/thinking.test.ts`                                | Covers `buildThinkingPayload`, `buildFamilyThinkingSchema`, `applyRequestThinkingOverride` for GLM effort values |
| D1  | Issue doc                                  | `docs/issues/31-20260702-pr68-...`                         | This document                                                                                                    |
| D2  | Thinking controls feature doc update       | `docs/features/02-20260517-per-model-thinking-controls.md` | GLM row updated to reflect effort-based values                                                                   |
| D3  | Devlog entry                               | `docs/devlog.md`                                           | This entry                                                                                                       |

---

## Verification

| Check                                   | Result                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run compile`                       | ✅ 0 errors                                                                       |
| `npm test` (thinking.test.ts)           | ✅ All GLM effort tests pass (payload, schema, override)                          |
| `validate-models.mts --dry-run` GLM 5.2 | ✅ `high` → `{ reasoning_effort: "high" }`, `max` → `{ reasoning_effort: "max" }` |
| `validate-models.mts --dry-run` GLM 5.1 | ✅ `high` → `{ reasoning_effort: "high" }` (gateway resolves to toggle)           |
| Output panel popup                      | ✅ No longer forces open on connection test or request error                      |
| Model list with auth header             | ✅ Returns correct authorized model set                                           |

---

## Lessons Learned

1. **Model families evolve across generations.** GLM 5/5.1 use toggle reasoning; GLM 5.2 uses effort-based reasoning. The extension must be aware of per-model-generation differences, not just per-family. models.dev `reasoning_options` metadata is the authoritative source for which interface a specific model supports.

2. **Diagnostic conveniences should be gated behind debug flags.** `show(true)` was useful during development but became intrusive in production. Any code that forces UI panels open should be behind a setting or debug flag, not unconditional.

3. **API key must be threaded to all gateway calls.** `fetchModels()` was the only call site that did not receive the API key. The gateway's model list endpoint is personalized per key — missing the header yields an incorrect or incomplete list.

4. **`reasoning_effort` is the modern GLM interface.** Going forward, new GLM models will likely use `reasoning_effort` (effort-based) rather than `thinking.type` (toggle). The code path should prefer `reasoning_effort` for GLM models with `reasoning_options` metadata, and fall back to toggle for older models without it.
