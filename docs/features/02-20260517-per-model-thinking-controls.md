**Status:** ✅ Solved

# Per-Model Thinking Controls

**Topic:** provider / models / thinking / vscode / copilot-chat
**Updated:** 2026-09-23
**Tags:** #provider #models #thinking #vscode #copilot-chat #reasoning #byok
**Supersedes:** —
**Related:** PR [#155](https://github.com/ltmoerdani/opencode-copilot-chat/pull/155) (per-provider strategy refactor) · feature doc [`17-20260814-data-driven-model-registry.md`](17-20260814-data-driven-model-registry.md)

---

## Overview

This document records the per-model Thinking controls feature for OpenCode Go and OpenCode Zen models in GitHub Copilot Chat.

The original session started on **2026-05-17 Asia/Jakarta**. The feature request was to expose model-family-specific Thinking behavior similar to Copilot's built-in `Thinking Effort` picker, while preserving separate OpenCode Go and OpenCode Zen provider configuration.

Before this work, the extension only had `opencodego.debugReasoning`, which writes provider `reasoning_content` to the OpenCode output channel for diagnostics. That setting remains diagnostic-only and is separate from user-facing Thinking controls.

---

## Problem

OpenCode models do not all use the same request fields for reasoning or thinking. A single global on/off setting cannot accurately represent the available controls.

The target model-family behavior was:

| Family      | User Choice                                   | Request Mapping                                                                                                                          |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek    | `off` / `low` / `medium` / `high` / `max`     | `reasoning_effort` when not `off`                                                                                                        |
| GLM 5/5.1   | `high` / `max` / `off`                        | `reasoning_effort` (gateway resolves to toggle for older models)                                                                         |
| GLM 5.2     | `high` / `max` / `off`                        | `reasoning_effort: "high" \| "max"`; `"off"` → `thinking: { type: "disabled" }`                                                          |
| Kimi        | `on` / `off`                                  | `thinking: { type: "enabled"                                                     \| "disabled" }`                                        |
| MiniMax     | `on` / `off`                                  | `thinking: { type: "enabled"                                                     \| "disabled" \| "adaptive" }` depending on route/model |
| Mimo        | `off` / `low` / `medium` / `high`             | `reasoning_effort` when not `off`                                                                                                        |
| Qwen        | `auto` / `on` / `off`                         | `enable_thinking` for chat completions, Anthropic-native `thinking` for messages                                                         |
| Qwen budget | `auto` / `4096` / `16384` / `32768` / `81920` | `thinking_budget` or `budget_tokens` depending on endpoint                                                                               |

The desired user experience was to make the model picker show the relevant Thinking state for the selected model family, so users could choose between faster non-thinking responses and deeper reasoning modes without editing request payloads manually.

---

## Solution

### Family-Aware Settings

The feature adds explicit settings under the `opencodego.thinking.*` namespace:

| Setting                          | Purpose                       |
| -------------------------------- | ----------------------------- |
| `opencodego.thinking.deepseek`   | DeepSeek reasoning effort     |
| `opencodego.thinking.glm`        | GLM on/off thinking           |
| `opencodego.thinking.kimi`       | Kimi on/off thinking          |
| `opencodego.thinking.minimax`    | MiniMax on/off thinking       |
| `opencodego.thinking.mimo`       | Mimo reasoning effort         |
| `opencodego.thinking.qwen`       | Qwen auto/on/off thinking     |
| `opencodego.thinking.qwenBudget` | Optional Qwen thinking budget |

These settings act as persistent defaults and as a fallback when the VS Code model picker does not expose native model configuration controls.

> **GLM 5.3+ cannot disable thinking (issue #162).** GLM 5.3 and later reject `thinking: { type: "disabled" }` with _"This model always engages in thinking and cannot be disabled"_. The `glm` strategy detects 5.3+ by version, forces thinking on (default `high`), and hides `off` from the picker — mirroring the Kimi K2.7-code force-on behavior. A defensive retry pattern also strips `thinking` when the upstream reports it cannot be disabled. Full write-up: `docs/issues/73-20260821-issue162-glm53-always-thinking.md`.
>
> **OpenAI effort is now a first-class setting (PR #160).** `opencodego.thinking.openai` exposes the OpenAI/GPT reasoning effort (`off`/`low`/`medium`/`high`/`xhigh`), mapped to the Responses API `reasoning.effort` field.
>
> **Muse Spark 1.2 (PR #168).** New `MuseThinking` strategy with the same effort ladder via `reasoning: { effort }` — see feature doc `18-20260821-muse-spark-1-2.md`.

### Native Model Configuration Schema

Thinking-capable models publish a `configurationSchema` through `LanguageModelChatInformation`.

The main picker property is:

```ts
reasoningEffort;
```

This matches the convention used by Copilot built-in models. The schema is built per model family so unsupported controls are not shown for unrelated models.

When `models.dev` provides `reasoning_options`, those options are preferred over hardcoded family defaults. This keeps the picker aligned with upstream model metadata when OpenCode updates supported reasoning levels.

### Per-Request Override

VS Code sends model picker choices on the request options object as:

```ts
options.modelConfiguration;
```

The extension reads that object and overlays only the selected model family's Thinking values onto the persistent defaults. This keeps changes scoped to the current model instead of accidentally changing every model family.

> **Schema-default echo is stripped (#226).** VS Code merges our picker schema defaults into the resolved `modelConfiguration` on every request (`resolveModelConfiguration` merges defaults in every branch) and strips default-equal values from persisted user picks — so a delivered value equal to the family's schema default (e.g. `reasoningEffort: "off"`) can never be a genuine user choice; it is the baseline being echoed back. `resolveThinkingConfig` (`src/thinking/resolve.ts`, `stripSchemaDefaultEcho`) drops those keys before applying the override, letting the global `opencodego.thinking.*` defaults take effect for models the user never configured per-model. A default-equal value therefore means "fall through to workspace", and only non-default per-model picks win. Full write-up: `docs/issues/100-20260923-issue226-thinking-default-echo.md`.

### Command Fallback

The command:

```text
OpenCode: Set Thinking Effort…
```

lets users change the same Thinking defaults from a Quick Pick when their VS Code/Copilot UI does not expose the native picker submenu.

### Request Payload Mapping

The request mapping is endpoint-aware and family-aware:

| Family                   | Mapping                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| DeepSeek                 | `reasoning_effort` when not `off`                                 |
| GLM                      | `thinking: { type: "enabled"                     \| "disabled" }` |
| Kimi                     | `thinking: { type: "enabled"                     \| "disabled" }` |
| MiniMax                  | `thinking` payload for supported MiniMax routes                   |
| Mimo                     | `reasoning_effort` when not `off`                                 |
| Qwen `/chat/completions` | `enable_thinking` and optional `thinking_budget`                  |
| Qwen `/messages`         | `thinking: { type, budget_tokens? }`                              |

---

## Implementation Notes

> **Architecture (post-#155, 2026-08-14):** the thinking system is now **per-provider strategy classes** under `src/thinking/`, not one monolithic builder. The behavior table below is still the source of truth for user-visible controls; the internal layout is described in the section after this one.

| Function / Area                                | Purpose                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `thinkingFamily()` (in `thinking/provider.ts`) | Classifies raw model IDs into Thinking families, **reading `core/registry.ts`**        |
| `thinkingProviderFor()`                        | Factory returning the per-family strategy class (`DeepSeekThinking`, `GlmThinking`, …) |
| `modelConfigurationSchema()`                   | Creates VS Code per-model configuration schema                                         |
| `buildFamilyThinkingSchema()`                  | Builds picker options from `models.dev` or family defaults                             |
| `applyRequestThinkingOverride()`               | Applies `modelConfiguration` over persistent defaults                                  |
| `getRequestModelConfiguration()`               | Reads `options.modelConfiguration` with a defensive fallback                           |
| `buildThinkingPayload()`                       | Emits OpenCode request fields for each model family                                    |
| `buildQwenAnthropicThinkingPayload()`          | Converts Qwen settings for Anthropic-style `/messages` requests                        |
| `showThinkingEffortPicker()`                   | Provides command-based fallback configuration (`src/commands/thinkingPicker.ts`)       |

## Architecture Refactor (PR #155, 2026-08-14)

The monolithic thinking builder was split into per-provider **strategy classes** so each family owns its picker schema, request-payload mapping, and the `treatReasoningAsContent` decision (whether `reasoning_content` surfaces as visible chat text — always `false` for DeepSeek and Mimo, fixing the CoT echo).

```text
src/thinking/
├── provider.ts     ← ThinkingProvider interface + thinkingProviderFor() factory
├── base.ts         ← shared base class
├── types.ts / schema.ts / payload.ts / resolve.ts
├── deepseek.ts / glm.ts / kimi.ts / minimax.ts / openai.ts / qwen.ts / mimo.ts / fallback.ts
└── thinking.ts     ← thin barrel (historical public API)
```

**Single config authority:** configuration resolves from the VS Code per-model configuration (model picker / Manage), with workspace settings and per-family defaults as fallbacks. The old `globalState` shadow copy is **removed** — a thinking effort chosen for one model can no longer silently leak onto another or override an explicit "Off". Model IDs are normalized to `effectiveModelId` (the `::sk-***` key-fingerprint suffix is gone), which also stops the per-model settings group from being recreated on every pick (related: issue #131).

Family→strategy routing is data-driven via `core/registry.ts` (same table the transport router reads), so the family detection no longer lives in two places.

## Files Changed

| File                                         | Role                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/thinking/` (per-provider classes)       | (post-#155) strategy classes, factory, payload/schema/type modules, thin barrel `thinking.ts`    |
| `src/core/registry.ts`                       | (post-#155) data-driven family→thinking-family mapping                                           |
| `src/commands/thinkingPicker.ts`             | (post-#155) command-based fallback picker                                                        |
| `src/extension.ts`                           | (pre-#155) family detection, picker schema, override handling, payload mapping, command fallback |
| `src/vscode.proposed.chatProvider.d.ts`      | Proposed API typing for `modelConfiguration` and `configurationSchema`                           |
| `src/metadata.ts` / `src/models/metadata.ts` | Metadata support for `reasoning_options`                                                         |
| `package.json`                               | Settings and command contribution                                                                |
| `README.md`                                  | Thinking controls documentation                                                                  |
| `CHANGELOG.md`                               | Release notes for Thinking controls                                                              |

---

## Verification

Compile check:

```bash
npm run compile
```

Targeted source checks:

```bash
rg -n "thinking|reasoningEffort|configurationSchema|modelConfiguration|thinking_budget" src package.json README.md CHANGELOG.md
rg -n "reasoning_options|reasoningOptions" src/metadata.ts src/extension.ts
```

Expected behavior:

| Scenario                                 | Expected Result                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Native picker configuration is available | Thinking-capable models expose family-appropriate controls                       |
| Native picker submenu is unavailable     | Users can configure defaults via `OpenCode: Set Thinking Effort…` or Settings    |
| Qwen `off`                               | Sends `enable_thinking: false` or endpoint-equivalent disable payload            |
| Qwen `auto`                              | Lets the model/provider decide and omits forced thinking flags where appropriate |
| Qwen budget selected                     | Sends endpoint-appropriate budget field when Thinking is active                  |
| `debugReasoning` enabled                 | Reasoning content is logged diagnostically, separate from Thinking configuration |

---

## Related Issue

The native Copilot Chat submenu behavior and provider warm-up bug are documented separately in:

- `docs/issues/06-20260517-thinking-native-submenu-investigation.md`

This split keeps the feature specification separate from the UI/runtime issue investigation.

---

_Backdated feature document: 2026-05-17._
