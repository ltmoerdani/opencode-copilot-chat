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

| Date       | Version | Change                                                                                                                                                                                                    | Status    |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 2026-05-14 | 0.1.0   | Initial OpenCode Go provider, model list, fallback limits, endpoint routing, tool support, and diagnostics                                                                                                | ✅ Solved |
| 2026-05-14 | 0.1.1   | Native VS Code Language Models BYOK configuration schema and secret `apiKey` flow                                                                                                                         | ✅ Solved |
| 2026-05-14 | 0.1.2   | Separate OpenCode Zen provider, free-model filtering, key caching, tool-call streaming, and DeepSeek reasoning replay                                                                                     | ✅ Solved |
| 2026-05-16 | 0.1.3   | Context-size metadata corrected and model limits split per provider                                                                                                                                       | ✅ Solved |
| 2026-05-17 | 0.1.4   | Zen `freeOnly`, per-model thinking configuration, model-label fixes, schema sanitization, and unavailable-model filtering                                                                                 | ✅ Solved |
| 2026-05-21 | 0.1.6   | Request timeout, sticky gateway headers, models.dev cache, Zen GPT `/responses`, and Zen Gemini routing                                                                                                   | ✅ Solved |
| 2026-05-27 | 0.1.7   | Transport diagnostics, usage status bar, usage DataPart, context-window hook, and OpenCode auth/body fixes                                                                                                | ✅ Solved |
| 2026-06-04 | 0.1.8   | Pricing metadata, modality detection, provider capability shape, and redundant experimental context setting removal                                                                                       | ✅ Solved |
| 2026-06-05 | 0.2.0   | Go Usage Tracker for subscription limits and cost tracking                                                                                                                                                | ✅ Solved |
| 2026-06-09 | 0.2.4   | Context Size selector, dynamic reasoning options, Mimo/MiniMax/DeepSeek/Kimi thinking controls, and strip-think-tags setting                                                                              | ✅ Solved |
| 2026-06-12 | 0.2.7   | Temperature support guard and Kimi thinking documentation correction                                                                                                                                      | ✅ Solved |
| 2026-06-23 | 0.3.4   | VS Code ≥1.126 model picker crash fix: `category` type from object to string, secrets fallback via `options.configuration` discriminator, agent variant independent resolution                            | ✅ Solved |
| 2026-06-24 | 0.3.4   | Security hardening: removed API key debug log leak, Clear API Key BYOK warning, `reasoningContentByToolCallId` memory cap at 500, removed dead `agentProvidersByBaseVendor` map and `categoryOrder` field | ✅ Solved |

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

### Configuration Commands

| Command                              | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `OpenCode Go: Manage Provider`       | Legacy fallback key management, refresh, and connection test |
| `OpenCode Go: Set API Key`           | Legacy fallback key storage                                  |
| `OpenCode Go: Diagnostics`           | Go model and transport diagnostics                           |
| `OpenCode Zen: Diagnostics`          | Zen model and transport diagnostics                          |
| `OpenCode: Model Picker Diagnostics` | Cross-provider model metadata comparison                     |
| `OpenCode: Set Thinking Effort...`   | Global thinking-mode helper for supported families           |

The recommended setup path is still VS Code's native **Language Models** UI. The legacy commands remain for diagnostics and fallback compatibility.

---

## API Key Handling

The native provider configuration passes the API key through `options.configuration.apiKey` during model listing and request handling. Because VS Code may not always pass provider configuration into every chat response call, the provider also caches resolved keys by model ID after successful model discovery.

Security rules:

- Real API keys are never written to repository files.
- Documentation must use placeholders only.
- API keys should be entered through VS Code's native secret-backed provider configuration.
- Legacy `SecretStorage` support remains only as a fallback path.

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
| Zen Gemini family                  | `google`           | `streamGenerateContent?alt=sse` style route |
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

Core implementation files:

- `src/extension.ts`
- `src/providerTypes.ts`
- `src/routing.ts`
- `src/streaming.ts`
- `src/metadata.ts`
- `src/openCodeAuth.ts`
- `src/chatParts.ts`
- `src/usage.ts`
- `src/goUsageTracker.ts`
- `src/contextWindowHook.ts`
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
