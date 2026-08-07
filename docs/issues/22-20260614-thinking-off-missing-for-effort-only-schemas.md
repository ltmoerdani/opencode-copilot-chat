**Status:** ✅ Solved

# Thinking Effort "Off" Missing for models.dev Effort-Only Schemas

**Topic:** thinking / reasoning / models.dev / ui  
**Updated:** 2026-06-14  
**Tags:** #thinking #reasoning #models-dev #ui #bug  
**GitHub Issue:** [#35](https://github.com/ltmoerdani/opencode-copilot-chat/issues/35)  
**GitHub PR:** [#38](https://github.com/ltmoerdani/opencode-copilot-chat/pull/38)  
**Reporter/Fixer:** [@sublimode](https://github.com/sublimode)

---

## Problem

When using **DeepSeek V4 Flash** (and potentially other models), selecting a Thinking Effort level showed only `High` and `Max` — with **no `Off` option**. Users could not disable reasoning once enabled, forcing slower responses even when reasoning was unnecessary.

## Root Cause

The `buildFamilyThinkingSchema()` function in `src/extension.ts` (line ~2494) builds the Thinking Effort picker from `models.dev` `reasoningOptions` metadata. The picker logic had a flaw in how it handled the "off" option:

### models.dev `reasoningOptions` structure

`models.dev` sends `reasoningOptions` as an array of objects with `type`:

```json
// Model with toggle + effort (e.g. Mimo V2.5)
"reasoning_options": [
  { "type": "toggle" },
  { "type": "effort", "values": ["low", "medium", "high"] }
]

// Model with effort ONLY — no toggle (e.g. DeepSeek V4 Flash)
"reasoning_options": [
  { "type": "effort", "values": ["high", "max"] }
]
```

### Bug in original code

```typescript
// "off" was ONLY added when toggle was present
if (hasToggle) {                    // ← gated by hasToggle
  enumOptions.push("off");
  ...
}
```

When a model from `models.dev` only has `{ type: "effort" }` without `{ type: "toggle" }`:

- `hasToggle = false`
- `effortValues = ["high", "max"]`
- The `if (hasToggle)` block was **skipped** → "off" was never added
- Result: picker showed only `High`, `Max` — no way to disable reasoning

This did **not** affect:

- Models using **family-based hardcoded** schemas (Priority 2) — those always include "off"
- Models with **toggle + effort** — those had `hasToggle = true` so "off" was added
- Models without reasoning support — no picker at all

## Solution (PR #38)

Two changes to `buildFamilyThinkingSchema()` in `src/extension.ts`:

| #   | Change                               | Detail                                                                                                                |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Move "off" outside `hasToggle` guard | `enumOptions.push("off")` now runs **unconditionally** when `hasToggle                                                |     | effortValues.length > 0` |
| 2   | Add "on" for toggle-only models      | New condition: `if (hasToggle && effortValues.length === 0)` adds `on` so toggle-only models get an `off`/`on` choice |

### Scenario matrix (before vs after)

| Scenario                                       | Before PR #38                    | After PR #38            |
| ---------------------------------------------- | -------------------------------- | ----------------------- |
| Effort-only (DeepSeek V4 Flash: `high`, `max`) | ❌ `high`, `max` only — no "off" | ✅ `off`, `high`, `max` |
| Toggle-only (toggle but no effort values)      | ❌ `off` only — no "on"          | ✅ `off`, `on`          |
| Toggle + effort                                | ✅ `off`, `low`, `med`, `high`   | ✅ Unchanged            |
| Family hardcoded (DeepSeek family fallback)    | ✅ `off`→`max`                   | ✅ Unchanged            |

## Files Changed

- `src/extension.ts` — `buildFamilyThinkingSchema()` (~line 2521): 9 insertions, 4 deletions

## Verification

```bash
npm run compile    # 0 errors
# Manual test: DeepSeek V4 Flash picker now shows Off, High, Max
```

Tested by maintainer locally — confirmed "Off" appears and correctly disables reasoning (no `reasoning_content` in response when selected).
