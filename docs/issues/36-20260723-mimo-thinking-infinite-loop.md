**Status:** ✅ Solved (with upstream workaround)

# MiMo 2.5 — Thinking Loops + Go Gateway Reasoning Leak (#36)

**Topic:** thinking / mimo / streaming / gateway / workaround  
**Reported:** 2026-07-23  
**Tags:** #thinking #mimo #streaming #gateway #workaround #bug

---

## Problem

Two distinct but related issues affect MiMo 2.5 on the opencode-go gateway:

### Problem A — Thinking loop (model level)

MiMo 2.5's reasoning can enter an infinite loop — repeating the same chain-of-thought fragment indefinitely without converging. The stream is actively generating tokens, so `DEFAULT_STREAM_IDLE_TIMEOUT_MS` (2 min) does not fire. User blocked for up to 10 minutes.

### Problem B — All response text in `reasoning_content` (gateway bug)

The opencode-go gateway wraps ALL streaming response text inside `reasoning_content` instead of `content` (issue [#37635](https://github.com/anomalyco/opencode/issues/37635)). This means:

- When MiMo thinking is OFF: the model's actual response (answer text) appears in `reasoning_content` → gets emitted as a thinking part → user sees nothing or truncated response
- When MiMo thinking is ON: CoT goes to thinking panel (correct), but answer also goes to `reasoning_content` → leaked to thinking panel or visible text depending on chunk order

---

## Root Cause

### Problem A — No token budget

MiMo uses `@ai-sdk/openai-compatible`. OpenCode's transform only sends `reasoningEffort` — no budget cap:

```typescript
// OpenCode transform.ts
return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]));
// reasoningBudget() for @ai-sdk/openai-compatible → returns undefined
```

### Problem B — Gateway bug (#37635)

Confirmed via direct API test on the Go gateway:

```
POST https://opencode.ai/zen/go/v1/chat/completions
→ All streaming chunks use `reasoning_content` for ALL output
→ Final chunk has `content: "answer"` (only answer, not CoT)
→ Non-streaming endpoint returns `content` correctly (only streaming affected)
```

**Affected:** ALL opencode-go models (deepseek, kimi, glm, mimo, minimax, qwen, grok).  
**Not affected:** Zen gateway (`/zen/v1/`).

Related upstream issues:

| Issue                                                        | Status                  | Relevance                            |
| ------------------------------------------------------------ | ----------------------- | ------------------------------------ |
| [#37635](https://github.com/anomalyco/opencode/issues/37635) | 🟡 Open (MrMushrooooom) | Gateway bug — server-side fix needed |
| [#35209](https://github.com/anomalyco/opencode/issues/35209) | 🟡 Open (StarpTech)     | Extended thinking on simple prompts  |
| [#36354](https://github.com/anomalyco/opencode/issues/36354) | 🟡 Open (jlongster)     | MiMo / DeepSeek tool-call errors     |

---

## Fix (v0.4.2)

### Fix 1 — `budget_tokens` in thinking payload (`src/thinking.ts`)

Added a `budget_tokens` field alongside `reasoning_effort` to cap reasoning token generation:

| Effort | `reasoning_effort` | `budget_tokens` |
| ------ | ------------------ | --------------- |
| low    | `"low"`            | 8 192           |
| medium | `"medium"`         | 16 384          |
| high   | `"high"`           | 32 768          |

If the gateway rejects `budget_tokens` (HTTP 400), `retry.ts` handler removes it and retries with only `reasoning_effort`.

### Fix 2 — Suffix-repetition loop detection (`src/streaming.ts`)

Added `shouldSuppressThinkingEmit()` in `OpenAiResponseExtractor.handleReasoning()`. When the same 40-char suffix repeats across 6+ consecutive reasoning chunks, the model is stuck in a word-level loop. Further thinking parts are suppressed and a visible warning `[Reasoning loop detected — thinking output suppressed]` is emitted.

### Fix 3 — Go gateway `reasoning_content` workaround (`src/streaming.ts`)

Added `treatReasoningAsContent` parameter to `OpenAiResponseExtractor`. In `extractStreamParts`, when this flag is on AND `delta.content` is empty AND `reasoning_content` exists, the reasoning is emitted as visible `LanguageModelTextPart` instead of a thinking part.

**Critical condition:** The workaround only activates when ALL three conditions are true:

1. Request URL includes `/zen/go/` (Go gateway)
2. `reasoning_effort` is NOT in the request body (MiMo thinking is OFF)
3. `delta.content` is empty

When `reasoning_effort` IS present (MiMo thinking ON), `reasoning_content` is genuine CoT and should stay in the thinking panel — the workaround is NOT applied.

---

## Why surgical conditions matter

Without the condition check, the workaround would break all models:

| Model             | Go gateway? | reasoning_effort in body? | Workaround active? | Result                                         |
| ----------------- | ----------- | ------------------------- | ------------------ | ---------------------------------------------- |
| MiMo thinking OFF | ✅          | ❌                        | ✅                 | `reasoning_content` → visible text (fix)       |
| MiMo thinking ON  | ✅          | ✅                        | ❌                 | `reasoning_content` → thinking panel (correct) |
| DeepSeek (any)    | ✅          | ✅                        | ❌                 | `reasoning_content` → thinking panel (correct) |
| GLM, Kimi, Qwen   | ✅          | varies                    | varies             | Same logic applies                             |
| Any model on Zen  | ❌          | n/a                       | ❌                 | Untouched                                      |

---

## Debug logging

The extension logs diagnostic info to the "OpenCode" output channel:

```
[go-gw] model=mimo-v2.5 hasReasoningEffort=false treatReasoningAsContent=true
[go-gw] model=deepseek-v4-pro hasReasoningEffort=true treatReasoningAsContent=false
[mimo] reasoning loop: suffix repeated 6x. Suppressing thinking parts.
```

---

## Fallback behavior

If `budget_tokens` is not supported:

1. Gateway returns `HTTP 400` → `retry.ts` removes `budget_tokens`
2. Retries with `{ reasoning_effort: "low"|"medium"|"high" }` only
3. Loop detection (suffix repetition) still applies as backup

---

## Workaround lifecycle

This workaround can be removed once upstream [#37635](https://github.com/anomalyco/opencode/issues/37635) is fixed server-side. The condition check (`isGoGateway && !hasReasoningEffort`) makes it zero-risk for other providers.

---

## Files changed

| File               | Change                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/thinking.ts`  | `buildThinkingPayload()` — `budget_tokens` per MiMo effort level                                                                     |
| `src/retry.ts`     | `analyzeHttp400ForRetry()` — handler for `budget_tokens` rejection                                                                   |
| `src/streaming.ts` | `OpenAiResponseExtractor` — `treatReasoningAsContent` constructor param, `shouldSuppressThinkingEmit()`, suffix-repetition detection |
| `src/streaming.ts` | `streamChatCompletions()` — Go gateway detection via URL + body check                                                                |
