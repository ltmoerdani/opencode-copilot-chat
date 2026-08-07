**Status:** ✅ Solved

# Per-Model Thinking Mode — Feature Implementation

**Topic:** provider / models / thinking / vscode / copilot-chat  
**Updated:** 2026-05-17  
**Tags:** #provider #models #thinking #vscode #copilot-chat #reasoning #byok #feat  
**Supersedes:** —

---

## Overview

This document covers **Phase 1** of the 2026-05-17 session: implementing per-model Thinking mode configuration for the OpenCode Go and OpenCode Zen VS Code Language Model Chat providers.

The original chat session started on **2026-05-17 Asia/Jakarta**. This document is intentionally backdated to that original work date.

The session had two distinct phases documented separately:

| Phase                  | Document                                               | Scope                                                                                                                      | Status    |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1 — Feature            | **This document (`05-*`)**                             | Settings, payload mapping, `configurationSchema`, per-request override                                                     | ✅ Solved |
| 2 — Issue → Resolution | `06-20260517-thinking-native-submenu-investigation.md` | Native submenu not appearing → warm-up fix, provider fixes (Kimi tool schema, Qwen routing, stream parser), v0.1.4 release | ✅ Solved |

The feature request: OpenCode Go and Zen models should expose model-family-specific Thinking controls similar to Copilot's built-in `Thinking Effort` picker. The user wanted to configure reasoning behavior per model family instead of relying only on the diagnostic `opencodego.debugReasoning` setting.

---

## Problem

The extension supported reasoning-related diagnostics through `opencodego.debugReasoning`, which writes provider `reasoning_content` to the OpenCode output channel. That setting is useful for debugging, but it is not a user-facing Thinking mode control.

The desired behavior was:

| Family      | Desired User Choice                                                      | Example Request Mapping                                                                                                                            |
| ----------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek    | `off` / `high` / `max` initially, later expanded to `low` / `medium` too | `reasoning_effort` or provider thinking fields                                                                                                     |
| GLM         | `on` / `off`                                                             | `thinking: { type: "enabled"                                                     \| "disabled" }`                                                  |
| Kimi        | `on` / `off`                                                             | `thinking: { type: "enabled"                                                     \| "disabled" }` in the current gateway-compatible implementation |
| Qwen        | `auto` / `on` / `off`                                                    | `enable_thinking` or Anthropic-native `thinking` when routed through `/messages`                                                                   |
| Qwen budget | `auto` / `4096` / `16384` / `32768` / `81920`                            | `thinking_budget` or `budget_tokens` depending on endpoint                                                                                         |
| Mimo        | `off` / `low` / `medium` / `high`                                        | `reasoning_effort`                                                                                                                                 |
| MiniMax     | `off` / `on`                                                             | `thinking: { type }`                                                                                                                               |

The user specifically wanted a UI like the Copilot built-in model picker, where the selected model can show and change `Thinking Effort` directly.

---

## Session Timeline

### 1. 2026-05-17 — Initial Family Settings and Payload Mapping

**Problem:** The first implementation needed a safe way to express per-family thinking behavior without breaking existing Go and Zen requests.

**Action:** Added per-family configuration settings and request mapping.

**Initial setting shape:**

| Setting                         | Purpose              |
| ------------------------------- | -------------------- |
| `opencodego.deepSeekThinking`   | DeepSeek family mode |
| `opencodego.glmThinking`        | GLM family mode      |
| `opencodego.kimiThinking`       | Kimi family mode     |
| `opencodego.qwenThinking`       | Qwen family mode     |
| `opencodego.qwenThinkingBudget` | Optional Qwen budget |

**Result:** The extension could build model-family-specific request payload fields, but the options were still global Settings UI entries rather than model-picker controls.

**Verification:**

```bash
npm run compile
```

**Status:** Superseded by later native model configuration work.

---

### 2. 2026-05-17 — Attempted Native Model Picker Schema

**Problem:** The user clarified that the requirement was not global settings; the UI should behave like the screenshot where Copilot shows `Thinking Effort` near the selected model.

**Action:** Added `configurationSchema` metadata to `LanguageModelChatInformation` so VS Code/Copilot Chat can render per-model controls.

**Important discovery:** The first attempt used a generic key such as `thinkingEffort`, but VS Code/Copilot's recognized convention is `reasoningEffort`.

**Fix:** Switched the primary picker property to:

```ts
reasoningEffort;
```

**Result:** VS Code began showing model configuration labels such as `Off` and `Auto` for OpenCode models. This proved that `configurationSchema` metadata was being read by the model picker.

**Remaining issue:** The UI still did not behave exactly like the built-in Copilot model submenu in all user environments.

---

### 3. 2026-05-17 — VS Code/Copilot Source Research

**Problem:** The model picker displayed configuration labels but the user could not select values the same way Copilot built-in models could.

**Research performed:**

| Source                                | Finding                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| VS Code model picker source           | `configurationSchema.properties[*].group === "navigation"` is used for Thinking controls   |
| VS Code model picker source           | Direct effort button is gated by usage-based billing UI mode                               |
| VS Code language model service source | Per-model configuration actions exist separately from the direct effort button             |
| Copilot extension source              | Built-in Copilot uses `reasoningEffort` and reads request values from `modelConfiguration` |
| Proposed chat provider API            | Current request field is `options.modelConfiguration`, not `options.modelOptions`          |

**Key conclusion:** The extension must publish `configurationSchema`, but request handling must read:

```ts
options.modelConfiguration;
```

not:

```ts
options.modelOptions;
```

**Important UI limitation:** The exact built-in Copilot submenu is not guaranteed for third-party providers in every VS Code/Copilot UI mode. Some builds show labels and configuration actions instead of the same inline submenu.

---

### 4. 2026-05-17 — Variant Fallback Experiment

**Problem:** Because the native UI did not expose a clickable submenu in the user's environment, a fallback was considered: register model variants such as:

```text
OpenCode Zen / Qwen3.6 Plus · Auto
OpenCode Zen / Qwen3.6 Plus · Off
OpenCode Zen / Qwen3.6 Plus · On
OpenCode Zen / Kimi K2.6 · Off
OpenCode Zen / Kimi K2.6 · On
```

**Benefit:** Model rows are always selectable by the picker.

**Drawback:** It increases model-list noise and is less native than VS Code's intended `configurationSchema` mechanism.

**Status:** This idea informed the fallback discussion, but the current codebase uses native schema plus command/settings fallback instead.

---

### 5. 2026-05-17 — Final Implementation State

The final implementation state contains the complete Thinking control stack.

**Current implementation areas:**

| Area                | File                                    | Detail                                                        |
| ------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Proposed API typing | `src/vscode.proposed.chatProvider.d.ts` | Adds `modelConfiguration` and `configurationSchema` typings   |
| Model metadata      | `src/metadata.ts`                       | Carries `reasoning_options` from `models.dev`                 |
| Picker schema       | `src/extension.ts`                      | Builds `configurationSchema` for Thinking and Context Size    |
| Request override    | `src/extension.ts`                      | Applies `modelConfiguration` over global settings per request |
| Request payload     | `src/extension.ts`                      | Maps Thinking settings to OpenCode request fields             |
| User fallback       | `src/extension.ts`                      | Adds `OpenCode: Set Thinking Effort…` command                 |
| Settings docs       | `package.json`, `README.md`             | Documents family defaults and Qwen budget                     |

**Current code concepts:**

| Function / Area                       | Purpose                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `thinkingFamily()`                    | Classifies raw model IDs into Thinking families                                          |
| `modelConfigurationSchema()`          | Creates VS Code per-model schema                                                         |
| `buildFamilyThinkingSchema()`         | Builds Thinking picker options from `models.dev` first, then family defaults             |
| `applyRequestThinkingOverride()`      | Applies selected `modelConfiguration` over global defaults                               |
| `getRequestModelConfiguration()`      | Reads `modelConfiguration` and defensively falls back to older `configuration` shape     |
| `buildThinkingPayload()`              | Emits the correct OpenCode API fields                                                    |
| `buildQwenAnthropicThinkingPayload()` | Converts Qwen thinking into Anthropic-native format when Qwen routes through `/messages` |
| `showThinkingEffortPicker()`          | Provides a command-based fallback when the native picker UI is unavailable               |

---

## Root Cause

The extension had reasoning diagnostics (`opencodego.debugReasoning`) but did not expose user-facing Thinking controls per model family. This document covers the implementation of those controls.

> **Note:** The native submenu UI issue (schema labels visible but radio list not appearing) is documented in `06-20260517-thinking-native-submenu-investigation.md` along with its root cause (missing metadata warm-up) and resolution.

---

## Final Solution

### Native Model Configuration

Models publish a `configurationSchema` when they support Thinking or Context Size options.

For Thinking, the main navigation property is:

```ts
reasoningEffort;
```

This matches VS Code/Copilot's built-in convention and allows the model picker to display current values such as `Off`, `Auto`, `High`, or `Max`.

### Dynamic `models.dev` Reasoning Options

When `models.dev` provides explicit `reasoning_options`, those options are used before hardcoded family defaults.

This prevents stale assumptions when OpenCode updates a model's supported reasoning levels.

### Per-Request Override

The selected per-model value is read from:

```ts
options.modelConfiguration;
```

The extension applies only the current model family's override, leaving other families at their configured defaults.

### Fallback Command

The command:

```text
OpenCode: Set Thinking Effort…
```

lets users configure Thinking values even when their VS Code/Copilot UI does not expose the native per-model picker submenu.

### Request Payload Mapping

The final request mapping is endpoint-aware and family-aware:

| Family                   | Current Mapping                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| DeepSeek                 | `reasoning_effort` when not `off`                                                               |
| GLM                      | `thinking: { type: "enabled"                          \| "disabled" }`                          |
| Kimi                     | `thinking: { type: "enabled"                          \| "disabled" }`                          |
| Qwen `/chat/completions` | `enable_thinking` and optional `thinking_budget`                                                |
| Qwen `/messages`         | Anthropic-native `thinking: { type, budget_tokens? }`                                           |
| Mimo                     | `reasoning_effort`                                                                              |
| MiniMax                  | `thinking: { type: "enabled"                          \| "adaptive" }` depending on route/model |

> **See also:** `06-20260517-thinking-native-submenu-investigation.md` for the native submenu resolution, tool schema sanitizer, Qwen routing fix, and v0.1.4 release details.

---

## Files Changed

| File                                    | Role                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/extension.ts`                      | Thinking family detection, picker schema, request override handling, payload mapping, command fallback |
| `src/vscode.proposed.chatProvider.d.ts` | Proposed API typing for `modelConfiguration` and `configurationSchema`                                 |
| `src/metadata.ts`                       | Metadata support for `reasoning_options`                                                               |
| `package.json`                          | Settings and command contribution                                                                      |
| `README.md`                             | Thinking settings and behavior documentation                                                           |
| `CHANGELOG.md`                          | Release notes for Thinking-related fixes and corrections                                               |

---

## Verification

The session used compile checks repeatedly while iterating:

```bash
npm run compile
```

The implementation was checked with targeted source searches:

```bash
rg -n "thinking|reasoningEffort|configurationSchema|modelConfiguration|thinking_budget" src package.json README.md CHANGELOG.md
rg -n "reasoning_options|reasoningOptions" src/metadata.ts src/extension.ts
```

Expected behavior:

| Scenario                                        | Expected Result                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| VS Code/Copilot supports native model config UI | Picker displays `Thinking Effort` or configuration action from `configurationSchema` |
| Native submenu not exposed                      | User can use `OpenCode: Set Thinking Effort…` or family settings                     |
| Qwen `off`                                      | Avoids forced hybrid thinking and prevents empty Copilot replies                     |
| Qwen `on` with budget                           | Sends endpoint-appropriate budget field                                              |
| `debugReasoning` enabled                        | Reasoning content is logged diagnostically, separate from user-facing Thinking mode  |

---

## Lessons Learned

| #   | Lesson                         | Detail                                                                                                   |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Match VS Code's property names | `reasoningEffort` is the recognized picker convention                                                    |
| 2   | Read `modelConfiguration`      | The current proposed API sends selected values through `options.modelConfiguration`                      |
| 3   | Keep diagnostics separate      | `debugReasoning` should not control user-facing Thinking mode                                            |
| 4   | Prefer live metadata           | `models.dev.reasoning_options` should override family guesses when available                             |
| 5   | Provide fallback controls      | A command/settings path is necessary when native picker affordances are unavailable                      |
| 6   | Cache busting is needed        | VS Code aggressively caches model picker metadata — `MODEL_METADATA_REVISION` in `family` forces refresh |

---

## Related Documents

- `docs/issues/06-20260517-thinking-native-submenu-investigation.md` — Issue → Resolution: native submenu warm-up fix, Kimi tool schema fix, Qwen routing/stream parser fix, v0.1.4 release
- Reference: `github.com/zelosleone/Opencode-Go-For-Copilot` — identical `configurationSchema` pattern

---

## Security Notes

- No OpenCode API keys, GitHub tokens, or other secrets were added to documentation.
- Request payload examples use field names only and do not contain real request bodies with credentials.

---

_Backdated issue document: 2026-05-17._
