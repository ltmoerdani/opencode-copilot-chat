# 🧠 OPENCODE COPILOT CHAT DEVLOG

**Branch:** `xianhongtao/issue98` | **Updated:** 2026-08-03 Asia/Jakarta | **Current Phase:** Issue #98 — premature tool-call flush regression, fix implemented

---

## ⚡ Session Handoff

| Field            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Last Session** | 2026-07-23 (Session 4 — stabilization)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Worked On**    | Final stabilization of #36 fix. After iteration 3 (suffix-repetition detection), user reported: (a) `treatReasoningAsContent` was leaking thinking to visible text, (b) `contentAfterReasoning` guard was suppressing ALL models, (c) thinking/reasoning was being "cut off" and stopping without warning. Through 4 additional iterations: (1) removed `treatReasoningAsContent` to fix leak → thinking went back to thinking panel ✅, (2) reverted `contentAfterReasoning` and `shouldSuppressTextEmit` which were false-positiving on DeepSeek/GLM/Kimi (they legitimately use `reasoning_content` then `content`), (3) re-added `treatReasoningAsContent` with correct condition: only when Go gateway + NO `reasoning_effort` in body. Key insight from web research: upstream issue #37635 is confirmed (gateway bug) and PR #37558 merged `reasoning_content` parsing — but the gateway bug itself persists. |
| **Stopped At**   | All fixes verified working. Documentation updated. Ready to push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Next Action**  | → Commit all changes → push `fix/mimo-thinking-budget` branch → open PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Open Issues**  | (1)-(9) same as before. (10) Log spam from agent-host provider still high (#36 debugging showed it). (11) Upstream #37635 still open, workaround can be removed when fixed server-side. (12) #98 premature tool-call flush regression — fix implemented, pending compile/test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 🔬 Issue #98 — Premature tool-call flush (empty `<invoke>`) — 2026-08-03

**Branch:** `xianhongtao/issue98`

**Problem:** After 0.4.4 (#93 gpt-5.6-luna fix), DeepSeek-V4 via OpenCode Zen produced malformed tool calls — `<invoke>` with no `<parameter>` — causing an unrecoverable tool-calling loop. Same model works in OpenCode CLI; reverting to 0.4.3 fixes it.

**Root cause:** #93 added a flush condition `finish_reason == null && pendingToolCalls.size > 0` in `OpenAiResponseExtractor.extractStreamParts()`. Standard OpenAI-compatible SSE streams report `finish_reason: null` on every intermediate chunk, so the first tool-call delta chunk flushed an INCOMPLETE call (empty arguments → `{}` → `<invoke>` without `<parameter>`).

**Fix:**

1. Flush ONLY on `finish_reason === "tool_calls"` (never on `null`).
2. New `OpenAiResponseExtractor.flushRemainingToolCalls()` flushes pending calls once at end-of-stream (after `streamOpenCodeResponse` returns) — preserves #93 for gateways omitting finish_reason (gpt-5.6-luna on Go).
3. Extracted pure `ToolCallAccumulator` (`src/toolCallAccumulator.ts`, no `vscode` import) + unit tests `src/test/toolCallAccumulator.test.ts` (multi-chunk stream emits exactly one complete call; no premature flush; end-of-stream flush; edge cases).

**Files:** `src/streaming.ts`, `src/toolCallAccumulator.ts` (new), `src/test/toolCallAccumulator.test.ts` (new), `CHANGELOG.md`, `docs/issues/42-20260803-premature-tool-call-flush.md`.

**Verification:** `npm run compile`, `npm test`, `npm run test-retry` — all pass. Manual F5: deepseek-v4 (Zen) tool call emits full `<parameter>` ✅, tool loop resolved. ⚠️ gpt-5.6-luna (Go) NOT live-verified — China users cannot access GPT-series models via the gateway; the #93 end-of-stream path is covered by unit tests and the shared extractor code path, but a live check on gpt-5.6-luna remains recommended.

---

## 🔬 Issue #36 — MiMo 2.5 Thinking Loop — Stabilization (Session 4)

**Commits on branch `fix/mimo-thinking-budget`:**

| #   | Commit      | Description                                                                           |
| --- | ----------- | ------------------------------------------------------------------------------------- |
| 1   | `52af4b3`   | `budget_tokens` payload + `retry.ts` handler + initial issue doc                      |
| 2   | `4a7c380`   | CHANGELOG + devlog + issue doc update                                                 |
| 3   | `db71214`   | Suffix-repetition loop detection + `flushReasoningFallback` warning                   |
| 4   | _(pending)_ | Final stabilization: `treatReasoningAsContent` conditional logic + revert regressions |

**Fixes applied in stabilization:**

1. **`treatReasoningAsContent` leak** — Thinking content was appearing as visible text in chat because the workaround was applied unconditionally for all Go gateway models. Fixed by adding condition: `treatReasoningAsContent` only activates when `reasoning_effort` is NOT in the request body. When thinking IS on (reasoning_effort present), `reasoning_content` is genuine CoT → stays in thinking panel.

2. **Regressive suppression guards** — `contentAfterReasoning` and `shouldSuppressTextEmit` were suppressing output for ALL reasoning models (DeepSeek, GLM, Kimi). These models legitimately produce `reasoning_content` first then `content` — this is normal behavior, not degradation. Both guards fully removed. Only suffix-repetition detection remains active.

3. **Surgical condition:** `isGoGateway && !hasReasoningEffort` — exact filter that protects MiMo thinking-OFF from gateway bug while leaving all other models untouched.

---

## 🔬 Issue #36 — MiMo 2.5 Thinking Loop — Session 2026-07-23 ✅ FIXED

**Action:** User reported MiMo 2.5 (and 2.5-Pro) thinking loops without end — same reasoning content repeated 30+ times, user blocked until 10-min total timeout. Initial investigation coded `budget_tokens` cap (low=8K, medium=16K, high=32K) in `buildThinkingPayload()`. User rightly questioned: "why does it loop even with a cap?"

**Branch:** `fix/mimo-thinking-budget` (created from `fix/issue-78-model-list-fetch-resilience`)

**Compile:** `npm run compile` exit 0 (verified every change)

**Root cause — two distinct problems found:**

| #   | Problem                                                                                                                                                                                                                   | Layer              | Fix                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | **Go gateway bug #37635** — opencode-go places ALL streaming text in `reasoning_content` instead of `content`. All Go models affected (mimo, deepseek, kimi, glm, etc.). Confirmed via direct API test by issue reporter. | Gateway (upstream) | `treatReasoningAsContent` workaround: detect `/zen/go/` URL path, emit reasoning as visible text |
| 2   | **MiMo model not converging** — model's chain-of-thought enters self-referential loop generating same text repeatedly.                                                                                                    | Model level        | `budget_tokens` caps damage; upstream fix needed from model provider                             |

**Web research findings:**

- `anomalyco/opencode#37635` (5 days old, assigned MrMushrooooom): "opencode-go gateway returns reasoning_content instead of content in streaming responses" — confirmed ALL opencode-go models. Non-streaming OK. Zen gateway OK.
- `anomalyco/opencode#35209` (3 weeks, assigned StarpTech): "models go into extended thinking on simple prompts" — related: thinking options not gated by model capabilities.
- `anomalyco/opencode#36354` (2 weeks, assigned jlongster): "MiMo / DeepSeek tool-call Internal server error" — reasoning_content handling broken for tool calls.

**Changes made (1 commit `52af4b3`):**

1. `src/thinking.ts` — `buildThinkingPayload()` MiMo branch: add `budget_tokens` per effort level with retry.ts handler map.
2. `src/retry.ts` — Add HTTP 400 handler for `budget_tokens` rejection (graceful degradation).
3. `src/streaming.ts` — `OpenAiResponseExtractor`: add `treatReasoningAsContent` parameter + constructor + logic. `streamChatCompletions`: detect Go gateway via URL path `/zen/go/`.
4. `docs/issues/36-20260723-mimo-thinking-infinite-loop.md` — Full issue documentation.
5. `CHANGELOG.md` — Added to [Unreleased] section.

**Workaround trade-off:** Go models lose legitimate thinking surfacing (CoT appears as visible text), but they were already broken — gateway mixes CoT + answer in `reasoning_content`. Zen models unaffected. Fix reversible when upstream #37635 is resolved.

**Manual verification:** Not run (requires Go API key + MiMo model). Workaround is deterministic — URL check, no runtime deps on model behavior.

---

## 🔬 Issue #78 — Model List Fetch Resilience — Session 2026-07-23 ✅ FIXED

**Action:** Triaged issue #78 (reported by `@leiyu1980`). Initial misdiagnosis: looked like a regression of the closed #51 picker crash (TypeScript schema change on VS Code 1.126, fixed by PR #53). Web research into Node undici defaults (`headersTimeout=300s`, no connect timeout), `nodejs/undici#5450` (socket-reuse race under concurrent load, expected behavior per maintainers, recommend `interceptors.retry`), and VS Code 1.129 release notes (new agent host raises concurrent `provideLanguageModelChatInformation` calls) confirmed the real root cause: `fetchModels()` was built for the happy path only.

**Branch:** `fix/issue-78-model-list-fetch-resilience` (created from `main` @ `742f899`)

**Compile:** `npm run compile` exit 0 (run after every change)
**Build:** `vsce package` produces `opencode-copilot-chat-0.4.2.vsix` (1.06 MB, 115 files)
**Errors:** `get_errors` clean on all modified files

**Commits (3, NEVER squash on merge):**

1. `8fcde64` — `fix(resilience): make model-list fetch tolerant of transient network failures`. Core 5-part fix: timeout, retry, User-Agent runtime, CancellationToken threading, 1-hour cache. Contains `Fixes #78` in message.
2. `a04939c` — `feat(commands): add top-level Refresh Models commands + Zen Manage Provider`. Drive-by UX parity fix uncovered when reporter couldn't find `OpenCode Go: Refresh Models` in palette (it only existed inside `Manage Provider` QuickPick; Zen had no Manage Provider at all).
3. `ccfcb75` — `fix(resilience): send Accept header for corporate firewall compatibility (#78)`. Added after reporter's reply revealed signature mismatch (POST worked, GET failed on same host). Bumps `0.4.1 → 0.4.2`, promotes `[Unreleased]` to `[0.4.2] — 2026-07-23`.

**Manual verification:** Test A (command visibility) PASS — all 3 new commands appear in palette. Tests B-F pending user.

**What's NOT covered (honest caveats):**

- VPN/firewall **hard block** to `opencode.ai` → user must set VS Code `http.proxy`.
- Gateway outage longer than ~3.5s retry budget → degrades to cache (1h) then bundled.
- undici socket-reuse race itself → upstream behavior, we tolerate it via retry but did not install a global custom dispatcher (`interceptors.retry` + `interceptors.dns` would affect every `fetch` in extension, deemed overkill for MVP).
- `FALLBACK_USER_AGENT` in test harnesses that stub `vscode.extensions.getExtension` → must bump manually when major version changes.

---

## 🔬 Issue #77 — MCP Tool Result Image Forwarding — Session 2026-07-20 ✅ FIXED

**Action:** Triaged issue #77 (reported by @yinhx3). Deep-dived VS Code Chat API to confirm `LanguageModelToolResultPart.content: unknown[]` may contain nested image `LanguageModelDataPart` (that's how MCP screenshot tools deliver images). Confirmed Kimi K2.7 is vision-capable via `VISION_CAPABLE_MODELS`. Designed and implemented a 4-transport fix with per-image size guard. Two pre-existing log-noise bugs fixed in the same session because they made manual testing very hard to follow.

**Branch:** `fix/issue-77-mcp-image-tool-result` (created from `main` @ `55fb6ad`)

**Compile:** `./node_modules/.bin/tsc -p ./` exit 0
**Tests:** 107/107 pass, 0 regression (vision proxy, metadata, thinking, retry, usage, goUsageTracker, usageProfile)

**Manual verification:** Chrome DevTools MCP + OpenCode Go model — model successfully read and described the screenshot.

---

## 🔬 PR #76 Review & Merge — Vision Proxy + Context Overflow + Output Popup — Session 2026-07-15 ✅ MERGED

**Action:** Reviewed community PR #76 (@Wallacy, 4 commits). Vision proxy for text-only models (#74), 64-token context overflow safety margin (#68), output pane focus steal fix (#67). Two review rounds, then merged via merge commit.

**What it does:**

1. **Vision proxy for text-only models (#74).** When a non-vision OpenCode model receives an image, the extension forwards it to a configured vision-capable Copilot model (via `vscode.lm.selectChatModels` + `sendRequest`), gets a text description, and feeds it to the original model. Configured via **OpenCode Go: Configure Vision Proxy** command — QuickPick with None/Customize-prompt/vision-models, stored in `globalState`. Key fix: `actuallySupportsVision` cached before `modelCapabilities()` override to break circular dependency.

2. **Context overflow 400 fix (#68).** `estimateTokenCount()` underestimates by 0–2%. Added `TOKEN_ESTIMATE_SAFETY_MARGIN = 64` to `promptReserve` in `modelLimits()`. Prevents payload pushing past context window on large prompts (~130K tokens).

3. **Output pane focus steal fix (#67).** Removed stray `.show(true)` in `streamChatCompletions()` empty-response warning that popped Output panel over chat.

**Review process:**

- **Round 1 (pre-force-push):** Flagged 1 blocker (context overflow fix claim without code) + 2 formatting (README table collapsed into one line, CHANGELOG `[0.3.7]` heading removed) + 2 nice-to-haves (dummy CancellationToken, quota not documented). Drafted reply via `avoid-ai-writing` + `writing-framework-v4` skills, peer-to-peer tone.
- **Wallacy response:** "I was squashing some commits and got few things mixed and lost. You can check again."
- **Round 2 (post-force-push `8a0d813`):** Re-verified all 5 items. All blockers resolved. 64-token margin in `modelLimits()`, README rows split, `[0.3.7]` heading restored, real `token` wired to `proxyVision()`. `[vision-proxy]` log lines added for runtime visibility. Approved.
- **Merge:** `gh pr merge 76 --merge` → merge commit `d2fcbe4`. Preserved all 4 commits (`69902bb`, `4a36009`, `a17f91e`, `8a0d813`). No squash.

**Post-merge documentation:**

- `docs/features/11-20260715-vision-proxy.md` — comprehensive feature doc (architecture, code locations, tests, review notes, limitations).
- `CHANGELOG.md` — `[Unreleased]` → `[0.4.1] — 2026-07-15` with PR + contributor attribution.
- `package.json` — version `0.4.0` → `0.4.1`.
- This devlog entry.

**Tests:** 107 total, 0 failing. 9 new in `visionProxy.test.ts` (proxy condition + circular-regression guard), 3 new in `metadata.test.ts` (`VISION_CAPABLE_MODELS` membership).

**CI:** build (20) SUCCESS, GitGuardian pass, mergeStateStatus CLEAN.

**Next:** Compile, package VSIX, install locally, commit docs.

---

## 🔬 Issues #22 + #71 Deep-Dive — Thinking Part BYOK Surfacing — Session 2026-07-09 ✅ SOLVED

**Action:** User asked to compare issues #22 (`chat.agent.thinkingStyle` not respected) and #71 (thinking tokens not displaying). Confirmed they are duplicates. Deep-dive research overturned the previous "upstream blocker" conclusion from doc `23-*`.

**Key findings:**

1. **Issues #22 and #71 are the same bug.** Both report reasoning from OpenCode models never rendered as a collapsible thinking block. #71 author explicitly frustrated ("negatively affecting results by a huge margin").

2. **The "upstream blocker" narrative was wrong.** Doc `23-*` (2026-06-15) concluded this was blocked on `microsoft/vscode#318211` and unfixable extension-side. Research on 2026-07-09 found:
   - `LanguageModelThinkingPart` API shipped to VS Code in **August 2025** (PR #259939). Our `engines.vscode: ^1.125.0` guarantees it is present at runtime.
   - `Vizards/deepseek-v4-for-copilot` v0.6.2 (Marketplace, engine `^1.116.0`) **already solves this** for DeepSeek BYOK via `progress.report(new vscode.LanguageModelThinkingPart(text))` — with **no `enabledApiProposals`** in `package.json`.
   - User @yinhx3 confirmed in #71: deepseek-v4-for-copilot "is able to display reasoning content."
   - DeepSeek-v4 tracker has **zero open issues** about reasoning not displaying.

3. **Root cause in our codebase:** `src/streaming.ts` `OpenAiResponseExtractor` accumulates `reasoningContent` but never emits it as a thinking part. `flushReasoningFallback` drops it silently when text/tool calls are present.

**Verified implementation plan (6 steps):**

1. Create `src/vscode.proposed.languageModelThinkingPart.d.ts` (type augmentation).
2. Emit reasoning per-chunk via `LanguageModelThinkingPart` in the streaming extractor.
3. Runtime guard `typeof vscode.LanguageModelThinkingPart === 'function'` (defensive only — our floor is 1.125.0).
4. Refactor `flushReasoningFallback` to route through thinking part.
5. **No `package.json` change** (no `enabledApiProposals` needed).
6. Verify: `npm run compile` + manual test per model family + all three `thinkingStyle` values.

**Documentation produced:**

- `docs/issues/33-20260709-thinking-part-byok-surfacing-research.md` — comprehensive issue doc (status ✅ Solved).
- `docs/issues/23-20260615-thinking-style-setting-not-respected.md` — marked ⚠️ Deprecated with redirect banner.
- `/memories/repo/issue22-71-thinking-part-bypass.md` — repo memory snapshot with full research.

**Implementation + verification:**

- `src/vscode.proposed.languageModelThinkingPart.d.ts` — type augmentation (NEW).
- `src/streaming.ts` — `emitThinkingPart()` helper + runtime guard; both extractors extended with `handleReasoning()`; all 4 transport call sites updated; `flushReasoningFallback` refactored; non-stream path (`extractChatCompletionParts`, `extractAnthropicParts`) also updated; `totalReasoningChars` monotonic counter for accurate log metrics.
- `npm run compile` + `npx tsc --noEmit --strict` → both pass.
- Manual test: DeepSeek + Kimi in Copilot Chat → reasoning rendered as collapsible thinking block. `chat.agent.thinkingStyle` respected. Tool-call replication intact.

**Released in:** v0.3.7.

**Next:** Commit, push branch, open PR, reply to #22/#71.

---

## ✅ PR #60 Review & Merge — SQLite-backed Cost Accuracy, DeepSeek Context Overflow — Session 2026-06-30 🟢 DONE

**Action:** Reviewed community PR #60 (@Wallacy, 4 commits after cleanup). SQLite-backed subscription cost accuracy (fixes #59), DeepSeek context overflow prevention, SSE log gating. Approved after review. Wallacy cleaned up commit history (removed revert+re-apply noise). Merged via `--merge`. Issue doc `docs/issues/30-20260630-pr60-*` written. Feature doc `docs/features/03-20260605-go-usage-tracker.md` updated with SQLite integration section.

**What it does:**

1. **SQLite-backed cost accuracy (#59).** `getSummary()` now reads `~/.local/share/opencode/opencode.db` as its primary cost source. The database contains actual billed amounts, replacing the local estimate that drifted 9–15% (issue #23 root cause). When the CLI database is available, subscription totals (session 5h, weekly, monthly, today, yesterday) reflect real billing data. Token and request counts are still enriched from tracked entries (SQLite stores cost only). Falls back to the local estimate when the CLI database is absent.

2. **DeepSeek 400 error fix.** When the prompt is large (e.g. 668K tokens on `deepseek-v4-flash`), the requested `max_tokens` (384K) combined with the prompt exceeded the 1048K context window. `modelLimits()` now caps `maxOutputTokens` to `contextWindow - promptReserve` using the estimated prompt size, preventing context overflow across all providers.

3. **SSE log gating.** `[sse-stats]` logged unconditionally on every response, adding noise to the Output channel. Now gated behind `debugReasoning`, matching other SSE-level logs.

**Review notes:**

- SQLite-first approach is clean: `readOpenCodeHistory()` was already in the codebase but dead code. Now wired into `getSummary()` as primary source.
- `buildSqliteEnrichedSummary()` correctly applies baselines after SQLite aggregation (no double-counting).
- `promptTokens` estimation via `JSON.stringify(apiMessages)` over-counts slightly (JSON structure overhead), but this is the right direction for safety.
- Commit history had revert+re-apply of #58 fix (agent-variant sync). Wallacy cleaned this up before merge.
- Issue #57/#58 (agent model visibility) remain open — VS Code API limitation, workaround documented.

**Changes:**

| #   | Change                                              | Files                                           | Impact                                    |
| --- | --------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| P0  | SQLite-backed cost accuracy for subscription totals | `src/goUsageTracker.ts`                         | Usage percentages reflect actual billing  |
| P0  | `buildSqliteEnrichedSummary()` method               | `src/goUsageTracker.ts`                         | Combines SQLite costs with tracked tokens |
| P0  | `sqliteAvailable` field on `UsageSummary`           | `src/goUsageTracker.ts`                         | Downstream consumers know data source     |
| P0  | `promptTokens` param on `modelLimits()`             | `src/extension.ts`                              | Prevents context window overflow          |
| P1  | `[sse-stats]` gated behind `debugReasoning`         | `src/streaming.ts`                              | Output channel cleaner                    |
| D1  | Issue doc                                           | `docs/issues/30-20260630-pr60-*`                | Full root cause, fix, lessons learned     |
| D2  | Feature doc update                                  | `docs/features/03-20260605-go-usage-tracker.md` | SQLite integration section added          |
| D3  | Devlog entry                                        | `docs/devlog.md`                                | This entry                                |

**Verification:**

```bash
npm run compile    # 0 errors
npm test           # 75/75 pass
```

**Follow-up:**

- Double DB read: `hasSQLiteData` getter and `getSummary()` both call `readOpenCodeHistory()`. Could cache per-call if profiling shows it matters.
- Prompt estimation: `JSON.stringify` over-counts tokens. Could be refined with a dedicated tokenizer in the future.

---

## ✅ PR #55 Review & Merge — Session-Level Cost Tracking + copilotCredits — Session 2026-06-26 🟢 DONE

**Action:** Reviewed community PR #55 (@Wallacy, 7 commits). Session-level cost tracking across the extension's usage UI, plus `copilotCredits` plumbing for VS Code session cost. Went through one review iteration; Wallacy addressed all 5 points in a follow-up push (2 commits). Merged via `--merge` (merge commit, all 7 commits preserved). Feature doc `docs/features/09-20260626-session-level-cost-tracking.md` written.

**What it does:**

Each chat thread now accumulates its cost, request count, and token usage, keyed by the `sessionId` from `x-opencode-session` header. Visible in:

- SVG hover card: `Session (est): $0.0042  Requests: 3  Tokens: 4.2K`
- QuickPick: `💬 Latest Session (est)` in Daily Summary
- Usage webview: same SVG card
- Persisted via `globalState` (max 50 sessions, idle >2h pruned)

Added `copilotCredits` (= cost × 100, since 1 credit = $0.01) to `UsageSnapshot`, `ProviderUsagePayload`, `TransportRequestSummary`, and `UsageLogEntry`. This follows the exact pattern Copilot's own BYOK providers (`AnthropicLMProvider`, `GeminiNativeProvider`) use. Session cost is an **estimate** (not the billed amount), hence the `(est)` marker.

**Review concerns (verified against branch code):**

1. **Cost computed twice.** `onTransportSummary` computed cost inline, then `goUsageTracker.record()` recomputed via `estimateCost()` — two formulas could drift. → Fixed: `estimateCost()` exported as shared helper, called from both sites.
2. **No unit tests.** Claimed "40/40 pass" was existing suite only. → Fixed: 35 new tests in `goUsageTracker.test.ts` (40 → 75 total). Covers accumulation, pruning, restoration, edge cases.
3. **Session cost = estimate.** `getSummary()` returns `buildSummaryFromTracked(...)` (local estimate). SQLite reader exists but is dead code. → Clarified: `(est)` marker added to tooltip/QuickPick. Tracked in issue #59.
4. **"This Session" label ambiguous.** `getCurrentSessionCost()` returns global most-recent, not focused thread. → Renamed to `Latest Session (est)`.
5. **Missing trailing newline in `usage.ts`.** → Fixed.

**VS Code limitation (Known Issue):**

VS Code 1.126 does not convert `LanguageModelDataPart({ type: 'data', mimeType: 'usage' })` from BYOK provider streams into `IChatUsage` progress events. The `copilotCredits` data is correctly structured; the plumbing stops at the `ChatService` boundary. Session cost is visible in the extension's own UI, not in VS Code's native session info popover.

**Changes:**

| #   | Change                                                       | Files                                                      | Impact                                                              |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| P0  | Session cost accumulation (Map by sessionId, prune, persist) | `src/goUsageTracker.ts`                                    | Per-thread cost visible in tooltip/QuickPick/webview                |
| P0  | `copilotCredits` in usage data parts                         | `src/extension.ts`, `src/streaming.ts`, `src/usage.ts`     | VS Code can accumulate session cost (when BYOK limitation is fixed) |
| P0  | `estimateCost()` exported as shared helper                   | `src/goUsageTracker.ts`, `src/extension.ts`                | Eliminates dual cost computation                                    |
| P0  | `onTransportSummary` moved before data part creation         | `src/streaming.ts`                                         | Callers can enrich summary before emission                          |
| P1  | `(est)` marker + SVG card resize                             | `src/extension.ts`                                         | Accurate labeling: session cost is local estimate                   |
| P1  | "Latest Session (est)" label rename                          | `src/extension.ts`                                         | Avoids ambiguity with multi-thread panels                           |
| T1  | 35 unit tests                                                | `src/test/goUsageTracker.test.ts`                          | Coverage for accumulation, pruning, restoration, edge cases         |
| D1  | Feature doc                                                  | `docs/features/09-20260626-session-level-cost-tracking.md` | 196-line living reference                                           |
| D2  | Issue #59 filed                                              | GitHub Issues                                              | SQLite wire-up follow-up (issue #23 root cause)                     |
| D3  | Repo memory updated                                          | `opencode-go-usage-accuracy.md`                            | Cross-link to issue #59                                             |

**Verification:**

```bash
npm run compile    # 0 errors
npm test           # 75/75 pass (40 existing + 35 new)
```

**Follow-up:**

- Issue #59: Wire SQLite reader into `getSummary()` for subscription-level accuracy.
- VS Code API gap: `ProvideLanguageModelChatResponseOptions` has no thread ID → `getCurrentSessionCost()` stays global-most-recent until VS Code adds a stable chat thread hook.

---

## ✅ PR #53 Review & Merge — Model Picker Crash + Duplication on VS Code ≥1.126 — Session 2026-06-23 🟢 DONE

**Action:** Reviewed community PR #53 (@Wallacy) fixing two model picker regressions introduced by the VS Code 1.126 unified picker (internal PR #321026). The PR went through two iterations after review feedback; iteration 2 shipped.

**Root Cause:**

1. **Crash.** `category` on each model info was typed as `{ label, order }` (object), but `LanguageModelChatInformation.category` expects a plain `string`. 1.126's unified picker calls `getCategoryLabel(model.metadata.category)` → `category.charAt(0)` → `TypeError` on an object. Verified against the bundled `src/vscode.proposed.chatProvider.d.ts` (provider version 5): the interface does not declare `category` as `{ label, order }`. Only `priceCategory?: string` exists. The object form was never type-correct.
2. **Duplication.** 1.126 resolves models in two phases (groupless + group-based) for vendors with a `configuration` schema. Each model acquired a second cache identity. A second duplication source was the unconditional `SecretStorage` fallback added in iteration 1, which fired on both phases.

**Changes (iteration 2, shipped):**

| #   | Change                                                                            | Files                | Impact                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Remove object-typed `category` field from `OpenCodeModel` and returned model info | `src/extension.ts`   | Eliminates the `TypeError` crash on 1.126.                                                                                                                                                            |
| P0  | Rewrite key resolution with `options.configuration` discriminator                 | `src/extension.ts`   | Single conditional replaces `group` guard, `Set` dedup, and unconditional fallback. Handles four cases: undefined (resolving), `{apiKey}` (BYOK), `{}` (1.126 empty), agent variant (always secrets). |
| P1  | Revert `warmModelPickerMetadata` to parallel `Promise.allSettled`                 | `src/extension.ts`   | Iteration 1 made it sequential; not needed with new discriminator.                                                                                                                                    |
| P1  | Strip eight `[DIAG]` log calls                                                    | `src/extension.ts`   | Replaced with one `this.log(\`[picker] options=...\`)`.                                                                                                                                               |
| P1  | Remove `*-agent` activation events                                                | `package.json`       | Not needed with new fallback strategy.                                                                                                                                                                |
| D1  | Issue doc                                                                         | `docs/issues/27-...` | Full root cause, both iterations, review notes.                                                                                                                                                       |
| D2  | CHANGELOG entries                                                                 | `CHANGELOG.md`       | v0.3.4 Fixed section (already present from PR).                                                                                                                                                       |
| D3  | README Agents Window section                                                      | `README.md`          | Clarified Local vs Copilot split, `supportAgentsWindow` note.                                                                                                                                         |
| D4  | Devlog entry                                                                      | `docs/devlog.md`     | This entry.                                                                                                                                                                                           |

**Verification:**

```bash
npm run compile    # 0 errors
```

**Manual test (reported by contributor):**

- ✅ VS Code 1.125: chat picker without duplication, Agent Window working.
- ✅ VS Code 1.126 Insiders: chat picker functional, no crash, no duplication.

**Review trail:** Two technical questions raised (2026-06-22): (1) API key fallback behavior change for non-agent providers, (2) unconditional `triggerChange()` idempotency. Contributor confirmed the duplication issue in iteration 1 and fixed it in iteration 2. Both questions resolved by the `options.configuration` discriminator. Stale-key edge case in `secrets` acknowledged as non-blocking.

**Result:** ✅ PR #53 merged with `--merge` (merge commit, all commits preserved). Both regressions resolved. v0.3.4 released.

**Follow-up (not blocking):** `ProviderDefinition.categoryOrder` is now dead code (interface + `providerVariant` param + `PROVIDERS` assignments at lines 141, 170). Small cleanup PR candidate.

---

## ✅ Kimi K2.7-code Dual 400 Errors — Temperature + Thinking Fix — Session 2026-06-15 🟢 DONE

**Action:** Fixed issue #25 — the newly released `kimi-k2.7-code` (Moonshot AI) returned two distinct HTTP 400 errors: (1) `invalid temperature: only 1 is allowed for this model`, and (2) `invalid thinking: only type=enabled is allowed for this model`. The extension sent both rejected values because the model was unregistered in the fallback metadata (`temperature: undefined` → temperature included in payload) and the default thinking setting is `kimi: "off"` (which produces `{ type: "disabled" }`, rejected by K2.7).

**Root Cause:** K2.7-code is a breaking change from K2.6 — Moonshot API contract (verified via `platform.kimi.ai/docs/api/chat`):

- `thinking.type` only accepts `"enabled"` (not `"disabled"`)
- The `temperature` parameter is rejected (only `1` is allowed)
- Default thinking is `{ type: "enabled", keep: "all" }`

**Changes:**

| #   | Change                                                                      | Files                                                    | Impact                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Register `kimi-k2.7-code` in `MODEL_LIMITS_BY_PROVIDER[GO_VENDOR]`          | `src/metadata.ts`                                        | Context 256000 / output 262144 (models.dev verified); fallback metadata now returns a record instead of `undefined`                                                                                                                                                           |
| P0  | Add `MODELS_WITHOUT_TEMPERATURE` set + propagate in `fallbackModelMetadata` | `src/metadata.ts`                                        | `temperature: false` returned for K2.7-code so `buildChatCompletionsRequestBody` omits the parameter; extensible for future models that lose temperature support                                                                                                              |
| P0  | Add `kimi-k2.7-code` to `VISION_CAPABLE_MODELS`                             | `src/metadata.ts`                                        | Vision-capable per models.dev (`attachment: true`, modalities include image/video)                                                                                                                                                                                            |
| P0  | Special-case `/^kimi-k2\.7/i` in `buildThinkingPayload`                     | `src/thinking.ts`                                        | Always emits `{ thinking: { type: "enabled", keep: "all" } }` regardless of user setting; `keep:"all"` preserves reasoning_content across multi-turn conversations per Moonshot spec                                                                                          |
| P1  | Special-case K2.7 in `buildFamilyThinkingSchema`                            | `src/thinking.ts`                                        | Picker shows single "Always On (K2.7)" option with Moonshot API constraint description (not hidden, not silent force-on)                                                                                                                                                      |
| P1  | Defensive force `kimi:"on"` in `applyRequestThinkingOverride`               | `src/thinking.ts`                                        | Guards against stale cached picker values                                                                                                                                                                                                                                     |
| R1  | Extract thinking helpers to `src/thinking.ts` (pure module)                 | `src/thinking.ts`, `src/extension.ts`                    | `thinkingFamily`, `buildFamilyThinkingSchema`, `applyRequestThinkingOverride`, `buildThinkingPayload`, `buildQwenAnthropicThinkingPayload` moved to zero-vscode-dependency module; enables unit testing; `extension.ts` re-imports all (-431 lines); all call sites unchanged |
| T1  | Unit test suite                                                             | `src/test/metadata.test.ts`, `src/test/thinking.test.ts` | 32 tests covering K2.7 fix + regression safety for K2.6/K2.5 + all other families (deepseek/glm/qwen/mimo/minimax)                                                                                                                                                            |
| T2  | Fix `package.json` test script                                              | `package.json`                                           | `node --test` → `node --test "out/test/**/*.test.js"` glob pattern                                                                                                                                                                                                            |
| D1  | Issue doc                                                                   | `docs/issues/25-...`                                     | Status → ✅ Solved; open questions resolved with models.dev evidence                                                                                                                                                                                                          |
| D2  | CHANGELOG entry                                                             | `CHANGELOG.md`                                           | `[0.3.2]` — Fixed + Changed sections                                                                                                                                                                                                                                          |
| D3  | Devlog entry                                                                | `docs/devlog.md`                                         | This entry                                                                                                                                                                                                                                                                    |

**Evidence — Official Moonshot API Contract:**

> Controls thinking for the kimi-k2.7-code model... Default value is `{"type": "enabled", "keep": "all"}`.
> Differences from kimi-k2.6: `type` only accepts `"enabled"`. Unlike kimi-k2.6, `"disabled"` is NOT supported — passing it returns an error. Thinking is always on for this model.
> Source: `platform.kimi.ai/docs/api/chat`

**Evidence — models.dev registry (verified 2026-06-15):**

| Field            | Value                      |
| ---------------- | -------------------------- |
| context          | 256000                     |
| output           | 262144                     |
| temperature      | `false`                    |
| attachment       | `true` (vision-capable)    |
| modalities.input | `["text","image","video"]` |

**Verification:**

```bash
npm run compile    # 0 errors
npm test           # 32 tests, 11 suites, 0 fail (69ms)
```

**Manual test:** User confirmed K2.7-code works via Copilot Chat (session 2026-06-15).

**Result:** ✅ Both 400 errors resolved. `kimi-k2.6` and `kimi-k2.5` behavior unchanged (they accept `disabled`). All other families (deepseek/glm/qwen/mimo/minimax) verified via unit tests — no regression.

---

**Action:** Full community growth session — merged 3 community PRs, rewrote README, optimized repo discoverability, and engaged with community issues.

**Changes:**

| #   | Change                                               | Files                                            | Impact                                                                                                                                                         |
| --- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Merged PR #34 — README model tables sync             | `README.md`                                      | 15 missing models added (Go: minimax-m3/m2.1/m2, hy3-preview, ring-2.6-1t; Zen: claude variants, gemini-3-flash, gpt-5.x variants, trinity-large-preview-free) |
| P0  | Merged PR #37 — Model picker demo GIF                | `docs/screenshots/model-picker.gif`, `README.md` | First demo visual — GIF wired into README `## 🎬 Demo` section at width=480                                                                                    |
| P0  | Merged PR #38 — Fix "Off" missing in Thinking picker | `src/extension.ts`                               | `buildFamilyThinkingSchema()`: moved "off" outside `hasToggle` guard; added "on" for toggle-only models. Fixes #35                                             |
| P1  | README full rewrite for virality                     | `README.md`                                      | Hero badges, comparison table (Copilot Free/Pro/Pro+ vs OpenCode), model showcase, FAQ, Star History, social share                                             |
| P1  | package.json marketplace SEO                         | `package.json`                                   | displayName keyword-rich, keywords 9→25, categories `[AI]`→`[AI, ML, Education, Other]`                                                                        |
| P1  | GitHub repo settings                                 | (GitHub API)                                     | Topics 6→20, description updated, Discussions enabled                                                                                                          |
| P1  | `.github/` community files                           | `.github/*`, `CONTRIBUTING.md`                   | Issue templates, PR template, FUNDING, dependabot (monthly), CI workflow, simplified for beginners                                                             |
| P1  | Labels for contributors                              | (GitHub API)                                     | `good first issue`, `help wanted`, `documentation`, `models`, `hacktoberfest`                                                                                  |
| D1  | Issue doc for PR #38                                 | `docs/issues/23-...`                             | Full root cause + scenario matrix                                                                                                                              |
| D2  | CHANGELOG entry                                      | `CHANGELOG.md`                                   | `[0.2.9] — 2026-06-14`                                                                                                                                         |
| D3  | Version bump                                         | `package.json`                                   | `0.2.8` → `0.2.9`                                                                                                                                              |

**Community engagement:**

| Issue                                                                                           | Action                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11) (Agents window visibility) | Posted detailed options analysis (Option A marketplace-safe, B/C rejected), asked community for config + ID strategy input |
| [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23) (Go Usage not updating)    | Explained client-side limitation, identified monthly anchor bug, proposed Options A-D, leaning B+C                         |
| [#35](https://github.com/ltmoerdani/opencode-copilot-chat/issues/35) (Can't turn off reasoning) | Fixed by PR #38, closed                                                                                                    |

**Contributors:** [@rupayon123](https://github.com/rupayon123) (#34), [@sublimode](https://github.com/sublimode) (#35 report, #37, #38)

**Verification:**

```bash
npm run compile    # 0 errors
```

**Result:** ✅ 3 community PRs merged, README transformed, repo discoverability optimized, 2 community issues engaged.

---

## ✅ MiniMax M3 `<think>` Tag Leak — Reimplementation — Session 2026-06-13 🟢 DONE

**Action:** Re-implemented the `<think>...</think>` tag stripping feature that was lost during the v0.2.4–v0.2.7 merge/refactor cycle.

**Root Cause:** The `opencodego.stripThinkTags` setting was declared in `package.json` (since v0.2.2, PR #13) and read from config in `extension.ts`, but the actual runtime stripping logic (`processThinkTagsStream`, `stripThinkTags`, etc. from PR #13) was absent from `src/streaming.ts`. Both `OpenAiResponseExtractor` and `AnthropicResponseExtractor` emitted text verbatim — including `<think>` reasoning blocks — directly to the Copilot Chat UI.

**Changes:**

| #   | Fix                                                   | Files                | Impact                                                                                                                        |
| --- | ----------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P0  | New `ThinkTagFilter` class                            | `src/streaming.ts`   | Streaming state machine — `carry` buffer for cross-chunk tag boundaries, `insideThink` flag, `process()` + `finish()` methods |
| P1  | `shouldStripThinkTags()` + `createThinkTagFilter()`   | `src/streaming.ts`   | Config resolution: `"auto"` → `/^minimax-m/i`, `"always"` → all, `"never"` → none                                             |
| P2  | `thinkFilter` wired into `OpenAiResponseExtractor`    | `src/streaming.ts`   | Constructor param + `filterText()` on both `delta` and `message` text paths                                                   |
| P3  | `thinkFilter` wired into `AnthropicResponseExtractor` | `src/streaming.ts`   | Constructor param + `filterText()` on `content_block_start`, `content_block_delta`, and fallback paths                        |
| P4  | `flushReasoningFallback()` flush                      | Both extractors      | Calls `thinkFilter.finish()` at stream end                                                                                    |
| P5  | `stripThinkTags` in `StreamRequestOptions`            | `src/streaming.ts`   | New optional field                                                                                                            |
| P6  | All 4 stream entry points create filter               | `src/streaming.ts`   | `streamChatCompletions`, `streamAnthropicMessages`, `streamResponsesApi`, `streamGoogleGenerateContent`                       |
| P7  | Thread `stripThinkTags` to all 4 calls                | `src/extension.ts`   | `settings.stripThinkTags` passed through                                                                                      |
| P8  | Fix `ApiSettings.stripThinkTags` type                 | `src/extension.ts`   | `"auto" \| "on" \| "off"` → `"never" \| "auto" \| "always"`                                                                   |
| D1  | Issue doc                                             | `docs/issues/22-...` | Full root cause analysis, architecture, comparison with PR #13                                                                |
| D2  | CHANGELOG entry                                       | `CHANGELOG.md`       | `[0.2.8] — 2026-06-13`                                                                                                        |
| D3  | Version bump                                          | `package.json`       | `0.2.7` → `0.2.8`                                                                                                             |

**Verification:**

```bash
npm run compile    # 0 errors
```

**Result:** ✅ MiniMax M3's `<think>` reasoning is now stripped from visible chat output in `"auto"` mode (default). Thinking content is accumulated into `reasoningContent` instead of being discarded.

---

## ✅ Active Docs Audit — Codebase Verification & Status Updates — Session 2026-06-13 🟢 DONE

**Action:** Verified all documents with 🟢 Active status against the current codebase to determine whether issues are resolved. Found 4 active docs (excluding `documentation-standards.md` template). Cross-referenced implementation evidence and GitHub PR merge status.

**Audit Results:**

| Document                                                      | Previous Status | Verified Status | Evidence                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | --------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issues/19-20260610-pr15-context-size-reasoning-review.md`    | 🟢 Active       | ✅ **Solved**   | PR #15 merged 2026-06-10. All features (context size selector, dynamic reasoning, Mimo/MiniMax thinking) confirmed in `src/metadata.ts` + `src/extension.ts`. Kimi format later corrected by PR #18.                                                                                      |
| `references/01-20260611-agents-window-model-visibility.md`    | 🟢 Active       | ✅ **Solved**   | Reference doc — research IS the deliverable. All options evaluated, marketplace compatibility confirmed. Implementation tracked separately as GitHub Issue #11 (new devlog task IMPL-01).                                                                                                 |
| `architecture/01-20260514-open-code-provider-architecture.md` | 🟢 Active       | ✅ **Solved**   | Living reference — all timeline entries (v0.1.0–v0.2.7) verified ✅ Solved in codebase. Document accurately describes current architecture. Reference is complete and up-to-date.                                                                                                         |
| `issues/01-20260515-qwen36-tool-call-loop.md`                 | 🟢 Active       | ✅ **Solved**   | All code-level issues fixed in v0.1.9/v0.1.10 (routing, Anthropic parser, tool surfacing). CHANGELOG confirms fixes. Remaining "loop" is inherent model behavior on free tier with broad prompts — model capability limitation, not a code bug. All 4 sub-issues documented and resolved. |

**Changes Made:**

| File                                                          | Change                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `docs/issues/19-...-pr15-context-size-reasoning-review.md`    | Status: 🟢 Active → ✅ Solved; added Post-Merge Update section                                                 |
| `docs/references/01-...-agents-window-model-visibility.md`    | Status: 🟢 Active → ✅ Solved; updated Status section to reflect research completeness                         |
| `docs/architecture/01-...-open-code-provider-architecture.md` | Status: 🟢 Active → ✅ Solved; added living-reference note + last-verified date                                |
| `docs/issues/01-...-qwen36-tool-call-loop.md`                 | Status: 🟢 Active → ✅ Solved; added resolution note — all code issues fixed, remaining loop is model behavior |
| `docs/devlog.md`                                              | Updated Session Handoff + Active Tasks (FIX-01 & DOC-01 removed, IMPL-01 added) + audit session entry          |

**Result:** ✅ **All 4** active docs updated to Solved. 0 genuinely Active docs remain. Only IMPL-01 (agents window implementation) is a future feature task.

---

## ✅ Usage Webview Panel — Persistent SVG Dashboard — Session 2026-06-13 🟢 DONE

**Action:** Implemented a persistent Webview panel for Go Usage details that stays open in the editor area when clicking the status bar icon, matching GitHub Copilot's quota UX pattern.

**Root Cause:** Go Usage status bar tooltip only appeared on hover and disappeared immediately when mouse moved away. No way to keep it visible for reference. VS Code API provides no `statusBarItem.showHover()` or programmatic hover control for status bar items.

**Research Findings:**

| Approach                     | Result                                                |
| ---------------------------- | ----------------------------------------------------- |
| `statusBarItem.showHover()`  | ❌ Not in VS Code API                                 |
| `workbench.action.showHover` | ❌ Editor-only, not status bar                        |
| Tooltip + command            | ⚠️ Conflicts — command prevents tooltip               |
| **Webview Panel**            | ✅ Best solution — persistent, theme-aware, real-time |

**Changes:**

| #   | Fix                                            | Files                              | Impact                                                                        |
| --- | ---------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| P0  | `usageWebviewPanel` module variable            | `src/extension.ts`                 | Tracks persistent panel lifecycle                                             |
| P1  | Register `opencodego.showUsageDetails` command | `package.json`, `src/extension.ts` | New command entry point                                                       |
| P2  | Assign command to status bar item              | `src/extension.ts`                 | Click opens persistent panel                                                  |
| P3  | `showUsageWebview()` function                  | `src/extension.ts`                 | Creates or reveals Webview in `ViewColumn.Beside`                             |
| P4  | `updateWebviewContent()` function              | `src/extension.ts`                 | Renders SVG in themed HTML with VS Code CSS variables                         |
| P5  | Real-time auto-sync                            | `src/extension.ts`                 | `refreshGoUsageStatusBar()` calls `updateWebviewContent()` after each refresh |
| P6  | Panel dispose handler                          | `src/extension.ts`                 | Cleans up reference on close                                                  |
| P7  | Activation event + command contribution        | `package.json`                     | `onCommand:opencodego.showUsageDetails` + metadata                            |

**Verification:**

```bash
npm run compile    # clean, 0 errors
```

**Result:** ✅ Status bar icon now has dual interaction: hover → transient tooltip, click → persistent Webview panel. SVG usage data auto-updates in both views after each chat response.

---

---

## ✅ PR #21 Review & v0.2.7 Version Bump — Session 2026-06-12 🟢 DONE

**Action:** Full review of contributor PR #21 by Wallacy Freitas — "Respect model temperature support from models.dev". Analyzed 3-file diff adding `temperature: boolean` field from models.dev metadata pipeline, with conditional omission in all 3 request body builders. Verified CI passed (GitGuardian Security Checks). Posted approving review comment on GitHub. After maintainer merged PR, stamped CHANGELOG `[Unreleased]` → `[0.2.7] — 2026-06-12` and bumped `package.json` version `0.2.6` → `0.2.7`.

**Doc:** `docs/issues/21-20260612-pr21-temperature-support-review.md`

**Root Cause:** Several models (Claude Opus 4-8, GPT-5 family) have deprecated the `temperature` parameter. The extension was unconditionally sending it in all request payloads, causing HTTP 400 errors ("temperature is deprecated for this model."). The `models.dev` registry already declared `temperature: boolean` but the extension was not reading this field.

**Changes:**

| #   | Fix                                               | Files              | Impact                                                                                              |
| --- | ------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| P0  | Added `temperature` field to 3 interfaces         | `src/metadata.ts`  | `ModelMetadataFields`, `ResolvedModelMetadata`, `ModelsDevModelRecord`                              |
| P1  | Parse `temperature` from models.dev API           | `src/metadata.ts`  | `normalizeModelsDevProvider()` reads `model.temperature`                                            |
| P2  | Propagate through resolution pipeline             | `src/metadata.ts`  | `resolveModelMetadata()` + `normalizeModelMetadataFields()`                                         |
| P3  | Conditional temperature in 3 request builders     | `src/extension.ts` | `buildChatCompletionsRequestBody`, `buildAnthropicMessagesRequestBody`, `buildResponsesRequestBody` |
| P4  | Portuguese comment → English                      | `src/extension.ts` | Minor cleanup in `buildThinkingPayload()`                                                           |
| V1  | CHANGELOG `[Unreleased]` → `[0.2.7] — 2026-06-12` | `CHANGELOG.md`     | Version stamp                                                                                       |
| V2  | Version bump `0.2.6` → `0.2.7`                    | `package.json`     | Extension version                                                                                   |

**Review Findings:**

| Category               | Finding                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| ✅ Bug fix valid       | Resolves issue #20 — HTTP 400 on temperature-deprecated models      |
| ✅ Backward-compatible | `undefined` (no metadata) still sends `temperature` as before       |
| ✅ Consistent pattern  | Follows `reasoning`/`reasoningOptions` approach already in codebase |
| ✅ CI passed           | GitGuardian Security Checks ✓                                       |

**Verification:**

```bash
gh pr list --repo ltmoerdani/opencode-copilot-chat --state all
gh pr diff 21 --repo ltmoerdani/opencode-copilot-chat
gh pr checks 21 --repo ltmoerdani/opencode-copilot-chat  # All checks successful
```

**Community Feedback:** Review comment posted — [PR #21 comment](https://github.com/ltmoerdani/opencode-copilot-chat/pull/21#issuecomment-4692922424). Verdict: ✅ Approved to merge.

**Lessons Learned:** (1) Model capability flags from `models.dev` must be respected — future deprecations should follow same pattern. (2) Spread pattern `...(condition ? { field } : {})` is clean for conditional request body fields. (3) Contributor PRs with `[Unreleased]` CHANGELOG entries need version stamping by maintainer after merge.

**Result:** ✅ PR #21 reviewed, approved, comment posted, merged by maintainer. Version bumped to 0.2.7.

---

---

## ✅ v0.2.7 Release — 2026-06-12 🟢 DONE

**Action:** Release cleanup for temperature support and Kimi thinking documentation.

**Root Cause:**

- Some models declare `temperature: false` in `models.dev`; sending temperature causes provider 400 errors.
- Kimi changelog text previously claimed the wrong thinking payload shape.

**Changes:**

| #   | Fix                                 | Files                                 | Impact                                                               |
| --- | ----------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| P0  | Respect model temperature support   | `src/extension.ts`, `src/metadata.ts` | Omits temperature when the selected model does not support it        |
| P1  | Correct Kimi thinking documentation | `CHANGELOG.md`, settings docs         | Keeps docs aligned with actual `thinking: { type }` payload behavior |

**Verification:** TypeScript compile and packaged VSIX for `0.2.7`.

---

---

## ✅ Agents Window Model Visibility Research — GitHub Issue #11 — Session 2026-06-11 🟢 DONE

**Action:** Deep-dive investigation of how to show OpenCode Go/Zen models in the VS Code Agents window model picker (GitHub Issue [#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11)). User wanted models to appear in a dedicated "OpenCode" tab in the Agents window, not under "Copilot CLI". Full VS Code source code analysis of `targetChatSessionType`, `chatSessions` contribution point, `chatSessionsProvider` proposed API, and `filterModelsForSession()` logic. Evaluated 3 approaches with marketplace compatibility as hard constraint.

**Doc:** `docs/references/01-20260611-agents-window-model-visibility.md`

**Root Cause:** Third-party language model providers registered via `languageModelChatProviders` contribution only appear in the Chat view (session type `'local'`). The Agents window (session type `'copilotcli'`) has `requiresCustomModels: true`, meaning its model picker only shows models with `targetChatSessionType: 'copilotcli'`. Our models had no `targetChatSessionType`, so they were filtered out.

**Options Evaluated:**

| Option | Approach                                                     | Marketplace?                                         | Verdict            |
| ------ | ------------------------------------------------------------ | ---------------------------------------------------- | ------------------ |
| **A**  | Duplicate models with `targetChatSessionType: 'copilotcli'`  | ✅ Yes — stable API                                  | ✅ **Recommended** |
| **B**  | Own `chatSessions` contribution (`type: "opencode-copilot"`) | ❌ No — requires `chatSessionsProvider` proposed API | Rejected           |
| **C**  | Distribute as VSIX only with `enabledApiProposals`           | ❌ Not marketplace-viable                            | Rejected           |

**Key Findings:**

| Finding                                                                                  | Source                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `targetChatSessionType` is in **STABLE** `vscode.d.ts` (9 matches)                       | `vscode-dts/vscode.d.ts`                 |
| `chatSessions` contribution is **SKIPPED** without proposed API                          | `chatSessions.contribution.ts` line ~335 |
| `registerChatSessionContentProvider` → `checkProposedApiEnabled('chatSessionsProvider')` | `extHost.api.impl.ts` line 1730          |
| `vsce publish` **REJECTS** `enabledApiProposals`                                         | Marketplace policy                       |
| `wlxms/opencode-copilot` uses proposed API — **NOT** on marketplace (HTTP 404)           | Marketplace verification                 |
| Model response routing is **independent** of `targetChatSessionType`                     | `extHostLanguageModels.ts` line ~326     |
| `AgentSessionProviders` enum is **hardcoded** — no custom types                          | `agentSessions.ts`                       |

**Implementation Plan (Option A):**

1. In `provideLanguageModelChatInformation()` (`extension.ts` ~line 1035), for each model, create 2 entries:
   - Copy 1: No `targetChatSessionType` → Chat view (existing)
   - Copy 2: `targetChatSessionType: 'copilotcli'` → Agents window
2. Both copies use same `provideLanguageModelChatResponse()` handler
3. Config toggle decision pending: always-on vs opt-in

**Files Investigated (VS Code Source):** `extHostLanguageModels.ts`, `extHost.api.impl.ts`, `chatSessions.contribution.ts`, `chatModelSelectionLogic.ts`, `chatSessionsService.ts`, `agentSessions.ts`, `copilotCli.ts`

**Lessons Learned:**

1. VS Code proposed API bypass is runtime-only (`isProposedApiEnabled` check is commented out in `extensions.ts`), but `vsce` blocks at publish time.
2. `chatSessions` contribution without `chatSessionsProvider` proposed API is completely ignored.
3. `targetChatSessionType` is the only marketplace-compatible hook into the Agents window model picker.
4. Custom session types require proposed API — only hardcoded built-in types work without it.

**Result:** ✅ Research complete, documented in `docs/references/01-20260611-agents-window-model-visibility.md`. Awaiting user confirmation to implement Option A. Custom "OpenCode" tab is NOT possible on marketplace.

---

---

## ✅ PR #18 Review — Kimi Thinking Format Fix — Session 2026-06-11 🟢 DONE

**Action:** Full review and community feedback for contributor PR #18 by Wallacy. Analyzed 3-file diff (+14/−5) fixing Kimi (MoonshotAI) thinking payload format. The extension was sending `enable_thinking: true | false` but the OpenCode Go gateway rejects this with HTTP 400. Correct format is `thinking: { type: "enabled" | "disabled" }` — matching GLM family. Posted approving review comment on GitHub.

**Doc:** `docs/issues/20-20260611-pr18-kimi-thinking-format-review.md`

**Root Cause:** The `buildThinkingPayload()` function for Kimi models returned `{ enable_thinking: thinking.kimi === "on" }`. The OpenCode Go gateway validates request fields strictly and rejects `enable_thinking` as an extra input (HTTP 400: "Extra inputs are not permitted"). The `[0.2.4]` CHANGELOG entry also incorrectly documented this format.

**Changes:**

| #   | Fix                                                    | Files              | Impact                                                |
| --- | ------------------------------------------------------ | ------------------ | ----------------------------------------------------- |
| P0  | Kimi payload: `enable_thinking` → `thinking: { type }` | `src/extension.ts` | Fixes HTTP 400 for all Kimi thinking requests         |
| P1  | GLM comment clarification                              | `src/extension.ts` | Documents gateway `variants()` behavior for GLM       |
| P2  | MiniMax inline documentation                           | `src/extension.ts` | Clarifies `adaptive` format for M3                    |
| P3  | Setting description update                             | `package.json`     | Aligns docs with actual payload format                |
| P4  | CHANGELOG `[Unreleased]` correction                    | `CHANGELOG.md`     | Corrects `[0.2.4]` entry that documented wrong format |

**Review Findings:**

| Category       | Finding                                                               |
| -------------- | --------------------------------------------------------------------- |
| ✅ Correct     | `enable_thinking` → `thinking: { type }` matches gateway expectations |
| ✅ Consistent  | Now uses same format as GLM family                                    |
| ✅ Well-tested | 70 API calls: 67 × 200, 3 × expected 400                              |
| ✅ Low risk    | Only affects `kimi-*` model family                                    |
| ⚠️ Minor nit   | Comment in Portuguese — codebase uses English (non-blocking)          |
| ✅ CI          | GitGuardian Security Checks — SUCCESS                                 |

**Verification:**

```bash
gh pr view 18 --repo ltmoerdani/opencode-copilot-chat --json title,state,mergeable,statusCheckRollup
gh pr diff 18 --repo ltmoerdani/opencode-copilot-chat
```

**Community Feedback:** Review comment posted — [PR #18 comment](https://github.com/ltmoerdani/opencode-copilot-chat/pull/18#issuecomment-4679210157). Verdict: 👍 Approved to merge.

**Lessons Learned:** (1) OpenCode Go gateway validates request fields strictly — provider-native formats like `enable_thinking` are rejected as extra inputs. (2) CHANGELOG accuracy is critical — wrong format documentation misleads future contributors. (3) Cross-family format consistency (Kimi + GLM both use `thinking: { type }`) reduces maintainability burden. (4) Contributor PRs should ideally match project language (English) for comments.

**Result:** ✅ Review completed, approving comment posted to GitHub. PR #18 OPEN, awaiting merge.

---

---

## ✅ PR #15 Review — Context-Size Tiers, Reasoning Options, Richer Thinking — Session 2026-06-10 🟢 DONE

**Action:** Full code review of community contributor PR #15 by Wallacy — 38KB diff analysis across 5 files (+487/-57). Reviewed 3 features: context-size selector for tiered-pricing models, dynamic reasoning options from models.dev, and richer thinking effort levels for DeepSeek/Mimo/MiniMax families. Identified Kimi `enable_thinking` bug fix and MiniMax format corrections. Prepared review feedback for maintainer.

**Doc:** `docs/issues/19-20260610-pr15-context-size-reasoning-review.md`

**Root Cause:** Three limitations in the model picker: (1) No context-size awareness for tiered-pricing models, (2) Hardcoded reasoning options with no models.dev adaptation, (3) Missing thinking support for Mimo and MiniMax families. Additionally, Kimi was sending wrong payload format (`thinking: { type }` object instead of `enable_thinking` boolean), and MiniMax was not differentiating between `minimax-m3` and `minimax-m2.*` payload formats.

**Changes:**

| #   | Fix                                                   | Files                       | Impact                                                                                   |
| --- | ----------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| P0  | `ModelCostTier` interface + tiered pricing parsing    | `src/metadata.ts`           | New interfaces for `cost.tiers[]` and `cost.context_over_200k`                           |
| P1  | `reasoningOptions` field in metadata pipeline         | `src/metadata.ts`           | Raw `reasoning_options` from models.dev propagated through                               |
| P2  | `getContextSizeOptions()` function                    | `src/metadata.ts`           | Generates picker options from tier thresholds                                            |
| P3  | `buildFamilyThinkingSchema()` — 3-priority resolution | `src/extension.ts`          | models.dev → family hardcoded → dynamic fallback                                         |
| P4  | `modelConfigurationSchema()` unified                  | `src/extension.ts`          | Combines thinking-effort + context-size properties                                       |
| P5  | `buildThinkingPayload()` — corrected MiniMax + Kimi   | `src/extension.ts`          | Fixed payload formats per upstream `transform.ts`                                        |
| P6  | `modelLimits()` — `contextSizeOverride` parameter     | `src/extension.ts`          | Caps effective context window when user selects a tier                                   |
| P7  | Mimo + MiniMax family support                         | `src/extension.ts`          | New families in `ThinkingSettings`, `thinkingFamily()`, `applyRequestThinkingOverride()` |
| P8  | Cache key bump `v4` → `v5`                            | `src/metadata.ts`           | Forces re-fetch of models.dev with new fields                                            |
| P9  | New settings + expanded DeepSeek                      | `package.json`              | `thinking.mimo`, `thinking.minimax`, expanded `thinking.deepseek`                        |
| P10 | CHANGELOG + README                                    | `CHANGELOG.md`, `README.md` | Comprehensive documentation for all 3 features                                           |

**Review Findings:**

| Category      | Finding                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| ✅ Strength   | 3-priority resolution is elegant and future-proof                                        |
| ✅ Strength   | Kimi fix correct — `enable_thinking: true` (boolean) replaces silently-ignored object    |
| ✅ Strength   | MiniMax correctly differentiates `minimax-m3` → `adaptive` vs `minimax-m2.*` → `enabled` |
| ✅ Strength   | All defaults `off` — backward-compatible                                                 |
| 🐛 Nit        | Unused variable `hasBaseSurcharge` in `getContextSizeOptions()`                          |
| 🐛 Nit        | Missing newline at EOF in `src/metadata.ts`                                              |
| 🐛 Nit        | Undocumented `minimax-m3`, `minimax-m2.1`, `minimax-m2` in CHANGELOG                     |
| 💡 Suggestion | Extract family schemas to lookup table for scalability                                   |

**Verification:**

```bash
gh pr diff 15 --repo ltmoerdani/opencode-copilot-chat   # 38KB diff, full review
gh pr view 15 --repo ltmoerdani/opencode-copilot-chat --json ...  # PR metadata
```

**CI:** ✅ GitGuardian — No secrets detected. **Mergeable:** ✅ Yes. **Reviews:** Awaiting maintainer.

**Result:** ✅ Review completed and feedback prepared. PR #15 is OPEN, awaiting maintainer to post review and merge. Documented in `docs/issues/19-20260610-pr15-context-size-reasoning-review.md`.

**Lessons Learned:** (1) PR review feedback should be formatted as copy-paste markdown codeblock for easy posting. (2) Large PRs with 3+ features are harder to review atomically but acceptable when features are tightly coupled in the same schema builder. (3) Always check for unused variables and missing EOF newlines in contributor PRs.

---

---

## ✅ v0.2.6 Payload Simplification — 2026-06-10 🟢 DONE

**Action:** Removed message trimming and gzip compression after proxy behavior proved incompatible.

**Root Cause:** The OpenCode Go/Zen proxy does not support gzip request bodies, and byte-aware trimming was too aggressive for Copilot conversations.

**Changes:**

| #   | Fix                             | Files                             | Impact                                                    |
| --- | ------------------------------- | --------------------------------- | --------------------------------------------------------- |
| P0  | Remove gzip request compression | `src/streaming.ts`                | Avoids OpenCode proxy HTTP 500                            |
| P1  | Remove message trimming         | `messageTrimmer.ts`, request flow | Prevents context loss and repeated trimming notifications |

**Result:** ✅ Requests now send raw JSON and preserve full conversation context within upstream limits.

---

---

## ✅ v0.2.4 Dynamic Reasoning + Context Size — 2026-06-10 🟢 DONE

**Action:** Added dynamic model-picker configuration for tiered context sizes and model-specific thinking controls.

**Root Cause:** Hardcoded reasoning and context metadata could drift from live provider metadata and pricing tiers.

**Changes:**

| #   | Feature                   | Detail                                                     |
| --- | ------------------------- | ---------------------------------------------------------- |
| 1   | Context Size selector     | Uses `models.dev` `cost.tiers[]` and `context_over_200k`   |
| 2   | Dynamic reasoning options | Uses `models.dev.reasoning_options` when present           |
| 3   | Family thinking controls  | DeepSeek, GLM, Kimi, MiniMax, Mimo, Qwen                   |
| 4   | Strip think tags          | Handles inline `<think>` output for known reasoning models |

**Result:** ✅ Model picker better reflects each model's actual capabilities and pricing shape.

---

---

## ✅ v0.2.3 Output Channel Cleanup & Buffer Fix — Session 2026-06-09 🟢 DONE

**Action:** Removed all verbose debug and informational logs from the "OpenCode" output channel, fixed `Buffer` TypeScript compilation error, refreshed extension icon, updated CHANGELOG, bumped version to 0.2.3, built and installed locally.

**Doc:** `docs/issues/16-20260609-output-channel-cleanup-textdecoder-fix.md`

**Root Cause:** (1) The `this.log()` method wrote every diagnostic data point directly to the output channel with no log-level filtering, producing hundreds of lines per session load and per API request. (2) `Buffer.from(part.data).toString("utf8")` used Node.js-specific `Buffer` class without `@types/node` in TypeScript config.

**Changes:**

| #   | Fix                                                                  | Files                          | Impact                                           |
| --- | -------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------ |
| P0  | Removed per-model `Model registered:` log (17+ models × N refreshes) | `src/extension.ts`             | Eliminated the largest noise source              |
| P1  | Removed `Request:`, `Request completed:` logs                        | `src/extension.ts`             | Clean request tracking without per-request noise |
| P2  | Removed `goUsageLogChannel` + `GoUsageTracker` log callback          | `src/extension.ts`             | Silenced separate "OpenCode Go Usage" channel    |
| P3  | Removed `[stream-summary]` from all 4 stream functions               | `src/streaming.ts`             | Removed per-stream diagnostic lines              |
| P4  | Removed `[response-summary]` + `[usage]` double-log                  | `src/streaming.ts`             | Consolidated into single compact line            |
| P5  | Removed `[request] url=`, `[http] 200 OK`, `[sse-stats]`             | `src/streaming.ts`             | Removed per-request HTTP/SSE debug lines         |
| P6  | Removed `formatUsageLogLine` import                                  | `src/streaming.ts`             | No longer needed                                 |
| P7  | Replaced `Buffer.from` with `TextDecoder`                            | `src/extension.ts`             | Fixed TS2591 without `@types/node` dependency    |
| P8  | Version bump + CHANGELOG                                             | `package.json`, `CHANGELOG.md` | 0.2.2 → 0.2.3                                    |

**Verification:**

```bash
npm run compile    # clean, 0 errors
npx tsc --noEmit   # clean, 0 errors
npx @vscode/vsce package --no-dependencies
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.2.3.vsix --force
```

**Result:** ✅ Output channel is now clean — only error/warning logs remain. No diagnostic capability lost (all removed data accessible via diagnostics document). TypeScript compiles without errors.

---

---

## ✅ Proxy Payload Limit — Gzip Compression & Message Trimming — Session 2026-06-09/10 🟢 DONE (develop branch, later reverted in v0.2.6)

**Action:** Investigated and fixed HTTP 500 errors from OpenCode Go API proxy when chat sessions get long (payloadBytes=393980). Went through 3 solution iterations before finding the correct fix. Also involved complex git workflow to properly merge `main` → `develop` with intact history.

**Doc:** `docs/issues/17-20260609-proxy-payload-gzip-compression.md`

**Root Cause:** OpenCode Go API proxy has HTTP body size limit ~400 KB. After long chat sessions, accumulated message history + tool definitions exceed this limit → proxy returns HTTP 500 "Internal server error". The model's token context window (1M tokens for deepseek-v4-pro) was only ~10% used — the bottleneck was infrastructure (proxy byte limit), NOT the model.

**Solution Iterations:**

| Phase | Approach                                             | Result                        | Why Wrong/Limited                                                              |
| ----- | ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| 1     | Payload size guard (`MAX_PAYLOAD_BYTES=350KB`)       | ✅ Prevents retry spam        | Band-aid — tells user to start new session                                     |
| 2     | Message trimming (`trimApiMessages()`)               | ✅ Keeps requests under limit | Sacrifices context unnecessarily — model can handle it                         |
| 3     | **Gzip compression** (`gzipSync` for payloads >50KB) | ✅ **Correct fix**            | 400KB → ~60KB compressed. Transport-layer solution for transport-layer problem |

**Files Changed:**

| File                    | Change                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| `src/messageTrimmer.ts` | NEW — byte-aware turn-level trimming with generic `<T extends TrimmableMessage>` |
| `src/streaming.ts`      | Added `gzipSync` compression + `Content-Encoding: gzip` header + hard safety net |
| `src/extension.ts`      | Integrated `trimApiMessages()` before body builders + user notification          |

**Git Workflow Issues (Lessons Learned):**

1. Multiple `git reset --hard` to `a5e4c0f` (main HEAD) **lost develop's original history** — develop had its own commits (22700e4, 0387c50, 36cbc4b)
2. Created fake merge commits with identical parents via `git hash-object` — graph showed immediate convergence
3. Recovery: `git reflog develop@{19}` found original HEAD (22700e4), properly restored and merged

**Final develop branch:**

```
* 64be1ad feat: gzip compression + message trimming fallback
*   80c635b Merge branch 'main' into develop (2 different parents ✓)
|\
| * a5e4c0f (main) feat: update extension icon...
* | 22700e4 feat: release version 0.2.1...
```

**Verification:**

```bash
npx tsc --noEmit  # 0 errors
npm run compile   # clean build
git push --force origin develop  # synced
```

**Lessons Learned:**

1. **ALWAYS** check `git reflog develop` and `git log --oneline develop -10` before any `reset --hard`
2. `git merge main --no-ff` only creates merge commit if branches have diverged
3. Fake merge commits with identical parents look wrong — proper merges need 2 DIFFERENT parents
4. Gzip is the architecturally correct fix — transport-layer solution for transport-layer problem
5. **Note:** Gzip compression was later removed in v0.2.6 because the OpenCode proxy does not support gzip request bodies

**Result:** ✅ Fix implemented on develop branch. Later reverted in v0.2.6 Payload Simplification (proxy doesn't support gzip). Full investigation documented in `docs/issues/17-20260609-proxy-payload-gzip-compression.md`.

---

---

## ✅ Project Cleanup — Immediate Bug Fixes & Improvement Analysis — Session 2026-06-09 🟢 DONE

**Action:** Full codebase review producing 4 categories of improvements (20+ items), then executing all 4 immediate bug fixes: redundant `activationEvents` removal, stale user-agent version update, duplicate CHANGELOG cleanup, and `.vsix` gitignore verification.

**Doc:** `docs/issues/18-20260609-project-cleanup-immediate-bugfixes.md`

**Root Cause:**

- Rapid v0.1.0→v0.2.3 development cycle (13 releases in ~25 days) accumulated stale version strings, redundant VS Code activation events, and duplicate changelog entries.
- `OPEN_CODE_USER_AGENT` was hardcoded once during v0.1.7 and never updated.
- VS Code now auto-generates `onCommand:*` activation events from `contributes.commands`, making 6 entries in `package.json` redundant and causing warnings.
- `.vsix` build artifacts were committed before `.gitignore` rule existed.

**Changes:**

| #   | Fix                                                  | Files              | Impact                                                           |
| --- | ---------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| P0  | Remove 6 redundant `onCommand:*` activationEvents    | `package.json`     | Eliminates VS Code compile warnings, cleaner activation manifest |
| P1  | Update `OPEN_CODE_USER_AGENT` from `0.1.7` → `0.2.7` | `src/extension.ts` | Correct user-agent header in API requests                        |
| P2  | Remove duplicate `[0.2.3]` CHANGELOG block           | `CHANGELOG.md`     | Clean changelog without duplicate entries                        |
| P3  | Verify `.vsix` in `.gitignore`                       | `.gitignore`       | Already covered — no code change needed                          |

**Improvement Analysis (Future Work):**

| Category     | Key Recommendations                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Architecture | Split `extension.ts` (~900+ lines) into `provider.ts`, `statusBar.ts`, `diagnostics.ts`, `config.ts` |
| Testing      | Add unit tests for `estimateCost`, `formatUsageStatusBarText`, `resolveModelRouting`                 |
| Linting      | Add ESLint + Prettier for consistent code style                                                      |
| DevEx        | Add CI/CD (GitHub Actions), bundle with esbuild, pin devDependencies                                 |
| Features     | Retry with backoff, model favorites, cost estimation before request, auto-switch on quota            |
| Docs         | Complete README requirements section, add CONTRIBUTING.md, add architecture diagram                  |

**Verification:**

```bash
npm run compile    # clean, 0 errors
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('✅ package.json valid')"
```

**Lessons Learned:**

1. Version strings must be centralized — `OPEN_CODE_USER_AGENT` should read from `package.json` or a shared constant.
2. Redundant activation events accumulate silently — periodic review of `activationEvents` is warranted.
3. Changelog duplication is a common copy-paste error — consider using a changelog tool.
4. `.gitignore` rules should be added before committing build artifacts.

**Result:** ✅ All 4 bug fixes applied, clean compile verified. Full improvement analysis documented for future sessions.

---

---

## ✅ Go Usage Tracker Debug Logging — Sessions 2026-06-05/06 🟢 DONE

**Action:** Investigated and debugged Go Usage Tracker status bar not updating after chat requests. Exhaustively searched for OpenCode REST API (none exists), removed CLI-dependent code paths, fixed session.percent bug, added debug output channel.

**Doc:** `docs/issues/14-20260605-go-usage-status-bar-not-updating.md`

**Root Cause:** (1) `session.percent` used `GO_LIMITS.weekly` ($30) instead of `GO_LIMITS.session` ($12) for the 5h rolling window. (2) Dual data paths (SQLite + extension-tracked) caused confusion; SQLite required CLI. (3) No diagnostic output when `record()` silently skipped entries. (4) Depleted Go balance meant API returned errors with no usage data → zero tokens → record skipped.

**Changes:**

| #   | Fix                                      | Files                                       | Impact                                                                             |
| --- | ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| P0  | Fixed `session.percent` wrong limit      | `src/goUsageTracker.ts`                     | Uses correct $12 session limit for 5h rolling window                               |
| P1  | Extension-tracked as sole primary        | `src/goUsageTracker.ts`                     | `getSummary()` only calls `buildSummaryFromTracked()`, no SQLite fallback          |
| P2  | Removed CLI-dependent messaging          | `src/goUsageTracker.ts`, `src/extension.ts` | "Ready to track" instead of "install CLI"                                          |
| P3  | Removed manual baseline functions        | `src/extension.ts`                          | Removed `askUsdAmount()`, `setManualGoUsageBaseline()`, manual baseline Quick Pick |
| P4  | Added "OpenCode Go Usage" output channel | `src/goUsageTracker.ts`, `src/extension.ts` | Per-call logging: SKIP reasons, RECORD details, entry counts                       |
| P5  | Added `log` callback to GoUsageTracker   | `src/goUsageTracker.ts`                     | Constructor accepts optional `(msg: string) => void`                               |
| P6  | Logging in `record()` guards             | `src/goUsageTracker.ts`                     | Logs reason for skip: providerDisplayName filter or zero tokens                    |
| P7  | Logging in `onTransportSummary`          | `src/extension.ts`                          | Logs provider, model, tokens, status, error before and after record                |

**Verification:**

```bash
npx tsc --noEmit  # 0 errors
npx @vscode/vsce package --no-dependencies  # 103.28 KB (v0.2.1 test VSIX)
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.2.1.vsix --force
# View → Output → "OpenCode Go Usage" channel shows debug logs
```

**Result:** ✅ Debug infrastructure in place. Status bar update requires non-depleted Go subscription balance for successful API responses that include usage data.

---

---

## ✅ v0.2.0 Go Usage Tracker — 2026-06-05 🟢 DONE

**Action:** Implemented Go subscription usage tracker triggered by GitHub user request. Research confirmed no OpenCode REST API for billing, so uses client-side cost estimation from token counts × model pricing. Designed UX similar to Copilot's usage indicator: status bar + Quick Pick.

**Doc:** `docs/features/03-20260605-go-usage-tracker.md`

**Root Cause:** Go subscription usage is quota-based ($12/5h, $30/week, $60/month) and users needed local visibility without leaving VS Code.

**Changes:**

| #   | Feature                 | Detail                                                                                                                      |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/goUsageTracker.ts` | New module — `GO_MODEL_PRICING` (18+ models), `estimateCost()`, time windows (5h/weekly/monthly), `globalState` persistence |
| 2   | Cost estimation         | `(billablePrompt × input + completion × output + cached × cache_read) / 1M`                                                 |
| 3   | Status bar              | `Go: XX%·XX%·XX%` format with >80% warning threshold                                                                        |
| 4   | Quick Pick panel        | Click status bar → detailed breakdown with progress bars, today/yesterday history                                           |
| 5   | `extension.ts`          | `onTransportSummary` callback gates on Go vendor, records usage per request                                                 |
| 6   | Persistence             | `globalState` key `opencodego.usageLog.v1`, max 2000 entries, 31-day retention                                              |

**Result:** ✅ Users can monitor Go subscription pressure from VS Code status bar. Follow-up: status bar did not update after testing → see debug logging issue.

---

---

## ✅ Qwen Routing & Anthropic Tool-Call Streaming Fix — Sessions 2026-06-04/05 🟢 DONE

**Action:** Fixed Qwen models not calling VS Code tools, responding with short answers, and context window indicator stuck at 0%. Two-release fix: v0.1.9 (incorrect routing change → 401 regression) then v0.1.10 (correct Anthropic parser rewrite).

**Doc:** `docs/issues/12-20260604-qwen-routing-anthropic-tool-call-fix.md`

**Root Cause:** `AnthropicResponseExtractor.extractStreamParts()` only handled flat delta shapes (`delta.type === "tool_use"`) and missed the full Anthropic SSE event lifecycle (`content_block_start`, `content_block_delta` with `input_json_delta`, `message_delta`, `message_stop`). Tool calls were silently dropped. Usage metadata (`input_tokens`/`output_tokens`) was not parsed, keeping context window at 0%.

**Changes:**

| #   | Fix                                  | Files                          | Impact                                                                                                                                                                                  |
| --- | ------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Restore Qwen routing to `/messages`  | `src/routing.ts`               | v0.1.9 incorrectly removed routing; v0.1.10 restored it (OpenCode Go gateway requires Qwen on Anthropic endpoint)                                                                       |
| P1  | Rewrite `AnthropicResponseExtractor` | `src/streaming.ts`             | Handles full Anthropic SSE lifecycle: `content_block_start` (tool_use id/name), `content_block_delta` (input_json_delta), `message_delta` (stop_reason + usage), `message_stop` (flush) |
| P2  | Anthropic usage fields               | `src/streaming.ts`             | Parse `input_tokens`, `output_tokens`, `cache_read_input_tokens` alongside OpenAI fields                                                                                                |
| P3  | Anthropic `stop_reason` parsing      | `src/streaming.ts`             | Extract from `message_delta` events                                                                                                                                                     |
| P4  | Qwen thinking payload bridge         | `src/extension.ts`             | `buildQwenAnthropicThinkingPayload()` translates `enable_thinking` → `{ type: "enabled"/"disabled" }` for messages endpoint                                                             |
| P5  | Version bump + CHANGELOG             | `package.json`, `CHANGELOG.md` | 0.1.8 → 0.1.9 (regression) → 0.1.10 (correct fix)                                                                                                                                       |

**Verification:**

```bash
npm run compile    # clean (both versions)
npx vsce package --no-dependencies  # 89.1 KB (v0.1.9), 91.38 KB (v0.1.10)
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension opencode-copilot-chat-0.1.10.vsix --force
```

**Result:** ✅ `qwen3.7-max` successfully reads files via tool call, returns full responses, context window indicator updates.

---

---

## ✅ PR #7 Review, Merge, and v0.1.8 Release — Session 2026-06-04 🟢 DONE

**Action:** Full review cycle for external contributor PR — code analysis, risk assessment, approving review with feedback, merge, version bump, VSIX build, local install, amend + force push.

**Doc:** `docs/issues/11-20260604-pr7-pricing-api-review-merge-release.md`

**Root Cause:** VS Code's proposed `languageModelPricing` API was not being used; `models.dev` cost data was available but not parsed. Duplicate type definitions in `extension.ts` shadowed canonical types in `metadata.ts`, preventing cost/modality fields from flowing through.

**Changes:**

| #   | Fix                                | Files                                                          | Impact                                                                                               |
| --- | ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P0  | `languageModelPricing` API support | `src/extension.ts`, `src/vscode.proposed.chatProvider.d.ts`    | Exposes `pricing`, `inputCost`, `outputCost`, `cacheCost`, `priceCategory` on every registered model |
| P1  | Cost data from `models.dev`        | `src/metadata.ts`                                              | Parses `cost.input/output/cache_read/cache_write`, converts USD → AI Credits                         |
| P2  | 4-tier `priceCategory`             | `src/extension.ts`                                             | 3:1 weighted input:output formula: `low`/`medium`/`high`/`very_high`                                 |
| P3  | Modality detection                 | `src/metadata.ts`, `src/extension.ts`                          | `supportsAudio/Video/Pdf` from `modalities.input` array, shown in picker tooltips                    |
| P4  | Type consolidation                 | `src/extension.ts`                                             | Import from `metadata.ts` instead of local duplicates — fixes shadowing bug                          |
| P5  | Cache key bump `v3` → `v4`         | `src/metadata.ts`                                              | Forces re-fetch of `models.dev` snapshot with cost data                                              |
| P6  | `toolCalling` fix                  | `src/extension.ts`                                             | `128` → `true` (correct `boolean` type)                                                              |
| P7  | Remove experimental config         | `package.json`, `src/extension.ts`, `src/contextWindowHook.ts` | `experimentalContextIndicator` no longer needed — native after `ca8bbb6`                             |

**Verification:**

```bash
npm run compile    # clean
npm run package    # 91.18 KB VSIX
gh pr review 7 --approve
gh pr merge 7 --merge
git pull origin main
git commit --amend --no-edit
git push --force-with-lease origin main
```

**Result:** ✅ PR #7 merged, v0.1.8 built and installed locally, release commit pushed to `main`. VS Code model picker now displays real cost metadata.

---

---

## ✅ v0.1.7 Transport Diagnostics + Context Usage — 2026-05-27 🟢 DONE

**Action:** Added transport summaries, normalized usage reporting, and context-window integration.

**Doc:** `docs/issues/10-20260527-context-window-usage-pr6-integration.md`

**Root Cause:** BYOK provider telemetry was hard to inspect, and Copilot's context window could stay at 0% without provider usage metadata.

**Changes:**

| #   | Fix                        | Files                                                        | Impact                                                                                                            |
| --- | -------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| P0  | Recent transport summaries | `src/extension.ts`, `src/streaming.ts`                       | Diagnostics show endpoint, request IDs, usage, latency, errors                                                    |
| P1  | Native usage DataPart      | `src/chatParts.ts`, `src/streaming.ts`, `src/usage.ts`       | Reports prompt/output/cache usage to VS Code using MIME `usage` so the Copilot Context Window can move            |
| P2  | OpenCode usage DataPart    | `src/chatParts.ts`, `src/usage.ts`                           | Keeps PR #6 custom telemetry with MIME `application/vnd.opencode.usage+json`                                      |
| P3  | Streamed usage request     | `src/extension.ts`                                           | Adds `stream_options: { include_usage: true }` for OpenAI-compatible chat completions                             |
| P4  | Local token estimator      | `src/extension.ts`                                           | Counts chat message overhead, tool calls/results, structured data, and image/data parts                           |
| P5  | Context-window hook        | `src/contextWindowHook.ts`, `src/contextWindowHookBridge.ts` | Keeps PR #6 experimental bridge as an optional supplement when VS Code internals allow                            |
| P6  | Auth/body fixes            | `src/openCodeAuth.ts`, request builders                      | Correct headers and Anthropic body shape for `/messages`                                                          |
| P7  | Branch integration         | git                                                          | Merged PR #6 from `main` into `develop`, preserved native context usage fix, then merged `develop` back to `main` |

**Verification:**

```bash
npm test  # 12/12 pass
npm run package
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension opencode-copilot-chat-0.1.7.vsix --force
```

**Result:** ✅ Better diagnostics and more accurate context usage for supported VS Code/Copilot versions. Random user sampling confirmed the Context Window indicator moved for most tested models; remaining failures should be tracked as model-specific usage metadata gaps.

---

---

## ✅ PR #4 Review, Merge, and v0.1.6 Release — Session 2026-05-24 🟢 DONE

**Action:** Full review cycle for external contributor PR — analysis, risk assessment, feedback, verification, merge, conflict resolution, and marketplace packaging.

**Doc:** `docs/issues/09-20260524-pr4-review-merge-release.md`

**Root Cause:** PR #4 by Wallacy added native Zen GPT/Gemini/Claude routing, TTL-cached `models.dev` metadata, and request hardening. PR was branched before v0.1.5 existed, causing missing CHANGELOG entry and missing vision code fixes after merge.

**Changes:**

| #   | Fix                                  | Files                                                        | Impact                                                                         |
| --- | ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| P0  | PR review                            | PR #4                                                        | Analyzed 94KB diff, identified 4 risks, posted review feedback                 |
| P1  | Contributor updates                  | PR #4                                                        | Verified all 4 recommendations addressed (docs, timeout, modular split, tests) |
| P2  | Merge + conflict resolution          | git                                                          | Merged PR #4, resolved missing 0.1.5 via develop→main no-ff merge              |
| P3  | Modular refactoring (by contributor) | `routing.ts`, `metadata.ts`, `errors.ts`, `providerTypes.ts` | Split monolithic extension.ts into 4 focused modules                           |
| P4  | Unit tests (by contributor)          | `test/routing.test.js`                                       | 5 tests covering Responses/Google stream normalizers and routing               |
| P5  | VSIX packaging                       | `opencode-copilot-chat-0.1.6.vsix`                           | 62.41 KB, marketplace-ready                                                    |

**Verification:**

```bash
npm run compile
node --test test/routing.test.js  # 5/5 pass
npx vsce package --no-dependencies   # 62.41 KB
git push origin main --force-with-lease
git push origin develop
```

**Result:** ✅ PR #4 merged cleanly, 0.1.5 vision fixes preserved, v0.1.6 released to marketplace.

---

---

## ✅ v0.1.6 Metadata + Native Zen Routing — 2026-05-21 🟢 DONE

**Action:** Added request timeouts, sticky gateway headers, cached `models.dev` metadata, and native Zen GPT/Gemini routing.

**Root Cause:** Single-path routing and static fallback metadata were insufficient for Zen GPT, Claude, Gemini, and provider-specific model limits.

**Changes:**

| #   | Feature            | Detail                                                          |
| --- | ------------------ | --------------------------------------------------------------- |
| 1   | Request timeouts   | Total request and stream idle timeout settings                  |
| 2   | Sticky headers     | `x-opencode-session`, `x-opencode-request`, `x-opencode-client` |
| 3   | Metadata cache     | 6-hour `models.dev` snapshot in VS Code global state            |
| 4   | Zen GPT routing    | `/zen/v1/responses`                                             |
| 5   | Zen Gemini routing | Google-style streaming route                                    |

**Result:** ✅ Transport and metadata became provider-aware instead of one-size-fits-all.

---

---

## ✅ Vision Image Requests and v0.1.5 Release Consolidation — Session 2026-05-20 🟢 DONE

**Action:** Fixed image attachment handling, corrected advertised vision capabilities, consolidated validation builds into marketplace version `0.1.5`, and merged `develop` into `main`.

**Doc:** `docs/issues/08-20260520-vision-image-request-fixes.md`

**Root Cause:**

- `convertMessage()` used `String.fromCodePoint(...part.data)` to encode image bytes, which overflowed the JavaScript call stack for larger image attachments.
- After that local encoding bug was fixed, Qwen image requests reached OpenCode but could still fail with Alibaba `429 insufficient_quota` when the request forced `thinking_budget=16384` while also carrying image input.
- `VISION_CAPABLE_MODELS` included models that OpenCode metadata did not support for image attachment: `glm-5`, `glm-5.1`, MiniMax M2/M2 Free, and MiMo Pro rows with no image input modality.
- VS Code continued showing stale `Vision` badges until the extension was packaged, installed, and reloaded with a cache-busting model metadata revision.

**Changes:**

| #   | Fix                            | Files                                               | Impact                                                                                                          |
| --- | ------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| P0  | Image base64 encoding          | `src/extension.ts`                                  | Replaced spread-based byte conversion with `Buffer.from(data).toString("base64")`                               |
| P1  | Local validation package       | `package.json`, `package-lock.json`, `CHANGELOG.md` | Packaged and installed validation VSIX builds to prove the fixes were active in VS Code                         |
| P2  | Qwen image thinking mitigation | `src/extension.ts`                                  | Added `messagesHaveImages()` and omitted Qwen `thinking_budget` for image requests when Thinking mode is `auto` |
| P3  | Request diagnostics            | `src/extension.ts`                                  | Added `images=yes/no` to request logs so image payload behavior can be verified quickly                         |
| P4  | Vision capability audit        | `src/extension.ts`                                  | Kept `Vision` only for Kimi K2.5/K2.6, MiMo V2.5/Omni, Qwen3.5/3.6 Plus, and Qwen3.6 Plus Free                  |
| P5  | Metadata cache bust            | `src/extension.ts`                                  | Updated model metadata revision to `visionfix-2026-05-20-a` so VS Code refreshes stale model capabilities       |
| P6  | Release consolidation          | `package.json`, `package-lock.json`, `CHANGELOG.md` | Folded temporary validation changes back into final marketplace version `0.1.5`                                 |
| P7  | Branch integration             | git                                                 | Merged `develop` into `main` with `--no-ff` as commit `66c8f5d`                                                 |

**Verification:**

```bash
npm run compile
PATH=/opt/homebrew/opt/node/bin:$PATH npm run package
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension opencode-copilot-chat-0.1.7.vsix --force
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --list-extensions --show-versions | rg 'ltmoerdani\\.opencode-copilot-chat'
rg -n "\"version\": \"0.1.5\"|visionfix-2026-05-20-a|const VISION_CAPABLE_MODELS|dataPartToBase64|messagesHaveImages|thinking_budget" package.json package-lock.json src/extension.ts out/extension.js CHANGELOG.md
git checkout main
git merge --no-ff develop -m "Merge branch 'develop' into main"
```

**Result:** ✅ The local stack overflow was fixed, Qwen vision token pressure was reduced by keeping Thinking `auto` truly automatic for image requests, incorrect `Vision` badges were removed, final release metadata was consolidated to `0.1.5`, and `main` contains the no-ff merge from `develop`. Remaining `429 insufficient_quota` responses are provider/account capacity issues unless logs show the old local behavior.

---

---

## ✅ v0.1.4 Thinking + Zen Free Filtering — 2026-05-17 🟢 DONE

**Action:** Added Zen free catalog control and native thinking configuration for initial reasoning families.

**Docs:**

- `docs/features/02-20260517-per-model-thinking-controls.md`
- `docs/issues/04-20260517-pr1-freeonly-review-merge.md`
- `docs/issues/06-20260517-thinking-native-submenu-investigation.md`
- `docs/issues/07-20260517-zen-model-version-labels.md`

**Root Cause:** Zen should default to free models, and reasoning-capable models needed explicit controls in the model picker/request payload.

**Changes:**

| #   | Feature                | Detail                                                                                               |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `opencodego.freeOnly`  | Filters Zen to free models by default                                                                |
| 2   | Thinking controls      | DeepSeek, GLM, Kimi, Qwen initial controls                                                           |
| 3   | Zen label fixes        | Preserves numeric model versions in display names and documents the stale-VSIX packaging/cache issue |
| 4   | Native submenu warm-up | Calls `selectChatModels()` on activation so Thinking radio controls appear without diagnostics       |
| 5   | Schema sanitization    | Avoids provider 400 errors from unsupported tool schema shapes                                       |
| 6   | Qwen routing/parser    | Uses chat-completions auth path with hybrid OpenAI/Anthropic stream parsing                          |
| 7   | Unavailable filtering  | Removes stale/deprecated free models from registration                                               |

**Result:** ✅ Zen setup became safer, native Thinking controls work in the model picker, and DeepSeek/Kimi/Qwen request paths were verified for the `0.1.4` release candidate.

---

---

## ✅ Unavailable/Deprecated Model Filtering — 2026-05-16 🟢 DONE

**Action:** Documented and completed the model availability cleanup after `ring-2.6-1t-free` and `trinity-large-preview-free` started failing with provider-side 404s.

**Doc:** `docs/issues/03-20260516-unavailable-deprecated-model-filtering.md`

**Root Cause:** OpenCode `/models` can still return catalog entries that no longer have usable provider endpoints or are marked deprecated in `models.dev`. The bundled fallback list could also reintroduce stale model IDs when live discovery failed.

**Changes:**

| #   | Fix                         | Files                                                                                 | Impact                                                                                                   |
| --- | --------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P0  | Local safety filter         | `src/extension.ts`                                                                    | Hides `ring-2.6-1t`, `ring-2.6-1t-free`, and `trinity-large-preview-free` before VS Code registration    |
| P1  | Deprecated-status filtering | `src/extension.ts`, `src/metadata.ts`                                                 | Uses resolved `models.dev` metadata so deprecated Zen models do not appear in the picker                 |
| P2  | Fallback cleanup            | `src/extension.ts`, `README.md`                                                       | Prevents offline fallback from reviving known-broken model IDs                                           |
| P3  | Error clarity               | `src/extension.ts`, `src/streaming.ts`                                                | Keeps provider failure text tied to the active provider instead of implying all failures are OpenCode Go |
| P4  | Session documentation       | `docs/issues/03-20260516-unavailable-deprecated-model-filtering.md`, `docs/devlog.md` | Records the full investigation, root cause, and verification with the correct backdate                   |

**Verification:**

```bash
npm run compile
```

**Result:** ✅ Stale unavailable/deprecated models are filtered before registration, and the extension compiles cleanly.

---

---

## ✅ v0.1.3 Context Size Correction — 2026-05-16 🟢 DONE

**Action:** Fixed context-size display mismatch and split model limits per provider.

**Doc:** `docs/issues/02-20260516-context-size-correction.md`

**Root Cause:** Earlier metadata inflated context by adding output limit on top of context window, causing the picker to show confusing values such as `2M`.

**Changes:**

| #   | Fix                                                                  | Impact                                                            |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Removed inflated `advertisedContextWindow` formula                   | Language Models and picker context display are consistent         |
| 2   | Ported limits from `models.dev`                                      | Corrects Go and Zen context/output values                         |
| 3   | Split limits by provider                                             | Prevents Go/Zen models with same ID from contaminating each other |
| 4   | Cache-busted VS Code picker metadata                                 | Forces stale model metadata to refresh                            |
| 5   | `CAPACITY_LIMITED_MODEL_NOTES` renamed from `DEPRECATED_MODEL_NOTES` | `qwen3.6-plus-free` re-enabled by OpenCode team, not deprecated   |

**Result:** ✅ Context size display matches the resolved provider metadata.

**Documentation (backdated session 2026-05-16, documented 2026-06-13):**

- `CHANGELOG.md` — added `[0.1.3]` entry with all fixes
- `README.md` — split bundled model limits into Go and Zen tables, corrected all values from `models.dev`, updated advertisedContextWindow description

---

---

## ✅ Provider Architecture — Session 2026-05-14 🟢 DONE

**Action:** Reconstruct historical OpenCode Go/Zen provider architecture from changelog, source files, and current implementation so maintainers have one self-contained architecture reference.

**Doc:** `docs/architecture/01-20260514-open-code-provider-architecture.md`

**Root Cause:** Earlier documentation was created as if the architecture was authored on 2026-06-12. The actual provider architecture started on 2026-05-14 with `v0.1.0`–`v0.1.2`, then evolved through routing, metadata, usage, pricing, and thinking releases.

**Backdate Decision:**

| Field            | Value                                             |
| ---------------- | ------------------------------------------------- |
| File date        | `20260514`                                        |
| Original Session | `2026-05-14`                                      |
| Documented       | `2026-06-12`                                      |
| Status           | ✅ Solved (living reference, verified 2026-06-13) |

**Coverage Added:**

| #   | Area                  | Detail                                                                                   |
| --- | --------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Provider registration | `opencodego` + `opencodezen` registered through VS Code Language Model Chat Provider API |
| 2   | BYOK flow             | Native Language Models group-name + provider `apiKey` secret configuration               |
| 3   | Model discovery       | OpenCode `/models`, `models.dev`, cached metadata, bundled fallback                      |
| 4   | Zen filtering         | `opencodego.freeOnly`, `*-free`, `big-pickle`, unavailable model filtering               |
| 5   | Routing               | chat-completions, messages, responses, Gemini transport selection                        |
| 6   | Tool calling          | OpenAI tool calls, Anthropic tool_use, Responses function calls, Gemini function calls   |
| 7   | Thinking              | DeepSeek, GLM, Kimi, MiniMax, Mimo, Qwen, dynamic `models.dev` reasoning options         |
| 8   | Usage/context         | status bar usage, Go usage tracker, DataPart usage, context-window hook                  |
| 9   | Diagnostics           | Go diagnostics, Zen diagnostics, model picker diagnostics                                |
| 10  | Security              | no real keys in docs, SecretStorage/provider secret only                                 |

**Verification:**

```bash
rg -n "registerLanguageModelChatProvider|GO_VENDOR|ZEN_VENDOR" src package.json
rg -n "resolveModelRouting|responses|messages|google|chat-completions" src
rg -n "freeOnly|models.dev|MODEL_METADATA_CACHE" src package.json README.md
rg -n "contextWindowHook|LanguageModelDataPart|usage" src README.md
rg -n "sk-[A-Za-z0-9]|apiKey.*[A-Za-z0-9]{20,}|Authorization: Bearer [A-Za-z0-9]" docs/architecture docs/devlog.md
```

**Result:** ✅ Architecture document is backdated, self-contained, and contains no real secrets.

---

---

## ✅ v0.1.0–v0.1.2 Initial Provider Build — 2026-05-14 🟢 DONE

**Action:** Built the initial OpenCode Go provider and then split OpenCode Zen into its own native BYOK provider.

**Changes:**

| Version | Scope               | Result                                                                                                               |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0.1.0   | Initial Go provider | Live Go model list, bundled fallback metadata, endpoint routing, tool calling, diagnostics                           |
| 0.1.1   | Native BYOK flow    | VS Code provider `configuration.apiKey` secret flow                                                                  |
| 0.1.2   | Zen provider        | Separate `opencodezen`, Zen API key flow, free model list, key cache, tool-call streaming, DeepSeek reasoning replay |

**Result:** ✅ Both OpenCode Go and OpenCode Zen can be configured separately and used from GitHub Copilot Chat.

---

## 🔥 Active Tasks

### IMPL-01 Agents Window Model Visibility

**Status:** 🟡 Not Started
**Priority:** P2 | **Est. remaining:** ~2–3 hours
**Started:** —
**Last touched:** 2026-06-13 (research complete)
**Next Action:** → Implement Option A: duplicate model registration with `targetChatSessionType: 'copilotcli'` in `provideLanguageModelChatInformation()` so OpenCode models appear in VS Code Agents window.
**Blocked by:** User confirmation of approach
**Doc:** `docs/references/01-20260611-agents-window-model-visibility.md` (reference complete, implementation pending)
**GitHub:** Issue #11

---

## 📋 Completed History

| Date       | Version                 | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-13 | docs                    | Deep audit — all 4 🟢 Active docs verified against codebase + git history + CHANGELOG. All marked ✅ Solved: issue #19 (PR #15 merged), references #01 (research complete), architecture #01 (living ref complete), issue #01 (all code fixed v0.1.9/v0.1.10, remaining tool-call loop is model behavior not code bug). 0 Active docs remain.                                                                                                                                                                                         |
| 2026-06-13 | docs                    | Rewrote devlog into work-context format and flagged unrelated `WORK-CONTEXT.md` content                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-06-13 | docs                    | Backdated and consolidated the 2026-05-15 Qwen 3.6 Plus Free tool-call loop investigation                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-06-12 | docs                    | Added provider architecture reference for Go/Zen BYOK setup and later routing/metadata/usage evolution                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-06-12 | v0.2.7                  | Temperature support fix, Kimi thinking format correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-06-11 | research                | Agents window model visibility — GitHub Issue #11 deep-dive. Investigated VS Code source (`targetChatSessionType`, `chatSessions`, `chatSessionsProvider` proposed API). Concluded Option A (duplicate models with `targetChatSessionType: 'copilotcli'`) is only marketplace-compatible path. Custom "OpenCode" tab blocked by `vsce` proposed API policy. Doc: `docs/references/01-20260611-agents-window-model-visibility.md`                                                                                                      |
| 2026-06-10 | v0.2.6                  | Removed message trimming + gzip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-06-10 | v0.2.5                  | Removed gzip HTTP 500 path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-06-10 | v0.2.4                  | Context size selector, dynamic reasoning, thinking controls, strip think tags                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-06-09 | cleanup                 | Project cleanup — full codebase review (20+ improvements across 5 categories), fixed 4 immediate bugs: redundant activationEvents, stale user-agent version, duplicate CHANGELOG, .vsix gitignore. Doc: `docs/issues/18-20260609-project-cleanup-immediate-bugfixes.md`                                                                                                                                                                                                                                                               |
| 2026-06-09 | v0.2.3                  | Output channel cleanup — removed all verbose debug/informational logs from "OpenCode" channel, fixed `Buffer` TS error with `TextDecoder` Web API, refreshed extension icon (commit `c8383735`), version bumped to 0.2.3. Doc: `docs/issues/16-20260609-output-channel-cleanup-textdecoder-fix.md`                                                                                                                                                                                                                                    |
| 2026-06-08 | v0.2.2                  | Strip think tags from model output                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-06-08 | icon                    | Extension icon redesign — replaced generic `</>` bracket logo with creative OpenCode Mark design (gradients, glow, grid pattern, sparkle accents). Researched brand assets from `anomalyco/opencode` source. Doc: `docs/features/04-20260608-extension-icon-redesign.md`                                                                                                                                                                                                                                                              |
| 2026-06-06 | v0.2.1                  | Removed unused Go usage panel/command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-06-05 | usage-debug             | Go Usage Tracker status bar not updating — REST API exhaustive search (all 404), CLI dependency removal, session.percent bug fix, debug output channel, temporary v0.2.1 test VSIX. Doc: `docs/issues/14-20260605-go-usage-status-bar-not-updating.md`                                                                                                                                                                                                                                                                                |
| 2026-06-05 | v0.2.0                  | Go Usage Tracker feature implementation — GitHub user request → OpenCode pricing research → status bar + Quick Pick design → `goUsageTracker.ts` + `extension.ts` → VSIX build. Doc: `docs/features/03-20260605-go-usage-tracker.md`                                                                                                                                                                                                                                                                                                  |
| 2026-06-05 | v0.1.10                 | Qwen routing reverted to Anthropic Messages API; Anthropic SSE tool call parsing; Qwen thinking payload                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-06-04 | v0.1.8                  | PR #7 review/merge/release — languageModelPricing API, models.dev cost data, 4-tier priceCategory, modality detection, type consolidation, experimental config cleanup. Doc: `docs/issues/11-20260604-pr7-pricing-api-review-merge-release.md`                                                                                                                                                                                                                                                                                        |
| 2026-06-04 | v0.1.9                  | Qwen tool calling fixed (routed to chat-completions); context window for Qwen                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-06-04 | v0.1.8                  | languageModelPricing, modality detection, cost metadata, capabilities alignment                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-27 | v0.1.7                  | Transport diagnostics + Context Window usage integration — added native `usage` DataPart reporting, kept OpenCode custom usage telemetry, restored richer token counting, integrated PR #6, packaged and installed `0.1.7`, and merged `develop` back to `main`. Doc: `docs/issues/10-20260527-context-window-usage-pr6-integration.md`                                                                                                                                                                                               |
| 2026-05-24 | v0.1.6                  | PR #4 review/merge/release — native Zen routing, models.dev cache, modular split, 5 unit tests, vision fixes preserved, marketplace VSIX packaged. Doc: `docs/issues/09-20260524-pr4-review-merge-release.md`                                                                                                                                                                                                                                                                                                                         |
| 2026-05-21 | v0.1.6                  | models.dev metadata cache, Zen GPT/Gemini routing, timeouts                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-05-20 | v0.1.5                  | Vision image request fixes and release consolidation — replaced stack-overflow-prone image byte encoding, diagnosed provider-side Alibaba `429 insufficient_quota`, omitted Qwen `thinking_budget` for image requests when Thinking is `auto`, audited OpenCode attachment metadata, removed incorrect `Vision` capability from GLM/MiniMax/MiMo Pro rows, restored the `0.1.5` changelog entry, compiled final output, and merged `develop` into `main` with `--no-ff`. Doc: `docs/issues/08-20260520-vision-image-request-fixes.md` |
| 2026-05-17 | zen-labels              | Zen model version label fix — preserved decimal version labels such as `Claude Opus 4.6`, diagnosed stale installed VSIX artifacts, rebuilt the final `0.1.4` package, and moved `reasoningEffort` changelog wording under Added. Doc: `docs/issues/07-20260517-zen-model-version-labels.md`                                                                                                                                                                                                                                          |
| 2026-05-17 | thinking-native-submenu | Native Thinking submenu solved — confirmed VS Code configuration pipeline, found diagnostics command was warming provider metadata, added automatic provider metadata warm-up, shortened Copilot-style labels, fixed Kimi/Moonshot tool schema sanitizer, fixed Qwen chat-completions routing and hybrid stream parsing, rebuilt final `0.1.4` VSIX. Doc: `docs/issues/06-20260517-thinking-native-submenu-investigation.md`                                                                                                          |
| 2026-05-17 | thinking                | Per-model Thinking controls — documented the feature covering family defaults, `configurationSchema`, `reasoningEffort`, `modelConfiguration`, `models.dev` reasoning options, request payload mapping, and command/settings fallback. Doc: `docs/features/02-20260517-per-model-thinking-controls.md`                                                                                                                                                                                                                                |
| 2026-05-17 | PR #1                   | First community contribution merged — `opencodego.freeOnly` setting by @Wallacy. Reviewed, tested locally, merged via GitHub UI, synced `develop`. Doc: `docs/issues/04-20260517-pr1-freeonly-review-merge.md`                                                                                                                                                                                                                                                                                                                        |
| 2026-05-17 | v0.1.4                  | Zen free filtering, thinking controls, schema sanitization, unavailable filtering                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-05-16 | v0.1.3 follow-up        | Unavailable/deprecated model filtering — hid Ring and Trinity stale IDs, applied `models.dev` deprecated status filtering, and synced model docs                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-05-16 | v0.1.3                  | Context-size correction and per-provider model limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-05-15 | investigation           | Qwen 3.6 Plus Free tool-call infinite loop — root cause identified. Doc: `docs/issues/01-20260515-qwen36-tool-call-loop.md`                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-05-14 | v0.1.0–0.1.2            | Initial Go provider, native BYOK, separate Zen provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## ⚠️ Notes

- `docs/WORK-CONTEXT.md` currently contains unrelated BLAZZ project context. Treat it as a style reference only until it is replaced or removed.
- No secrets should be added to devlog, architecture docs, diagnostics, or pasted request logs.

---

_Updated automatically during development sessions._
_Paired with: `docs/devlog-guide.md`_
