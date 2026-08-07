**Status:** ✅ Solved

# Per-Model Thinking Controls

**Topic:** provider / models / thinking / vscode / copilot-chat
**Updated:** 2026-05-17
**Tags:** #provider #models #thinking #vscode #copilot-chat #reasoning #byok
**Supersedes:** —

---

## Overview

This document records the per-model Thinking controls feature for OpenCode Go and OpenCode Zen models in GitHub Copilot Chat.

The original session started on **2026-05-17 Asia/Jakarta**. The feature request was to expose model-family-specific Thinking behavior similar to Copilot's built-in `Thinking Effort` picker, while preserving separate OpenCode Go and OpenCode Zen provider configuration.

Before this work, the extension only had `opencodego.debugReasoning`, which writes provider `reasoning_content` to the OpenCode output channel for diagnostics. That setting remains diagnostic-only and is separate from user-facing Thinking controls.

---

## Problem

OpenCode models do not all use the same request fields for reasoning or thinking. A single global on/off setting cannot accurately represent the available controls.

The target model-family behavior was:

| Family      | User Choice                                   | Request Mapping                                                                                                                             |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek    | `off` / `low` / `medium` / `high` / `max`     | `reasoning_effort` when not `off`                                                                                                           |
| GLM 5/5.1   | `high` / `max` / `off`                        | `reasoning_effort` (gateway resolves to toggle for older models)                                                                            |
| GLM 5.2     | `high` / `max` / `off`                        | `reasoning_effort: "high" \| "max"`; `"off"` → `thinking: { type: "disabled" }`                                                             |
| Kimi        | `on` / `off`                                  | `thinking: { type: "enabled"                                                     \| "disabled" }`                                           |
| MiniMax     | `on` / `off`                                  | `thinking: { type: "enabled"                                                     \| "disabled"    \| "adaptive" }` depending on route/model |
| Mimo        | `off` / `low` / `medium` / `high`             | `reasoning_effort` when not `off`                                                                                                           |
| Qwen        | `auto` / `on` / `off`                         | `enable_thinking` for chat completions, Anthropic-native `thinking` for messages                                                            |
| Qwen budget | `auto` / `4096` / `16384` / `32768` / `81920` | `thinking_budget` or `budget_tokens` depending on endpoint                                                                                  |

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

| Function / Area                       | Purpose                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `thinkingFamily()`                    | Classifies raw model IDs into Thinking families                 |
| `modelConfigurationSchema()`          | Creates VS Code per-model configuration schema                  |
| `buildFamilyThinkingSchema()`         | Builds picker options from `models.dev` or family defaults      |
| `applyRequestThinkingOverride()`      | Applies `modelConfiguration` over persistent defaults           |
| `getRequestModelConfiguration()`      | Reads `options.modelConfiguration` with a defensive fallback    |
| `buildThinkingPayload()`              | Emits OpenCode request fields for each model family             |
| `buildQwenAnthropicThinkingPayload()` | Converts Qwen settings for Anthropic-style `/messages` requests |
| `showThinkingEffortPicker()`          | Provides command-based fallback configuration                   |

---

## Files Changed

| File                                    | Role                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/extension.ts`                      | Thinking family detection, picker schema, request override handling, payload mapping, command fallback |
| `src/vscode.proposed.chatProvider.d.ts` | Proposed API typing for `modelConfiguration` and `configurationSchema`                                 |
| `src/metadata.ts`                       | Metadata support for `reasoning_options`                                                               |
| `package.json`                          | Settings and command contribution                                                                      |
| `README.md`                             | Thinking controls documentation                                                                        |
| `CHANGELOG.md`                          | Release notes for Thinking controls                                                                    |

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
