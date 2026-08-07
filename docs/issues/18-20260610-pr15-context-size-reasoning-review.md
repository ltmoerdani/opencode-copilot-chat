**Status:** ✅ Solved

# PR #15 Review — Context-Size Tiers, Models.dev Reasoning Options, and Richer Thinking Efforts

**Topic:** models / thinking / provider / metadata  
**Updated:** 2026-06-13  
**Tags:** #models #thinking #reasoning #modelsdev #community-pr #context-size #pricing  
**Supersedes:** —

---

## Overview

Full review of community contributor PR #15 by [Wallacy](https://github.com/Wallacy), which adds three tightly related features: **Context Size selector** for tiered-pricing models, **dynamic reasoning options** from models.dev, and **richer thinking effort levels** for DeepSeek/Mimo/MiniMax families. Includes code analysis, risk assessment, and review feedback posted to GitHub.

**PR:** [ltmoerdani/opencode-copilot-chat#15](https://github.com/ltmoerdani/opencode-copilot-chat/pull/15)  
**Branch:** `feature/mimo-think` → `main`  
**Author:** Wallacy Freitas  
**Files changed:** 5 (+487 / −57)

---

## Problem

The VS Code model picker had three limitations:

1. **No context-size awareness** — Models with tiered pricing (e.g., `256K` default vs `1M` premium) exposed no way for users to select their desired context tier, meaning the extension always assumed the full context window regardless of what the user was willing to pay for.
2. **Hardcoded reasoning options** — Thinking/reasoning effort levels were hardcoded per family with no way to adapt when models.dev added or changed the options a model supports.
3. **Limited thinking family coverage** — Only DeepSeek (`off`/`high`/`max`), GLM, Kimi, and Qwen had thinking controls. Mimo (Xiaomi) and MiniMax models were unsupported despite being reasoning-capable.
4. **Kimi payload bug** — Kimi models were sending `thinking: { type: "enabled" | "disabled" }` (Anthropic-style object) to the OpenAI-compatible chat-completions endpoint, which silently ignored it. The correct format is `enable_thinking: true | false` (MoonshotAI-native boolean).
5. **MiniMax incorrect format** — MiniMax thinking payloads were not differentiated between `minimax-m3` (chat-completions → `adaptive`) and `minimax-m2.*` (messages/Anthropic → `enabled`).

---

## Solution

### 1. Context Size Selector (Tiered Pricing)

Models with `cost.tiers[]` or `cost.context_over_200k` in their models.dev metadata now expose a **Context Size** dropdown in the VS Code model picker. The selected value caps the effective `maxInputTokens` for each request, matching the pricing tier.

**Flow:**

```
models.dev cost.tiers[] / cost.context_over_200k
  → getContextSizeOptions(cost, fullContextWindow)
    → ContextSizeOption[] (value, label, description, isDefault)
      → modelConfigurationSchema() → contextSize property
        → modelLimits() → contextSizeOverride caps contextWindow
```

### 2. Dynamic Reasoning Options from models.dev

When a model's models.dev entry declares explicit `reasoning_options` (e.g., `[{type:"effort",values:["low","medium","high","max"]}]`), the picker renders those exact effort levels, overriding family-based hardcoded defaults.

**3-Priority Resolution:**

```
Priority 1: models.dev reasoning_options → exact effort levels
Priority 2: Family-based hardcoded values (per ThinkingFamily)
Priority 3: Dynamic fallback — any model with reasoning:true → generic off/on
```

### 3. Richer Thinking Efforts

| Family                        | Options                                   | Payload Format                                                          |
| ----------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| **DeepSeek**                  | `off` / `low` / `medium` / `high` / `max` | `reasoning_effort`                                                      |
| **Mimo (Xiaomi)**             | `off` / `low` / `medium` / `high`         | `reasoning_effort`                                                      |
| **GLM**                       | `off` / `on`                              | `thinking: { type: "enabled" \| "disabled" }`                           |
| **Kimi**                      | `off` / `on`                              | `enable_thinking: true \| false` (**fixed**)                            |
| **MiniMax**                   | `off` / `on`                              | `thinking: { type: "disabled" \| "adaptive" \| "enabled" }` (**fixed**) |
| **Qwen** (chat-completions)   | `off` / `auto` / `on` + budget            | `enable_thinking` + `thinking_budget`                                   |
| **Qwen** (messages/Anthropic) | `off` / `auto` / `on` + budget            | `thinking: { type }` + `budget_tokens`                                  |

### 4. Bug Fixes

- **Kimi** — Changed from `thinking: { type: "enabled" | "disabled" }` to `enable_thinking: true | false` (MoonshotAI-native boolean on OpenAI-compatible endpoint).
- **MiniMax** — Corrected format: `minimax-m3` sends `thinking: { type: "adaptive" }` when on; `minimax-m2.*` sends `thinking: { type: "enabled" }` when on; off omits the field entirely.

---

## Changes

| #   | Change                                                                      | Files              | Impact                                                                       |
| --- | --------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| P0  | `ModelCostTier` interface + `cost.tiers` / `cost.context_over_200k` parsing | `src/metadata.ts`  | New interfaces and fields for tiered pricing data                            |
| P1  | `ModelMetadataFields.reasoningOptions` field                                | `src/metadata.ts`  | Raw reasoning_options from models.dev propagated through metadata pipeline   |
| P2  | `getContextSizeOptions()` function                                          | `src/metadata.ts`  | Generates picker options from tier thresholds with human-readable labels     |
| P3  | `ContextSizeOption` interface                                               | `src/metadata.ts`  | Structured type for context-size dropdown options                            |
| P4  | `modelConfigurationSchema()` unified with context-size + reasoning          | `src/extension.ts` | Unified schema builder combining thinking-effort and context-size properties |
| P5  | `buildFamilyThinkingSchema()` — 3-priority resolution                       | `src/extension.ts` | models.dev → family hardcoded → dynamic fallback                             |
| P6  | `buildThinkingPayload()` — corrected MiniMax + Kimi                         | `src/extension.ts` | Fixed payload formats for MiniMax and Kimi families                          |
| P7  | `modelLimits()` — `contextSizeOverride` parameter                           | `src/extension.ts` | Caps effective context window when user selects a tier                       |
| P8  | `ThinkingSettings` expanded with `mimo` + `minimax`                         | `src/extension.ts` | New family fields in settings interface                                      |
| P9  | `thinkingFamily()` — added `minimax` + `mimo` detection                     | `src/extension.ts` | Regex patterns for new families                                              |
| P10 | `applyRequestThinkingOverride()` — mimo + minimax branches                  | `src/extension.ts` | Per-request override handling for new families                               |
| P11 | `getSettings()` — read `thinking.mimo` + `thinking.minimax`                 | `src/extension.ts` | Config reads for new settings                                                |
| P12 | `supportsReasoning()` — added minimax + mimo patterns                       | `src/metadata.ts`  | Extended regex for new reasoning families                                    |
| P13 | New models in `MODEL_LIMITS_BY_PROVIDER`                                    | `src/metadata.ts`  | `minimax-m3`, `minimax-m2.1`, `minimax-m2` added                             |
| P14 | Cache key bump `v4` → `v5`                                                  | `src/metadata.ts`  | Forces re-fetch of models.dev snapshot with new fields                       |
| P15 | `opencodego.thinking.mimo` setting                                          | `package.json`     | New setting: `off` / `low` / `medium` / `high`                               |
| P16 | `opencodego.thinking.minimax` setting                                       | `package.json`     | New setting: `off` / `on`                                                    |
| P17 | `opencodego.thinking.deepseek` expanded                                     | `package.json`     | Added `low` / `medium` to existing `off` / `high` / `max`                    |
| P18 | `showThinkingEffortPicker()` — Mimo + MiniMax entries                       | `src/extension.ts` | Command palette picker includes new families                                 |
| P19 | CHANGELOG entry                                                             | `CHANGELOG.md`     | Comprehensive Unreleased section                                             |
| P20 | README update                                                               | `README.md`        | Documentation for new features                                               |

**Lines changed:** +487 / −57 across 5 files.

---

## Review Findings

### ✅ Strengths

| #   | Finding                     | Detail                                                                                                                          |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **3-priority resolution**   | Elegant fallback chain (models.dev → family → dynamic) that handles future reasoning-capable models automatically               |
| 2   | **Kimi fix**                | Correctly switches to `enable_thinking: true` (boolean) from `thinking: { type: "enabled" }` (object that was silently ignored) |
| 3   | **MiniMax differentiation** | Correctly maps `minimax-m3` → `adaptive` vs `minimax-m2.*` → `enabled`, matching upstream OpenCode `transform.ts`               |
| 4   | **Cache key bump**          | `v4` → `v5` ensures clean state after adding `reasoningOptions` and `tiers` fields                                              |
| 5   | **Comprehensive docs**      | CHANGELOG and README well-documented with table format for all families                                                         |
| 6   | **No breaking changes**     | All defaults are `off` — backward-compatible for existing users                                                                 |

### 🐛 Nits (Non-blocking)

| #   | Issue                                  | Severity | Detail                                                                                           |
| --- | -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| 1   | **Unused variable `hasBaseSurcharge`** | Low      | Declared in `getContextSizeOptions()` but never read. Should remove or use in description.       |
| 2   | **Missing newline at EOF**             | Low      | `src/metadata.ts` ends without trailing newline (`\ No newline at end of file`).                 |
| 3   | **Undocumented models**                | Low      | `minimax-m3`, `minimax-m2.1`, `minimax-m2` added to limits table but not mentioned in CHANGELOG. |

### 💡 Suggestions (Future PRs)

- Extract family-specific schemas into a `Map<ThinkingFamily, SchemaFactory>` lookup table — the `if/family === "..."` chain will grow as more families are added.
- Similarly refactor `buildThinkingPayload()` which is getting long with the new families.

### **Verdict: LGTM — approve with minor nits.** Merge when ready.

---

## Review Feedback Posted

Review comment posted to GitHub PR #15 summarizing findings: strengths, nits, and suggestions. Non-blocking — all nits are cosmetic.

---

## Technical Context

### New Interfaces (`src/metadata.ts`)

```typescript
export interface ModelCostTier {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  tier: { type: string; size: number };
}

export interface ContextSizeOption {
  value: number;
  label: string;
  description: string;
  isDefault: boolean;
}
```

### Cache Key Change

`MODEL_METADATA_CACHE_KEY` changed from `"opencodego.modelMetadataCache.v4"` → `"opencode.modelMetadataCache.v5"` — note also the prefix change from `opencodego` to `opencode`.

### Settings Added

| Setting                        | Type     | Options                               | Default |
| ------------------------------ | -------- | ------------------------------------- | ------- |
| `opencodego.thinking.mimo`     | `string` | `off`, `low`, `medium`, `high`        | `off`   |
| `opencodego.thinking.minimax`  | `string` | `off`, `on`                           | `off`   |
| `opencodego.thinking.deepseek` | `string` | `off`, `low`, `medium`, `high`, `max` | `off`   |

---

## Verification

Review performed by reading the full diff (38KB) via `gh pr diff 15`. No local build or install was performed — PR is still OPEN awaiting merge.

**CI Status:** ✅ GitGuardian Security Checks — No secrets detected.  
**Mergeable:** ✅ Yes  
**Reviews:** None yet (review feedback to be posted by maintainer)

---

## Post-Merge Update (2026-06-13)

PR #15 was **merged on 2026-06-10** (`mergedAt: 2026-06-10T03:08:19Z`). All features verified in the codebase:

| Feature                   | Verified Location                                                            | Status         |
| ------------------------- | ---------------------------------------------------------------------------- | -------------- |
| Context Size selector     | `src/metadata.ts` — `getContextSizeOptions()`, `ContextSizeOption` interface | ✅ Implemented |
| Context size override     | `src/extension.ts` — `contextSizeOverride` in `modelLimits()`                | ✅ Implemented |
| Dynamic reasoning options | `src/metadata.ts` — `reasoningOptions` in metadata pipeline                  | ✅ Implemented |
| Mimo thinking             | `src/extension.ts` — `thinking.mimo` → `reasoning_effort`                    | ✅ Implemented |
| MiniMax thinking          | `src/extension.ts` — `thinking.minimax` → `adaptive` / `enabled`             | ✅ Implemented |
| Kimi thinking format      | `src/extension.ts` — `thinking: { type }` (later corrected by PR #18)        | ✅ Implemented |

**Follow-up:** PR #18 (merged 2026-06-11) corrected the Kimi format from `enable_thinking` back to `thinking: { type }` after gateway testing showed `enable_thinking` caused HTTP 400. See `docs/issues/19-20260611-pr18-kimi-thinking-format-review.md`.

**Status changed:** 🟢 Active → ✅ Solved

---

## Related

- Closes #14
- Preceded by: PR #7 (pricing API), PR #13 (MiniMax think tags)
- Extension architecture: `docs/architecture/01-20260514-open-code-provider-architecture.md`
