**Status:** 🟢 Active

# Discussion #118: DeepSeek V4 Reasoning Text Leaks into Chat (Multi-Factor Regression Analysis)

**Topic:** thinking / reasoning / streaming / regression / deepseek / community
**Updated:** 2026-08-28
**Tags:** #thinking #reasoning #deepseek #regression #streaming #gateway #community
**GitHub Discussion:** [#118](https://github.com/ltmoerdani/opencode-copilot-chat/discussions/118)
**GitHub Issue:** [#196](https://github.com/ltmoerdani/opencode-copilot-chat/issues/196)
**Reported by:** [@druellan](https://github.com/druellan)
**Confirmed by:** [@weizhen25](https://github.com/weizhen25)
**Status:** ✅ Solved per reporter (v0.7.x) · ✅ Regression #3 residual gap FIXED (2026-08-28, see "Final Resolution")

---

## Overview

Discussion #118 reports that DeepSeek V4 models intermittently display reasoning/thinking text directly in the VS Code chat window instead of inside the `LanguageModelThinkingPart` thinking block (where `chat.agent.thinkingStyle` applies). Sometimes tool calls also leak into the visible chat.

The reporter notes the issue is **intermittent**: "sometimes it works (thinking inside the VSCode thinking block), the next session the thinking is just dropped into the chat as is, and sometimes even tool calls are dropped inside the chat."

---

## Deep Dive: Regression Analysis

A full git history audit (80+ commits touching thinking/reasoning from May–Aug 2026) reveals that this is **not a single bug** but an **accumulation of 3 regressions + 3 independent bugs** that produce overlapping symptoms.

### 🔴 Regression #1: MiniMax Think-Tag Stripping Lost in Merge Cycle

| Aspect          | Detail                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline**    | Jun 5 → Jun 14, 2026                                                                                                                                                                           |
| **Initial fix** | PR #13 (Wallacy): +293 lines, `processThinkTagsStream()` in both extractors                                                                                                                    |
| **Breakage**    | During v0.2.4→v0.2.7 merge/refactor cycle, the **runtime implementation was silently lost**                                                                                                    |
| **Symptom**     | Setting `opencodego.stripThinkTags` existed in `package.json` and was read from config, but the actual stripping logic was **never executed**. Raw `thinking...response` tags leaked into chat |
| **Fix**         | Reimplemented `ThinkTagFilter` class from scratch (Jun 14, `f92654b`)                                                                                                                          |
| **Root cause**  | No regression test for the specific "strip think tags" behavior. Merge cycle couldn't detect the loss                                                                                          |

**Relevance to #118:** Not the direct cause (druellan uses DeepSeek, not MiniMax), but demonstrates the fragility of the reasoning pipeline.

### 🔴 Regression #2: MiMo Thinking Loop Fix Caused Side Effects

| Aspect          | Detail                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| **Timeline**    | Jul 23, 2026                                                             |
| **Initial fix** | `budget_tokens` cap + suffix-repetition loop detection                   |
| **Breakage**    | The fix caused regressions in other model families                       |
| **Fix**         | `baa4337`: "stabilize MiMo thinking loop fix + revert regressions"       |
| **Root cause**  | Single commit touching too many areas without per-model-family isolation |

### 🔴 Regression #3: God File Split Altered `flushReasoningFallback()` Behavior

| Aspect         | Detail                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline**   | Aug 14, 2026                                                                                                                                                                                                           |
| **Event**      | PR #155: `streaming.ts` (1620 lines) → `src/transports/` domain folder                                                                                                                                                 |
| **Breakage**   | `flushReasoningFallback()` logic changed. Reasoning was **silently dropped** when no `progress` sink was available                                                                                                     |
| **Symptom**    | Reasoning neither appeared in thinking panel NOR as visible text. But in the fallback path (when `thinkingPartConstructor` unavailable), reasoning could leak as `LanguageModelTextPart`                               |
| **Fix**        | `da881c9` (Aug 14 23:24): "don't drop reasoning when there is no progress sink". Residual gap (sink absent at construction despite constructor present) fixed 2026-08-28 per issue #196 — see "Final Resolution" below |
| **Root cause** | God file split altered subtle behavior that the test suite (310 tests) didn't catch                                                                                                                                    |

**Relevance to #118:** This is the most likely direct cause of druellan's intermittent symptom. When `progress` sink is absent in certain VS Code contexts (Agents window, certain Copilot Chat configurations), reasoning could either be silently dropped or leak as visible text depending on the fallback path.

### 🟡 Independent Bug #1: Go Gateway #37635: All Output in `reasoning_content`

| Aspect               | Detail                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline**         | Ongoing (reported Jul 23)                                                                                                                               |
| **Issue**            | OpenCode Go gateway wraps ALL streaming response text inside `reasoning_content` instead of `content`                                                   |
| **Affected**         | ALL opencode-go models (deepseek, kimi, glm, mimo, minimax, qwen, grok)                                                                                 |
| **Not affected**     | Zen gateway (`/zen/v1/`)                                                                                                                                |
| **Workaround**       | `treatReasoningAsContent` flag. Activates only when 3 conditions met: (1) URL `/zen/go/`, (2) `reasoning_effort` NOT in body, (3) `delta.content` empty |
| **Why intermittent** | Condition #3 depends on chunk order from gateway, non-deterministic                                                                                     |

**Relevance to #118:** When DeepSeek thinking is OFF and the gateway wraps the answer in `reasoning_content`, the workaround may or may not activate depending on chunk ordering. This is the most likely explanation for "sometimes reasoning appears, sometimes it doesn't."

### 🟡 Independent Bug #2: DeepSeek vs MiMo Conflicting `reasoning_content` Echo

| Aspect               | Detail                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Timeline**         | Jul 25 → Aug 10, 2026                                                              |
| **Conflict**         | MiMo's Pydantic validator **rejects** `reasoning_content` echo (issue #38, Jul 25) |
|                      | DeepSeek's validator **REQUIRES** `reasoning_content` echo (HTTP 400 if omitted)   |
| **Initial state**    | No echo for anyone (safe for MiMo, broken for DeepSeek)                            |
| **Fix for DeepSeek** | PR #123 (Aug 10): `shouldEchoThinkingHistory()` with family gating                 |
| **Fix for MiMo**     | Carve-out preserved: MiMo excluded from echo                                       |
| **Root cause**       | Global gating logic couldn't handle conflicting model requirements                 |

**Relevance to #118:** Before PR #123, every DeepSeek multi-turn conversation would 400 on the second turn. The 400 error could trigger fallback behavior that manifests as reasoning in visible chat.

### 🟡 Independent Bug #3: GLM 5.3 Cannot Disable Thinking

| Aspect                | Detail                                                                           |
| --------------------- | -------------------------------------------------------------------------------- |
| **Timeline**          | Aug 20, 2026                                                                     |
| **Issue**             | GLM 5.3+ rejects `thinking: { type: "disabled" }`                                |
| **Fix**               | Version detection → force thinking on, hide "off" from picker                    |
| **Relevance to #118** | Not directly related, but shows the ongoing pattern of per-model thinking quirks |

---

## Timeline Visualization

```text
May 14  ── Initial reasoning_content debug support
May 17  ── Thinking effort configuration
Jun 05  ── PR #13: Strip MiniMax ` thinking` tags  ✅ (Wallacy)
           ⚠️ v0.2.4–v0.2.7 merge cycle → IMPLEMENTATION LOST ❌  [REGRESSION #1]
Jun 14  ── Reimplemented ThinkTagFilter from scratch              ✅
Jul 09  ── Surface reasoning as LanguageModelThinkingPart     ✅ (#22/#71)
Jul 23  ── MiMo infinite loop → budget_tokens + loop detection
           ⚠️ Fix regressions in other models → revert partial          [REGRESSION #2]
Jul 25  ── MiMo: reasoning_content echo REJECTED                   ✅ (#38)
Aug 10  ── DeepSeek: reasoning_content echo REQUIRED                  ✅ (PR #123)
Aug 12  ── Reasoning marker + thinking-off echo                    ✅
Aug 13  ── 7 verified logic bugs from deep audit                   ✅
Aug 14  ── PR #150: DeepSeek reasoning → thinking block            ✅
Aug 14  ── PR #155: GOD FILE SPLIT (streaming.ts → transports/)
           ⚠️ flushReasoningFallback() changed → reasoning dropped  [REGRESSION #3]
Aug 14  ── Hotfix: don't drop reasoning when no progress sink      ✅ (da881c9)
Aug 14  ── Hotfix: keep reasoning_content when merging messages    ✅
Aug 18  ── Force think-tag stripping for subagent/tool-call        ✅
Aug 20  ── GLM 5.3 force thinking on                               ✅
Aug 21  ── Flush reasoning in finally on engine throw              ✅
Aug 22  ── Retry idle-stalled streams                              ✅
Aug 26  ── "Try again" popup fix (#193)                            ✅
Aug 28  ── Issue #196: residual flushReasoningFallback gap fixed   ✅
           + 3 regression tests + drop-path warning log
```

---

## Why the Reporter Says "Solved" in v0.7.x

The combination of fixes that collectively resolved the issue:

| Fix                                                   | Version | What it fixed                                          |
| ----------------------------------------------------- | ------- | ------------------------------------------------------ |
| PR #123: DeepSeek reasoning_content echo              | 0.5.2   | Multi-turn 400 error eliminated                        |
| PR #126: typeof guard + unit tests                    | 0.5.2   | Reasoning history stability                            |
| PR #150: DeepSeek reasoning → thinking block          | 0.7.0   | Reasoning never visible text                           |
| PR #155: Per-provider thinking strategy               | 0.7.0   | Each model family has `treatReasoningAsContent()`      |
| PR #155: Single config authority                      | 0.7.0   | Thinking effort model A doesn't leak to model B        |
| `da881c9`: Don't drop reasoning without progress sink | 0.7.0   | Reasoning not silently dropped                         |
| #193: "Try again" popup fix                           | 0.7.2   | False positive truncation eliminated                   |
| #196: `flushReasoningFallback()` residual gap fix     | Unrel.  | Reasoning not dropped when sink absent at construction |

---

## Final Resolution (2026-08-28, issue #196)

The hotfix `da881c9` (Aug 14) closed the most visible part of Regression #3, but a full re-verification against the current source revealed a **residual gap** in `flushReasoningFallback()` (`src/transports/extractors.ts`):

- **Happy path:** `thinkingPartConstructor && this.progress` → reasoning emitted as `ThinkingPart` via progress. ✅
- **Residual gap (fixed):** `thinkingPartConstructor` available but `progress` sink absent at construction → buffered reasoning fell through to the legacy fallback and was **silently dropped** (no thinking panel, no visible text, no log). ❌
- **Legacy path:** no constructor → reasoning surfaced as `TextPart` (leak) or dropped. Now logs a warning.

**Fix applied (this session):**

1. New branch in `flushReasoningFallback()`: when the constructor exists but the sink does not, emit via `reportProgressPart(localRequestId, progress, new thinkingPartConstructor(reasoning))` so the reasoning always reaches the thinking block.
2. The legacy drop path now logs `[warn] N chars of reasoning dropped: thinking API unavailable and response has visible content` — silent loss is now diagnosable.
3. 3 regression tests added in `src/test/extractors.test.ts` (suite `OpenAiResponseExtractor — reasoning surfacing invariants (issue #196)`), using shape-based part checks (not `instanceof`, for mock compatibility):
   - `reasoning_content + content` → ThinkingPart via progress, text in returned parts
   - `reasoning_content` only → ThinkingPart via progress, empty returned parts
   - no progress sink at construction → flush emits ThinkingPart, not TextPart

**Verification:** `npm run compile` clean, `npm run lint` 7/7 pass, 432/432 unit tests pass.

**Remaining upstream (not fixable extension-side):** gateway bug #37635 (all output wrapped in `reasoning_content` on Go) — mitigated by the `treatReasoningAsContent` workaround.

---

## Recurring Pattern Identified

Every time a large file is refactored/split, subtle behavior in the reasoning pipeline changes without detection:

1. **PR #13** (MiniMax strip) → merge cycle → logic lost
2. **PR #155** (god file split) → `flushReasoningFallback()` behavior changed

**Root cause:** No integration test that verifies end-to-end: "reasoning from model X appears as `LanguageModelThinkingPart`, not `LanguageModelTextPart`."

---

## Recommendations

1. ~~**Add integration test** for reasoning surfacing~~ → **DONE (2026-08-28):** 3 shape-based regression tests added in `src/test/extractors.test.ts` (issue #196 suite). Broader mock-gateway E2E still an option.
2. ~~**Add logging** in `flushReasoningFallback()` when fallback path activates~~ → **DONE (2026-08-28):** legacy drop path now logs a `[warn]` with the dropped char count.
3. **Create regression checklist** for any refactor touching `extractors.ts`, `thinkTags.ts`, or `streamParts.ts`. Must verify all model families
4. **Monitor gateway bug #37635**: if OpenCode fixes the server-side issue, the `treatReasoningAsContent` workaround can be simplified

---

## Related Docs

- `docs/issues/55-20260811-pr123-deepseek-reasoning-content-echo.md`: PR #123
- `docs/issues/59-20260811-pr126-reasoning-history-guard-tests.md`: PR #126
- `docs/issues/36-20260723-mimo-thinking-infinite-loop.md`: MiMo thinking loop + gateway bug
- `docs/issues/21-20260613-minimax-m3-think-tag-leak-reimplementation.md`: MiniMax tag leak
- `docs/issues/14-20260608-pr13-minimax-think-tags-review-merge-release.md`: Original PR #13
- `docs/issues/33-20260709-thinking-part-byok-surfacing-research.md`: LanguageModelThinkingPart
- `docs/features/02-20260517-per-model-thinking-controls.md`: Thinking controls
- `docs/architecture/01-20260514-open-code-provider-architecture.md`: Provider architecture
