**Status:** ✅ Solved

# OpenCode Provider Architecture

**Topic:** provider / models / routing / usage / security
**Updated:** 2026-06-24
**Tags:** #provider #models #routing #byok #vscode #tool-calling #thinking #usage #security
**Supersedes:** -
**Original Session:** 2026-05-14
**Documented:** 2026-06-12
**Last verified:** 2026-06-24

> **Note:** This is a living reference document. All timeline entries below are ✅ Solved and reflect the current codebase. The document is periodically updated as new releases are shipped.

---

## Overview

OpenCode Copilot Chat is a VS Code extension that registers OpenCode models as native GitHub Copilot Chat language models through the VS Code Language Model Chat Provider API.

The extension exposes two independent BYOK providers:

| Provider     | Vendor ID     | Purpose                                       | Model Source                           |
| ------------ | ------------- | --------------------------------------------- | -------------------------------------- |
| OpenCode Go  | `opencodego`  | Paid Go/top-up models                         | `https://opencode.ai/zen/go/v1/models` |
| OpenCode Zen | `opencodezen` | Free Zen models by default, paid Zen optional | `https://opencode.ai/zen/v1/models`    |

Both providers can be configured at the same time through VS Code **Language Models → Add Models...**. Each provider group owns its own API key secret in VS Code's native provider configuration flow, so Go and Zen can be added, configured, and removed separately.

This document is intentionally backdated to the original provider-architecture session on 2026-05-14. Later sections include follow-up changes through 2026-07-02 so maintainers can understand the full evolution without opening multiple changelog entries.

---

## Timeline

| Date       | Version    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status    |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 2026-05-14 | 0.1.0      | Initial OpenCode Go provider, model list, fallback limits, endpoint routing, tool support, and diagnostics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ Solved |
| 2026-05-14 | 0.1.1      | Native VS Code Language Models BYOK configuration schema and secret `apiKey` flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ Solved |
| 2026-05-14 | 0.1.2      | Separate OpenCode Zen provider, free-model filtering, key caching, tool-call streaming, and DeepSeek reasoning replay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ Solved |
| 2026-05-16 | 0.1.3      | Context-size metadata corrected and model limits split per provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ Solved |
| 2026-05-17 | 0.1.4      | Zen `freeOnly`, per-model thinking configuration, model-label fixes, schema sanitization, and unavailable-model filtering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ Solved |
| 2026-05-21 | 0.1.6      | Request timeout, sticky gateway headers, models.dev cache, Zen GPT `/responses`, and Zen Gemini routing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ Solved |
| 2026-05-27 | 0.1.7      | Transport diagnostics, usage status bar, usage DataPart, context-window hook, and OpenCode auth/body fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ Solved |
| 2026-06-04 | 0.1.8      | Pricing metadata, modality detection, provider capability shape, and redundant experimental context setting removal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ Solved |
| 2026-06-05 | 0.2.0      | Go Usage Tracker for subscription limits and cost tracking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ Solved |
| 2026-06-09 | 0.2.4      | Context Size selector, dynamic reasoning options, Mimo/MiniMax/DeepSeek/Kimi thinking controls, and strip-think-tags setting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ Solved |
| 2026-06-12 | 0.2.7      | Temperature support guard and Kimi thinking documentation correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ Solved |
| 2026-06-23 | 0.3.4      | VS Code ≥1.126 model picker crash fix: `category` type from object to string, secrets fallback via `options.configuration` discriminator, agent variant independent resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ Solved |
| 2026-06-24 | 0.3.4      | Security hardening: removed API key debug log leak, Clear API Key BYOK warning, `reasoningContentByToolCallId` memory cap at 500, removed dead `agentProvidersByBaseVendor` map and `categoryOrder` field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ Solved |
| 2026-08-03 | 0.5.0      | Issue [#86](https://github.com/ltmoerdani/opencode-copilot-chat/issues/86) (PR [#101](https://github.com/ltmoerdani/opencode-copilot-chat/pull/101)): dropped the `isAgentVariant \|\| options.configuration` guard so non-agent `opencodezen` / `opencodego` providers fall back to `SecretStorage` whenever `options.configuration` is absent. Mirrors Copilot's own `AbstractLanguageModelChatProvider`. The previous in-code comment claiming `configuration=undefined` was a transient "still resolving" state was incorrect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ Solved |
| 2026-08-05 | 0.5.0      | Issue [#106](https://github.com/ltmoerdani/opencode-copilot-chat/issues/106) (PR [#108](https://github.com/ltmoerdani/opencode-copilot-chat/pull/108)): regression from the #86 fix where a native BYOK group caused every Zen model to be listed twice. The provider now records per vendor when a BYOK group exists and keeps the groupless call silent in that case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ Solved |
| 2026-08-07 | Unreleased | PR [#113](https://github.com/ltmoerdani/opencode-copilot-chat/pull/113) bridge hardening (#103 + #109): `truncation: "auto"` + bounded output on Responses, tool/MCP schemas in prompt estimates, proportional tokenizer headroom, upstream-count HTTP 400 recovery across 4 transports, `editTools` dropped for Marketplace, cold-start `SecretStorage` credentials, runtime diagnostics, blocking CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Solved |
| 2026-08-10 | Unreleased | Issue [#121](https://github.com/ltmoerdani/opencode-copilot-chat/issues/121) (PR [#124](https://github.com/ltmoerdani/opencode-copilot-chat/pull/124)): dropped `managementCommand` from the `opencodego`, `opencodezen`, and agent-variant `languageModelChatProviders` contributions. VS Code's `configureLanguageModelsProviderGroup()` short-circuits on `managementCommand` (re-resolves models and returns), so "+ Add Models" never prompted for a group name/API key, context-menu actions (Rename/Update API Key/Delete/Open in JSON) failed with `group not found`, and leftover BYOK groups were undeletable. With only the `configuration` schema present, the native BYOK group flow runs end-to-end. Legacy manage commands remain in the Command Palette as the SecretStorage fallback path.                                                                                                                                                                                                                                                                                                                        | ✅ Solved |
| 2026-08-11 | 0.5.2      | Issue [#122](https://github.com/ltmoerdani/opencode-copilot-chat/issues/122) (PR [#125](https://github.com/ltmoerdani/opencode-copilot-chat/pull/125)): OpenCode Go/Zen missing from the Agents window (VS Code ≥1.129) because the extension never ran there (`extensions.supportAgentsWindow`) and the BYOK bridge (`chat.agentHost.byokModels.enabled`) was off. The extension now auto-enables both settings (gated by `opencodego.autoEnableAgentsWindow`, default `true`), records what it flipped in globalState, and reverts only its own changes when `agentsWindow` is disabled. Also adds per-provider kill switches `opencodego.enabled` / `opencodezen.enabled` with matching `when` clauses on the vendor contributions plus `Remove/Re-add Provider in Language Models` commands and a Manage QuickPick action. Enabled flags are read from the root config via `providerEnabledSetting()` in the new pure module `src/providerEnablement.ts` (agent variants resolve to their base vendor).                                                                                                                        | ✅ Solved |
| 2026-08-10 | Unreleased | PR [#123](https://github.com/ltmoerdani/opencode-copilot-chat/pull/123): multi-turn `reasoning_content` echo for DeepSeek V4 and other OpenAI-compatible reasoning models. Follow-up turns 400'd with `The reasoning_content in the thinking mode must be passed back to the API` because `convertMessage()` dropped `LanguageModelThinkingPart` from assistant history. Thinking text is now extracted from history parts and echoed back as `reasoning_content` on assistant messages, gated by model family via `shouldEchoThinkingHistory()`. Family gating: DeepSeek (required), Gemini (maps to `thought: true`), GLM/Kimi/Qwen/MiniMax (tolerated); omitted for MiMo (issue #38), GPT (Responses API), Claude (Anthropic API), unknown. See `docs/issues/55-20260811-pr123-deepseek-reasoning-content-echo.md`.                                                                                                                                                                                                                                                                                                             | ✅ Solved |
| 2026-08-11 | 0.5.2      | PR [#126](https://github.com/ltmoerdani/opencode-copilot-chat/pull/126) (follow-up on #123): extracted `shouldEchoThinkingHistory()` and the `LanguageModelThinkingPart.value` normalization into a new pure module `src/reasoningHistory.ts` (`thinkingTextFromValue()` + `shouldEchoThinkingHistory()`) with a +16-test regression suite covering every model family including the issue #38 MiMo carve-out (177/177 pass). Added the `typeof vscode.LanguageModelThinkingPart === "function"` runtime guard to `thinkingPartText()` in `src/extension.ts`, mirroring the defensive pattern already used in `src/streaming.ts`. No behavior change. See `docs/issues/59-20260811-pr126-reasoning-history-guard-tests.md`.                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ Solved |
| 2026-08-12 | Unreleased | PR [#129](https://github.com/ltmoerdani/opencode-copilot-chat/pull/129): strict-but-sane lint stack + intelligent pre-commit gate. ESLint keeps `strict` + `strictTypeChecked` (the bug-catchers), drops the pure-`stylistic` layer that fought prettier. `npm run lint` now ends with a Tests step. New `scripts/staged-lint.ts` lints staged files **plus their direct import dependents** so changing a module can never leave type-aware errors in its consumers. Branch also carries unified `lint.ts`/`format.ts` runners, `editorconfig-checker` + `shellcheck` + `tsconfig.check.json` type-check (covers `scripts/`), eslint 10.8.1, `@types/node` 26.2 (supersedes dependabot #91). Post-review refinements: all 217 `void describe/it/test` prefixes dropped from test files (`22e04b7`), `@ts-expect-error` allowed while `@ts-ignore` stays banned (`5246434`), TypeScript-first config (`eslint.config.ts` + typed scripts via `tsx`, `76570cc`), standard extensions only (`514a63f`), markdownlint config renamed to `.json` (`c817871`). See `docs/issues/61-20260812-pr129-strict-lint-stack-precommit-gate.md`. | ✅ Solved |
| 2026-08-12 | Unreleased | Issue [#130](https://github.com/ltmoerdani/opencode-copilot-chat/issues/130) (PR [#132](https://github.com/ltmoerdani/opencode-copilot-chat/pull/132)): server-accurate Go usage meters via the official `/zen/go/v1/usage` endpoint. The status bar / tooltip / quick-pick / webview previously showed locally estimated Session/Weekly/Monthly percentages that drifted from opencode.ai (CLI, cross-device, pre-install usage were invisible). New pure module `src/goUsageSync.ts` (`fetchGoUsage` + `mergeServerUsage` + failure classifier) syncs the server meters with a 60s TTL; `spent` is derived from the authoritative percent, Today/Yesterday + per-session spend stay device-local. Failures fall back to the existing SQLite → tracked estimates. The key is only ever sent as the Authorization header and never logged or persisted. Also fixes a dead Reset action, a card that collapsed on reset, and a dead Open Console quick-pick. See `docs/issues/62-20260812-pr132-go-usage-server-sync.md`.                                                                                                           | ✅ Solved |

---

## Goals

1. Make OpenCode Go and OpenCode Zen models available directly in GitHub Copilot Chat.
2. Preserve the native Copilot Chat model picker, tool-calling loop, and Agent Mode workflow.
3. Keep Go and Zen setup separate so a user can enable only one provider or both.
4. Resolve live model metadata whenever possible while keeping a robust bundled fallback.
5. Route each model family to the transport format expected by the OpenCode gateway.
6. Report usage and context-window metadata back to VS Code as accurately as the public and internal APIs allow.

---

## Provider Registration

Provider registration starts in `src/extension.ts`.

```ts
vscode.lm.registerLanguageModelChatProvider(GO_VENDOR, goProvider);
vscode.lm.registerLanguageModelChatProvider(ZEN_VENDOR, zenProvider);
```

The vendor constants live in `src/providerTypes.ts`:

| Constant     | Value         |
| ------------ | ------------- |
| `GO_VENDOR`  | `opencodego`  |
| `ZEN_VENDOR` | `opencodezen` |

The native provider configuration schema is declared in `package.json` under `contributes.languageModelChatProviders`. VS Code prompts for a group name first, then the provider-specific `apiKey` secret field.

> **Note (since #121 / PR #124):** the contributions no longer declare `managementCommand`. Declaring it alongside a `configuration` schema makes VS Code's `configureLanguageModelsProviderGroup()` short-circuit (re-resolve models and return) without ever prompting for a group name or API key, so the native BYOK group flow never runs. With only the `configuration` schema present, "+ Add Models" and the group context-menu actions (Rename / Update API Key / Delete / Open in Language Models JSON) work end-to-end. The extension's own manage commands remain registered and reachable from the Command Palette as a legacy SecretStorage fallback.
>
> **Note (since #122 / PR #125):** each vendor contribution also carries a `when` clause (`config.opencodego.enabled` / `config.opencodezen.enabled`) so a disabled provider disappears from the Manage Language Models view, the "+ Add Models" list, the Chat picker, and the Agents window. At runtime, registration is gated by the same flags (spread-gated `registerLanguageModelChatProvider` calls in `activate()`), and the flags are read from the **root** configuration via `providerEnabledSetting()` in `src/providerEnablement.ts` — never from a section-scoped config, which would silently misread `opencodezen.enabled` as `opencodego.opencodezen.enabled`.

### Configuration Commands

| Command                                                   | Purpose                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `OpenCode Go: Manage Provider`                            | Refresh models, test connection, configure utility models                  |
| `OpenCode Go: Remove/Re-add Provider in Language Models`  | Toggle `opencodego.enabled` (remove/re-add the provider, requires reload)  |
| `OpenCode Zen: Remove/Re-add Provider in Language Models` | Toggle `opencodezen.enabled` (remove/re-add the provider, requires reload) |
| `OpenCode Go: Diagnostics`                                | Go model and transport diagnostics                                         |
| `OpenCode Zen: Diagnostics`                               | Zen model and transport diagnostics                                        |
| `OpenCode: Model Picker Diagnostics`                      | Cross-provider model metadata comparison                                   |
| `OpenCode: Set Thinking Effort...`                        | Global thinking-mode helper for supported families                         |

The recommended — and only — setup path is VS Code's native **Language Models** UI ("+ Add Models"). The `Set API Key` command and the legacy key-management menu items were removed (the old single `opencodego.apiKey` secret could not represent both Go and Zen keys); the remaining manage commands cover refresh, connection testing, and diagnostics.

---

## API Key Handling

The native provider configuration passes the API key through `options.configuration.apiKey` during model listing and request handling. Because VS Code may not always pass provider configuration into every chat response call, the provider also caches resolved keys by model ID after successful model discovery.

For model discovery (`provideLanguageModelChatInformation`), the extension resolves the key in two steps:

1. Read `options.configuration.apiKey` (the native BYOK value) if VS Code supplied one.
2. If step 1 produced nothing, fall back to `SecretStorage` unconditionally.

The fallback is an internal mirror of Copilot's own `AbstractLanguageModelChatProvider`, which always falls back to its own storage when `configuration.apiKey` is absent. Since the `Set API Key` command was removed, the only writer is the BYOK group resolution itself: when a non-agent provider resolves a key it persists it into its **per-vendor** secret (`opencodego.apiKey` / `opencodezen.apiKey`, resolved via `secretKeyFor()` in `src/config.ts`), so agent-host variants and cold-start requests inherit it. A per-vendor flag (`hasConfiguredByokGroup`) suppresses the groupless call once a native BYOK group exists, so models are not listed twice ([#106](https://github.com/ltmoerdani/opencode-copilot-chat/issues/106)). A group call whose `configuration` is present but carries no API key is treated as a **per-model configuration group** (only `settings`, created when the user picks e.g. `reasoningEffort` in the model picker) and returns no models, so the groupless call remains the single source; per-model settings still apply at request time via `modelConfiguration` ([#131](https://github.com/ltmoerdani/opencode-copilot-chat/issues/131)).

Security rules:

- Real API keys are never written to repository files.
- Documentation must use placeholders only.
- API keys are entered through VS Code's native secret-backed provider configuration ("+ Add Models"); there is no command-palette key entry.
- `SecretStorage` remains only as an internal fallback (per-vendor, mirroring the BYOK group key for agent variants and cold-start requests).

Safe placeholder example:

```bash
OPENCODE_API_KEY=<YOUR_API_KEY>
```

---

## Model Discovery

Model discovery uses this sequence:

1. Fetch live provider model list from OpenCode.
2. Merge live data with `models.dev` metadata when available.
3. Use cached `models.dev` metadata for up to six hours.
4. Fall back to bundled metadata from `src/metadata.ts`.

### Live Sources

| Provider     | Endpoint                               |
| ------------ | -------------------------------------- |
| OpenCode Go  | `https://opencode.ai/zen/go/v1/models` |
| OpenCode Zen | `https://opencode.ai/zen/v1/models`    |
| models.dev   | `https://models.dev/api.json`          |

### Metadata Resolution

`src/metadata.ts` resolves:

- Context window
- Max output tokens
- Vision/audio/video/PDF capability
- Reasoning support
- Reasoning options
- Temperature parameter support
- Pricing and pricing tiers
- Model status/deprecation state

The resolved provider-specific metadata is used to populate VS Code `LanguageModelChatInformation`.

---

## Zen Free Model Filtering

OpenCode Zen can expose free and paid models. By default, the extension limits Zen registration to free models to match the expected Zen setup flow.

The behavior is controlled by:

```json
{
  "opencodego.freeOnly": true
}
```

When `freeOnly` is enabled, Zen includes:

- Model IDs ending with `-free`
- Known free non-suffixed IDs such as `big-pickle`

When `freeOnly` is disabled, paid Zen models from the live Zen catalog can also appear.

Known unavailable Zen entries are filtered before registration so stale or temporarily unsupported models do not remain visible purely because `/models` still lists them.

---

## Endpoint Routing

Routing is centralized in `src/routing.ts`.

| Condition                          | Endpoint Kind      | Endpoint                                    |
| ---------------------------------- | ------------------ | ------------------------------------------- |
| Zen GPT family (`gpt-*`)           | `responses`        | `/zen/v1/responses`                         |
| Claude family                      | `messages`         | `/zen/v1/messages`                          |
| Go MiniMax M2 family               | `messages`         | `/zen/go/v1/messages`                       |
| Qwen 3.5/3.6 Plus and Qwen 3.7 Max | `messages`         | provider messages endpoint                  |
| Gemini family (Zen + Go)           | `google`           | `streamGenerateContent?alt=sse` style route |
| All other models                   | `chat-completions` | provider chat-completions endpoint          |

The request layer maps VS Code chat parts and tools into the correct request body for the selected endpoint.

### Auth Header Mapping

`src/openCodeAuth.ts` maps auth headers by endpoint type:

| Endpoint Kind      | Header                                   |
| ------------------ | ---------------------------------------- |
| `chat-completions` | `Authorization: Bearer <key>`            |
| `responses`        | `Authorization: Bearer <key>`            |
| `messages`         | `x-api-key: <key>` + `anthropic-version` |
| `google`           | `x-goog-api-key: <key>`                  |

---

## Tool Calling

Tool calling is required for Copilot Agent workflows such as reading files, searching code, editing files, and running terminal commands.

The extension supports:

- OpenAI-compatible `tool_calls`
- Anthropic-compatible `tool_use` blocks
- Responses API function-call normalization
- Gemini function-call normalization
- Tool result conversion back into provider-specific chat history

Streaming parsers accumulate partial tool-call argument chunks before emitting VS Code `LanguageModelToolCallPart` instances.

---

## Thinking And Reasoning

Thinking support is model-family specific and is configured through `opencodego.thinking.*` settings plus dynamic `models.dev` reasoning metadata.

| Family   | Setting                                     | Payload Behavior               |
| -------- | ------------------------------------------- | ------------------------------ |
| DeepSeek | `opencodego.thinking.deepseek`              | Maps to reasoning effort       |
| GLM      | `opencodego.thinking.glm`                   | Maps to `thinking: { type }`   |
| Kimi     | `opencodego.thinking.kimi`                  | Maps to `thinking: { type }`   |
| MiniMax  | `opencodego.thinking.minimax`               | Maps to on/off thinking shape  |
| Mimo     | `opencodego.thinking.mimo`                  | Maps to reasoning effort       |
| Qwen     | `opencodego.thinking.qwen` and `qwenBudget` | Maps to Qwen thinking controls |

Reasoning content is handled carefully:

- Provider `reasoning_content` is captured during streaming.
- Tool-call follow-up requests can replay required reasoning content when the upstream provider requires it.
- Multi-turn thinking history is echoed back as `reasoning_content` on assistant messages, gated by model family (`shouldEchoThinkingHistory`, in the pure module `src/reasoningHistory.ts` since PR #126): DeepSeek requires it (HTTP 400 if omitted), Gemini maps it to `thought: true` parts, GLM/Kimi/Qwen/MiniMax tolerate it; it is omitted for MiMo (strict validator, issue #38), GPT (Responses API), Claude (Anthropic API), and unknown models. See `docs/issues/55-20260811-pr123-deepseek-reasoning-content-echo.md` and `docs/issues/59-20260811-pr126-reasoning-history-guard-tests.md`.
- `opencodego.debugReasoning` can write raw reasoning content to **Output → OpenCode** for debugging.
- Reasoning is not directly displayed in Copilot Chat unless VS Code exposes a compatible surface.

---

## Context Window And Usage Reporting

The extension reports model context metadata through VS Code `LanguageModelChatInformation`:

- `maxInputTokens`
- `maxOutputTokens`
- model capabilities
- pricing and detail metadata when available

For very large-output models, the extension separates UI-friendly advertised values from actual request `max_tokens` so the Language Models table, model picker tooltip, and Copilot Chat context indicator remain consistent.

The usage path includes:

- `src/usage.ts` for normalized prompt/output/cache usage snapshots
- `src/goUsageTracker.ts` for Go subscription tracking
- `src/contextWindowHook.ts` for bridging BYOK usage into VS Code's internal context-window UI
- status bar summaries for latest response usage
- recent transport summaries persisted to VS Code `globalState`

### Context Safety

Since PR #113, request budgets are bounded so long and tool-heavy sessions are not rejected by the upstream tokenizer:

- Prompt estimates (`src/tokenEstimate.ts`) include Copilot/MCP tool schemas, not just message text, and run after vision proxying and old-image trimming.
- `src/modelLimits.ts` reserves proportional tokenizer headroom (12% of the local prompt estimate, floor 64 tokens) instead of a fixed margin, and caps the requested output to the context remaining after the prompt.
- Responses requests (`src/responsesRequest.ts`) send `truncation: "auto"` and omit the proxy-sensitive `text.verbosity` field.
- If upstream still reports an exact context overflow (HTTP 400 with authoritative counts), `src/retry.ts` reduces the `max_tokens` / `max_output_tokens` / `max_completion_tokens` / Gemini `generationConfig.maxOutputTokens` budget and retries once, across all four transports.

The context-window hook silently no-ops if VS Code internals change or cannot be captured.

---

## Diagnostics

Diagnostics are designed to answer whether a model is registered, where its metadata came from, and what happened during recent transport requests.

| Diagnostic               | Includes                                                    |
| ------------------------ | ----------------------------------------------------------- |
| OpenCode Go Diagnostics  | Go models, metadata, routing, recent Go request summaries   |
| OpenCode Zen Diagnostics | Zen models, metadata, routing, recent Zen request summaries |
| Model Picker Diagnostics | Go, Zen, and Copilot model metadata side by side            |

Recent summaries include endpoint kind, initiator, metadata source, request IDs, usage, latency, and errors when available.

---

## Files Changed

> **Note (2026-08-14, PR #155):** the flat `src/` god-file layout below was reorganized into domain folders. The historical file list is kept for reference; the current structure is documented in feature doc [`17-20260814-data-driven-model-registry.md`](../features/17-20260814-data-driven-model-registry.md) and the repo-root `ARCHITECTURE-MAP.md`.

Core implementation files (historical, pre-#155):

- `src/extension.ts` → now a thin entry; provider class in `src/provider/OpenCodeProvider.ts`, commands in `src/commands/`
- `src/providerTypes.ts`
- `src/routing.ts` → moved to `src/core/routing.ts` (reads `src/core/registry.ts`)
- `src/streaming.ts` → split into `src/transports/` (barrel removed)
- `src/metadata.ts` → moved to `src/models/metadata.ts`
- `src/openCodeAuth.ts`
- `src/chatParts.ts`
- `src/usage.ts` → moved to `src/usage/usage.ts`
- `src/goUsageTracker.ts` → split into `src/usage/` (barrel removed)
- `src/contextWindowHook.ts`
- `src/retry.ts` (400 parameter + context-overflow recovery, transient 5xx classification)
- `src/modelLimits.ts` → moved to `src/models/modelLimits.ts`
- `src/responsesRequest.ts` (Responses request envelope: `truncation: "auto"`, bounded output)
- `src/tokenEstimate.ts` (prompt estimate incl. tool/MCP schemas)
- `src/modelCapabilities.ts` → moved to `src/models/modelCapabilities.ts`
- `src/apiKeyResolution.ts` (configured → registered → SecretStorage key resolution)
- `src/runtimeDiagnostics.ts` (runtime/elevation diagnostics)
- `package.json`

Documentation and release files:

- `README.md`
- `CHANGELOG.md`
- `docs/devlog.md`
- `docs/architecture/01-20260514-open-code-provider-architecture.md`

---

## Verification

Codebase verification performed on 2026-06-12:

```bash
rg -n "registerLanguageModelChatProvider|GO_VENDOR|ZEN_VENDOR" src package.json
rg -n "resolveModelRouting|responses|messages|google|chat-completions" src
rg -n "freeOnly|models.dev|MODEL_METADATA_CACHE" src package.json README.md
rg -n "contextWindowHook|LanguageModelDataPart|usage" src README.md
```

Expected verification before release:

```bash
npm run compile
npm run package
```

Manual smoke test:

1. Install the VSIX.
2. Reload VS Code.
3. Open **Language Models → Add Models...**.
4. Add **OpenCode Go** with a Go API key.
5. Add **OpenCode Zen** with a Zen API key.
6. Confirm both provider groups appear separately.
7. Confirm Zen free models appear when `opencodego.freeOnly` is enabled.
8. Select one Go model and one Zen model in Copilot Chat and run a tool-using prompt.

---

## Operational Notes

- Do not document real API keys, VS Code secret values, or user-specific `globalState` contents.
- Prefer native Language Models provider configuration over legacy command-based key storage.
- Keep provider-specific model limits separate because Go and Zen can share model IDs with different context/output limits.
- Treat `models.dev` as an enrichment source, not the only source of truth.
- Keep routing tests focused on endpoint kind and payload shape because endpoint regressions usually break tool calling first.
