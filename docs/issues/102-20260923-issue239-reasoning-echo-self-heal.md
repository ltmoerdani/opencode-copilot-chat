# Issue #239 — DeepSeek 400 "reasoning_content must be passed back": Self-Healing Retry When History Loses the Echo

**Status:** ✅ Solved — implemented + verified end-to-end
**Topic:** retry / thinking / deepseek
**Updated:** 2026-09-23
**Tags:** #retry #thinking #deepseek #resilience
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#239](https://github.com/ltmoerdani/opencode-copilot-chat/issues/239)
**Related:** issue doc [55 — PR123 deepseek reasoning_content echo](55-20260811-pr123-deepseek-reasoning-content-echo.md), issue doc [34 — MCP tool result image](34-20260720-mcp-tool-result-image-dropped.md), issue doc [102 — #233 glm tool-image defer](102-20260923-issue233-glm-tool-image-defer.md)

---

## Problem

`deepseek-v4.1-flash` with thinking effort `low` failed on multi-turn agent conversations:

```text
[http-error-body] {"error":{"param":null,"type":"invalid_request_error","code":
"invalid_request_error","message":"Upstream request failed: [invalid_request_error]
The `reasoning_content` in the thinking mode must be passed back to the API."}}
[http] 400 Bad Request
```

Every retry failed identically; only starting a new conversation recovered. Reported by @itsmorty (0.7.5).

## Root Cause

The echo itself is implemented correctly (`src/reasoningHistory.ts` + `src/provider/messages.ts` — see doc 55). The failure appears when the reasoning **disappears from the replayed history** while thinking mode is still on:

1. **Copilot Chat conversation summarization/compaction** — summarized history carries no reasoning parts (the same mechanism issue #232 users tune via `summarizeAgentConversationHistoryThreshold`).
2. **History trimming** (`trimOldMessagesToFitContext`) can cut an assistant turn that carried the reasoning.
3. **Conversations started before thinking capture was active.**

Once one turn ships without the echo, DeepSeek's validator rejects it, and since the history shape never changes between retries, every subsequent turn 400s forever — the exact "every retry same session → 400" pattern from the MiMo saga (doc 34 family).

## Fix — recoverable-400 self-heal pattern (extension-side, post-serialization)

One new entry in `RECOVERABLE_ERROR_PATTERNS` (`src/retry.ts`), executed by the existing `MAX_400_PATCH_ATTEMPTS` loop in `transports/engine.ts` (same mechanism as #190/#171):

- **Pattern:** `/reasoning_content`? in the thinking mode must be passed back/i` — matches the verbatim upstream body (backtick-safe).
- **Patch:** strip `reasoning_content` from every assistant message **and** set `reasoning_effort: undefined`.
- **Why also drop `reasoning_effort`:** with thinking still enabled, the next response emits new reasoning that compaction strips again — the turn after would 400 again. Turning thinking off makes the request self-contained and **stops the cycle** for the rest of the conversation, not just one turn.
- **No-op guard:** the patch only fires when something actually changes (`analyzeHttp400ForRetry`'s existing JSON-diff check), so a genuinely healthy request is never patched and real failures still surface unchanged.

The patch runs **after** message conversion on the wire body — zero contact with the conversion, vision, or tool-call paths.

## Files Changed

| File                        | Change                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/retry.ts`              | New recoverable-400 pattern (echo + effort strip), with issue/rationale comment                              |
| `src/test/retry.test.ts`    | 2 tests: patch correctness (echo + effort stripped, other content untouched) and no-op when nothing to strip |
| `scripts/test-retry-e2e.ts` | Mock-server scenario replicating the DeepSeek validator (400 until echo+effort absent) + 2 e2e cases         |

## Verification

- `npm run lint` (full 7-check gate) pass; 480/480 unit tests pass.
- Mock-server retry E2E (`npx tsx scripts/test-retry-e2e.ts`) — 9/9 pass, including the new full-loop scenario (request → 400 → analyze → patch → retry → 200) and the healthy-request no-retry case.
- Real-model manual test (Copilot Chat, deepseek-v4.1-flash + effort low) — PASS (2026-09-23).

---

Detected 2026-09-22 | Reported by @itsmorty | Fixed 2026-09-23
