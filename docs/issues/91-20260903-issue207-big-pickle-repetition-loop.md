# Issue #207 — Big Pickle Infinite Looping → Sampling repetition_penalty for the Fallback Family

**Status:** ✅ Solved (branch `fix/issues-204-214-batch`, commit `f5b4a72`)
**Topic:** thinking / sampling / repetition / big-pickle
**Updated:** 2026-09-03
**Tags:** #thinking #big-pickle #zen #free-models #repetition
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#207](https://github.com/ltmoerdani/opencode-copilot-chat/issues/207)
**Related:** issue doc [36 — MiMo thinking infinite loop](36-20260723-mimo-thinking-infinite-loop.md), PR #163 (MiMo `repetition_penalty: 1.2`)

---

## Problem

`big-pickle` (Zen, free stealth model, chat-completions) repeats the same phrase forever mid-task in ~50% of complex agent runs — the agent never finishes.

## Root Cause

Model-level degenerate repetition, not a transport retry loop. `big-pickle` matches the registry catch-all (`thinkingFamily: null` → `FallbackThinking`), whose `buildPayload` emitted **no** sampling fields — so none of the loop mitigations applied. The existing suffix-repetition detector (`src/transports/extractors.ts`, 6-chunk suffix match) only suppresses thinking-part emission; it cannot stop content repetition. Precedent: the MiMo loop (#36) was fixed with the same mechanism — sampling-level `repetition_penalty: 1.2` (PR #163), a standard parameter on OpenAI-compatible (vLLM/SGLang-style) backends.

## Fix

`FallbackThinking.buildPayload()` (`src/thinking/fallback.ts`) now emits `{ repetition_penalty: 1.2 }` for models in a new `REPETITION_PENALIZED_MODEL_PATTERNS` list (`big-pickle` only, pattern-precise so other fallback-family models are unaffected). `requestsThinking()` stays `false` — the penalty is sampling, not a thinking request, so gateway thinking workarounds and the thinking panel are untouched.

## Files Changed

| File                        | Change                                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| `src/thinking/fallback.ts`  | Penalized-model list + payload emission                                       |
| `src/test/thinking.test.ts` | big-pickle penalty test, requestsThinking-false test, other-models-empty test |

## Verification

- `npx tsc --noEmit` clean; 449/449 tests pass; staged-lint gate pass.
- Manual: long agent run on `big-pickle` no longer enters a repeat loop (verify over several complex tasks — the report says ~50% incidence).

## Lessons Learned

1. Free/stealth models are the most likely to need sampling guardrails; the fallback strategy is the right home for them since they share the generic chat-completions endpoint.
2. Keep the penalized list **pattern-explicit**, not family-wide — a blanket penalty would alter sampling for every unknown model.

---

Detected 2026-09-03 | Reported by @ImGGAAVVIINN
