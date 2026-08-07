**Status:** ✅ Solved

# Native Thinking Submenu — Issue Investigation & v0.1.4 Release

**Topic:** vscode / thinking / copilot-chat / native-ui / configurationSchema / release  
**Updated:** 2026-05-17  
**Tags:** #vscode #thinking #copilot-chat #native-ui #configurationSchema #byok #reasoning #tool-calling #streaming #release  
**Extends:** `05-20260517-thinking-mode-picker-configuration.md`

---

## Overview

This document covers **Phase 2** of the 2026-05-17 session: investigating why the native Thinking submenu did not appear despite correct `configurationSchema` implementation, and resolving all related issues through to the `0.1.4` release.

The session phases are documented separately:

| Phase                  | Document                                            | Scope                                                                                                                      | Status    |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1 — Feature            | `05-20260517-thinking-mode-picker-configuration.md` | Settings, payload mapping, `configurationSchema`, per-request override                                                     | ✅ Solved |
| 2 — Issue → Resolution | **This document (`06-*`)**                          | Native submenu not appearing → warm-up fix, provider fixes (Kimi tool schema, Qwen routing, stream parser), v0.1.4 release | ✅ Solved |

The original chat session happened on **2026-05-17 Asia/Jakarta** and continued into the release/test wrap-up on **2026-05-18 Asia/Jakarta**. This document is intentionally backdated to the original implementation date because the feature and verification work belong to the `0.1.4` release line.

The goal was to make OpenCode Go and OpenCode Zen models behave like GitHub Copilot built-in models in the Copilot Chat model picker: when a user hovers a thinking-capable model, VS Code should show a native side panel with radio controls for `Thinking Effort`, persist the choice, and forward it to the next request through `options.modelConfiguration`.

---

## Target Behavior

The requested user experience was:

```text
Model Picker                       Native Hover Panel
-------------------------------    -------------------------
OpenCode Go                         OpenCode Go / DeepSeek V4 Flash
> DeepSeek V4 Flash        Off      Max context
  GLM 5.1                  Off      1M
  Qwen3.5 Plus             Off
                                    Thinking Effort
                                    ✓ Off (default)   Fastest responses
                                      High            More reasoning
                                      Max             Maximum reasoning
```

Rejected alternatives:

| Alternative            | Reason Rejected                                        |
| ---------------------- | ------------------------------------------------------ |
| Status bar item        | Not native and visually separate from the model picker |
| Topbar/toolbar control | Not consistent with Copilot's model picker             |
| Manual Quick Pick only | Useful as fallback, but not the requested UX           |
| Settings editor only   | Too far from the chat/model selection workflow         |

---

## Timeline

### 1. 2026-05-17 — Initial State: Schema Labels Work, Native Submenu Missing

**Problem:** The extension already attached `configurationSchema` to OpenCode model metadata, and the model picker showed labels such as `Off` beside DeepSeek, GLM, Kimi, and Qwen rows. However, the native radio-list submenu did not appear.

**Confirmed evidence:**

| Evidence                                              | Meaning                                                   |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `Off` / `Off, Auto` labels appeared beside model rows | VS Code received and read `configurationSchema`           |
| Hover panel showed model description and max context  | Model rows used the normal Copilot picker hover path      |
| No radio list appeared until diagnostics ran          | Metadata/actions were not warmed before the picker opened |

**Status:** Investigated further.

---

### 2. 2026-05-17 — VS Code 1.120 Source Investigation

**Action:** Read VS Code 1.120 workbench source to trace the path from extension metadata to the model picker UI.

**Pipeline confirmed:**

```text
provideLanguageModelChatInformation()
  -> configurationSchema
  -> extHostLanguageModels.$provideLanguageModelChatInfo()
  -> LanguageModelsService model cache
  -> getModelConfigurationActions(modelId)
  -> chatModelPicker toolbarActions
  -> ActionList submenuActions
  -> hover panel radio list
```

**Important findings:**

| Area                             | Finding                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `configurationSchema` forwarding | Forwarded from extension host without the expected UBB-only check                                            |
| `getModelConfigurationActions()` | Creates submenu actions from enum schema properties                                                          |
| PRU vs UBB                       | Built-in inline chips and "Configurable" hover sections are UBB-gated, but PRU can still use submenu actions |
| Chevron visibility               | The chevron can be hidden when hover content exists, but the panel can still include submenu actions         |
| Request value                    | VS Code forwards the selected radio value through `options.modelConfiguration`                               |

**Status:** Source path existed, but runtime still needed proof.

---

### 3. 2026-05-17 — Diagnostics Command Revealed the Runtime Gap

**Problem:** The submenu did not appear after extension reloads, but it appeared after running `OpenCode: Model Picker Diagnostics`.

**Discovery:** The diagnostics command called:

```ts
vscode.lm.selectChatModels({ vendor: GO_VENDOR });
vscode.lm.selectChatModels({ vendor: ZEN_VENDOR });
```

That query forced VS Code to ask the provider for model information and populate the internal model/action cache before the picker was opened.

**Root Cause:** The extension registered the providers, but the model picker could open before VS Code had warmed the provider metadata path used for configuration actions. The diagnostics command accidentally acted as a metadata warm-up.

**Fix:** Add silent warm-up during extension activation:

```ts
void warmModelPickerMetadata();

async function warmModelPickerMetadata(): Promise<void> {
  await Promise.allSettled([vscode.lm.selectChatModels({ vendor: GO_VENDOR }), vscode.lm.selectChatModels({ vendor: ZEN_VENDOR })]);
}
```

**Result:** The native Thinking radio list appeared without requiring the diagnostics command.

---

### 4. 2026-05-17 — Picker Schema and Visual Polish

**Problem:** The radio list worked, but the enum descriptions were too long and caused the hover panel to feel wider and less aligned with the built-in Copilot style.

**Fix:** Shorten descriptions to Copilot-like phrases:

| Family      | Option                       | Description                                     |
| ----------- | ---------------------------- | ----------------------------------------------- |
| DeepSeek    | `Off`                        | `Fastest responses`                             |
| DeepSeek    | `High`                       | `More reasoning`                                |
| DeepSeek    | `Max`                        | `Maximum reasoning`                             |
| GLM / Kimi  | `Off`                        | `Fastest responses`                             |
| GLM / Kimi  | `On`                         | `Enable thinking`                               |
| Qwen        | `Off`                        | `Fastest responses`                             |
| Qwen        | `Auto`                       | `Model decides`                                 |
| Qwen        | `On`                         | `Enable thinking`                               |
| Qwen budget | `Auto`                       | `Provider default`                              |
| Qwen budget | `4K` / `16K` / `32K` / `80K` | `Small` / `Medium` / `Large` / `Maximum budget` |

**Result:** The panel looked closer to GitHub Copilot's native model picker and avoided long-line overlap.

---

### 5. 2026-05-17 — Manual Test Plan and DeepSeek Verification

**Manual test scenarios were defined for:**

| #   | Scenario                  | Expected Result                                                |
| --- | ------------------------- | -------------------------------------------------------------- |
| 1   | Fresh reload              | Submenu appears without running diagnostics                    |
| 2   | Persistent selection      | Selected effort persists across picker reopen/reload           |
| 3   | DeepSeek payload          | `High` / `Max` become `reasoning_effort`, `Off` sends no field |
| 4   | GLM/Kimi payload          | `On` / `Off` become `thinking: { type }`                       |
| 5   | Qwen payload              | `Auto` + budget maps to Qwen thinking fields                   |
| 6   | Scope per model           | Changing one model does not globally change another model      |
| 7   | Non-thinking models       | No Thinking section appears                                    |
| 8   | No diagnostics dependency | Submenu still appears after reload                             |
| 9   | Visual regression         | Text does not overlap                                          |
| 10  | Full VS Code restart      | Submenu and persisted values survive                           |

**DeepSeek verification passed:**

| Picker Choice | Observed `modelConfiguration`   | Observed payload                 |
| ------------- | ------------------------------- | -------------------------------- |
| `High`        | `{ "reasoningEffort": "high" }` | `{ "reasoning_effort": "high" }` |
| `Max`         | `{ "reasoningEffort": "max" }`  | `{ "reasoning_effort": "max" }`  |
| `Off`         | `{ "reasoningEffort": "off" }`  | `{}`                             |

**Result:** Native UI and request override worked end-to-end for DeepSeek.

---

### 6. 2026-05-17 — Kimi/Moonshot Tool Schema Failure

**Problem:** Kimi `On` and `Off` both failed with provider HTTP 400:

```text
tools.function.parameters is not a valid moonshot flavored json schema
At path 'properties.variantOptions': conflicting keywords found after $ref expansion: description
```

**Root Cause:** The failure was unrelated to Thinking. Copilot tool schemas can include `$ref`, `$defs`, `definitions`, and sibling fields such as `description`. Moonshot's tool validator accepts a narrower JSON Schema subset and rejected the expanded schema.

**Fix:** Sanitize tool schemas before forwarding them:

| Sanitizer Behavior                                                                           | Purpose                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Dereference local `#/...` `$ref` values                                                      | Avoid provider-side conflicting keyword expansion |
| Remove `$schema`, `$id`, `$ref`, `$defs`, `definitions`                                      | Keep only provider-compatible schema              |
| Preserve `type`, `properties`, `required`, `items`, `enum`, `description`, and common bounds | Maintain useful parameter validation              |
| Apply to OpenAI-style and Anthropic-style tool definitions                                   | Keep provider behavior consistent                 |

**Result:** Kimi `On` and `Off` requests succeeded after sanitizer deployment.

---

### 7. 2026-05-17 — Qwen `/messages` Auth Failure

**Problem:** Qwen `Auto + 16K` initially failed with:

```text
401 Missing API key
```

**Root Cause:** Qwen was routed through the `/messages` endpoint to match an earlier Anthropic-style stream assumption. For OpenCode Go, the valid authenticated path for Qwen was `/chat/completions`, not `/messages`.

**Fix:** Route Qwen requests through `chatCompletionsUrl` while preserving Qwen thinking payloads:

```text
https://opencode.ai/zen/go/v1/chat/completions
```

**Result:** The 401 disappeared and requests returned `200 OK`.

---

### 8. 2026-05-17 — Qwen Stream Parser Failure

**Problem:** After the endpoint fix, Qwen returned `200 OK` with SSE events, but Copilot Chat still did not receive visible text.

**Root Cause:** The response stream could be OpenAI-style or Anthropic-style depending on gateway/model behavior. A parser that assumed only one shape could miss the actual text.

**Fix:** Add a hybrid Qwen parser:

1. Try OpenAI-style chunks first:
   ```text
   choices[].delta.content
   choices[].delta.text
   choices[].message.content
   ```
2. If no OpenAI parts are found, try Anthropic-style chunks:
   ```text
   delta.text
   ```
3. Keep stream summaries for verification:
   ```text
   [stream-summary model=qwen3.5-plus] textChars=... toolCalls=... reasoningChars=...
   ```

**Result:** Qwen `Auto + 16K` produced text and tool calls successfully:

| Test               | Result                                            |
| ------------------ | ------------------------------------------------- |
| Qwen first request | `textChars=68`, `toolCalls=2`, request completed  |
| Qwen follow-up     | `textChars=896`, `toolCalls=0`, request completed |

---

### 9. 2026-05-18 — Release Version Consolidation

**Problem:** During local testing, intermediate VSIX builds were installed as `0.1.6` and `0.1.7`, but the marketplace release target remained `0.1.4`.

**Action:** Consolidated all fixes back into the `0.1.4` release line:

| File                               | Change                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| `package.json`                     | Version set to `0.1.4`                                      |
| `package-lock.json`                | Root and package version set to `0.1.4`                     |
| `CHANGELOG.md`                     | Intermediate `0.1.6` / `0.1.7` sections merged into `0.1.4` |
| `opencode-copilot-chat-0.1.4.vsix` | Rebuilt final local VSIX                                    |

**Final local build verification:**

```bash
npm run compile
npx --yes vsce package --out opencode-copilot-chat-0.1.4.vsix
code --install-extension opencode-copilot-chat-0.1.4.vsix --force
```

**Artifact verification confirmed the installed `0.1.4` bundle contains:**

- `warmModelPickerMetadata`
- `sanitizeToolSchema`
- `streamChatCompletionsWithAnthropicStream`
- Qwen hybrid parser warning path
- shortened submenu text such as `Fastest responses`

---

## Root Cause Summary

| Issue                                          | Root Cause                                                          | Fix                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Native submenu appeared only after diagnostics | Provider model metadata/actions were not warmed before picker use   | Call `vscode.lm.selectChatModels()` silently on activation |
| Long hover-panel text                          | Enum descriptions were too verbose                                  | Use short Copilot-like descriptions                        |
| Kimi/Moonshot 400                              | Tool schemas contained unsupported `$ref`/definition structures     | Sanitize tool schemas before forwarding                    |
| Qwen 401                                       | Qwen was routed to `/messages`, which rejected the current key path | Use `/chat/completions` for Qwen                           |
| Qwen 200 but no visible output                 | Parser assumed the wrong stream shape                               | Hybrid OpenAI/Anthropic stream parser                      |

---

## Final Solution

The final `0.1.4` implementation provides:

| Capability                                                                | Status  |
| ------------------------------------------------------------------------- | ------- |
| Native VS Code model picker radio list for thinking-capable models        | ✅ Done |
| Automatic provider metadata warm-up without diagnostics command           | ✅ Done |
| Persisted per-model selection through VS Code model configuration storage | ✅ Done |
| Per-request override via `options.modelConfiguration`                     | ✅ Done |
| DeepSeek payload mapping                                                  | ✅ Done |
| GLM/Kimi payload mapping                                                  | ✅ Done |
| Qwen effort and budget mapping                                            | ✅ Done |
| Kimi/Moonshot tool schema compatibility                                   | ✅ Done |
| Qwen Go endpoint routing and stream parsing                               | ✅ Done |
| Visual polish matching Copilot style more closely                         | ✅ Done |

---

## Files Changed

| File                                    | Role                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                      | Native model picker schema, activation warm-up, request override handling, Thinking payload mapping, tool schema sanitizer, Qwen hybrid stream parser |
| `src/vscode.proposed.chatProvider.d.ts` | Proposed API typing for `configurationSchema`, enum descriptions, and `modelConfiguration`                                                            |
| `package.json`                          | Release version, commands, configuration contributions                                                                                                |
| `package-lock.json`                     | Release version synchronization                                                                                                                       |
| `CHANGELOG.md`                          | `0.1.4` release notes                                                                                                                                 |

---

## Manual Verification

### Native UI

| Scenario                  | Result  |
| ------------------------- | ------- |
| Fresh reload              | ✅ Pass |
| Persistent selection      | ✅ Pass |
| No diagnostics dependency | ✅ Pass |
| Full VS Code restart      | ✅ Pass |
| Visual regression         | ✅ Pass |
| Scope per model           | ✅ Pass |
| Non-thinking models       | ✅ Pass |

### Provider Requests

| Provider / Family | Scenario               | Result                                           |
| ----------------- | ---------------------- | ------------------------------------------------ |
| DeepSeek          | `Off` / `High` / `Max` | ✅ Correct `reasoning_effort` behavior           |
| Kimi              | `Off` / `On`           | ✅ Works after tool schema sanitizer             |
| Qwen              | `Auto + 16K`           | ✅ Uses `/chat/completions`, returns parsed text |

### Build and Install

```bash
npm run compile
npx --yes vsce package --out opencode-copilot-chat-0.1.4.vsix
code --install-extension opencode-copilot-chat-0.1.4.vsix --force
```

**Result:** ✅ Final local `0.1.4` build was installed and ready for marketplace testing.

---

## GitHub Issue Response

After implementation, a response was prepared for GitHub issue `ltmoerdani/opencode-copilot-chat#3`, stating that the feature was implemented in `0.1.4` with native per-model Thinking controls for DeepSeek, GLM, Kimi, and Qwen, including Qwen Thinking Budget.

---

## Lessons Learned

| #   | Lesson                                              | Detail                                                                                                    |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Runtime verification beats source-only assumptions  | VS Code source showed the path, but diagnostics revealed the missing metadata warm-up                     |
| 2   | Native UI can be present without an obvious chevron | Hover content can hide the chevron while still allowing the panel to render radio actions                 |
| 3   | `modelConfiguration` is the request contract        | Native picker choices must be read from `options.modelConfiguration`                                      |
| 4   | Provider validators differ                          | Kimi/Moonshot requires safer tool schemas than Copilot may provide                                        |
| 5   | Endpoint and parser are separate concerns           | Qwen needed `/chat/completions` for auth but hybrid parsing for stream compatibility                      |
| 6   | Release version discipline matters                  | Intermediate local VSIX versions must be folded back into the intended marketplace version before release |

---

## Security Notes

- No API keys, tokens, or credentials are included in this document.
- Request log examples are reduced to safe field names, status codes, and non-secret metadata.
- VS Code source references are public source-code observations and not copied as long verbatim excerpts.

---

_Backdated issue document: 2026-05-17._
