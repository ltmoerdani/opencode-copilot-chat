# 🧠 OPENCODE COPILOT CHAT DEVLOG

**Branch:** `main` | **Updated:** 2026-08-23 Asia/Jakarta | **Current Phase:** PR #158–#187 merged; docs/changelog/devlog sync complete. Open: PR #161 (restore API key command).

---

## ✅ Streaming-resilience + refactor wave — 2026-08-21 → 2026-08-22

**Merged (all merge commits, no squash):**

- **PR #170** (Fahad0NP, `fix/stream-silent-stop`) — Detect truncated streams + prompt completion on `[DONE]`. `parseServerSentEvent` fires `onDone`; `isStreamTruncated` throws a clear `OpenCodeRequestError` when the stream closes with neither `[DONE]` nor `finish_reason` after content; engine aborts the controller in `finally` and flushes tool calls/reasoning on engine throw. Review fixes p2/p3 (socket abort, flush-on-throw) + unrecognized `stop_reason` treated as healthy stop. Docs 68/69/70 + CHANGELOG by contributor — complete. Merge `1886dca`.
- **PR #174** (Barragek0, `patch-1`) — Muse Spark context window 0% fix: Responses API nests usage under `response.usage` on `response.completed`; parser falls back to it + reads `input_tokens_details.cached_tokens`. Also documents Muse reasoning arriving as `encrypted_content` (thinking blocks stay empty until the gateway relays plaintext). 3 unit tests in `src/test/extractors.test.ts`. CHANGELOG `[Responses]` entry present (merge resolved to keep both entries). Merge `a1133a4`.
- **PR #173/#175** (Fahad0NP, `fix/issue-173-vision-byte-cap`) — Vision payloads no longer trigger futile history trimming: `stripImageData` in `src/provider/historyTrim.ts` replaces oversized data URLs with an `[image]` placeholder before measuring against the byte ceiling; structure overhead still counted so the estimate never under-trims. Rebasing on main folded the scaled byte-cap (`historyByteCapForBudget`) into `chatPrep`. Doc 75 + CHANGELOG by contributor. Merge `ad5e2ea`.
- **PR #176** (Fahad0NP, `refactor/split-oversized-files`) — ≤600-line policy completed: `OpenCodeProvider.ts` (1259→584) split into `chatPrep`/`modelInfo`/`modelList`/`transportLog`/`providerDialogs`/`providerUtils`; `usage/tracker.ts` → `trackerTypes`/`trackerWindows`/`trackerSummary`; goUsageTracker tests split into focused suites + shared helpers. Zero behavior change. CHANGELOG `[Internal]` entry by contributor. Merge `1c84655`.
- **PR #177/#178** (Fahad0NP, `fix/truncated-stream-resilience`) — Zero-emission truncated streams retried once (`truncated-retry`, internal flag — nothing was reported so no duplicated text); byte-only dead streams no longer succeed silently; truncation error carries `x-opencode-request` id. Doc 76 + CHANGELOG by contributor. Merge `d41e573`.
- **PR #179/#180** (Fahad0NP, `fix/stream-stall-resilience`) — Pre-content one-shot retry generalized to idle stalls (`isStreamFailureRetry`, shared retry budget with truncation retry); stall error points at `streamIdleTimeoutSeconds`. Doc 77 + CHANGELOG/devlog by contributor. Merge `a8556ba`.

**Docs sync actions (this session, 2026-08-22):** audited `git log` + `gh pr list` vs `docs/issues` + CHANGELOG + devlog after pulling `a8556ba`. Issue docs 68–70, 75–77 and all CHANGELOG entries were already complete from contributors — the only gaps were here in devlog: header phase updated (#158–#180, PR #170 no longer open), this wave section added, and 3 missing merge rows added to Completed History (PR #170, #174, #175).

**Open PRs (tracked, not actioned):** #161 (restore API key command — buhagee).

---

## ✅ Post-0.7.0 hotfix wave + docs sync — 2026-08-22 → 2026-08-23

**Merged (all merge commits, no squash):**

- **PR #185** (Barragek0, `patch-1`) — Deprecated-model gateway cross-check (#182): `models.dev` `status: deprecated` no longer hides models the gateway still serves; only hides when BOTH sources agree. Follow-up doc update notes `deepseek-v4-flash-free` is listed-but-broken upstream (not fixable extension-side); `laguna-s-2.1-free` works. New tests in `src/test/deprecatedFilter.test.ts`. Doc 78 (#182) + CHANGELOG `[Models]` entry by contributor. Merge `f0b3c04`.
- **PR #186** (Fahad090NP, `fix/stream-truncation-retry-loop`) — Bounded 3-attempt retry loop for pre-content truncation/stall (#181), shared budget across both failure modes, still gated on zero emitted parts (no content duplication). Doc `78-20260822-ox-alpha-truncation-retry.md` + CHANGELOG `[Streaming]` entry by contributor. Merge `0c936e0`.
- **PR #187** (Barragek0, `patch-2`) — Muse Spark stream completion fix: when content was already delivered, a stream ending without `[DONE]`/`finish_reason` now logs a `[warn]` and returns successfully instead of throwing the confusing "stream ended before completion" popup (a #178 regression — Muse Spark's Responses API gateway simply omits the termination signals). `extractedPartCount > 0` branch in `src/transports/engine.ts`. Doc 79 + CHANGELOG `[Streaming]` entry by contributor. Merge `b2f1084`.

**Docs sync actions (this session, 2026-08-23):** audited `git log` + `gh pr list` (only #161 open) vs `docs/issues` + CHANGELOG + devlog. All issue docs and CHANGELOG entries for #175–#187 were already complete from contributors — the only gaps were here in devlog and two PR cross-references: this wave section + 3 Completed History rows added; `Landed:` PR refs added to issue docs 78 (#182) and 79 (Muse Spark).

---

## ✅ Contributor PR wave + docs sync — 2026-08-15 → 2026-08-21

**Merged (all merge commits, no squash):**

- **PR #157** — Bug-hunt pass, 35 latent fixes (webview `esc()` crash, dead 5xx retry branch, stale-cancel error, day bucketing, profile override every ~300 ms, reasoning marker phantom tokens, debouncer race, schema/staged-lint hardening). No CHANGELOG/doc at merge → added in this sync: CHANGELOG `[Internal]` Fixed entry + `docs/issues/74-20260821-pr157-bug-hunt-pass-35-fixes.md`.

- **PR #163** — MiMo `repetition_penalty: 1.2` (third mitigation layer for #36 infinite thinking loop). CHANGELOG entry by contributor; issue doc 36 updated with follow-up section in this sync.
- **PR #164** — Force think-tag stripping when tools are present (`options.tools.length > 0`) — fixes blank code boxes during subagent runs. No CHANGELOG/doc at merge → added in this sync: CHANGELOG `[Streaming]` Fixed entry + `docs/issues/72-20260821-pr164-force-think-tag-stripping-subagents.md`.
- **PR #166 / issue #162** — GLM 5.3+ always-thinking force-on (`GlmThinking` version detection, picker hides `off`) + defensive retry strip. CHANGELOG + features/02 note by contributor; dedicated issue doc added: `docs/issues/73-20260821-issue162-glm53-always-thinking.md`.
- **PR #167/#169** — History trim to 70% context ratio + 512 KB byte cap (O(n), tool-group units) + chat-request transient `fetch failed` retry. Docs 68/69 + CHANGELOG by contributor — complete.
- **PR #168** — Muse Spark 1.2 (`muse-spark-1.2-contributor` Go + `-free` Zen): Responses API + `truncation: disabled` + 64-char tool-name mapping + `MuseThinking` strategy. CHANGELOG by contributor; feature doc added: `docs/features/18-20260821-muse-spark-1-2.md`.
- **PR #171/#172** — `patchMaxTokensCap` retry classifier (stale `deepseek-v4-flash` completion cap self-heals) + bundled fallback corrected to 131072. Doc 71 + CHANGELOG by contributor — complete.
- **PR #160** — `opencodego.thinking.openai` setting (off/low/medium/high/xhigh → `reasoning.effort`). No CHANGELOG/doc at merge → added in this sync: CHANGELOG `[Thinking]` Added entry + features/02 note.

**Docs sync actions (this session):** audited git log + PR list vs `docs/issues` + `docs/features` + CHANGELOG; created 4 new docs (issues 72, 73, 74; features 18), updated features/02 (OpenAI + Muse notes, GLM doc link), appended PR #163 follow-up to issue doc 36, added 3 missing CHANGELOG `[Unreleased]` entries (PR #157, #160, #164).

**Open PRs (tracked, not actioned):** #161 (restore API key command + route usage — buhagee), #170 (detect truncated streams / prompt `[DONE]` completion — Fahadk0NP). PR #159 (fair-use one-account-per-install) closed unmerged.

---

## ✅ PR #155 Review + Merge — God-File Split + Data-Driven Registry — 2026-08-14/15

**Action:** Independently reviewed the contributor PR (branch `refactor/split-god-files`, 87 files, +9,195/−8,009, 24 commits), then merged as a **merge commit** (not squash) — all contributor commits preserved.

**Review (2026-08-14, worktree at PR head):**

- `npm run compile` clean · `npm test` **310/310** (PR listed 305 — registry work added a few) · `npm run test-retry` 7/7 · `npx eslint src/` clean · no `any` / `TODO` in new code.
- Diffed old routing vs `core/routing.ts` + registry line-by-line: **behavior identical** (gpt→responses, claude→messages, minimax-m2 Go→messages/Zen→chat, qwen-messages, gemini Zen→google, default→chat).
- `thinkingFamily()` + payload mapping identical; SSE parser byte-identical; command registration intact except intentional `opencodego.setApiKey` removal.
- PR #152/#154 already in `main` → final diff clean.

**Review points:**

1. **API key migration gap (Zen):** legacy `Set API Key` users hold the Zen key under the shared `opencodego.apiKey`; after the per-vendor split (`opencodezen.apiKey`) Zen reads an empty slot until re-added via BYOK. **Not a merge blocker** (BYOK recovery path exists), but a one-time migration is planned **before release** — tracked as follow-up.
2. **Thinking single-config-authority is a behavior change** (drops the `globalState` shadow copy) — deserves a manual live spin before release.
3. Merge as merge commit (never squash) — executed.

**Docs (post-merge):** issue doc `docs/issues/67-20260814-pr155-split-god-files-review-merge.md` + feature doc `docs/features/17-20260814-data-driven-model-registry.md` created; issue #131 doc updated to ✅ Solved (PR #135 merged + #155 `effectiveModelId` normalization); feature doc 02 (thinking) + architecture doc 01 updated for the new structure.

**Follow-up before release:** (1) Zen API key one-time migration; (2) longer live session across several models + both vendors; (3) full suite re-run; (4) remaining architecture candidates (full `ModelTransport` port interface, usage webview HTML → own file).

---

## ✅ Architecture Map — 2026-08-15

**Action:** Created `ARCHITECTURE-MAP.md` (project root) — the navigation map for the codebase (same pattern as the blazz-next-v6 agent's `ARCHITECTURE-MAP.md`), so maintainers can locate any domain, its dependencies, and its contracts in one place.

**Follow-up (2026-08-15):** Deep-scanned every remaining module (vision proxy, usage submodules, context-window hook, thinking families, request builders, commands, autocomplete, root utils, tests/scripts/CI) and expanded the map with 5.5 Vision Proxy flow, 5.6 Context-Window Hook (monkey-patches Copilot internals), 5.7 Usage Accounting (3 sources: server meters + CLI SQLite + tracked entries, per-profile), and a new section 8 Tests/Tooling/CI (22 test files / 312 cases, scripts, ci.yml).

**Follow-up 2 (2026-08-15):** Exhaustive scan — read **100% of `src/` non-test files** (all 86 `.ts` + 2 proposed-API `.d.ts`, read in full — including the three gaps found on self-audit: `OpenCodeProvider.ts` 200–440, `dashboard.ts` webview HTML template 530–1126, `chatProvider.d.ts` 50–172) plus toolchain (`tsconfig*.json`, `eslint.config.ts`, `.husky/pre-commit`, `package.json` scripts/deps, `README`/`CONTRIBUTING`, `ci.yml`, `media/`). Map finalized with a **Toolchain** block (TS configs, ESLint stack, pre-commit gate, proposed-API `.d.ts` augmentations, single runtime dep `@silvia-odwyer/photon-node`), test-harness detail (Node `node --test`) + per-file test counts (312 cases across 22 files, verified), and removed the now-deleted `scripts/live-smoke-zen.ts`.

**What:**

- **Domain Ownership Map** — 11 domains (provider / transports / core / models / usage / thinking / request / commands / autocomplete / extension entry / root utilities) with per-folder LoC (total `src/` ≈ 14,782 lines, ~70 files) and key contracts.
- **Module Context Loading Protocol** — identify domain → load module context → check cross-module deps → shared-lib lookup.
- **Module Dependency Graph** (Mermaid) — highlights `OpenCodeProvider.ts` as the heaviest fan-in (imports 15+ modules) and the registry as single source of truth for transport + thinking family.
- **Data-Driven Model Registry** — full `MODEL_REGISTRY` table (11 family rows + catch-all) with patterns → endpointKind → thinkingFamily → vendor restriction.
- **Core Execution Flows** — activation, model discovery, chat request, streaming engine (4 Mermaid diagrams).
- **Shared Libraries & Utilities** — 16 reusable modules + when to reuse each.
- **Anti-Regression Contracts** — security (BYOK/SecretStorage only), resilience (bundled fallback never removed), new-vendor checklist, and the remaining hot spots (`usage/dashboard.ts` 1,317 · `OpenCodeProvider.ts` 1,215 · `usage/tracker.ts` 985 · `models/metadata.ts` 646 · `transports/extractors.ts` 556 · `contextWindowHook.ts` 485 · `core/routing.ts` 441).

**Verification:** LoC numbers cross-checked against `wc -l` per file; all file/folder names verified against the current `src/` tree; domain LoC sums reconcile to the 14,782 total.

---

## ✅ Data-driven model registry — 2026-08-14

**Action:** Implemented `src/core/registry.ts` — the single data-driven source of truth for per-model wiring (architecture doc 02, item 3).

**What:**

- `MODEL_REGISTRY`: family rows → `{ patterns, endpointKind, sdkPackage, thinkingFamily, vendors? }` (first match wins; vendor restrictions honored).
- `core/routing.ts` `resolveModelRouting()` now reads the registry (was an if-chain); `thinking/provider.ts` `thinkingFamily()` reads the same table vendor-agnostically (was a second hardcoded prefix table). `ModelEndpointKind` type moved to the registry, re-exported by `provider/definitions.ts`.
- Adding a model family = one row (+ optionally a thinking strategy class). Context limits/capabilities stay metadata-driven (live models.dev).
- New `src/test/registry.test.ts` (14 tests): transport routing × vendors, thinking family, lookup mechanics. Total **305 tests**.

**Verification:** compile + 305 tests + `npm run test-retry` 7/7 + lint green. CHANGELOG `[Unreleased]` + architecture doc 02 timeline updated.

---

## ✅ God-file split — usage/ + transports/ + provider/ + models/ + commands/ — 2026-08-14

**Branch:** `refactor/split-god-files` (12 commits ahead of `main`, PR pending)

**Action:** Split the three god files into domain modules per `docs/architecture/02-20260809-provider-adapter-architecture.md`, pure mechanical (cut-paste, zero behavior change). Phase-gated: each commit passes `npm run compile` + `npm test` (291) + `npm run lint`.

**What:**

1. **`src/usage/`** (from `goUsageTracker.ts` 1510 → split): `tracker.ts` (class + types + time helpers), `history.ts` (OpenCode CLI SQLite read/aggregation, pure), `pricing.ts` (bundled cost snapshot + `estimateCost`, pure), `formatting.ts` (status-bar/quick-pick), `dashboard.ts` (usage state + status bar + webview incl. the 583-line HTML template + tooltip SVG). Moved `usage.ts` / `usageProfile.ts` / `goUsageSync.ts` in.
2. **`src/transports/`** (from `streaming.ts` 1620 → split): one entry per transport (`chatCompletions` / `responses` / `anthropic` / `google`) + shared `engine` (HTTP/SSE + retry/backoff), `sse` (pure parser), `extractors` (Base/OpenAi/Anthropic), `extract` (non-stream + pure helpers), `streamParts`, `thinkTags` (pure). Contract types → `src/core/transport.ts`.
3. **`src/models/` + `src/core/`**: moved `metadata`/`modelLimits`/`modelCapabilities`/`modelNames` → `models/`, `routing.ts` → `core/routing.ts`, new `models/metadataFetcher.ts` (models.dev cache) + `models/pricing.ts`.
4. **`src/provider/`** (from `extension.ts`): `OpenCodeProvider` class (moved whole, one cohesive concern), `definitions` (PROVIDERS + model types + user-agent/transient-fetch helpers), `messages`/`tokens` (convertMessage + token estimation), `settings` (schema/getSettings/limits/capabilities/rawModelId/visionProxyEnabled), `visionProxy`.
5. **`src/commands/`**: `providers.ts`, `agentsWindow.ts`, `diagnostics.ts`, `thinkingPicker.ts` — command handlers moved out of `extension.ts`.
6. **Thin entry**: `extension.ts` is ~414 lines (was 4653) — only `activate` wiring + `deactivate`. Both compat barrels (`streaming.ts`, `goUsageTracker.ts`) deleted; all importers reference canonical paths.

**Verification:** `npm run compile` clean; `npm test` 291/291; `npm run test-retry` 7/7 (mock server); `npm run lint` fully green on Windows. CHANGELOG `[Unreleased]` updated.

**Notes:** env quirks hit during the run — user's global gitignore ignores `.vscode`, so lint-staged fails whenever `.vscode/settings.json` is staged (commit with targeted `git add`, never `git add -A`); PowerShell `WriteAllLines` writes CRLF, so always `prettier --write` after PowerShell line-range edits.

---

## ✅ Thinking refactor + per-request modules + Windows lint fixes — 2026-08-13

**Branch:** `refactor/thinking-request-modules` (6 commits ahead of `main`, PR drafted)

**Action:** Refactored the thinking/reasoning system and split the monolithic `extension.ts` request path, per user request to align with VS Code extension standards.

**What:**

1. **Per-provider Thinking strategies** (`src/thinking/`, commit `400861c`). One strategy class per model family (`deepseek` / `glm` / `kimi` / `minimax` / `openai` / `qwen` / `mimo` / `fallback`) behind a shared interface + factory. Each owns its picker schema, request-payload mapping, and `treatReasoningAsContent`. Pure modules (no `vscode` import) keep unit-testability in plain Node.
2. **Single config authority** (`resolve.ts`). VS Code per-model configuration wins (as VS Code itself designs), then workspace settings, then per-family defaults. Removed the `globalState` shadow copy of thinking overrides — root cause of (a) "Max" being treated as "Off" (fp-suffixed model IDs never matched the per-model config group) and (b) "Off" being silently overridden by a shadow "max". Model IDs normalized to `effectiveModelId` (no `::sk-***` fp suffix), which also stops the per-model settings group from being recreated on every pick (related to #131 / PR #135).
3. **CoT leak fix.** `treatReasoningAsContent` now comes from the provider strategy — always `false` for DeepSeek and Mimo — so native-reasoning models keep chain-of-thought in the thinking panel instead of echoing it into the chat transcript. Upstream gateway bug (#37635) deliberately not worked around for Mimo (user decision).
4. **Request module split** (commits `ad1df51` + `e63b757`). Body builders + message/tool conversions moved out of `extension.ts` (~640 lines) into `src/request/{types,schema,shared,openai,anthropic,google}.ts`.
5. **Windows fixes** (commits `679a851`, `21e8393`, `ec5b27f`). `staged-lint.ts` and `lint.ts` run npm `.cmd` shims through the shell (fixes ENOENT on Windows); `isCwdInWorkspace` matches both path separators; new `.gitattributes` enforces LF normalization so prettier + shellcheck pass on Windows.

**Verification:** `npm run compile` clean; `npm test` **290/290**; `npm run lint` fully green on Windows (was silently ENOENT-failing before); `npm run package` produced `opencode-copilot-chat-0.6.0.vsix`.

**Docs:** CHANGELOG `[Unreleased]` updated. Live testing with a real API key not done; `npm run test-retry` (mock server) is available.

---

## 📝 Docs — Usage Dashboard living reference + PR #138 documentation complete — 2026-08-13

**Action:** Completed the post-merge documentation for PR #138 (merged `616d6f6`). Most was already in place from the author; filled the remaining gaps.

**What:**

- **New** `docs/features/16-20260813-usage-dashboard-realtime.md` — living reference for the usage dashboard feature as of #138: data sources & flow (CLI history via `node:sqlite`/`sqlite3`, server meters, extension entries), Today/Yesterday/Codebase rows, permanent tracking, realtime loop, compact K/M/B/T formatting, full-page webview panel (rings, Spend/Requests/Tokens/Models/Suggested/Approved tabs), all 7 usage settings, known limitation (completion cost attribution).
- **Updated** `docs/features/05-20260613-usage-webview-panel.md` — marked ⚠️ Deprecated, superseded by doc 16 (kept as historical design context).
- **Updated** `docs/features/03-20260605-go-usage-tracker.md` — added a PR #138 evolution note pointing to doc 16.
- **Updated** CHANGELOG `[Unreleased]` — added `docs/issues/66-...` + `docs/features/16-...` references to the central-config and full-page panel entries (consistency with other PR entries).
- Issue doc `66-...` and tracker `63-...` were already Solved by the author; the merge devlog entry was already present.

**Verification:** `markdownlint-cli2 --config .markdownlint-cli2.json` = **0 issues** across all four created/edited files.

---

## ✅ PR #136 + PR #138 Merge — Inline Code Suggestions (#49) + Central Config / Utils / Usage Dashboard — 2026-08-13

**Action:** Merged [@Fahad090NP](https://github.com/Fahad090NP)'s stacked PR pair: #136 (`feat/inline-completions`, merge commit `7df19f4`) then #138 (`refactor/central-config-utils`, merge commit `616d6f6`). Both merge commits — contributor history preserved.

**What (#136, +957/−9, 19 files):** experimental **inline code suggestions** (ghost text) closing #49. OpenCode exposes no FIM endpoint, so completions emulate fill-in-the-middle with FIM tokens over `/chat/completions`. Engine chosen from live probe, not assumption: `qwen3.5-plus` with `enable_thinking=false` (~1.5s TTFB, zero hidden reasoning); `deepseek-v4-flash` rejected (burns 128 reasoning chars even "off"). New `src/autocomplete/` module (context, prompt, throttle, engine, provider, index, types) + `usage.ts`, 15 unit tests, `scripts/probe-completion-latency.ts`. Opt-in `opencodego.inlineSuggestions` (default `false`), model dropdown default `qwen3.5-plus`, five tuning knobs (debounce 300ms / timeout 3s / max tokens 128 / prefix 10 lines / suffix 300 chars), strict cancellation (latest keystroke aborts in-flight request). `.vscodeignore` fixed so `out/autocomplete/` ships in the VSIX.

**Review cycle:** maintainer review (08:16) raised 5 points + small stuff; Fahad answered all in #138 (08:18 "let me do some more changes", then 11:37/11:51): key fallback (profile→secret), failure logging to the OpenCode Completions channel, live debounce resync, indentation preservation in `cleanCompletion`, `qwen3.7-plus` added to bundled fallback. Point 3 (cost attribution into `tracker.record()`) documented as a follow-up; Suggested/Approved per-day counters ship instead.

**What (#138, +4335/−1051, 46 files, 44 commits):** three intentional halves stacked on #136: (1) central `src/config.ts` + shared `src/utils.ts` + `BaseResponseExtractor` (behavior-preserving); (2) ten verified production bugs fixed (#139–#148 — kimi-k2.7-code cold-start 400, audio/PDF vision false-positive, `freeOnly` bypass, Kimi/MiniMax CoT leak, baseline inflation, `node:sqlite` reads, string-setting 400s, 26h→1d 2h, DOMException guard, etc.); (3) full usage dashboard — Today/Yesterday/Codebase rows merging CLI history, permanent tracking, realtime loop, compact K/M/B/T formatting, panel with rings/charts/Models/Suggested/Approved tabs, 7 new settings. Review scope question answered: dashboard was intentional (depends on the refactor); `freeOnly` on metadata-success path + HTML-escaping of model names fixed.

**Verification:** 207 tests at #136 merge base → **276 after #138**; strict lint + tsc + prettier + markdownlint green; VSIX packages and installs cleanly (author + maintainer independently).

**Docs:** `docs/features/15-20260813-inline-code-suggestions.md` (new), `docs/issues/66-20260813-pr138-central-config-utils-usage-dashboard.md` (new), tracker `63-...` marked solved. CHANGELOG `[Unreleased]` already updated by the PR author (autocomplete + config/utils + usage dashboard + all bug fixes).

---

## ✅ Issue #23 — Full lifecycle documented + upstream reply + tracking issue #130 — 2026-08-13

**Action:** Completed the documentation arc for issue #23 (Go usage status drift), which began with a new comment on the issue from @mderazon on 2026-08-12 pointing at the merged upstream endpoint PR.

**What:**

1. **Upstream reply (2026-08-12):** Posted a reply on [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23) acknowledging the official `GET /zen/go/v1/usage` endpoint (anomalyco/opencode#16513, merged to `dev` 2026-08-11/12, live) and noting it needs a production check before building on it.
2. **Tracking issue [#130](https://github.com/ltmoerdani/opencode-copilot-chat/issues/130):** Opened "[FEATURE] Sync Go usage from official /zen/go/v1/usage endpoint" with the proposed sync-layer design. Closed 2026-08-12T22:51:07Z when PR #132 (by @Fahad090NP) merged the implementation.
3. **Documentation updates (2026-08-13):**
   - **New** `docs/issues/65-20260813-issue23-go-usage-status-sync.md` — consolidated timeline of the full #23 arc (Jun 12 report → no-public-API diagnosis → PR #50 manual targets → PR #60 SQLite → upstream endpoint → PR #132), endpoint contract, final data flow, lessons.
   - **Updated** `docs/issues/13-20260605-go-usage-status-bar-not-updating.md` — marked its "no public REST API" conclusion **superseded** (endpoint now live), refreshed Lessons Learned + Remaining Work.
   - **Updated** `docs/features/03-20260605-go-usage-tracker.md` — corrected the Overview (no longer "no REST API exists") and added a Server-Accurate Go Usage (PR #132) section.
   - CHANGELOG `[Unreleased]` + architecture timeline + doc 62 already covered PR #132; no changes needed there.

**Verification:** `markdownlint-cli2` 0 issues on all three edited files.

**Docs:** `docs/issues/65-20260813-issue23-go-usage-status-sync.md` (new), `docs/issues/13-...` + `docs/features/03-...` (updated).

---

## 🟢 Issue #131 — Duplicate models after per-model config (reasoningEffort) — root cause confirmed, PR #135 open — 2026-08-13

**Action:** Investigated and confirmed the root cause of the per-model config duplicate-model bug, posted issue [#131](https://github.com/ltmoerdani/opencode-copilot-chat/issues/131) (2026-08-12), and [@Fahad090NP](https://github.com/Fahad090NP) opened fix PR [#135](https://github.com/ltmoerdani/opencode-copilot-chat/pull/135) (open as of 2026-08-13).

**What:**

1. Reporter @xianhongtao gave full diagnostics (extension 0.5.2, VS Code 1.132.1 System setup): `chatLanguageModels.json` holds settings-only groups for `opencodego` / `opencodezen` (no apiKey), and the repro counts move 7 → 14 → 7 → 14 depending on whether a per-model config group exists.
2. Root cause confirmed against VS Code source (`languageModels.ts`): a settings-only group resolves to `configuration: {}`; the #106 fix only silences the groupless call when an apiKey-bearing group call was observed, so the SecretStorage fallback ran on both calls and served every model twice.
3. Fix in PR #135 (`src/extension.ts`, +19/−1): a group call whose `configuration` is present but carries no API key returns `[]` (per-model config group); the groupless call stays the single source. Per-model settings still apply at request time via `modelConfiguration`.

**Docs:** `docs/issues/64-20260813-issue131-permodel-config-duplicate-models.md` (new). Open-PR tracker `63-...`, architecture, and CHANGELOG `[Unreleased]` updated.

---

## ✅ PR #129 Merge — Strict-but-Sane Lint Stack + Intelligent Pre-Commit Gate — 2026-08-12

**Action:** Merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #129 (`chore/strict-lint`, +3450/−944, 90 files). Merge commit `a960694`, 2026-08-12T07:17:41Z.

**What:**

1. **ESLint strict-but-sane.** Keeps `strict` + `strictTypeChecked` (the bug-catchers: `no-unsafe-*`, `no-unnecessary-condition`, `no-floating-promises`), drops the pure-`stylistic` layer that fought prettier. `restrict-template-expressions` allows numbers/booleans; `no-floating-promises` off for `*.test.*`.
2. **`npm run lint` now runs tests.** Ends with a Tests step (compile + unit tests), making it the single "is everything green" command. 7 steps: Editorconfig, ESLint, Markdown, Prettier, Shell, TypeScript, Tests.
3. **Intelligent pre-commit gate.** New `scripts/staged-lint.ts` (`npm run lint:staged`) lints staged files **plus their direct import dependents** (resolved from the real import graph) so changing a module can never leave type-aware errors in its consumers. Measured: config-only commit ≈1s, `src/` commit ≈10s. Full-tree lint stays in CI.
4. **Branch also carries:** unified `lint.ts`/`format.ts` runners (picocolors), `editorconfig-checker` + `shellcheck` + `tsconfig.check.json` type-check (covers `scripts/`), script renames (`*.mjs`/`*.mts` → `*.ts`), eslint 10.8.1, `@types/node` 26.2 (supersedes dependabot #91), husky PATH fixes.
5. **Post-review refinements (final 5 commits, 20 total).** Maintainer review surfaced 3 points + 2 config-consistency items, all addressed before merge: dropped all 217 `void describe/it/test` prefixes from 15 test files (`22e04b7`); allowed `@ts-expect-error` for proposed-API workarounds while keeping `@ts-ignore` banned (`5246434`); moved to TypeScript-first config `eslint.config.ts` + typed `.ts` scripts via `tsx` (`76570cc`); standard extensions only, zero `.mjs`/`.mts` (`514a63f`); markdownlint config renamed to `.json` (`c817871`).

**Maintainer verification (2026-08-13):** independently re-ran `npm ci && npm run lint` on the final 20-commit head (all 7 steps green), measured the staged gate (~0.6s docs-only, ~8.3s `src/`), confirmed `void describe/it/test` = 0, `@ts-expect-error` allowed, zero `.mjs`/`.mts` in repo.

**Supersedes:** dependabot #91 (`@types/node` 26.1.0 → 26.1.2) — this branch bumps to 26.2, so #91 is effectively moot and can be closed.

**Docs:** `docs/issues/61-20260812-pr129-strict-lint-stack-precommit-gate.md`. Architecture timeline + CHANGELOG `[Unreleased] ### Changed` updated.

---

## ✅ PR #132 Merge — Server-Accurate Go Usage via `/zen/go/v1/usage` (#130) — 2026-08-12

**Action:** Merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #132 (`feat/issue-130-go-usage-sync`, +607/−120, 8 files). Merge commit `4a14b1e`, 2026-08-12T22:51:06Z.

**What:** Replaces locally estimated Go usage meters with server-accurate meters from the official `/zen/go/v1/usage` endpoint. The status bar / tooltip / quick-pick / webview previously drifted from opencode.ai because CLI, cross-device, and pre-install usage were invisible (issue #23). New pure module `src/goUsageSync.ts` (`fetchGoUsage` + `mergeServerUsage` + failure classifier) syncs the server meters with a 60s TTL; `spent` is derived from the authoritative percent, Today/Yesterday + per-session spend stay device-local. Failures fall back to the existing SQLite → tracked estimates. The key is only ever sent as the Authorization header and never logged or persisted.

**Dialog fixes found along the way:** dead "Reset tracked usage data" action wired up; reset no longer collapses the card into the first-run state (new `everTracked` flag); dead "Open OpenCode console" quick-pick wired up; usage panel + hover card given stable geometry (fixed width/columns, no layout jumps).

**Type-safety:** resolved always-true/false TS hints flagged by the new strict lint stack (#129) — redundant cancellation guards, dead `if (tracker)`, and `GO_MODEL_PRICING` + metadata `providers` map typed as `Partial` at runtime.

**Verification:** endpoint verified live in production (401 shape matches upstream route source; upstream `anomalyco/opencode#16513` merged); `npm run lint` all 7 steps green; `npm test` 189/189 (incl. the post-review `hasData` regression test).

**Docs:** `docs/issues/62-20260812-pr132-go-usage-server-sync.md`. Architecture timeline + CHANGELOG `[Unreleased] ### Added` doc reference added.

---

## ✅ PRs #133/#135/#136/#138 — All Merged (2026-08-13)

**Status:** The three PRs tracked below were all merged on 2026-08-13 (merge commits `4a78f6b`, `8eca1f2`, `7df19f4`, `616d6f6`), followed by the stacked #138. Full details: tracker `docs/issues/63-20260813-open-prs-133-135-136-tracker.md`, feature doc `docs/features/15-20260813-inline-code-suggestions.md`, issue doc `docs/issues/66-20260813-pr138-central-config-utils-usage-dashboard.md`.

| PR                                                                   | Merged (commit) | Summary                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#133](https://github.com/ltmoerdani/opencode-copilot-chat/pull/133) | `4a78f6b`       | DeepSeek 400 recurs when thinking is OFF (Go gateway wraps reasoning as visible text, no thinking part to echo). Fix: internal `application/vnd.opencode.reasoning+json` marker part in transcript. Closes #134. |
| [#135](https://github.com/ltmoerdani/opencode-copilot-chat/pull/135) | `8eca1f2`       | Duplicate models after per-model config (#131). Settings-only group returns `[]` so groupless call serves models. +19/−1.                                                                                        |
| [#136](https://github.com/ltmoerdani/opencode-copilot-chat/pull/136) | `7df19f4`       | Inline completions / autocomplete (#49). Ghost-text via `qwen3.5-plus` with `enable_thinking:false` (~1.5s TTFB). Experimental, opt-in.                                                                          |
| [#138](https://github.com/ltmoerdani/opencode-copilot-chat/pull/138) | `616d6f6`       | Central config + shared utils + usage dashboard + bug fixes #139–#148. Stacked on #136; carries the #136 review fixes.                                                                                           |

---

## 📝 README Model Data Refresh — Internet Research (opencode.ai docs + live endpoints + models.dev) — 2026-08-12

**Action:** Re-verified all OpenCode Go/Zen model data in `README.md` against **live sources** (docs updated today, Aug 12 2026): official `opencode.ai/docs/go` + `docs/zen`, live `/zen/go/v1/models` (25) + `/zen/v1/models` (60), and `models.dev/api.json` (limits/pricing/status). Docs-only; prettier + markdownlint pass.

**Key findings that changed the README:**

1. **Go catalog** — now the curated live set: added `grok-4.5`, `glm-5.2`, `kimi-k3`, `qwen3.8-max`, `qwen3.7-plus`, `hy3`; **removed** models no longer served/legacy: `ring-2.6-1t` (KNOWN_UNAVAILABLE), `minimax-m2.1`/`minimax-m2`, and deprecated ones (`glm-5`, `kimi-k2.5`, `minimax-m2.5`, `mimo-v2-pro`, `mimo-v2-omni`, `qwen3.5-plus` — status `deprecated` in models.dev, filtered by `shouldHideDeprecatedModel`).
2. **Zen free models** — now the **8 real rotating free models**: `big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `hy3-free`, `laguna-s-2.1-free`, `ling-3.0-tiny-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`. Docs say **all free models (incl. Big Pickle) are limited-time** — softened the "always free" claim. Dropped `minimax-m2.5-free`/`nemotron-3-super-free`/`qwen3.6-plus-free`/`trinity-large-preview-free`/`north-mini-code-free` (all deprecated per models.dev).
3. **Zen paid table** — refreshed with current models + **official pricing** (per 1M tokens): added `claude-fable-5` ($10/$50), `claude-opus-5`/`claude-opus-4-8`, `claude-sonnet-5`, `gpt-5.6-sol/terra/luna`, `gpt-5.4-nano`, `gemini-3.6-flash`/`3.5-flash-lite`, `grok-4.5`, `glm-5.2`, `kimi-k3`, `minimax-m3`; corrected `gpt-5.5-pro`/`gpt-5.4-pro` ($30/$180) and Zen DeepSeek pricing.
4. **Go usage** — confirmed official limits (5h/$12, weekly/$30, monthly/$60) + added the ~$15/mo vs ~$60/mo per-model usage tier note (per docs "6x multiplier").
5. **Prose** — banner, elevator pitch, features table, quick start, compare table, FAQ updated to current model names; "2-5 rotating free models" → "rotating free models".

**Data sources (verified live, 2026-08-12):** `https://opencode.ai/zen/go/v1/models`, `https://opencode.ai/zen/v1/models`, `https://models.dev/api.json` (providers `opencode-go`/`opencode`), `https://opencode.ai/docs/go` + `docs/zen`.

**Verification:** `npx prettier --write README.md` ✅ · `npm run lint:md` 0 issues ✅ · diff reviewed (Go 19 models live, Zen free 8, Zen paid refreshed). Not committed — awaiting user approval.

**Follow-up (Star History note):** GitHub [restricted the stargazers endpoint](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/) (June 30, 2026) to repo admins/collaborators, so the embedded star-history.com chart only renders after the viewer adds a GitHub Access Token. Added an explanatory note under the Star History section with token guidance (fine-grained: Metadata Read-only + Contents Read/Write; or classic `public_repo`). Verified against the official GitHub changelog.

---

## 📝 README Sync — Align with Current State (CHANGELOG as reference) — 2026-08-12

**Action:** Updated `README.md` to match the current feature set (v0.5.2), using `CHANGELOG.md` history as the primary reference. Docs-only change — no code touched. Verified with prettier + markdownlint.

**What changed (evidence-based from CHANGELOG + `package.json` + `src/metadata.ts`):**

1. **Features table** — vision proxy row now mentions the per-image description cache (PR #120); new **Provider on/off** row for remove/re-add from Language Models (0.5.2).
2. **Go model table** — added `gpt-5.6-luna` (🛣️ `/responses`), `qwen3.6-plus`/`qwen3.5-plus`, `mimo-v2-omni`, `kimi-k2.7-code`, synced to `MODEL_LIMITS_BY_PROVIDER[GO_VENDOR]` in `src/metadata.ts` (was missing from README).
3. **Zen free table** — synced to bundled fallback catalog: dropped `mimo-v2.5-free`/`north-mini-code-free`, added `minimax-m2.5-free`, `qwen3.6-plus-free`, `trinity-large-preview-free`.
4. **GLM thinking enum** — corrected `on/off` → `off/high/max` in both the Thinking table and settings table (matches `package.json` + the 0.3.5 fix).
5. **Settings table** — added `opencodego.enabled` / `opencodezen.enabled` (0.5.2 remove-provider settings).
6. **Commands table** — added `Remove/Re-add Provider in Language Models` (Go + Zen), `Configure Vision Proxy`, `Set Usage Targets…`, `Show Usage Quick Pick`, `Rename Active Profile`, `Delete Profile`. Fixed "Delete Active Profile" → "Delete Profile" in the Multiple Go accounts section (actual command title).
7. **Smart Routing** — added transient 5xx retry bullet (PR #107).
8. **FAQ (Agents window)** — now documents the auto-enable of `chat.agentHost.byokModels.enabled` + `extensions.supportAgentsWindow` (PR #125/#122) instead of a manual `settings.json` step.
9. **Roadmap** — marked done: Demo GIF, Marketplace publish, Usage panel (status bar + webview).

**Verification:** `npx prettier --write README.md` ✅ · `npm run lint:md` 0 issues ✅ · `git diff` reviewed (45 insertions / 35 deletions) ✅. Not committed — awaiting user approval.

---

## ✅ PR #126 Merge — Reasoning History `typeof` Guard + Unit Tests (Follow-up on #123) — 2026-08-11

**Action:** Merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #126 (`fix/reasoning-history-guard-tests`, +151/−51). Merge commit `7be0c06`, 2026-08-11.

**What:** Addresses the two non-blocking review notes left on the merged PR #123 (DeepSeek V4 multi-turn `reasoning_content` echo fix):

1. **`typeof` guard.** `thinkingPartText()` in `src/extension.ts` used `part instanceof vscode.LanguageModelThinkingPart` without the `typeof ... === 'function'` guard that `src/streaming.ts` already uses for the same proposed API. Guard now in place, mirroring the `streaming.ts` pattern and the contract in `src/vscode.proposed.languageModelThinkingPart.d.ts`.
2. **Unit tests for pure reasoning helpers.** `shouldEchoThinkingHistory()` and the value-normalization logic were inline in `extension.ts` with no tests. Extracted into new pure module `src/reasoningHistory.ts` (`thinkingTextFromValue()` + `shouldEchoThinkingHistory()`), with `src/test/reasoningHistory.test.ts` covering every model family including the issue #38 carve-out. 177/177 tests pass (+16 new).

**Tooling overlap with #125:** branch carries the same `tmp/` ignore + `.gitignore`-aware tooling commits as #125 (cherry-picked so lint passed on `main` before #125 landed). After #125 merged (`3001d68`), those commits auto-reconcile to no-ops. Local simulation: `git merge-tree` reports 0 conflicts, post-merge working tree is clean, no duplication.

**Residual (out of scope):** `src/extension.ts:3545` (`processAssistantMessage`) still has an unguarded `part instanceof vscode.LanguageModelThinkingPart`. Safe under the engine floor, candidate for a separate consistency pass.

**Docs:** Dedicated issue doc `docs/issues/59-20260811-pr126-reasoning-history-guard-tests.md`. Corrected `55-…` (parent doc) which had prematurely claimed #126 was merged. Release runbook: `docs/issues/60-20260811-release-0-5-2-plan.md`.

---

## ✅ PR #125 Merge — OpenCode Go/Zen in Agents Window + Remove from Language Models (#122) — 2026-08-11

**Action:** Merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #125 (`fix/issue-122-agents-window-models`, +380/−67). Merge commit `3001d68`, 2026-08-11T07:22:30Z.

**What:** Auto-enables the two VS Code settings the Agents window needs (experimental BYOK bridge `chat.agentHost.byokModels.enabled` and `extensions.supportAgentsWindow`, gated by `opencodego.autoEnableAgentsWindow` default `true`), so OpenCode Go/Zen appear in the Agents window model picker and its "+ Add Models" vendor list. Also adds `opencodego.enabled` / `opencodezen.enabled` + `when` clauses on the vendor contributions and `Remove/Re-add Provider in Language Models` commands so providers can be removed from the Language Models list. New `src/providerEnablement.ts` + tests.

**Relation to #121:** this PR adds `when` clauses (`config.opencodego.enabled` / `config.opencodezen.enabled`) to the `languageModelChatProviders` contributions — no `managementCommand` reintroduced, so the native BYOK group flow from #124 stays intact.

**Docs:** CHANGELOG `[Unreleased]` entries added by the PR. Dedicated issue doc: `docs/issues/58-20260811-pr125-agents-window-byok-bridge.md` (also updates `docs/architecture/01-…` timeline, `docs/features/06-…agents-window-model-visibility.md` BYOK-bridge note).

---

## ✅ PR #126 Merge — `typeof` Guard + Unit Tests for Reasoning History Helpers — 2026-08-11

**Action:** Merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #126 (review notes on #123) — the missing `typeof vscode.LanguageModelThinkingPart === "function"` runtime guard plus unit tests for `shouldEchoThinkingHistory` / `thinkingPartText`. Merge commit `7be0c06`, 2026-08-11T07:34:39Z.

**Relation to #123:** addresses the two non-blocking review notes recorded on PR #123. With #126 merged, the #123 family-gating logic is guarded and tested.

---

## ✅ PR #124 Merge — Drop `managementCommand`, Restore Native BYOK Group Flow (#121) — 2026-08-11

**Action:** Reviewed and merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #124 (`fix/issue-121-manage-models-unresponsive`, 1 commit `f778835a`, manifest-only, `package.json` + `CHANGELOG.md`, −4 lines). Merge commit `43a55c60`, 2026-08-10T23:38:09Z.

**Problem (#121):** The `languageModelChatProviders` contributions declared both `managementCommand` and a `configuration` schema. VS Code's `configureLanguageModelsProviderGroup()` **short-circuits on `managementCommand`** — it re-resolves models and returns without prompting for a group name or API key — so "+ Add Models" never created a BYOK group, every built-in context-menu action (Rename / Update API Key / Delete / Open in Language Models (JSON)) threw `group not found` and failed silently, and leftover groups (e.g. created by per-model `reasoningEffort`) could not be deleted.

**Root cause (verified against VS Code source):** `if (vendor.managementCommand) { await this._resolveAllLanguageModels(vendor.vendor, false); return; }` in `src/vs/workbench/contrib/chat/common/languageModels.ts` never reaches the group-name/configuration prompts. `managementCommand` is also officially deprecated in the contribution schema ("Use the new `configuration` property instead").

**Fix:** Dropped `managementCommand` from `opencodego`, `opencodezen`, `opencodego-agent`, `opencodezen-agent`. "+ Add Models" now runs the native BYOK prompt flow; context-menu actions work against the created group; leftover groups are deletable. Legacy commands (`OpenCode Go: Manage Provider`, `Set API Key`, …) remain registered in `contributes.commands` and keep working as the SecretStorage fallback.

**Verification:** `npm run compile` ✅ · `npm test` 161/161 ✅ · `npm run lint` ✅ · CI build + GitGuardian pass ✅ · author tested VSIX on VS Code 1.132 (Add Models → prompt → group created; gear actions work; leftover group deletable) ✅ · PR based on latest `main`, no conflict ✅.

**Review notes (non-blocking):** agent vendors (`*-agent`) no longer appear in "+ Add Models" (VS Code lists vendors with `managementCommand || configuration`) and lose their gear "Manage (Agents)…" entry when `opencodego.showAgentModelsInManagePanel` is on (default off) — acceptable trade-off, commands stay reachable from the Command Palette.

**Docs:** `docs/issues/57-20260811-pr124-managementcommand-byok-flow.md` (new, ✅ Solved); architecture doc timeline updated; CHANGELOG `[Unreleased] → Fixed` entry added by the PR.

---

## ✅ PR #123 Merge — DeepSeek Multi-Turn `reasoning_content` Echo — 2026-08-11

**Action:** Reviewed and merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #123 (`fix/deepseek-reasoning-content-echo`, 1 commit `fec411b`, `src/extension.ts`, +70/−1). Fixes repeated `HTTP 400: The reasoning_content in the thinking mode must be passed back to the API` on multi-turn DeepSeek V4 Flash conversations. Merged 2026-08-10T23:28:50Z.

**Root cause:** `convertMessage()` dropped `LanguageModelThinkingPart` from assistant history (fell through to `partToText()` → `""`), so follow-up turns omitted the `reasoning_content` DeepSeek's upstream validator requires to be echoed back unchanged.

**Fix:** Extract thinking text from history (`thinkingPartText`) and echo it as `reasoning_content` on assistant messages — tool-call branch uses cache-first with history fallback (`reasoningForToolCalls(...) ?? thinkingText`), plain assistant branch is new. Family-gated via `shouldEchoThinkingHistory`: DeepSeek required, Gemini (thought parts), GLM/Kimi/Qwen/MiniMax tolerated; omitted for MiMo (#38), GPT (Responses API), Claude (Anthropic API), unknown.

**Verification:** `npm run compile` ✅ · `npm run lint` ✅ · `npm test` 161/161 ✅ (in separate worktree `review/pr-123`, `main` untouched). Transport tracing confirmed Gemini reads the field into `thought: true`, Responses/Anthropic serializers ignore it, MiMo carve-out intact.

**Review notes:** (1) missing `typeof vscode.LanguageModelThinkingPart === "function"` runtime guard (consistency with `streaming.ts`); (2) `shouldEchoThinkingHistory`/`thinkingPartText` pure but untested — family gating regression-prone (lesson #38). Both notes addressed by PR #126 (merged 2026-08-11, commit `7be0c06`).

**Next (done):** merged with a merge commit preserving `fec411b`; issue doc promoted to ✅ Solved.

**Docs:** `docs/issues/55-20260811-pr123-deepseek-reasoning-content-echo.md` (new, ✅ Solved), CHANGELOG `[Unreleased]` entry added.

---

## ✅ PR #114 Merge — Prettier Format Codemod + Markdownlint Fixes — 2026-08-08

**Action:** Merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #114 (`chore/format-codemod`) — one-shot prettier formatting across 99 files plus markdownlint fixes (2219 → 0 issues).

**Problem:** The husky/lint-staged pre-commit hook from #110 went live the moment that PR landed, but 99 files in the repo still failed `npm run format:check`. The next contributor to touch any of those files would have been blocked on commit.

**Fix:** Two coordinated changes landed as a single commit so `git blame`/`git bisect` stay clean:

1. **Prettier format** — `npm run format` applied across 99 files (docs 63, src 27, scripts 3, root/config 5) using `.prettierrc.json` from #108. Formatting only, no logic changes.
2. **Markdownlint fixes** — `.markdownlint.json` relaxed (`MD033`, `MD041`, `MD060` off; `MD024` set to `siblings_only`), 51 bare code fences got language tags, literal `|` pipes inside inline code escaped (real table rendering bug), duplicate `### Changed` in CHANGELOG merged, README heading level fixed.

**Sequencing note:** Merged back-to-back with #110 so the window where the hook could trip stayed closed.

**Files:** 99 files touched. Highlights: `.markdownlint.json`, `CHANGELOG.md`, `README.md`, `docs/**/*.md`, `src/*.ts`, `src/test/*.test.ts`, `scripts/*.mts`.

**Verification:** `npm run lint:md` → 0 issues (72 files). `npx prettier --check .` → all pass. `npm run compile` clean, `npm test` green (161/161).

**Merge:** merge commit `94ef74f`.

**Docs:** `docs/issues/54-20260808-pr114-format-codemod-merge.md` (new).

**Follow-up:** Separate PR for the remaining 45 ESLint errors (`@typescript-eslint/no-explicit-any` in `src/` and vendored `vscode.proposed.*.d.ts`).

---

## ✅ PR #116 Merge — gpt-5.6-luna Image `invalid_prompt` Fix — 2026-08-07

**Action:** Merged PR #116 (`fix/responses-api-image-url-string`) — `gpt-5.6-luna` and every GPT-5.x Responses-routed model on OpenCode Go failed with `[invalid_prompt] Invalid Responses API request` (HTTP 400) on the first turn with an image attached.

**Root cause:** The Responses input serializer emitted `input_image.image_url` as the Chat Completions nested object `{ url: "…" }`, but the Responses API expects a plain string (URL or base64 data URL). The malformed shape predates #93 (GPT → Responses routing) and only surfaced once Luna started routing through `/v1/responses`.

**Fix:** `responsesUserContent()` in `src/responsesRequest.ts` now emits `image_url` as a string. The full Responses input conversion (`responsesInputItemsFromMessage`, `responsesUserContent`, `responsesAssistantText`, `responsesToolOutput`, `joinedTextContent`) was extracted from `src/extension.ts` into the pure, unit-testable `src/responsesRequest.ts` module. Regression suite covers the string shape, empty messages, assistant tool calls, image-bearing tool results, and unsupported roles.

**Files:** `src/responsesRequest.ts` (new, pure module), `src/extension.ts` (-119 lines, now imports the pure functions), `src/test/responsesRequest.test.ts` (new suite).

**Verification:** `npm test` → 161/161 pass. Live gateway check (attach an image to `gpt-5.6-luna`) still pending Go API key.

**Merge:** merge commit `e25a247`.

**Docs:** `docs/issues/49-20260808-luna-image-invalid-prompt.md` (from PR).

---

## ✅ PR #113 Merge — Bridge Hardening (#103 + #109) — 2026-08-07

**Action:** Reviewed and merged [@Wallacy](https://github.com/Wallacy)'s PR #113 (`feat/bridge-hardening`) — context-overflow hardening for long and tool-heavy Copilot sessions.

**Problem:** Two related overflow failures surfaced once multi-turn agent sessions and Responses-routed models hit production:

- #103 — long sessions rejected with `invalid_prompt` because Responses requests sent `text.verbosity` (proxy-sensitive) and did not cap `max_output_tokens` against remaining context.
- #109 — DeepSeek V4 Flash hit its 1M-token ceiling while the extension still requested the full 384K completion allowance, because prompt estimates only counted message text and ignored Copilot/MCP tool schemas.

**Fix:** Four classes of hardening landed together:

1. **Context budget** — enable `truncation: "auto"` for Responses, drop `text.verbosity`, include tool schemas in prompt estimates, reserve proportional tokenizer headroom, bound output to remaining context, recover from upstream HTTP 400 by reducing output budget using provider-reported counts and retry once.
2. **VS Code integration** — mark models `isBYOK`, expose capacity warnings, add utility-model configuration, drop proposal-gated `capabilities.editTools` so the published extension works in regular VS Code.
3. **Credentials** — restore credentials for cached models after Extension Host restart by falling back to `SecretStorage`.
4. **Reliability/build** — dispose cancellation listeners, 30s provider connection timeout, clean `out/` before compile, blocking CI checks, trim dev-only files from VSIX.

**Review notes:** Confirmed the `capabilities.editTools` drop is safe (only an edit-tool preference hint, not a capability gate). #89 diagnostics enriched but definitive elevated/admin fix still pending repro.

**Files:** `src/extension.ts`, `src/contextWindowHook.ts`, `src/contextWindowHookBridge.ts`, `src/responsesRequest.ts`, `src/modelCapabilities.ts`, `src/retry.ts`, `src/streaming.ts`, `src/test/`, `README.md`, `CHANGELOG.md`.

**Verification:** `npm run compile` clean, `npm run lint` passes, unit tests green. Live validation for #109 near-limit session still pending reporter confirmation.

**Merge:** merge commit `268059f`.

**Docs:** `docs/issues/53-20260807-pr113-bridge-hardening-merge.md` (new). Related issue docs: `47-20260804-gpt56-luna-responses-api-invalid-prompt.md` (#103), `49-20260807-issue109-deepseek-context-overflow.md` (#109).

---

## ✅ PR #110 Merge — Husky + ESLint + Markdownlint Toolchain — 2026-08-06

**Action:** Reviewed and merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #110 (`chore/tooling`) — husky + lint-staged pre-commit hook, ESLint flat config, prettier, markdownlint, tsconfig scoped to `src`, and CONTRIBUTING.md AI-agent workflow guidance.

**Problem:** No lint/format toolchain existed. The repo had accumulated style drift across 99 files, and there was no guard against AI-generated PRs introducing inconsistent formatting or lint failures.

**Fix:** Developer tooling + docs baseline landed after a six-point review (all addressed in commit `4c43b10`):

1. Husky + lint-staged pre-commit hook (`eslint --fix`, `prettier`, `markdownlint-cli2 --fix`).
2. ESLint flat config (`typescript-eslint` recommended), ignore list read from `.gitignore`.
3. Prettier config kept in `.prettierrc.json` (single source from #108); a duplicate package.json block was dropped.
4. Markdownlint with `MD013` off; further relaxations landed in #114.
5. `tsconfig` scoped to `src` so `tsc -p ./` no longer scans the gitignored `inspirations/` reference folder.
6. CONTRIBUTING.md "Workflow expectations" (think first, surgical changes, fix root causes, no bulk automation, self-review, verify before claiming done).

**Review notes:**

- Caught a **prettier config conflict** — `package.json` had `trailingComma: "none"` contradicting `.prettierrc.json` (`all` from #108). Dropped the duplicate.
- Caught a **misleading "3167 problems" claim** — actual count after scoping was 48. The 3167 came from eslint scanning an untracked local `inspirations/` folder.
- Requested the **format codemod land as a one-shot PR** before the hook goes live (became #114).
- Requested **rebase on main** so `.prettierrc.json` from #108 was picked up.
- Flagged **"AGENTS.md dropped" wording** as inaccurate (file never existed).
- `npm audit fix` applied: 7 → 0 vulnerabilities.

**Files:** `.husky/pre-commit`, `.markdownlint.json`, `CONTRIBUTING.md`, `eslint.config.mjs`, `package.json`, `tsconfig.json`.

**Verification:** `npm run compile` clean, `npm test` 133/133, `npm run lint` 48 problems (baseline), `npm run format:check` 98 files (pre-codemod), `npm audit` 0 vulnerabilities, husky hook installed via `prepare`.

**Merge:** merge commit `6d0522a`.

**Docs:** `docs/issues/52-20260806-pr110-husky-eslint-toolchain-merge.md` (new).

**Follow-up:** #114 (format codemod) merged back-to-back.

---

## ✅ PR #107 Review & Merge — Transient 5xx Gateway Retry — 2026-08-07

**Action:** Reviewed and merged [@Fahad090NP](https://github.com/Fahad090NP)'s PR #107 (`feat/error-handling`) — transient 5xx retry with exponential backoff + jitter for the streaming request path.

**Problem:** When the OpenCode gateway momentarily had no healthy backend for a model, it returned `502`/`503`/`504` or a `5xx` body naming `Router.Unavailable`. The extension surfaced the error on the first failure even though a retry a second later usually succeeded — flaky chat under gateway load, especially during multi-turn agent + parallel tool-call bursts.

**Fix:** Two coordinated changes that extend the existing retry module:

1. `isTransientServerError(status, errorDetail)` in `src/retry.ts` — classifies `502/503/504` as transient by definition, and other `5xx` as transient only when the compacted body matches `RouterUnavailable` (case-insensitive). Unknown `5xx` payloads stay permanent so real bugs surface.
2. Transient retry loop in `src/streaming.ts` — up to `TRANSIENT_5XX_MAX_RETRIES = 2` retries with `Math.round(BASE * 2 ** (attempt - 1) + Math.random() * JITTER)` backoff (`TRANSIENT_5XX_RETRY_BASE_MS = 1000`, `TRANSIENT_5XX_RETRY_JITTER_MS = 250`). `sleepWithCancellation` aborts the backoff on user cancel. `fetchWithBody` helper collapses the three fetch sites. `describeRouterUnavailable` in `src/errors.ts` swaps raw JSON for an actionable hint.

**Review notes:**

- Requested **scope split** — original submission bundled husky + eslint + markdownlint + AGENTS.md + tsconfig. Split into PR #107 (4 source files) + PR [#110](https://github.com/ltmoerdani/opencode-copilot-chat/pull/110) (tooling stack).
- Requested **jitter** to prevent thundering-herd on concurrent retries — landed as `+ Math.random() * 250`.
- Confirmed the **400→5xx handoff** is intentional: worst case 4 fetches per request (initial + 1 patched 400 retry + 2 transient retries). `consumedErrorBody` is reset to `undefined` at the end of the 400 block and after each 5xx retry so the classifier reads a fresh body.
- Dropped the standalone `AGENTS.md`; relevant guidance folded into `CONTRIBUTING.md` in PR #110.

**Files:** `src/retry.ts`, `src/streaming.ts`, `src/errors.ts`, `src/test/retry.test.ts` (+167 / -34).

**Verification:** `npm run compile` clean, `npm test` green, `npm run test-retry` green. Code grep on `main` confirms `TRANSIENT_5XX_RETRY_JITTER_MS`, `isTransientServerError`, `sleepWithCancellation`, `fetchWithBody`, `describeRouterUnavailable` all present. Live verification against a real `Router.Unavailable` burst not performed (classifier covered by unit tests).

**Merge:** merge commit `6d519f7` (merge, not squash, to preserve contributor history). 2 contributor commits preserved.

**Docs:** `docs/issues/51-20260807-pr107-transient-5xx-retry-merge.md` (new), `docs/features/07-20260615-model-validation-retry.md` (extended with the 5xx retry section), `CHANGELOG.md` Unreleased entry.

**Follow-up:** PR #110 (husky/eslint/markdownlint stack) reviewed separately.

---

## ✅ PR #96 Merge — Usage Monitor SVG Width Fix (#85) — 2026-08-03

**Action:** Reported by @gwynnbleiidd — usage monitor SVG card was too narrow at 330px/345px, causing the bottom statistics section (cost, requests, tokens per row) to be hard to read with values overlapping.

**Root cause:** Hardcoded SVG dimensions and column positions in `buildUsageTooltipSvg()` were too tight. The bottom section crammed 6 values per line with gaps as small as 33px.

**Fix:** Widened SVG card to 420px (440px with session data), adjusted all column positions proportionally. Progress bar width 256→340px, column spacing minimum 33→40px with most gaps at 80px. Tooltip image width 330→420px, webview max-width 480→560px.

**Files:** `src/extension.ts` (buildUsageTooltipSvg, buildUsageTooltip, updateWebviewContent), `CHANGELOG.md`, `docs/issues/25-20260803-usage-monitor-ui-width-fix.md`.

**Branch:** `fix/issue-85-usage-monitor-ui-width` (from main). Rebased onto main (CHANGELOG conflict resolved). Merge commit `c1a6dc6`.

**Verification:** `npm run compile` clean, no TS errors. NoData SVG case automatically uses wider dimensions via shared `width` variable.

**Merge:** PR #96 merged to main. Issue #85 auto-closed by `fixes #85` in commit message.

---

## ✅ PR #95 Merge — Top-Level Image Size Guard (#38) — 2026-08-03

**Action:** First size guard for top-level (user paste/drag) image attachments. Closed the asymmetry with the tool-result path that had been bounded since PR #79.

**Scope:** New constant `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` (2 MB raw bytes) in `src/extension.ts`. Top-level image branch in `convertMessage()` now checks `part.data.byteLength` before base64-encoding; oversized images are replaced with an actionable placeholder text part naming the byte count, the limit, and the suggested fix. Threshold intentionally more liberal than `MAX_TOOL_RESULT_IMAGE_BYTES` (1 MB) because top-level user images are typically larger than pre-compressed MCP screenshots.

**Why not a regression:** `git log -L` confirmed the top-level image handler never had a size cap since first vision support (commit `dee9634`). The latent bug only surfaced because users started attaching larger images (4K screenshots, phone photos) that triggered `400 Upstream request failed` on the OpenCode Go gateway.

**Why not auto-resize:** Considered and rejected at the time (sharp native binary impractical for VSIX, jimp too heavy, VS Code has no resize API). Upstream models auto-resize to a patch budget anyway, so a client-side resize layer was deemed not worth the complexity. This reasoning was later overturned by PR #102 (see above), which shipped a WASM-based normalizer that avoids native binaries entirely.

**Verification:** `npm run compile` clean, 0 errors. Issue doc `docs/issues/38-20260725-top-level-image-size-guard.md` created with full evidence table.

**Merge:** merge commit `8518a56` (NOT squash). Fix commit `eb3423b` (2026-07-25, rebased onto main). Merged 2026-08-03 01:21, five minutes before PR #96 above.

**Post-merge:** Issue #38 auto-closed. Released in 0.4.4.

**Superseded (2026-08-05):** This raw-byte guard was **removed** in PR #102 (issue #94, see entry above). The new `src/imageNormalizer.ts` resizes/re-encodes oversized images before any guard runs, so images the old guard would have dropped are now sent successfully after normalization. Issue doc `38-*` marked `⚠️ Deprecated`.

---

## ✅ PR #101 Merge — Non-agent Zen 0 Models Fix (#86) — 2026-08-03

**Action:** Reported by @Witchcraft2k — non-agent `opencodezen` returned 0 models in `vscode.lm.selectChatModels({ vendor: "opencodezen" })` when the API key was stored via the extension command `OpenCode Go: Set API Key` instead of VS Code's native BYOK flow. `opencodezen-agent` worked (7 models), but `opencodezen` showed 0.

**Root cause:** `provideLanguageModelChatInformation` had a guard `if (!apiKey && (this.definition.isAgentVariant || options.configuration))` that skipped the `SecretStorage` fallback for non-agent providers when `options.configuration` was `undefined`. VS Code passes exactly `undefined` when no native BYOK group is configured, so non-agent Zen never reached the secret-storage read and returned `[]`. The in-code comment claiming this was a transient "still resolving" state was incorrect; verified against `vscode.proposed.chatProvider.d.ts` and Copilot's own `AbstractLanguageModelChatProvider`.

**Fix:** Dropped the guard so the fallback is unconditional (`if (!apiKey)`). Mirrors Copilot's own BYOK provider pattern. Also fixes the identical latent bug on non-agent `opencodego`.

**Files:** `src/extension.ts` (guard + comment rewrite), `docs/issues/43-20260803-issue86-zen-nonagent-0-models.md`, `CHANGELOG.md`.

**Branch:** `fix/issue86-zen-nonagent-0-models` (from main). Merge commit `40e5db5` (merge, not squash, to preserve history).

**Verification:** `npm run compile` clean, no TS errors. Built and installed locally as 0.4.5; diagnostic commands (`OpenCode: Model Picker Diagnostics`, `OpenCode Zen: Diagnostics`) confirmed non-agent Zen now resolves models.

**Merge:** PR #101 merged to main. Issue #86 auto-closed by `Closes #86` in commit + CHANGELOG. Released publicly in 0.5.0.

**Follow-up:** Regression [#106](https://github.com/ltmoerdani/opencode-copilot-chat/issues/106) — the unconditional fallback caused duplicate Zen models when a native BYOK group was also configured. Fixed in PR [#108](https://github.com/ltmoerdani/opencode-copilot-chat/pull/108) by tracking a per-vendor `hasConfiguredByokGroup` flag and silencing the groupless call when a group exists.

---

## ✅ PR #102 Merge — Image Normalization + Picker Enhancements (#87, #92, #94) — 2026-08-04

**Action:** Wallacy's PR #102 (`fix/open-issues-87-92-94`) — three user-facing improvements shipped together in release 0.5.0.

**Scope:**

- **#94 (image normalization):** New `src/imageNormalizer.ts` using WASM `@silvia-odwyer/photon-node`. Resizes/re-encodes image attachments to 2000×2000 / 5MB base64 before the final payload guard, mirroring OpenCode CLI behavior. `convertMessage()` became `async` with inline `normalizeImagePart()`. Removed the obsolete `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` raw-byte guard from issue #38. `MAX_TOOL_RESULT_IMAGE_BYTES` (1MB raw) retained for MCP cumulative history bounding.
- **#92 (provider prefix toggle):** New setting `opencodego.showProviderPrefix` (default `true`). Extracted `formatModelName` to `src/modelNames.ts`, added `providerModelDisplayName()`. Config listener fires `notifyModelInfoChanged()` on all 4 providers (Go, Zen, Agent Go, Agent Zen).
- **#87 (Kimi context selector):** `getContextSizeOptionsForModel()` in `src/metadata.ts` exposes 256K + full window tiers for Kimi models (`/^(?:kimi-|k3(?:-|$))/i`) with `fullContextWindow > 262_144`. Defers to models.dev explicit tiers when available.

**Review notes:** Initial concern about ordering (normalizer ran after the raw-byte guard, so oversized images were dropped to placeholders before normalization). Wallacy addressed in follow-up commit `4572a9f` — moved normalization inline into `convertMessage()`, deleted `MAX_TOP_LEVEL_IMAGE_BYTES`, shared `MAX_IMAGE_BASE64_BYTES` as single source of truth. Also rewrote `candidateSizes` from `reduce` to plain `while` loop per readability feedback.

**Verification:** `npm run package` clean (133 tests pass), built VSIX (1.82MB, photon-node WASM included), installed locally as 0.5.0.

**Merge:** merge commit `a273a1f` (NOT squash). Both contributor commits preserved: `e43c01b` (initial), `4572a9f` (follow-up).

**Post-merge:** Issues #87, #92, #94 auto-closed. Released in 0.5.0 (commit `4fac469`).

**Docs backfill (2026-08-08):** Created feature docs `docs/features/13-20260803-image-normalization.md` + `docs/features/14-20260803-model-picker-enhancements.md`. Updated issue docs #44/#45/#46 status from "Implemented on branch" to `✅ Solved` with PR/commit refs. Marked `docs/issues/38-*` as deprecated (superseded by #94).

---

## ⚡ Session Handoff

| Field            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Last Session** | 2026-08-15 (PR #155 review + merge + post-merge docs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Worked On**    | Reviewed contributor PR #155 (`refactor/split-god-files`: split god files into domain modules + data-driven model registry) on a worktree: compile clean, 310/310 tests, retry E2E 7/7, eslint clean, routing/thinking/SSE verified behavior-identical. Merged as **merge commit** (no squash). Post-merge documentation: created `docs/issues/67-20260814-pr155-split-god-files-review-merge.md` + `docs/features/17-20260814-data-driven-model-registry.md`; updated issue #131 doc → ✅ Solved (PR #135 merged + #155 `effectiveModelId` normalization); updated feature doc 02 (thinking per-provider refactor) + architecture doc 01 (timeline + Files Changed); ARCHITECTURE-MAP.md created (untracked, from prior session). |
| **Stopped At**   | All green on `main`: compile ✅, 310/310 tests ✅, lint ✅. Docs updated but **not yet committed** (git status: modified `docs/devlog.md`, `docs/architecture/01...`, `docs/features/02...`, `docs/issues/64...` + new issue/feature docs untracked + `ARCHITECTURE-MAP.md` untracked).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Next Action**  | → Review diff of all doc changes → commit locally (ask user first) → post-merge deep validation: longer live session across several models + both vendors, re-run full suite + lint. Follow-ups before release: (1) Zen API key one-time migration (legacy `opencodego.apiKey` → `opencodezen.apiKey`); (2) manual live spin of thinking single-config-authority; (3) remaining architecture candidates: full `ModelTransport` port interface, usage webview HTML → own file.                                                                                                                                                                                                                                                      |
| **Open Issues**  | (1) Upstream #37635 gateway CoT bug still open (Mimo intentionally not worked around). (2) Live API validation (`npm run validate-models`) not run — requires `OPENCODE_API_KEY`. (3) VSIX currently includes local `AGENTS.md` + `.codegraph/` (not in `.vscodeignore`); minor, follow-up. (4) Zen API key migration pending (from PR #155 review, see issue doc 67).                                                                                                                                                                                                                                                                                                                                                             |

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

**Review/Merge docs:** [`docs/issues/42-20260803-premature-tool-call-flush.md`](issues/42-20260803-premature-tool-call-flush.md) (root cause + fix), [`docs/issues/50-20260803-pr100-tool-call-flush-review-merge.md`](issues/50-20260803-pr100-tool-call-flush-review-merge.md) (PR #100 review cycle, 3 commits incl. version sync + naming consistency follow-ups).

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

```text
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

| Date       | Version                           | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-23 | fix/issue-184-incomplete-toolcall-guard | Incomplete tool calls from `[DONE]`-less streams are dropped instead of executed (#184): `hasCompletePendingCalls()` completeness check (empty args = complete no-param tool convention), flush guard in `flushRemainingToolCalls`, engine throws via `hasCompletePendingWork` on the Responses path. PR #188, doc `docs/issues/80-20260823-issue184-incomplete-toolcall-guard.md`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-23 | docs                              | Docs sync for post-0.7.0 hotfix wave: audited git log + `gh pr list` vs docs/issues + CHANGELOG + devlog. Added hotfix-wave section + 3 Completed History rows (#185, #186, #187); added `Landed:` PR refs to issue docs 78-#182 and 79-Muse-Spark. CHANGELOG entries for all three were already present from contributors — nothing to add. Open PR #161 still tracked.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-22 | patch-2 (Muse Spark stream fix)   | Muse Spark no-throw on missing termination signals (PR #187, Barragek0, merge `b2f1084`): `extractedPartCount > 0` branch in `src/transports/engine.ts` logs `[warn]` + returns successfully when a delivered stream lacks `[DONE]`/`finish_reason` — a #178 regression; Muse Spark's Responses API gateway omits the signals on successful responses. Doc `docs/issues/79-20260822-issue-muse-spark-stream-completion.md` + CHANGELOG `[Streaming]` entry by contributor.                                                                                                                                                                                                                                                                                                                    |
| 2026-08-22 | patch-1 (deprecated cross-check)  | Deprecated-model gateway cross-check (#182, PR #185, Barragek0, merge `f0b3c04`): `models.dev` `status: deprecated` only hides a model when the gateway also omits it; `laguna-s-2.1-free` restored, `deepseek-v4-flash-free` documented as upstream-broken. Tests in `src/test/deprecatedFilter.test.ts`; doc 78 + CHANGELOG `[Models]` entry by contributor.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-22 | fix/stream-truncation-retry-loop  | Stream-truncation resilience (#181): bounded 3-attempt retry loop for pre-content truncation/stall (replaces single retry), shared budget across both failure modes, no content duplication. Issue #181, PR #186, doc `docs/issues/78-20260822-ox-alpha-truncation-retry.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-22 | release 0.7.0                     | Version bump 0.6.0 → 0.7.0 (package.json + CHANGELOG `[0.7.0] — 2026-08-22`). Scope: PR wave #157–#180 — Muse Spark 1.2, OpenAI thinking effort setting, configurable API base URL; BYOK-only API key entry (Set API Key commands removed), thinking strategy refactor, god-file split (≤600-line policy), data-driven model registry; streaming-resilience wave (#170/#177/#178/#179), Muse Spark usage fix (#174), vision byte-cap (#173/#175), completion-cap self-heal (#171/#172), GLM 5.3 always-thinking (#162/#166), bug-hunt 35 fixes (#157), history trim 70% + scaled byte cap (#167/#169), transient fetch retry. 0.7.0 (not 1.0.0): Zen key migration gap + open PR #161 (Set API Key restore) mean the key-entry UX is not final yet — 1.0.0 waits for those + settings freeze. |
| 2026-08-22 | fix/stream-stall-resilience       | Stream-stall resilience (#179): pre-content one-shot retry generalized to idle stalls (`isStreamFailureRetry`, shared budget with truncation retry), stall error points at `streamIdleTimeoutSeconds`. Issue #179, PR #180, doc `docs/issues/77-20260822-stream-stall-resilience.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-22 | fix/issue-173-vision-byte-cap     | Vision byte-cap fix (#173, PR #175): base64 image data no longer counts toward the history-trim byte ceiling — `stripImageData` replaces oversized data URLs with an `[image]` placeholder before measuring (`src/provider/historyTrim.ts`); image weight stays the image trimmer's job, structure overhead still counted. Rebased on main to fold the scaled byte-cap into `chatPrep`. Doc `docs/issues/75-20260821-issue173-vision-byte-cap.md`.                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-21 | fix/stream-silent-stop            | Truncated-stream detection + prompt `[DONE]` completion (PR #170, merge `1886dca`): `parseServerSentEvent` fires `onDone`; `isStreamTruncated` throws a clear `OpenCodeRequestError` on close without `[DONE]`/`finish_reason` after content; engine aborts controller + flushes tool calls/reasoning in `finally` (review p2/p3); unrecognized `stop_reason` = healthy stop. Docs `docs/issues/68/69/70-20260820-*.md`.                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-21 | patch-1 (Muse Spark usage)        | Muse Spark context-window fix (PR #174, Barragek0, merge `a1133a4`): Responses API nests usage under `response.usage` on `response.completed` — parser falls back to it + reads `input_tokens_details.cached_tokens`; also documents Muse reasoning as `encrypted_content` (thinking blocks empty until gateway relays plaintext). 3 tests in `src/test/extractors.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-21 | docs                              | Docs sync for PR wave #157–#172: created issues 72 (PR #164 think-tag force-strip) + 73 (#162 GLM 5.3) + 74 (PR #157 bug-hunt) + features 18 (Muse Spark 1.2); features/02 + issues/36 updated; 3 missing CHANGELOG [Unreleased] entries added (PR #157, #160, #164); devlog refreshed. Open PRs #161, #170 tracked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-21 | refactor/file-size-limit          | Completed the ≤600-line file-size policy — split the remaining oversized modules with zero behavior change: `src/provider/OpenCodeProvider.ts` (1259→584) into `chatPrep`, `modelInfo`, `modelList`, `transportLog`, `providerDialogs`, `providerUtils`; `src/usage/tracker.ts` (989) into `trackerTypes`/`trackerWindows`/`trackerSummary`; `src/test/goUsageTracker.test.ts` (904) into focused suites + `test/helpers/goUsageTestUtils`. Full lint gate green after each split. 3 commits on `refactor/split-oversized-files`.                                                                                                                                                                                                                                                             |
| 2026-08-13 | refactor/thinking-request-modules | Thinking refactor (per-provider strategy classes + single VS Code per-model config authority + removed globalState shadow + `effectiveModelId`) + request module split (`src/request/`) + Windows lint fixes (`.cmd` shims + `.gitattributes` LF). 6 commits. CHANGELOG [Unreleased] updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-06-13 | docs                              | Deep audit — all 4 🟢 Active docs verified against codebase + git history + CHANGELOG. All marked ✅ Solved: issue #19 (PR #15 merged), references #01 (research complete), architecture #01 (living ref complete), issue #01 (all code fixed v0.1.9/v0.1.10, remaining tool-call loop is model behavior not code bug). 0 Active docs remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-06-13 | docs                              | Rewrote devlog into work-context format and flagged unrelated `WORK-CONTEXT.md` content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-06-13 | docs                              | Backdated and consolidated the 2026-05-15 Qwen 3.6 Plus Free tool-call loop investigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-06-12 | docs                              | Added provider architecture reference for Go/Zen BYOK setup and later routing/metadata/usage evolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-06-12 | v0.2.7                            | Temperature support fix, Kimi thinking format correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-06-11 | research                          | Agents window model visibility — GitHub Issue #11 deep-dive. Investigated VS Code source (`targetChatSessionType`, `chatSessions`, `chatSessionsProvider` proposed API). Concluded Option A (duplicate models with `targetChatSessionType: 'copilotcli'`) is only marketplace-compatible path. Custom "OpenCode" tab blocked by `vsce` proposed API policy. Doc: `docs/references/01-20260611-agents-window-model-visibility.md`                                                                                                                                                                                                                                                                                                                                                              |
| 2026-06-10 | v0.2.6                            | Removed message trimming + gzip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-06-10 | v0.2.5                            | Removed gzip HTTP 500 path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-06-10 | v0.2.4                            | Context size selector, dynamic reasoning, thinking controls, strip think tags                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-06-09 | cleanup                           | Project cleanup — full codebase review (20+ improvements across 5 categories), fixed 4 immediate bugs: redundant activationEvents, stale user-agent version, duplicate CHANGELOG, .vsix gitignore. Doc: `docs/issues/18-20260609-project-cleanup-immediate-bugfixes.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-06-09 | v0.2.3                            | Output channel cleanup — removed all verbose debug/informational logs from "OpenCode" channel, fixed `Buffer` TS error with `TextDecoder` Web API, refreshed extension icon (commit `c8383735`), version bumped to 0.2.3. Doc: `docs/issues/16-20260609-output-channel-cleanup-textdecoder-fix.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-06-08 | v0.2.2                            | Strip think tags from model output                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-06-08 | icon                              | Extension icon redesign — replaced generic `</>` bracket logo with creative OpenCode Mark design (gradients, glow, grid pattern, sparkle accents). Researched brand assets from `anomalyco/opencode` source. Doc: `docs/features/04-20260608-extension-icon-redesign.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-06-06 | v0.2.1                            | Removed unused Go usage panel/command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-06-05 | usage-debug                       | Go Usage Tracker status bar not updating — REST API exhaustive search (all 404), CLI dependency removal, session.percent bug fix, debug output channel, temporary v0.2.1 test VSIX. Doc: `docs/issues/14-20260605-go-usage-status-bar-not-updating.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-06-05 | v0.2.0                            | Go Usage Tracker feature implementation — GitHub user request → OpenCode pricing research → status bar + Quick Pick design → `goUsageTracker.ts` + `extension.ts` → VSIX build. Doc: `docs/features/03-20260605-go-usage-tracker.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-06-05 | v0.1.10                           | Qwen routing reverted to Anthropic Messages API; Anthropic SSE tool call parsing; Qwen thinking payload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-06-04 | v0.1.8                            | PR #7 review/merge/release — languageModelPricing API, models.dev cost data, 4-tier priceCategory, modality detection, type consolidation, experimental config cleanup. Doc: `docs/issues/11-20260604-pr7-pricing-api-review-merge-release.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-06-04 | v0.1.9                            | Qwen tool calling fixed (routed to chat-completions); context window for Qwen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-06-04 | v0.1.8                            | languageModelPricing, modality detection, cost metadata, capabilities alignment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-05-27 | v0.1.7                            | Transport diagnostics + Context Window usage integration — added native `usage` DataPart reporting, kept OpenCode custom usage telemetry, restored richer token counting, integrated PR #6, packaged and installed `0.1.7`, and merged `develop` back to `main`. Doc: `docs/issues/10-20260527-context-window-usage-pr6-integration.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-24 | v0.1.6                            | PR #4 review/merge/release — native Zen routing, models.dev cache, modular split, 5 unit tests, vision fixes preserved, marketplace VSIX packaged. Doc: `docs/issues/09-20260524-pr4-review-merge-release.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-05-21 | v0.1.6                            | models.dev metadata cache, Zen GPT/Gemini routing, timeouts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-20 | v0.1.5                            | Vision image request fixes and release consolidation — replaced stack-overflow-prone image byte encoding, diagnosed provider-side Alibaba `429 insufficient_quota`, omitted Qwen `thinking_budget` for image requests when Thinking is `auto`, audited OpenCode attachment metadata, removed incorrect `Vision` capability from GLM/MiniMax/MiMo Pro rows, restored the `0.1.5` changelog entry, compiled final output, and merged `develop` into `main` with `--no-ff`. Doc: `docs/issues/08-20260520-vision-image-request-fixes.md`                                                                                                                                                                                                                                                         |
| 2026-05-17 | zen-labels                        | Zen model version label fix — preserved decimal version labels such as `Claude Opus 4.6`, diagnosed stale installed VSIX artifacts, rebuilt the final `0.1.4` package, and moved `reasoningEffort` changelog wording under Added. Doc: `docs/issues/07-20260517-zen-model-version-labels.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-05-17 | thinking-native-submenu           | Native Thinking submenu solved — confirmed VS Code configuration pipeline, found diagnostics command was warming provider metadata, added automatic provider metadata warm-up, shortened Copilot-style labels, fixed Kimi/Moonshot tool schema sanitizer, fixed Qwen chat-completions routing and hybrid stream parsing, rebuilt final `0.1.4` VSIX. Doc: `docs/issues/06-20260517-thinking-native-submenu-investigation.md`                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-05-17 | thinking                          | Per-model Thinking controls — documented the feature covering family defaults, `configurationSchema`, `reasoningEffort`, `modelConfiguration`, `models.dev` reasoning options, request payload mapping, and command/settings fallback. Doc: `docs/features/02-20260517-per-model-thinking-controls.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-17 | PR #1                             | First community contribution merged — `opencodego.freeOnly` setting by @Wallacy. Reviewed, tested locally, merged via GitHub UI, synced `develop`. Doc: `docs/issues/04-20260517-pr1-freeonly-review-merge.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-05-17 | v0.1.4                            | Zen free filtering, thinking controls, schema sanitization, unavailable filtering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-05-16 | v0.1.3 follow-up                  | Unavailable/deprecated model filtering — hid Ring and Trinity stale IDs, applied `models.dev` deprecated status filtering, and synced model docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-05-16 | v0.1.3                            | Context-size correction and per-provider model limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-05-15 | investigation                     | Qwen 3.6 Plus Free tool-call infinite loop — root cause identified. Doc: `docs/issues/01-20260515-qwen36-tool-call-loop.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-14 | v0.1.0–0.1.2                      | Initial Go provider, native BYOK, separate Zen provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
b4d9ae3 (fix(streaming): drop incomplete tool calls on flush; treat empty args as complete (review #188))

---

## ⚠️ Notes

- `docs/WORK-CONTEXT.md` currently contains unrelated BLAZZ project context. Treat it as a style reference only until it is replaced or removed.
- No secrets should be added to devlog, architecture docs, diagnostics, or pasted request logs.

---

_Updated automatically during development sessions._
_Paired with: `docs/devlog-guide.md`_
