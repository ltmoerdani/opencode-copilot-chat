# Changelog

All notable changes to the **OpenCode Go BYOK Provider** extension are documented here.

## [Unreleased]

### Fixed

- **`[Provider]` OpenCode Zen models listed twice when using a native BYOK group (#106).** With the API key configured via VS Code's Manage Models / BYOK flow, every OpenCode Zen model appeared twice (16 instead of 8). VS Code calls `provideLanguageModelChatInformation` once without a group and then once per configured group, namespacing identifiers by group — so the secrets-backed set emitted on the groupless call (since 0.5.0, #86) was kept alongside the group's set. The provider now records per vendor when a BYOK group has been configured and the groupless call stays silent in that case; the `Clear API Key` action resets the flag. Documented in `docs/issues/48-20260805-issue106-zen-duplicate-models.md`.

## [0.5.0] — 2026-08-05

### Added

- **`[Model Picker]` Optional provider prefixes (#92).** Added `opencodego.showProviderPrefix` (default `true`) to hide `OpenCode Go` / `OpenCode Zen` prefixes in narrow model pickers when desired. Changes refresh the registered model names immediately. Documented in `docs/issues/45-20260803-issue92-provider-prefix.md`.
- **`[Model Picker]` Kimi context-size selector (#87).** Kimi models with a context window larger than 256K now expose `256K` and the full window in the per-model configuration schema, with the smaller tier selected by default. Documented in `docs/issues/46-20260803-issue87-kimi-context-size.md`.

### Fixed

- **`[Vision]` Normalize image attachments before OpenCode Go requests (#94).** Image data URLs are resized and re-encoded using the same 2000x2000 / 5 MB base64 limits used by OpenCode's CLI, while preserving the original image when normalization is unavailable. Documented in `docs/issues/44-20260803-issue94-image-normalization.md`.

### Changed

- **`[Vision]` Top-level image handling superseded by normalizer (#94).** The previous `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` raw-byte guard that replaced oversized top-level attachments with a placeholder text part has been **removed**. Top-level images now flow through the new image normalizer (`src/imageNormalizer.ts`, powered by `@silvia-odwyer/photon-node`) **before** a final `MAX_IMAGE_BASE64_BYTES = 5 MB` base64 payload guard, so images that were previously dropped can now be resized and sent successfully. `convertMessage()` is now `async`. The separate `MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000` (1 MB raw) guard for MCP tool-result images is retained, since the normalizer does not bound the cumulative multi-image accumulation case. The superseded `docs/issues/38-20260725-top-level-image-size-guard.md` is marked deprecated. PR [#102](https://github.com/ltmoerdani/opencode-copilot-chat/pull/102) by [@Wallacy](https://github.com/Wallacy).

## [0.4.5] — 2026-08-03

### Fixed

- **`[Provider]` Non-agent OpenCode Zen returns 0 models when API key set via the extension command (#86).** When the Zen API key was stored via `OpenCode Go: Set API Key` instead of VS Code's native Manage Models / BYOK flow, `vscode.lm.selectChatModels({ vendor: "opencodezen" })` returned 0 models, so Zen free models never appeared in the Chat model picker. Root cause: the `provideLanguageModelChatInformation` fallback guard `if (!apiKey && (this.definition.isAgentVariant || options.configuration))` skipped the SecretStorage fallback for non-agent providers when `options.configuration` was `undefined` — which is exactly what VS Code passes when the user never configured a native BYOK group. The previous in-code comment claiming this was a "still resolving" state was incorrect; verified against `microsoft/vscode` `vscode.proposed.chatProvider.d.ts` and the reference implementation in Copilot's `AbstractLanguageModelChatProvider`. The guard is now simply `if (!apiKey)`, mirroring Copilot's own pattern. This also fixes the identical latent bug on non-agent `opencodego`. Closes #86. Documented in `docs/issues/43-20260803-issue86-zen-nonagent-0-models.md`.

- **`[Streaming]` Premature tool-call flush caused empty `<invoke>` calls and an unrecoverable tool-calling loop (#98).** The 0.4.4 fix for gpt-5.6-luna (#93) flushed accumulated tool calls whenever `finish_reason` was `null`/`undefined` and tool calls were pending. Standard OpenAI-compatible streams (DeepSeek-V4 via OpenCode Zen, plus Kimi, GLM, Qwen non-plus, MiniMax non-m2.x, MiMo) report `finish_reason: null` on EVERY intermediate chunk, so the first tool-call delta chunk flushed an INCOMPLETE call — empty arguments parsed as `{}`, and VS Code rendered `<invoke>` without `<parameter>`. The model then looped retrying the malformed call. `OpenAiResponseExtractor` now flushes ONLY on `finish_reason === "tool_calls"`; gateways that omit it (gpt-5.6-luna on OpenCode Go) are flushed once at end-of-stream via the new `flushRemainingToolCalls()`, so #93 stays fixed. Tool-call accumulation was extracted into a pure, unit-tested `ToolCallAccumulator` (`src/toolCallAccumulator.ts`, no `vscode` import). Documented in `docs/issues/42-20260803-premature-tool-call-flush.md`.

## [0.4.4] — 2026-07-25

### Fixed

- **`[Routing]` GPT 5.6 Luna on OpenCode Go — routing, tool calling, and reasoning (#93).** OpenCode Go docs require `gpt-5.6-luna` on the Responses API endpoint (`/v1/responses`), not chat-completions. Three issues were fixed: (1) Routing — GPT models were sent to `chat-completions` which doesn't support reasoning or tool calling for this model; now routed to Responses API per OpenCode Go docs. (2) Tool calls — the gateway sends tool calls in standard OpenAI format but omits `finish_reason` on the final chunk (`null` instead of `"tool_calls"`); `OpenAiResponseExtractor` now flushes pending tool calls when `finish_reason` is `null`/`undefined` and there are accumulated calls. (3) Reasoning — `buildResponsesRequestBody()` did not include `thinkingPayload`; added reasoning payload in Responses API format (`{ reasoning: { effort } }`). Added `openai` thinking family with effort levels (off/low/medium/high/xhigh). Diagnostic logging auto-activates when gateway reports completion tokens but extractor finds nothing. Documented in `docs/issues/41-20260803-gpt56-luna-routing-fix.md`.

- **`[Usage]` Usage monitor SVG card too narrow — values unreadable (#85).** The usage monitor SVG card (shown in status bar tooltip and webview panel) was 330px wide (345px with session data), causing the bottom statistics section to cram 6 values per line with gaps as small as 33px — making costs, request counts, and token counts hard to read. Widened the card to 420px (440px with session) and adjusted all column positions proportionally: progress bar width 256→340px, column spacing minimum 33→40px with most gaps at 80px. Tooltip image width updated to 420px, webview max-width to 560px. Documented in `docs/issues/25-20260803-usage-monitor-ui-width-fix.md`.

- **`[Vision]` Trim old images from conversation history — fix `400 Upstream request failed` on MiMo + MCP screenshot loops (#38 follow-up).** Even with per-image size guards (`MAX_TOOL_RESULT_IMAGE_BYTES` 1 MB, `MAX_TOP_LEVEL_IMAGE_BYTES` 2 MB), MCP-driven agentic workflows (`chrome-devtools-mcp`, `playwright-mcp`) accumulated multiple screenshots in conversation history and hit the OpenCode Go gateway's upstream limit. Documented in `docs/issues/34-20260720-mcp-tool-result-image-dropped.md` line 264+: a `mimo-v2.5` agent loop reached `payloadBytes=4665383` (4.6 MB) after 8 screenshots and started failing every subsequent request with HTTP 400. VS Code Copilot Chat is _supposed_ to trim history based on `advertisedMaxInputTokens`, but our local estimator under-counts base64 image data (`IMAGE_TOKEN_ESTIMATE = 1024` per image vs. realistic ~80K tokens/MB), so VS Code never sees the true payload weight. New function `trimOldImagesFromHistoryInPlace()` keeps only the most recent `MAX_HISTORY_IMAGES_KEPT = 2` images and replaces older ones with a short placeholder text note ("Earlier screenshot omitted from history..."). The model retains conversation structure and the latest screenshots for immediate agentic context (compare current vs. previous), while cumulative payload stays bounded. OpenAI and Anthropic vision models auto-resize each image to a 1568–2576 px patch budget upstream, so old screenshots lose most of their pixel value once a newer one arrives — the model rarely benefits from keeping more than 2 in flight. Applied after vision proxy (so proxy text descriptions are preserved) and before `promptTokens` estimation (so the output budget reflects the trimmed payload). Diagnostic log line `[history-trim] Replaced N old image(s)...` appears in the Output channel when trimming fires.

- **`[Vision]` Top-level image attachment size guard — prevent `400 Upstream request failed` on oversized pasted images (#38).** Pasting or dragging a large image (4K screenshot, high-res phone photo) into Copilot Chat with a vision-capable OpenCode model (e.g. `mimo-v2.5`) produced a multi-MB base64 payload that the OpenCode Go gateway rejected with HTTP 400. The top-level image handler in `convertMessage()` had **no size guard**, unlike MCP tool-result images which were already capped at 1 MB by `MAX_TOOL_RESULT_IMAGE_BYTES` (PR #79). New constant `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` (2 MB raw, intentionally more liberal than the 1 MB tool-result cap because user screenshots/photos are typically larger than pre-compressed MCP screenshots). Images exceeding the limit are replaced with an actionable placeholder text part — the model still knows an image was attached, and the user gets the actual byte count, the limit, and a hint to resize/compress. Threshold rationale (evidence-based): Anthropic publishes a 5–10 MB per-image limit, OpenCode Go was verified to reject 3.18 MB, and upstream vision models auto-resize to a 1568–2576 px patch budget anyway — so there is no fidelity benefit to forwarding multi-MB raw images. See `docs/issues/38-20260725-top-level-image-size-guard.md`.

## [0.4.3] — 2026-07-24

### Fixed

- **`[Streaming]` `estimateTokenCount` overestimation caused `max_tokens: 1` on large conversations (#83).** The word-count-based heuristic (`words * 1.15`) in `estimateTokenCount()` dramatically overestimates token counts for JSON-serialized chat messages (3-5× actual), because every structural character (`{`, `}`, `"`, `:`, `,`) is counted as a separate "word". For conversations approaching the context window limit (~754K tokens), this inflated `safeOutputBudget` to 1, sending `max_tokens: 1` to the API — models generated exactly 1 token then stopped with `finishReason: length`. Replaced with a charEstimate-based heuristic using OpenAI's standard "1 token ≈ 4 characters" rule, plus a 10% buffer for code-heavy text and CJK character accounting. Added `MIN_OUTPUT_BUDGET = 4096` as a safety net to prevent budget collapse under any estimation scenario.

## [0.4.2] — 2026-07-23

### Added

- **`[Thinking]` `budget_tokens` cap for MiMo thinking payload (#36).** MiMo 2.5 / 2.5-Pro reasoning can loop indefinitely when `reasoning_effort` is set without a token budget. Each effort level now sends `budget_tokens`: `low` → 8,192, `medium` → 16,384, `high` → 32,768. Graceful degradation via `retry.ts` handler for HTTP 400 `"budget_tokens"` rejection.
- **`[Streaming]` Go gateway `reasoning_content` workaround (#36, #37635).** The opencode-go gateway places ALL streaming response text inside `reasoning_content` instead of `content` (upstream bug [#37635](https://github.com/anomalyco/opencode/issues/37635)). When a Go-gateway request has NO `reasoning_effort` in the body (MiMo thinking OFF), `reasoning_content` is emitted as visible text instead of a thinking part. When `reasoning_effort` IS present (thinking ON), CoT correctly stays in the thinking panel. Zen gateway and all other providers unaffected. Can be removed once upstream #37635 is fixed.
- **`[Streaming]` Suffix-repetition loop detection (#36).** `OpenAiResponseExtractor.handleReasoning()` now tracks 40-char suffix across consecutive reasoning chunks. If the same suffix repeats 6+ times, the model is stuck in a word-level loop — thinking parts are suppressed and a visible warning `[Reasoning loop detected — thinking output suppressed]` is emitted instead.
- **`[Commands]` Top-level `Refresh Models` commands for Go and Zen (#78).** The `Refresh Models` action was previously buried inside the `OpenCode Go: Manage Provider` QuickPick, and Zen had no manual refresh path at all. Two new commands are now registered: `OpenCode Go: Refresh Models` and `OpenCode Zen: Refresh Models`, each bypassing the Manage menu and going straight to a model-list fetch. For parity, `OpenCode Zen: Manage Provider` is also added, matching the existing Go command. The new commands are especially useful when the picker is showing a stale or bundled list at startup (issue #78) and you want to force a re-fetch without opening the Manage menu.
- **`[Vision]` Multimodal tool results — MCP screenshot forwarding (#77).** Images returned inside a `LanguageModelToolResultPart` (e.g. screenshots from `chrome-devtools-mcp`, `playwright-mcp`) are now forwarded to vision-capable models. Previously these images were silently dropped by the serialization layer and the model would report "I cannot see the image". Images are encoded as OpenAI-style `image_url` content parts and translated into the native multimodal shape for each transport: chat-completions (native array content), Anthropic messages (`tool_result.content: AnthropicContentBlock[]`), Google Gemini (`functionResponse.response.parts: [{inlineData}]`). Oversized images (>1 MB raw bytes) are replaced with an actionable placeholder note so a single full-page MCP screenshot can't push the request payload past the upstream limit. The Responses API cannot carry images in tool output and degrades to a placeholder note on that transport only.

### Fixed

- **`[Streaming]` Regressive visible-text suppression removed.** Previous guards (`contentAfterReasoning`, `shouldSuppressTextEmit`) incorrectly blocked visible text emission for ALL reasoning models. These models naturally produce `reasoning_content` first then `content` — this is normal, not degradation. Both guards removed; only suffix-repetition loop detection remains active.
- **`[Streaming]` Go gateway reasoning leak fix (#36, #37635).** MiMo 2.5 responses were leaking thinking content into the visible chat when thinking was OFF. The `treatReasoningAsContent` workaround now only activates when ALL conditions are met: (1) request URL includes `/zen/go/`, (2) `reasoning_effort` is NOT in the request body, (3) `delta.content` is empty. This ensures the workaround applies only to the MiMo-thinking-OFF scenario while leaving all other models untouched.
- **`[Logging]` Model registration log spam during UI refresh.** VS Code refreshes model info on roughly a 300 ms cadence during chat UI activity; each call previously produced one log line per registered model (22+ lines per call). `provideLanguageModelChatInformation` now emits a single summary line per invocation (`Models registered: count=N provider=… first=… last=…`). Output channel is dramatically cleaner during testing.
- **`[Logging]` Transient model-list fetch failures no longer pop a modal warning.** OpenCode's shared gateway occasionally returns transient 400/503 responses that resolve on retry within seconds, and the previous behavior called `showWarningMessage` on every failure — including from auto-registered provider variants the user may not actively use (e.g. `OpenCode Zen (Agents)`). Failures now log to the Output channel only; the bundled `fallbackModels` snapshot keeps the picker functional.
- **`[Resilience]` Model-list fetch now tolerates transient network failures (#78).** On flaky networks (and especially on VS Code 1.129 where the new agent host raises the rate of concurrent `provideLanguageModelChatInformation` calls), a single `TypeError: fetch failed` at startup — DNS wobble, TCP reset, undici socket reuse race ([`nodejs/undici#5450`](https://github.com/nodejs/undici/issues/5450)) — caused the picker to drop to the bundled list or empty out entirely ("flash then disappear"). `fetchModels()` now (1) wraps each attempt in `AbortSignal.timeout(15_000)` so a hung connect can't stall the picker for the full undici default of 5 minutes, (2) retries up to 3 times with exponential backoff (500 ms / 1 s / 2 s) on transient errors only — `ECONNRESET`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`, HTTP 408/429/5xx, and the generic `TypeError: fetch failed` wrapper — never on `AbortError` from VS Code's `CancellationToken` or on HTTP 4xx, (3) sends a `User-Agent` header built from the extension's `packageJSON.version` so strict gateways don't silently drop the request and so the version string can't drift again, (4) caches every successful fetch to `globalState` (`opencode.modelListCache.v1::<vendor>`, TTL 1 hour) and prefers that snapshot over the bundled list when all retries fail, (5) composes the caller's `CancellationToken` with the timeout via `AbortSignal.any([...])` so a cancelled resolution tears down the in-flight fetch immediately, and (6) sends an explicit `Accept: application/json` header so SSL-inspecting corporate firewalls / VPN proxies (Zscaler, Netskope, Fortinet) don't drop the GET as an anonymous scanner — the #78 reporter sits behind a VPN + corporate firewall on Windows 11, where POST `/chat/completions` with a JSON content type was passing but the bare GET `/models` was being dropped. See `docs/issues/35-20260720-issue78-model-list-fetch-resilience.md`.

- **`[Logging]` Model registration log spam during UI refresh.** VS Code refreshes model info on roughly a 300 ms cadence during chat UI activity; each call previously produced one log line per registered model (22+ lines per call). `provideLanguageModelChatInformation` now emits a single summary line per invocation (`Models registered: count=N provider=… first=… last=…`). Output channel is dramatically cleaner during testing.
- **`[Logging]` Transient model-list fetch failures no longer pop a modal warning.** OpenCode's shared gateway occasionally returns transient 400/503 responses that resolve on retry within seconds, and the previous behavior called `showWarningMessage` on every failure — including from auto-registered provider variants the user may not actively use (e.g. `OpenCode Zen (Agents)`). Failures now log to the Output channel only; the bundled `fallbackModels` snapshot keeps the picker functional.
- **`[Resilience]` Model-list fetch now tolerates transient network failures (#78).** On flaky networks (and especially on VS Code 1.129 where the new agent host raises the rate of concurrent `provideLanguageModelChatInformation` calls), a single `TypeError: fetch failed` at startup — DNS wobble, TCP reset, undici socket reuse race ([`nodejs/undici#5450`](https://github.com/nodejs/undici/issues/5450)) — caused the picker to drop to the bundled list or empty out entirely ("flash then disappear"). `fetchModels()` now (1) wraps each attempt in `AbortSignal.timeout(15_000)` so a hung connect can't stall the picker for the full undici default of 5 minutes, (2) retries up to 3 times with exponential backoff (500 ms / 1 s / 2 s) on transient errors only — `ECONNRESET`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`, HTTP 408/429/5xx, and the generic `TypeError: fetch failed` wrapper — never on `AbortError` from VS Code's `CancellationToken` or on HTTP 4xx, (3) sends a `User-Agent` header built from the extension's `packageJSON.version` so strict gateways don't silently drop the request and so the version string can't drift again, (4) caches every successful fetch to `globalState` (`opencode.modelListCache.v1::<vendor>`, TTL 1 hour) and prefers that snapshot over the bundled list when all retries fail, (5) composes the caller's `CancellationToken` with the timeout via `AbortSignal.any([...])` so a cancelled resolution tears down the in-flight fetch immediately, and (6) sends an explicit `Accept: application/json` header so SSL-inspecting corporate firewalls / VPN proxies (Zscaler, Netskope, Fortinet) don't drop the GET as an anonymous scanner — the #78 reporter sits behind a VPN + corporate firewall on Windows 11, where POST `/chat/completions` with a JSON content type was passing but the bare GET `/models` was being dropped. See `docs/issues/35-20260720-issue78-model-list-fetch-resilience.md`.

## [0.4.1] — 2026-07-15

### Added

- **`[Vision]` Transparent vision proxy for text-only models (#74).** Run **OpenCode Go: Configure Vision Proxy** from the Command Palette to pick a vision-capable model. When a non-vision OpenCode model receives an image, the extension forwards it to the configured model, receives a text description, and feeds that to the original model — so text-only models "see" images with zero extra steps. The picker shows only vision-capable models (filtered by `models.dev` metadata), with a **None** option to disable and a **Customize prompt** entry to edit the description instruction. No settings to toggle — if a model is configured, the proxy is on. Implemented with `vscode.lm.selectChatModels` + `sendRequest`. PR [#76](https://github.com/ltmoerdani/opencode-copilot-chat/pull/76) by [@Wallacy](https://github.com/Wallacy).

### Fixed

- **`[Streaming]` Context overflow 400 when prompt + output approached the model's limit (#68).** `estimateTokenCount` can underestimate by 0–2%, pushing payloads past the context window on large prompts. Added a 64-token safety margin (`TOKEN_ESTIMATE_SAFETY_MARGIN`) to `promptReserve` in `modelLimits()`. Affects all models (reported with GLM-5.2).
- **`[Streaming]` Empty response warning no longer steals focus to the Output pane (#67).** Removed the stray `.show(true)` call on the empty-response diagnostic log.

## [0.4.0] — 2026-07-13

### Added

- **`[Usage]` Per-profile Go usage tracking for multi-account setups.** Users with multiple OpenCode Go subscriptions (e.g. work + personal) can now add separate Go entries in the Manage Language Models panel. The extension auto-creates a named profile ("Profile 1", "Profile 2", etc.) on the first request with each key. Storage is namespaced per profile so usage data never mixes. Fixes [#63](https://github.com/ltmoerdani/opencode-copilot-chat/issues/63). PR [#75](https://github.com/ltmoerdani/opencode-copilot-chat/pull/75) by [@Wallacy](https://github.com/Wallacy).
- **`[Usage]` Profile auto-switch and QuickPick.** The active profile follows the last used model. Click the status bar to open a QuickPick listing all profiles; the active one is checked, others are clickable switches. The SVG hover card and status bar show the active profile label (e.g. `Go: 5%·12%·8% [Profile 2]`).
- **`[Usage]` Profile management commands.** `OpenCode Go: Rename Active Profile` and `OpenCode Go: Delete Profile` let users manage their profiles. Delete includes a confirmation dialog and cleans up all namespaced storage.
- **`[Usage]` Legacy data migration.** Users upgrading from a single-account install get their existing usage data migrated into Profile 1 automatically on first multi-profile activation. Nothing is lost.

### Fixed

- **`[Usage]` 5-hour rolling usage now isolates per profile in multi-profile mode.** The shared `opencode.db` SQLite database has no API key column, so reading it in multi-account mode mixed quota from all accounts. The tracker now skips SQLite entirely when multiple profiles exist and falls back to extension-tracked entries (which are namespaced per profile). This trades billed-accuracy for correct per-profile isolation.

## [0.3.7] — 2026-07-09

### Added

- **`[Thinking]` Reasoning now surfaced to Copilot Chat as collapsible thinking blocks.** Previously, reasoning content from OpenCode models (DeepSeek, Kimi, GLM, Qwen, MiniMax, MiMo) was accumulated internally but never emitted to the VS Code Chat UI as a thinking part — so `chat.agent.thinkingStyle` (`collapsed` / `collapsedPreview` / `fixedScrolling`) had no effect, and reasoning either appeared as flat plain text or was silently dropped. The extension now streams reasoning per-chunk via the proposed `LanguageModelThinkingPart` API (available at runtime since VS Code ~1.102, well within our `^1.125.0` floor), across all four transports (chat-completions, Anthropic messages, OpenAI responses, Google Gemini) and both streaming + non-stream response paths. This makes `chat.agent.thinkingStyle` work for OpenCode BYOK models, matching the behavior of Copilot-hosted models. Falls back to the legacy accumulate-and-flush behavior on hypothetical older hosts via a runtime guard. Tool-call replication (`onReasoningContent`) and think-tag filtering (`opencodego.stripThinkTags`) remain intact and compose with the new surfacing. No `enabledApiProposals` declaration needed. Verified working with DeepSeek and Kimi in Copilot Chat. Fixes [#22](https://github.com/ltmoerdani/opencode-copilot-chat/issues/22) and [#71](https://github.com/ltmoerdani/opencode-copilot-chat/issues/71). See `docs/issues/33-20260709-thinking-part-byok-surfacing-research.md`.

### Changed

- **`[Streaming]` `[stream-summary]` log now reports total reasoning characters accurately.** Previously, `reasoningChars` in the log reflected only the remaining `reasoningContent` string, which is cleared by `flushToolCalls` (for tool-call replication) and `flushReasoningFallback` — so the metric showed `0` even when reasoning was streamed. Now tracks a monotonic `totalReasoningChars` counter that survives clears, giving accurate per-response reasoning metrics for debugging.

### Fixed

- **`[Usage]` Monthly cost aggregation now respects the subscription anchor.** The monthly window was using calendar month after a regression, but OpenCode Go billing is anchor-based (subscription day/hour). The tracker now derives the window from three tiers: (1) user-configured anchor via "Set spent targets", (2) auto-anchor from the earliest SQLite row (matching actual billing start), (3) calendar month fallback. Also fixes `setManualSpentTargets` which previously computed the monthly cost for the old window before storing the anchor, causing tracked+baseline to mismatch the target. Now reads SQLite costs directly using the prospective window (with the new anchor).

## [0.3.6] — 2026-07-08

### Fixed

- **`[Compatibility]` Auto-fix VS Code 1.128 BYOK utility model error.** VS Code 1.128 changed the default of `chat.byokUtilityModelDefault` to `"none"`, silently breaking all background utility tasks (chat title generation, commit messages, intent detection) for BYOK users. On activation, the extension now checks whether any utility model setting is already configured; if not, it automatically writes `chat.byokUtilityModelDefault = "mainAgent"` to global settings and shows a one-time toast. The fix runs only on VS Code ≥1.128 and never overwrites a value the user has already set. See `docs/issues/32-20260708-vscode-128-byok-utility-model.md`.

## [0.3.5] — 2026-07-02

### Added

- **`[Usage]` Session-level cost tracking.** The status bar tooltip, SVG hover card, and usage QuickPick now show the cost of the current chat session (requests, tokens, USD). Each chat thread gets a unique `sessionId` derived from conversation content; the tracker accumulates costs per session in memory. Sessions idle for >2h are pruned automatically, capped at 50 active sessions, and persisted across restarts.
- **`[Usage]` VS Code session cost fields (`copilotCredits`).** Added `copilotCredits` to `UsageSnapshot`, `ProviderUsagePayload`, `TransportRequestSummary`, and `UsageLogEntry`. The `onTransportSummary` callback now computes credits (`cost × 100`, since 1 credit = $0.01) and mutates the summary directly so the `LanguageModelDataPart("usage")` emitted at the end of each response includes the credit total. This is the standard mechanism VS Code uses to accumulate per-session cost in `IChatModel.sessionCost`.
- **`[Usage]` SQLite-backed subscription cost accuracy.** The `getSummary()` method now reads the OpenCode CLI database (`opencode.db`) as its primary cost source. The database contains actual billed amounts, replacing the local estimate that drifted 9–15% (issue [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23)). When the CLI database is available, subscription totals (session 5h, weekly, monthly, today, yesterday) reflect real billing data. Token and request counts are still enriched from tracked entries (SQLite stores cost only). Falls back to the local estimate when the CLI database is absent. Fixes [#59](https://github.com/ltmoerdani/opencode-copilot-chat/issues/59).

### Changed

- **`[Model Picker]` Removed `triggerChange()` cross-provider re-resolution.** The agent-variant providers now resolve their API key independently via the secrets fallback path (`isAgentVariant || options.configuration`). Previously, the base provider called `triggerChange()` on the agent provider to force it to re-resolve after storing the BYOK key — this indirection is no longer needed since both paths reach the same `SecretStorage` read.
- **`[Model Picker]` Removed `categoryOrder` from `ProviderDefinition`.** This field was left over from the old `category: { label, order }` object that crashed the picker on VS Code ≥1.126 (fixed in 0.3.4). It was never read after the type was changed to a plain string.
- **`[Deps]` Bumped `@types/node` 25.9.3 → 26.1.0, `@vscode/vsce` 3.9.1 → 3.9.2, `@types/vscode` 1.120.0 → 1.125.0.** Minimum VS Code engine bumped from 1.120.0 to 1.125.0 to match `@types/vscode`.

### Fixed

- **`[Thinking]` GLM thinking enum values corrected, output popup removed, API key passed on model fetch.** [#61](https://github.com/ltmoerdani/opencode-copilot-chat/issues/61): Removed invalid `'on'` from GLM thinking enum — GLM models now accept only `'off'`/`'high'`/`'max'`. `reasoning_effort` is sent for GLM when the value is effort-based (`high`/`max`). Combined GLM/Kimi thinking schema split into separate blocks for clarity. [#67](https://github.com/ltmoerdani/opencode-copilot-chat/issues/67): Removed `getOutputChannel().show(true)` calls that caused random output popups during model fetch. [#62](https://github.com/ltmoerdani/opencode-copilot-chat/issues/62): `Authorization` header is now passed when fetching the model list (previously missing). Added comprehensive unit tests for GLM effort values. PR [#68](https://github.com/ltmoerdani/opencode-copilot-chat/pull/68) by [@Wallacy](https://github.com/Wallacy).
- **`[Request]` DeepSeek 400 error when prompt + completion exceeds context window.** When the prompt is large (e.g. 668K tokens on deepseek-v4-flash), the requested `max_tokens` (384K) combined with the prompt exceeded the 1048K context window, causing a 400 error from the provider. `modelLimits()` now caps `maxOutputTokens` to `contextWindow - promptReserve` using the estimated prompt size, preventing context overflow across all providers and endpoint types.
- **`[Security]` Picker debug log no longer leaks API keys.** The previous `JSON.stringify(options)` debug log wrote the full `options` object (including `configuration.apiKey`) to the Output channel in plaintext. Removed entirely — the log served only as a temporary diagnostic during the 1.125/1.126 picker investigation and is no longer needed.
- **`[Security]` `Clear API Key` action now warns about BYOK re-persistence.** When the user clears the key via `SecretStorage`, the next picker resolution re-stores it from `options.configuration` (BYOK). The info message now tells the user to also remove it from the Manage Models panel if they want a full clear.
- **`[Performance]` `reasoningContentByToolCallId` capped at 500 entries.** In long agent sessions (many tool calls), this `Map` grew without limit — one entry per `toolCallId` was added but never evicted. Over a multi-hour session this could accumulate thousands of entries of reasoning text. Now uses a LRU-style eviction: when the map exceeds 500 entries, the oldest entries (by insertion order) are removed. At ~200–500 tokens per reasoning chunk, 500 entries ≈ 100K–250K tokens of cached reasoning, which comfortably covers the most intensive agent workflows while bounding memory growth.
- **`[Performance]` `[sse-stats]` log now gated behind `debugReasoning`.** The SSE stats line was logged unconditionally on every streamed response, adding noise to the Output channel. Now gated behind the existing `debugReasoning` setting, matching the other SSE-level logs.
- **`[Optimization]` Removed dead `agentProvidersByBaseVendor` map.** This `Map<string, OpenCodeProvider>` was populated during activation but never read after `triggerChange()` was removed. It held strong references to the agent provider instances unnecessarily.

### Known Issues

- **`[Usage]` Session cost does not appear in the VS Code session info popover (the "ring" below the chat input).** VS Code 1.126 accumulates session cost by reading `usage.copilotCredits` from `IChatUsage` progress events (`{ kind: 'usage', copilotCredits: ... }`). This works for the Copilot provider because the Copilot extension's `ToolCallingLoop` explicitly calls `stream.usage({ copilotCredits })` after each model fetch. For BYOK providers (like OpenCode), the extension reports a `LanguageModelDataPart` with MIME `"usage"` at the end of the response stream — the same pattern used by Copilot's own BYOK providers (`AnthropicLMProvider`, `GeminiNativeProvider`). However, VS Code 1.126 does not convert `{ type: 'data', mimeType: 'usage' }` from BYOK provider streams into `IChatUsage` progress events. This is a VS Code limitation, not a missing extension feature. The data is correctly structured and available; the VS Code ChatService (`acceptResponseProgress`) simply does not process BYOK usage data parts yet. We expect this to be addressed in a future VS Code release. In the meantime, session cost is visible in the extension's own status bar tooltip and usage QuickPick.

## [0.3.4] — 2026-06-23

### Added

- **`[Usage]` Status bar click opens usage QuickPick.** Clicking the OpenCode Go usage status bar item now opens a QuickPick with session, weekly, and monthly progress bars, usage percentages, and reset countdowns. Quick actions: "Set spent targets…" and "Open full usage panel". Before this, the status bar was hover-only. No click handler.

### Fixed

- **`[Model Picker]` Chat model picker no longer crashes on VS Code ≥1.126.** The `category` field in `provideLanguageModelChatInformation` was typed as `{ label, order }`, but VS Code's `LanguageModelChatInformation.category` expects a plain `string`. The unified picker calls `category.charAt(0)`, which throws `TypeError` on an object. Now a plain string (`this.definition.displayName`). Fixes [#51](https://github.com/ltmoerdani/opencode-copilot-chat/issues/51).
- **`[Model Picker]` OpenCode models now appear on VS Code ≥1.126.** VS Code 1.126 sends `options.configuration={}` (empty object) instead of the BYOK key for non-agent providers. The extension now falls back to `SecretStorage` whenever `options.configuration` is present but holds no usable API key. This covers both agent variants (which never receive BYOK keys) and 1.126+ non-agent providers, with no version checks.
- **`[Usage]` Baseline editing recalculates correctly on re-edit.** `setManualSpentTargets()` now computes `baseline = target - tracked` for all three periods, without clamping to 0. Negative baselines are now allowed: they offset tracked entries downward, so `display = tracked + baseline = target`. Previously, `Math.max(0, ...)` blocked negative baselines. When a user lowered a target below the tracked amount, the display never updated because the delta clamped to 0. Session and weekly periods now also use delta-based calculation (matching monthly) instead of absolute target injection, which fixes expiry behavior.
- **`[Usage]` Input validation rejects non-numeric characters.** The usage target editor now validates input against the regex `/^-?\d+[.,]?\d*$/`. Strings like `60f` or `18asd` are rejected (previously `parseFloat` would silently accept the leading number). Both `.` and `,` work as decimal separators.
- **`[Usage]` Status bar tooltip refreshes immediately after editing targets.** `refreshGoUsageStatusBar()` now runs right after `setManualSpentTargets()`. The hover tooltip updates on the spot, no window reload needed.
- **`[Usage]` Removed dead `setCostResolver()` method.** `CostResolver` is injected via constructor closure and never updated after init. The setter was unreachable.
- **`[Usage]` Validation limits now derive from `GO_LIMITS`.** Input box validation for session ($12), weekly ($30), and monthly ($60) limits reads from the exported `GO_LIMITS` constant rather than hardcoded numbers. If limits change, the validation follows.
- **`[Usage]` Tooltip command link now uses `supportedCommands`.** Added `md.supportedCommands = ["opencodego.setUsageTargets"]` to the usage tooltip. The `[$(pencil) Set spent targets]` link now renders as a clickable command across VS Code versions.

---

## [0.3.3] — 2026-06-17

### Added

- **`[Usage]` Manual usage targets editor for the Go usage tracker.** New command **"OpenCode Go: Set Usage Targets…"** (`opencodego.setUsageTargets`) opens 5 sequential input boxes pre-filled with current values — session spent (5h rolling, limit $12), weekly spent (Mon–Mon UTC, limit $30), monthly spent (limit $60), monthly reset day (1–31), and monthly reset hour (0–23 UTC). Press Enter to keep the current value; Escape cancels the flow. Targets persist in `globalState` as baseline amounts, with a custom `expiresAt` anchor for the monthly counter. The status bar tooltip now links to this command via a `[$(pencil) Set spent targets]` markdown command link. Closes [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23). PR [#50](https://github.com/ltmoerdani/opencode-copilot-chat/pull/50) by [@Wallacy](https://github.com/Wallacy).
- **`[Reliability]` Runtime retry for HTTP 400 parameter errors.** When the upstream API rejects a parameter (thinking, temperature, reasoning_effort), the extension now parses the error message, patches the request body, and retries once automatically. This handles stale models.dev metadata and provider API changes without requiring a code release. Handles: `thinking.type` rejection, `invalid temperature`, `enable_thinking` rejection, `reasoning_effort` format mismatch, and generic `Extra inputs are not permitted`. Implemented in `src/retry.ts` with 8 unit tests + 7 E2E tests (mock server). Body consumption bug fixed to prevent double-read on non-recoverable errors.
- **`[Tooling]` Model validation script (`scripts/validate-models.mts`).** Pre-release validation that tests ALL thinking/reasoning parameter combinations for each model against the live OpenCode API. Reuses the extension's exact logic (`buildThinkingPayload`, `resolveModelRouting`, `buildOpenCodeGatewayAuthHeaders`) — no duplicated routing/auth/thinking code. Fetches live model list from models.dev. Run: `npm run validate-models -- --api-key YOUR_KEY`. Validated 89 parameter combinations across 18 models (13 Go + 5 Zen free) — all passing.
- **`[Tooling]` E2E retry test (`scripts/test-retry-e2e.mts`).** Mock server simulates OpenCode API behavior. Proves retry flow: HTTP 400 → `analyzeHttp400ForRetry()` → patch → retry → HTTP 200. Covers 5 recovery scenarios + 2 no-retry scenarios. Run: `npm run test-retry` (no API key needed).
- **`[Tooling]` Pre-release validation hook.** `npm run prepackage` now runs compile + test before packaging.

### Changed

- **`[Usage]` Monthly reset display respects user-configured anchor date.** `buildSummaryFromRows` and `buildSummaryFromTracked` now return `baseline.monthly.expiresAt` as `resetsAt` when a monthly baseline exists, so the "resets in Xd Yh" text reflects the user-set anchor instead of the auto-calculated month end. Previously the manual anchor was ignored on display.
- **`[Usage]` Live models.dev pricing injected into Go usage tracker.** A `CostResolver` callback is now passed to `GoUsageTracker` that reads `modelMetadataSnapshot.providers[GO_VENDOR]?.[modelId]?.cost`. Cost resolution priority: per-request `externalCost` → live models.dev snapshot → bundled `GO_MODEL_PRICING` table (kept as last-resort fallback so the extension stays functional when live fetch fails).
- **`[Usage]` Usage webview hardened (`enableScripts: false`).** The usage details panel is now display-only (SVG render) — message handlers and button scripts removed. Status bar click is disabled; usage details are visible via hover tooltip only.
- **`[Metadata]` models.dev cache TTL reduced from 6 hours to 1 hour.** Detects provider API changes faster, reducing the window where stale metadata causes HTTP 400 errors. Mitigation for [#24](https://github.com/ltmoerdani/opencode-copilot-chat/issues/24).

### Documentation

- Feature doc: `docs/features/07-20260615-model-validation-retry.md`
- Feature doc: `docs/features/08-20260617-manual-usage-targets.md`

Mitigates [#24](https://github.com/ltmoerdani/opencode-copilot-chat/issues/24).

## [0.3.2] — 2026-06-15

### Fixed

- **`[Thinking]` Kimi K2.7-code rejects `temperature` and `thinking.type: "disabled"` (dual 400 errors).** The newly released `kimi-k2.7-code` (Moonshot AI) introduced breaking changes from K2.6: (1) `thinking.type` only accepts `"enabled"` — passing `"disabled"` returns HTTP 400 (`invalid thinking: only type=enabled is allowed for this model`); (2) the `temperature` request parameter is rejected (only `1` is allowed). The extension sent both rejected values because the model was unregistered in the fallback metadata and the default thinking setting is `kimi: "off"`. Fix: register `kimi-k2.7-code` in `MODEL_LIMITS_BY_PROVIDER` (context 256000 / output 262144 per models.dev), add to `VISION_CAPABLE_MODELS`, introduce `MODELS_WITHOUT_TEMPERATURE` set that propagates `temperature: false` via `fallbackModelMetadata` so the request body omits the parameter, and special-case `/^kimi-k2\.7/i` in `buildThinkingPayload` to always emit `{ thinking: { type: "enabled", keep: "all" } }` (thinking cannot be disabled for this model). The Thinking picker shows a single "Always On (K2.7)" option with the Moonshot API constraint description. `kimi-k2.6` and `kimi-k2.5` remain unchanged (they accept `disabled`). Fixes [#25](https://github.com/ltmoerdani/opencode-copilot-chat/issues/25).
- **`[Model Picker]` Agent models no longer duplicated in the Manage Language Models panel.** Replaced the double-registration approach (PR #39/#42) with separate vendor IDs (`opencodego-agent`, `opencodezen-agent`). Each vendor now shows only its own models — zero duplication in any picker or management UI. Agent models are hidden from the Manage panel by default (`showAgentModelsInManagePanel: false`) while still working in the Agents window.

### Added

- **`opencodego.agentsWindow`** boolean setting (default `true`). Controls whether agent-host providers are registered at runtime. When enabled, agent models appear in the Agents window picker.
- **`opencodego.showAgentModelsInManagePanel`** boolean setting (default `false`). Controls whether agent vendors appear in the Manage Language Models panel. Enable to manage agent API keys separately.
- **`resolveBaseVendor()`** helper in `providerTypes.ts` — maps agent vendor IDs back to their base vendor for routing and metadata resolution.
- **`providerVariant()`** helper in `extension.ts` — creates DRY agent provider definitions from base definitions.
- **BYOK key synchronization** — main provider stores API key via `context.secrets.store()` and triggers agent provider re-resolution via `triggerChange()`.

### Changed

- Agent vendors (`opencodego-agent`, `opencodezen-agent`) declared in `package.json` with `when: "config.opencodego.showAgentModelsInManagePanel"` clause.
- `routing.ts` uses `resolveBaseVendor()` before all vendor comparisons to fix routing for agent variants.
- `metadata.ts` `toEffectiveModelId()` vendor parameter widened to accept `AllProviderVendor`.
- Replaces the `opencodego.showInAgentsWindow` setting from PR #42 with the cleaner two-setting approach (`agentsWindow` + `showAgentModelsInManagePanel`).

### Changed

- **Thinking helpers extracted to `src/thinking.ts` (pure module).** `thinkingFamily`, `buildFamilyThinkingSchema`, `applyRequestThinkingOverride`, `buildThinkingPayload`, and `buildQwenAnthropicThinkingPayload` moved out of `extension.ts` into a new pure module (`src/thinking.ts`) with zero `vscode` dependency. This enables unit testing without mocking the VS Code API surface. `extension.ts` now re-imports all five functions; all call sites unchanged — behavior identical. Unit tests added (`src/test/metadata.test.ts`, `src/test/thinking.test.ts` — 32 tests, all passing).

Fixes [#25](https://github.com/ltmoerdani/opencode-copilot-chat/issues/25), [#41](https://github.com/ltmoerdani/opencode-copilot-chat/issues/41). Alternative to PR [#42](https://github.com/ltmoerdani/opencode-copilot-chat/pull/42) by [@Wallacy](https://github.com/Wallacy).

## [0.3.1] — 2026-06-15

### Fixed

- **`[Model Picker]` Models no longer shown twice in the Language Models management UI.** PR #39 registered each model twice (a general variant + a `::agent-host` variant with `targetChatSessionType: "copilotcli"`) so OpenCode models could appear in the Agents window picker. `filterModelsForSession()` hid the duplicate from the Chat view dropdown and Agents window picker, but the Language Models management UI (BYOK enable/disable list) enumerates the raw registration list with no session filter — so both variants appeared there with a `::agent-host` suffix (issue #41, regression from #39 in v0.3.0).

### Added

- **`opencodego.showInAgentsWindow`** boolean setting (default `false`). Gates the `::agent-host` duplicate behind an explicit opt-in. **Disabled by default** so each model appears exactly once everywhere (pre-#39 behaviour restored). When enabled, an `(Agents)` suffix is added to the duplicate entry's name so the two are visually distinguishable in the Language Models management UI.

### Changed

- **Agents window support is now opt-in.** Users upgrading from v0.3.0 who relied on OpenCode models in the Agents window must now **also** set `"opencodego.showInAgentsWindow": true` (in addition to `extensions.supportAgentsWindow`) to restore model visibility there.

Fixes [#41](https://github.com/ltmoerdani/opencode-copilot-chat/issues/41). PR [#42](https://github.com/ltmoerdani/opencode-copilot-chat/pull/42) by [@Marinski](https://github.com/Marinski).

---

## [0.3.0] — 2026-06-14

### Added

- **`[Model Picker]` OpenCode models in the Agents window.** OpenCode Go and Zen models now appear in the VS Code Agents window model picker when starting a Copilot CLI session, alongside Claude and GPT models. Previously they were only visible in the Chat view.
- **Action Required.** Add `"extensions.supportAgentsWindow": { "ltmoerdani.opencode-copilot-chat": true }` to VS Code settings to enable the extension in the Agents window, then reload.

Fixes [#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11). PR [#39](https://github.com/ltmoerdani/opencode-copilot-chat/pull/39) by [@Marinski](https://github.com/Marinski).

---

## [0.2.9] — 2026-06-14

### Fixed

- **`[Thinking]` "Off" option missing for models.dev effort-only schemas.** Models whose `models.dev` `reasoning_options` contained only `{ type: "effort" }` without `{ type: "toggle" }` (e.g. DeepSeek V4 Flash with `high`, `max`) showed no "Off" option in the Thinking Effort picker — users could not disable reasoning. Fix moves the "off" enum entry outside the `hasToggle` guard so it is always available. Also adds an "on" option for toggle-only models (toggle but no effort values) so they get a proper off/on choice. Fixes [#35](https://github.com/ltmoerdani/opencode-copilot-chat/issues/35). PR [#38](https://github.com/ltmoerdani/opencode-copilot-chat/pull/38) by [@sublimode](https://github.com/sublimode).

### Added

- **Model picker demo GIF.** Added `docs/screenshots/model-picker.gif` showing the Copilot Chat model picker flow with OpenCode models, wired into the README demo section. PR [#37](https://github.com/ltmoerdani/opencode-copilot-chat/pull/37) by [@sublimode](https://github.com/sublimode).

### Changed

- **README model tables synced with fallback catalog.** Added 15 missing models across the Go and Zen tables to match the bundled `MODEL_LIMITS_BY_PROVIDER` in `src/metadata.ts`. Includes `minimax-m3`, `minimax-m2.1`, `minimax-m2`, `hy3-preview`, `ring-2.6-1t` (Go) and `claude-opus-4-5`, `claude-opus-4-1`, `claude-sonnet-4`, `claude-haiku-4-5`, `gemini-3-flash`, `gpt-5.3-codex`, `gpt-5.2` variants, `gpt-5.1` variants, `gpt-5` variants, `trinity-large-preview-free` (Zen). PR [#34](https://github.com/ltmoerdani/opencode-copilot-chat/pull/34) by [@rupayon123](https://github.com/rupayon123).
- **Community health files.** Added `CONTRIBUTING.md`, GitHub Issue templates (bug report, feature request), PR template, `FUNDING.yml`, `dependabot.yml`, and CI workflow (`ci.yml`). Simplified to be beginner-friendly.

### Documentation

- New issue doc: `docs/issues/22-20260614-thinking-off-missing-for-effort-only-schemas.md`

---

## [0.2.8] — 2026-06-13

### Fixed

- **`[Streaming]` MiniMax M3 `<think>` tag leak — reimplementation.** The `opencodego.stripThinkTags` setting was declared in `package.json` and read from config, but the actual stripping logic was missing from the runtime code — MiniMax M3's inline `<think>...</think>` reasoning blocks leaked directly into the Copilot Chat UI. This fix introduces a new `ThinkTagFilter` class (streaming-safe state machine with partial-tag carry buffer) wired into both `OpenAiResponseExtractor` and `AnthropicResponseExtractor`, all four streaming entry points, and all text extraction paths (`delta.content`, `delta.text`, `content_block_start`, `content_block_delta`, fallback deltas). The extracted thinking content is accumulated into the existing `reasoningContent` pipeline instead of being discarded. Also fixes the `ApiSettings.stripThinkTags` type from `"auto" | "on" | "off"` to `"never" | "auto" | "always"` to match the `package.json` enum. In `"auto"` mode (default), stripping applies only to models matching `/^minimax-m/i`.

---

## [0.2.7] — 2026-06-12

### Fixed

- **Kimi thinking format correction.** The `[0.2.4]` changelog entry incorrectly stated that Kimi models use `enable_thinking: true | false`. Tests confirm the OpenCode Go gateway **rejects** `enable_thinking` (HTTP 400: "Extra inputs are not permitted"). The correct format is `thinking: { type: "enabled" | "disabled" }` — matching GLM's format and what the gateway expects for MoonshotAI models on the OpenAI-compatible endpoint. The extension code has been using `thinking: { type }` all along; this entry corrects the record.
- **Respect model `temperature` support from models.dev.** The extension now reads the `temperature: boolean` field from `models.dev` metadata and omits the `temperature` parameter from request payloads when the model declares it unsupported (`temperature: false`). This fixes HTTP 400 errors ("temperature is deprecated for this model.") on models like `claude-opus-4-8` and the GPT-5 family, which have deprecated the temperature parameter.

---

## [0.2.6] — 2026-06-10

### Removed

- **Removed message trimming feature entirely** (`messageTrimmer.ts`). The byte-aware trimming that pruned older conversation turns was too aggressive and disruptive — users reported losing significant context with notifications appearing on every long conversation. Removed all related code: `messageTrimmer.ts` module, trimming logic in `extension.ts`, and payload size safety net in `streaming.ts`.
- **Removed gzip compression** (`node:zlib`). The OpenCode Go/Zen proxy does not support `Content-Encoding: gzip` and returns HTTP 500 Internal Server Error when receiving compressed request bodies. All outgoing requests now send raw JSON payloads.

---

## [0.2.5] — 2026-06-10

### Fixed

- **Removed gzip compression** — the OpenCode Go/Zen proxy does **not** support `Content-Encoding: gzip` and returns HTTP 500 Internal Server Error when receiving compressed request bodies. All outgoing requests now send raw JSON payloads. Message trimming (`messageTrimmer.ts`) remains the primary mechanism for keeping payloads under the proxy's ~400 KB body limit.

---

## [0.2.4] — 2026-06-10

### Added

- **Byte-aware message trimming.** New `messageTrimmer.ts` module provides `trimApiMessages()` which prunes older conversation turns when the messages array exceeds a byte budget (~800 KB). Always preserves the system prompt, full conversation turns, and tool-call atomicity. A subtle notification is shown to the user when a significant portion (>30%) of context is trimmed.
- **Context Size selector for tiered-pricing models.** Models with `cost.tiers[]` or `cost.context_over_200k` in their `models.dev` metadata now expose a **Context Size** dropdown in the VS Code model picker (e.g. `256K` ↔ `1M`). The selected value caps the effective `maxInputTokens` for each request, matching the pricing structure declared by the upstream provider. Supported for both OpenCode Go and OpenCode Zen models.
- **Dynamic reasoning options from models.dev.** When a model's `models.dev` entry declares explicit `reasoning_options` (e.g. `[{type:"effort",values:["low","medium","high","max"]}]`), the model picker renders those exact effort levels, overriding the family-based hardcoded defaults. The `reasoningOptions` field is propagated through `ModelMetadataFields` → `ResolvedModelMetadata` → `modelConfigurationSchema()`.
- **Thinking controls for Mimo and MiniMax models.** MiniMax (`minimax-m*`) models now support on/off thinking only (`thinking: { type: "disabled"|"adaptive"|"enabled" }` — the OpenCode gateway does not expose `reasoning_effort` for this family, as verified in the official `transform.ts`). Mimo (`mimo-v2.*`) models support `off`/`low`/`medium`/`high` reasoning effort levels. DeepSeek (`deepseek-v4-*`) models support `off`/`low`/`medium`/`high`/`max` — matching the upstream OpenCode reasoning effort options sourced from the official OpenCode provider `transform.ts`. The `opencodego.thinking.mimo`, `opencodego.thinking.minimax` and `opencodego.thinking.deepseek` settings have been updated with the corrected enum values.
- **Kimi thinking format corrected.** Kimi models (`kimi-k2.5`, `kimi-k2.6`) on the OpenAI-compatible chat-completions endpoint now send `enable_thinking: true | false` (MoonshotAI-native boolean) instead of the Anthropic-style `thinking: { type: "enabled" | "disabled" }` object, which was silently ignored. The `opencodego.thinking.kimi` setting description updated accordingly.
- **Dynamic configuration schema** — any model with `reasoning: true` in its resolved metadata (from `models.dev`, live API, or bundled fallback) automatically gets a generic `off`/`on` Thinking Effort control in the model picker, without requiring a hardcoded family mapping. Future reasoning-capable models will work out of the box.
- New settings `opencodego.thinking.mimo` (`"off"` / `"low"` / `"medium"` / `"high"`, default `"off"`) and expanded `opencodego.thinking.deepseek` (`"off"` / `"low"` / `"medium"` / `"high"` / `"max"`, default `"off"`).
- New setting `opencodego.stripThinkTags` (`"auto"` / `"on"` / `"off"`, default `"auto"`) — strips `<!--<think-->...<!--</think-->` tags from model output. In `"auto"` mode, stripping applies only to known models that inline reasoning in content (MiniMax M3 family). Merged from main (`v0.2.2`).

### Changed

- **Merged `main` into `develop`** — all features from `main` (Mimo thinking, context size selector, dynamic reasoning, strip think tags, icon refresh) are now unified with develop-only features (gzip compression, message trimming) into a single coherent branch.
- Streaming layer cleaned up — removed gzip compression logic that caused proxy 500 errors. SSE parsing and request flow remain unchanged.

### Fixed

- Fixed merge conflict in `modelLimits()` signature — `contextSizeOverride` parameter from main is now correctly combined with develop's message trimming logic.
- Fixed missing `stripThinkTags` property on `ApiSettings` interface after merge.
- Fixed missing closing parenthesis on `stripThinkTags` config getter that caused TypeScript parse error.
- Fixed `Buffer` not found TypeScript error by replacing `Buffer.from(part.data).toString("utf8")` with `new TextDecoder().decode(part.data)` in `estimateDataPartTokenCount`.

---

## [0.2.3] — 2026-06-09

### Added

- Refreshed extension icon (`opencodego.png` and `opencodego.svg`) with a redesigned visual featuring gradient backgrounds, subtle grid pattern, glow effects, and sparkle accents for a more polished marketplace presence.

### Changed

- Cleaned up the "OpenCode" output channel by removing all verbose debug and informational logs. The output channel was previously flooded with per-model registration logs, per-request summaries, streaming stats, metadata refresh messages, and usage tracking lines. Now the output channel only surfaces error-level messages (e.g. `ERROR model=...`) and critical warnings (empty response, rate limits, HTTP errors), keeping it clean for production use. All removed diagnostic data was already accessible through the extension's diagnostics document and status bar indicators.

### Fixed

- Fixed `Buffer` not found TypeScript error by replacing `Buffer.from(part.data).toString("utf8")` with `new TextDecoder().decode(part.data)` in `estimateDataPartTokenCount`. `TextDecoder` is a Web API available in all JS environments without requiring `@types/node`.

---

## [0.2.2] — 2026-06-08

### Fixed

- Strip `<think>...</think>` tags from model output when enabled. For streaming responses, the inner thinking content is accumulated into the reasoning pipeline and displayed via the existing reasoning fallback. For non-streaming fallback, the tags are removed and only the surrounding text is kept. Gated by the new `opencodego.stripThinkTags` setting (`"auto"` / `"always"` / `"never"`). In `"auto"` mode (default), stripping applies only to known models that inline reasoning in `<think>` tags within the content field (MiniMax M3 family).

---

## [0.2.1] — 2026-06-06

### Removed

- Removed the unused `opencodego.showUsage` command, `showGoUsagePanel` WebView panel, and related activation event. The Go Usage Tracker details are still accessible via the status bar indicator (`Go: XX%·XX%·XX%`). The separate Quick Pick panel was removed because the status bar already provides glanceable usage data and the dedicated panel added unnecessary code complexity without proportional user benefit.

---

## [0.2.0] — 2026-06-05

### Added

- Added **Go Usage Tracker** — real-time tracking of OpenCode Go subscription limits as percentages in the status bar and a Quick Pick panel.
  - Tracks 5-hour rolling ($12), weekly ($30), and monthly ($60) limits per the OpenCode Go subscription tiers.
  - Calculates client-side cost from token usage × per-model pricing (input, output, cache_read) for every Go model.
  - Status bar indicator (`Go: 27%·62%·75%`) shows 5h / weekly / monthly usage at a glance, with ⚠ warning when any period exceeds 80%.
  - Click the status bar to open a detailed Quick Pick panel showing progress bars, today/yesterday breakdown, and actions to open diagnostics console or reset data.
  - Usage log persisted in VS Code `globalState` so data survives editor restarts.
  - New command: `OpenCode Go: Show Usage` (`opencodego.showUsage`).

---

## [0.1.10] — 2026-06-05

### Fixed

- Fixed Qwen models returning 401 error ("Model qwen3.7-max is not supported for format oa-compat"). Qwen models on the OpenCode Go gateway are only available through the Anthropic Messages API endpoint, not the OpenAI chat-completions endpoint. Reverted the routing while fixing the actual root cause. _Background: the initial investigation on 2026-05-15 identified that `qwen3.6-plus-free` uses an Anthropic-bridged gateway that re-derives tools from message history, causing infinite tool-call loops (see `docs/issues/01-20260515-qwen36-tool-call-loop.md`)._
- Fixed Anthropic streaming tool call parsing in `AnthropicResponseExtractor`. The extractor now correctly handles Anthropic SSE event types (`content_block_start` with `tool_use` blocks, `content_block_delta` with `input_json_delta`, `message_delta`, `message_stop`) so Qwen tool calls are properly captured and surfaced to VS Code Copilot Chat.
- Fixed Anthropic usage metadata parsing. Added support for Anthropic-native fields (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) in addition to OpenAI fields, so the context window indicator updates correctly for Qwen models routed through the messages endpoint.
- Fixed Qwen thinking payload format when routed through the Anthropic messages endpoint. Qwen thinking settings are now translated to Anthropic-native format (`{ type: "enabled"|"disabled" }`) instead of Qwen-native `enable_thinking` boolean, matching what the OpenCode gateway expects.

---

## [0.1.9] — 2026-06-04

### Fixed

- Fixed Qwen models (`qwen3.5-plus`, `qwen3.6-plus`, `qwen3.6-plus-free`, `qwen3.7-max`) not being able to call VS Code tools (file reading, terminal, etc.) and responding with short answers without follow-through. The root cause was Qwen being incorrectly routed to the Anthropic Messages API (`/messages`) which uses a different tool calling format (`tool_use` content blocks) than Qwen's native OpenAI-compatible format (`choices[].delta.tool_calls`). All Qwen models now correctly route to the chat-completions endpoint (`/chat/completions`) where tool calls are properly parsed and surfaced to Copilot Chat.
- Fixed context window indicator not updating for Qwen models by ensuring the response streaming path correctly reports usage metadata back to VS Code.

---

## [0.1.8] — 2026-06-04

### Added

- Added support for VS Code's `languageModelPricing` proposed API, exposing `pricing`, `inputCost`, `outputCost`, `cacheCost`, and `priceCategory` on every registered model so the model picker and management UI can display real cost metadata.
- Parsed per-model cost data from the live `models.dev` registry (`cost.input`, `cost.output`, `cost.cache_read`, `cost.cache_write`) and converted USD values to AI Credits (`1 USD = 100 AI credits`) for native VS Code consumption.
- Added modality detection from `models.dev` metadata, surfacing audio, video, and PDF input support in model tooltips and detail badges alongside the existing vision indicator.

### Changed

- Removed the `opencodego.experimentalContextIndicator` configuration setting and its associated context-window hook bridge; the same capability was already implemented natively in commit `ca8bbb6` and the redundant experimental path is no longer needed.
- Consolidated duplicate local type definitions (`BaseModelLimits`, `ModelMetadataFields`, `CachedModelMetadataSnapshot`, `ResolvedModelMetadata`) that were shadowing the canonical types in `metadata.ts`, ensuring `cost` and modality fields flow correctly through the metadata pipeline.
- Bumped the cached `models.dev` snapshot key from `v3` to `v4` so users automatically re-fetch the registry on next activation and pick up the freshly added `cost` and modality data, instead of consuming stale cached entries that did not carry those fields.
- Aligned the `priceCategory` thresholds with the Copilot extension's 3:1 input:output weighted blend so low/medium/high/very_high buckets line up with what the user sees for the official Copilot models (e.g. Kimi k2.6 is `medium`, GPT-5.4 is `medium`, Claude Opus 4.5 is `high`, GPT-5.4 Pro is `very_high`).

### Fixed

- Corrected the `modelCapabilities` return type to use the official `vscode.LanguageModelChatCapabilities` shape (`imageInput`, `toolCalling`, `supportsImageToText`, `supportsToolCalling`) instead of ad-hoc fields, aligning with how VS Code internally maps provider capabilities to `vision` / `toolCalling` / `agentMode`.

---

## [0.1.7] — 2026-05-27

### Added

- Added recent OpenCode transport summaries to the Go and Zen diagnostics reports, including endpoint, initiator, metadata source, request IDs, token usage, latency, and error details for the last provider requests.
- Persist recent diagnostics request summaries in VS Code global state so the request history survives extension host reloads and can be reused if VS Code later exposes richer BYOK debug surfaces.
- Added a usage status bar summary with prompt/output/total/cache data after each OpenCode response.
- Added OpenCode usage DataPart emission so later Copilot Chat integrations can consume normalized prompt/output/cache metadata without re-parsing raw transport logs.
- Added an opt-in experimental context-indicator hook that can inject real BYOK usage into the Copilot Chat footer using VS Code internals.

### Changed

- Extracted the OpenCode transport and SSE parsing layer into a dedicated `streaming.ts` module so provider wiring, request building, and stream normalization can evolve independently.
- Keep capturing request usage and finish metadata even when VS Code's native Agent Debug Log does not surface custom BYOK provider telemetry.
- Enriched OpenCode output logging with normalized usage lines, finish reasons, and cache hit ratio when the upstream provider reports cache metadata.
- Route provider progress and usage through a local request-id bridge so the experimental context hook can bind real request usage back to VS Code's internal chat request ids.
- Simplified the Anthropic `/messages` request builder by removing dead branches and consolidating repeated text extraction helpers after the qwen3.7 transport fix.
- Refreshed the bundled fallback catalogs to match the current OpenCode Go catalog and the current free/paid Zen catalogs.

### Fixed

- Fixed OpenCode `/messages` authentication to follow the gateway contract (`x-api-key` for Anthropic-style routes, bearer auth for OpenAI-style routes), which restores OpenCode Go `qwen3.7-max` in Copilot Chat.
- Fixed the OpenCode `/messages` body builder to emit Anthropic-compatible message blocks instead of forwarding OpenAI-shaped payloads to that endpoint.
- Aligned OpenCode Go and Zen Qwen routing with the current official endpoint docs: Go `qwen3.5-plus`, `qwen3.6-plus`, and `qwen3.7-max`, plus Zen `qwen3.5-plus` / `qwen3.6-plus`, now use `/messages`.
- Report provider token usage back to VS Code via `LanguageModelDataPart` MIME `usage` so Copilot Chat's Context Window widget can display used tokens instead of staying at 0%.
- Improved local token counting for chat messages, tool calls, tool results, JSON/data parts, and image attachments.
- Logged raw HTTP error bodies in the OpenCode output channel so provider-specific backend failures can be diagnosed without reproducing requests manually.

## [0.1.6] — 2026-05-21

### Added

- Added configurable OpenCode request and streaming idle timeouts so Copilot Chat requests fail clearly instead of hanging indefinitely.
- Added sticky OpenCode request headers (`x-opencode-session`, `x-opencode-request`, `x-opencode-client`) so Go and Zen requests preserve gateway affinity behavior.
- Added clearer rate-limit and quota handling, including retry/quota details from response headers when available.
- Added a TTL-cached models.dev metadata snapshot, merged with live `/models` metadata and a bundled fallback catalog for offline picker registration.
- Added native Zen GPT routing through `/responses` and Zen Gemini routing through the documented Google-style `/models/{model}:streamGenerateContent?alt=sse` endpoint.

### Changed

- Corrected fallback-advertised model limits to follow `models.dev` whenever the live `/models` payload does not provide limit metadata, fixing earlier Go/Zen cross-provider mix-ups in the bundled table.
- This reduces several previously overstated fallback values, notably `deepseek-v4-flash-free` to `200000 / 128000`, `glm-5` and `glm-5.1` to `202752 / 32768`, and Go `minimax-m2.5` to `204800 / 65536`.

### Fixed

- Updated bundled fallback limits and capability hints so the picker stays usable when neither `/models` nor models.dev can be refreshed.
- Zen Claude, Zen GPT, Zen Gemini, and Go MiniMax families now use the correct transport automatically instead of being forced through a single OpenAI-compatible route.

---

## [0.1.5] — 2026-05-20

### Fixed

- Fixed vision requests with image attachments failing before upload due to stack overflow while encoding image bytes.
- Avoid forcing Qwen `thinking_budget` on vision requests when Thinking is set to Auto, reducing image request token pressure from Alibaba-backed models.
- Stopped advertising image input support for models that do not support image attachments in OpenCode metadata: `glm-5`, `glm-5.1`, `minimax-m2.5`, `minimax-m2.7`, `minimax-m2.5-free`, `mimo-v2-pro`, and `mimo-v2.5-pro`.

---

## [0.1.4] — 2026-05-17

### Added

- Added `opencodego.freeOnly` to control whether the OpenCode Zen provider exposes only free models or the full Zen catalog.
- Added native per-model Thinking configuration schema for DeepSeek, GLM, Kimi, and Qwen models.
- Added `reasoningEffort` support for Thinking controls and request logging for selected model configuration and final Thinking payload.

### Fixed

- Preserved numeric model versions in picker labels, so Zen model IDs like `claude-opus-4-5` now display as `Claude Opus 4.5` instead of `Claude Opus 4 5`.
- Bumped model metadata revision to force VS Code to refresh model-picker configuration metadata, including corrected model labels.
- Sanitized Copilot tool schemas before forwarding them to OpenCode providers, avoiding Moonshot/Kimi 400 errors caused by `$ref` schemas with sibling descriptions.
- Sent Qwen chat requests through the OpenCode chat-completions endpoint while preserving hybrid OpenAI/Anthropic stream parsing, avoiding the `/messages` auth path that returned `Missing API key`.
- Filter deprecated OpenCode models using the models.dev registry before registering them with VS Code, with a local safety list for free models that now return provider 404s (`ring-2.6-1t-free`, `trinity-large-preview-free`).
- Removed stale unavailable models from bundled fallback lists so offline fallback does not reintroduce models that can no longer serve requests.
- API errors now use the active provider display name instead of always saying `OpenCode Go`.

---

## [0.1.3] — 2026-05-16

### Fixed

- **Context size now correct in picker and chat bar.** Removed the formula that inflated `advertisedContextWindow` by adding `maxOutputTokens` on top of `contextWindow`, which caused VS Code to round up and display `2M` for models with 262K or 1M actual context.
- **Model limits ported from models.dev (official OpenCode registry).** All context and output limits are now sourced from the authoritative `models.dev/api.json` registry, fixing previously wrong values across most models:
  - `qwen3.6-plus-free` / `qwen3.6-plus` / `qwen3.5-plus`: corrected from 1 M → **262 K** context
  - `glm-5` / `glm-5.1` max output: corrected from 32 K → **131 K**
  - `minimax-m2.5` max output: corrected from 65 K → **131 K**
  - `mimo-v2-omni` max output: corrected from 65 K → **128 K**
  - `hy3-preview`: corrected from 262 K / 128 K → **256 K / 64 K**
  - `ring-2.6-1t-free`: corrected to **262 K / 66 K**
  - `trinity-large-preview-free`: corrected to **131 K / 131 K**
  - `nemotron-3-super-free`: corrected from 262 K → **204 K** context, 65 K → **128 K** output
  - `big-pickle`: corrected from 262 K → **200 K** context, 65 K → **128 K** output
- **Model limits are now per-provider (Zen vs Go).** `MODEL_LIMITS_BY_PROVIDER` prevents Go and Zen limits from contaminating each other when both providers expose a model with the same ID (e.g. `qwen3.6-plus`, `glm-5.1`, `minimax-m2.7`).
- **Hard cache-bust for VS Code picker metadata.** Model `id`, `family`, and `version` fields now encode a per-revision token (`ctxfix-2026-05-16-b`) so VS Code drops stale context-size metadata after this update instead of showing old values.
- **API requests always use the raw upstream model ID**, never the revisioned effective ID, so backend routing is unaffected by the cache-bust strategy.
- **`qwen3.6-plus-free` deprecation label corrected.** Earlier sessions incorrectly labelled the model as deprecated based on a community PR that was ultimately rejected. The model is actively re-enabled by the OpenCode team ("Round 2 — found more GPUs"). Label is now "Limited capacity" with a note to retry on 5xx rather than "Deprecated upstream".

### Changed

- `provideLanguageModelChatResponse` now resolves the raw model ID via `model.rawModelId` before calling `modelLimits()` and forwarding the ID to the backend, so the revisioned effective ID is never sent to the OpenCode API.
- `modelLimits()` now accepts an optional `vendor` parameter; callers inside `OpenCodeProvider` pass `this.definition.vendor` for accurate per-provider lookups.

---

## [0.1.2] — 2026-05-14

### Added

- Added `opencodego.debugReasoning` to write provider `reasoning_content` to **Output → OpenCode** for opt-in debugging.
- Added a separate native **OpenCode Zen** provider (`opencodezen`) with its own BYOK configuration flow and free-model list from `https://opencode.ai/zen/v1/models`.
- Added `OpenCode Zen: Diagnostics` for inspecting Zen models registered with VS Code.

### Fixed

- Kept advertised context-size metadata consistent across the Language Models table, Copilot model picker tooltip, and chat context indicator while preserving the full OpenCode Go max-output limit for API requests.
- Improved provider token counting for mixed chat/tool content so Copilot receives a more realistic context usage estimate.
- Stopped resolving an extra unconfigured OpenCode Go model group from the legacy command-stored API key.
- Native Language Models entries are now produced only for configured provider groups, preventing duplicate model rows.
- Cached native BYOK API keys per resolved model so Copilot chat requests continue to work when VS Code does not pass provider configuration into `provideLanguageModelChatResponse`.
- Implemented OpenAI-compatible streaming tool-call parsing and conversion to `LanguageModelToolCallPart`, enabling Copilot Agent tool loops for file reads, search, edits, and workspace actions.
- Preserved assistant tool calls and tool results when converting VS Code chat history back into OpenAI-compatible messages.
- Captured and replayed DeepSeek `reasoning_content` on follow-up tool-result requests so thinking-mode models can continue multi-step tool workflows without provider errors.

---

## [0.1.1] — 2026-05-14

### Fixed

- Switched the Language Models gear flow to VS Code's native provider configuration schema.
- Added `apiKey` as a secret provider configuration field so configure/add prompts proceed from **Group Name** to **OpenCode Go API Key**.
- Provider now reads the configured API key from VS Code's language model configuration, with the command-stored key kept as a fallback.

---

## [0.1.0] — 2026-05-14

### Added

- Initial public release on VS Code Marketplace
- Live model list fetched from `https://opencode.ai/zen/go/v1/models` on activation
- Bundled fallback model metadata table (context window + max output tokens per model)
- Dual endpoint routing: OpenAI-compatible `/chat/completions` for standard models, Anthropic-compatible `/messages` for MiniMax M2 models
- Tool-calling support forwarded to both endpoint types
- `OpenCode Go: Manage Provider` command — model selection and management dialog
- `OpenCode Go: Set API Key` command — stores API key in VS Code Secret Storage
- `OpenCode Go: Diagnostics` command — renders a markdown report of all registered models
- Settings: `opencodego.temperature`, `opencodego.maxTokens`, `opencodego.maxInputTokens`
- Per-model token limit overrides via `opencodego.maxInputTokens` and `opencodego.maxTokens`
