**Status:** ✅ Solved

# estimateTokenCount Overestimation Causes `max_tokens: 1` on Large Conversations

**Topic:** streaming / models / context-window  
**Updated:** 2026-07-24  
**Tags:** #streaming #models #bug #estimateTokenCount #context-window #max-tokens  
**Fixes:** [#83](https://github.com/ltmoerdani/opencode-copilot-chat/issues/83)

---

## Problem

When a user has a large conversation that approaches the model's context window limit (~754K tokens on a 1M window), the extension sends `max_tokens: 1` to the API. The model generates exactly 1 token, hits `finishReason: length`, and the user sees an empty or 1-word response. The chat becomes unusable until the conversation is cleared.

**Reported:** [#83](https://github.com/ltmoerdani/opencode-copilot-chat/issues/83) by @gwynnbleiidd (2026-07-24)  
**Environment:** Extension v0.4.2, VS Code 1.130.0, OpenCode Go provider  
**Affected models:** `deepseek-v4-flash`, `mimo-v2.5`, `hy3` (all Go models with large context windows)

### Symptoms

From the Go usage tracker diagnostics:

```
model: deepseek-v4-flash
prompt: 754,773  completion: 1  cached: 754,752
finishReason: length
```

Every request shows `completion=1` with `finishReason=length`. Some requests show `status: cancelled` after 97-100 seconds when the user gives up waiting.

---

## Root Cause

### Commit history

| Commit       | Date            | Author  | Change                                                                                                                             |
| ------------ | --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bca269f`    | Early           | —       | Introduced `estimateTokenCount()` with word-count heuristic                                                                        |
| `d1a056c`    | 29 Jun 2026     | Wallacy | Added `promptTokens` param to `modelLimits()` + `estimateTokenCount()` call in request handler. Fixed context overflow 400 errors. |
| `8a0d813`    | 14 Jul 2026     | Wallacy | Added `TOKEN_ESTIMATE_SAFETY_MARGIN = 64` for 0-2% underestimation                                                                 |
| **This fix** | **24 Jul 2026** | —       | **Replaced word-count heuristic with charEstimate-based heuristic + MIN_OUTPUT_BUDGET**                                            |

### The bug: `words * 1.15` overestimates JSON by 3-5×

The `estimateTokenCount()` function used a word-count-based heuristic:

```typescript
// OLD — problematic
const words = normalized.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/gu)?.length ?? 0;
return Math.max(1, Math.ceil(Math.max(words * 1.15, charEstimate, cjkCharacters)));
```

The regex `[^\sA-Za-z0-9_]` matches every structural JSON character individually: `{`, `}`, `"`, `:`, `,`, `[`, `]`. For a JSON-serialized message array, these structural characters inflate the word count by 3-5× compared to the actual token count.

### How it causes `max_tokens: 1`

```
estimateTokenCount(JSON.stringify(apiMessages)) → ~3.5M (for 754K token conversation)
                          ↓
promptReserve = 3,500,000 + 64 = 3,500,064
                          ↓
safeOutputBudget = max(1, 1,000,000 - 3,500,064) = 1  ← COLLAPSE!
                          ↓
apiMaxOutputTokens = min(384,000, 1) = 1
                          ↓
POST /chat/completions { max_tokens: 1, ... }
                          ↓
Model generates 1 token → finishReason: "length" → empty response
```

### Why `MIN_OUTPUT_BUDGET` alone is insufficient

Adding a minimum floor (e.g., `max(4096, ...)`) without fixing the estimate would prevent collapse to 1, but would still cause 400 errors: the server would reject `prompt=754K + max_tokens=4K = 758K` if the estimate says the prompt is 3.5M (impossible to fit in 1M window). The server would see 758K which fits, but the client-side logic thinks it doesn't fit, leading to confusing behavior. **The estimate must be fixed first.**

---

## Fix

Two changes in `src/extension.ts`:

### 1. Fixed `estimateTokenCount()` heuristic

**Before:**

```typescript
const words = normalized.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/gu)?.length ?? 0;
return Math.max(1, Math.ceil(Math.max(words * 1.15, charEstimate, cjkCharacters)));
```

**After:**

```typescript
// Standard: 1 token ≈ 4 characters (OpenAI rule of thumb).
// CJK characters get 1:1 addition (each ≈1-2 tokens).
// 10% buffer for code-heavy text (lower char/token ratio).
const cjkCharacters = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
const charEstimate = Math.ceil(normalized.length / 4);
const codeBuffer = Math.ceil(charEstimate * 0.1);
return Math.max(1, Math.ceil(charEstimate + codeBuffer + cjkCharacters));
```

**Key insight:** `charEstimate` (n/4) naturally overestimates for JSON because JSON has a higher char/token ratio (5-6 chars/token for structured data vs 4 chars/token for plain English). This means the estimate trends conservative (safe direction) for JSON-heavy prompts.

### 2. Added `MIN_OUTPUT_BUDGET = 4096` guard

In `modelLimits()`:

**Before:** `const safeOutputBudget = Math.max(1, contextWindow - promptReserve);`

**After:** `const safeOutputBudget = Math.max(MIN_OUTPUT_BUDGET, contextWindow - promptReserve);`

This ensures the model always has at least 4K tokens of output budget, even if the estimation is off.

---

## Verification

```
Issue #83 scenario (754K prompt, 1M context, deepseek-v4-flash):

  OLD: words * 1.15 = 1,298,529 (1.72×) → safeOutputBudget = 1 → ❌
  NEW: charEstimate  = 1,040,654 (1.38×) → safeOutputBudget = 4,096 → ✅

Result: max_tokens=4,096 → model can generate meaningful response
Context budget: 754K + 4K = 758K/1M (75.9%) → safe, no 400 error
```

Verified with automated test at `scripts/verify-estimate-token-count.mts` across 4 scenarios (small, medium, large, code-heavy). All pass.

---

## Confirmed Not a Regression

| Recent change                                         | Files touched                                             | Related to this bug?                                                  |
| ----------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| PR #82 — MiMo thinking loop fix (#36)                 | `src/thinking.ts`, `src/retry.ts`, `src/streaming.ts`     | ❌ No                                                                 |
| PR #81 — Model list fetch resilience (#78)            | `src/extension.ts` (model fetch only)                     | ❌ No                                                                 |
| PR #76 — Vision proxy + context overflow safety (#74) | `src/extension.ts` (added safety margin)                  | ⚠️ Indirect (safety margin was correct, but didn't fix the heuristic) |
| PR #60 — DeepSeek context overflow                    | `src/extension.ts` (introduced `estimateTokenCount` call) | ✅ Root cause                                                         |

The bug was introduced in `d1a056c` (PR #60) when `estimateTokenCount()` was first wired into the request path. The heuristic itself was unchanged since `bca269f`.
