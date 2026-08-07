# 11 — Vision Proxy for Text-Only Models

**Status:** 🟢 Active  
**Author:** Wallacy (Wallacy Freitas)  
**Reviewer:** ltmoerdani  
**PR:** [#76](https://github.com/ltmoerdani/opencode-copilot-chat/pull/76)  
**Issues:** [#74](https://github.com/ltmoerdani/opencode-copilot-chat/issues/74) (vision proxy), [#67](https://github.com/ltmoerdani/opencode-copilot-chat/issues/67) (output pane focus steal), [#68](https://github.com/ltmoerdani/opencode-copilot-chat/issues/68) (context overflow safety)  
**Merged:** 2026-07-15  
**Merge commit:** `d2fcbe4` (merge commit, NOT squash)  
**Commits preserved:** 4 (`69902bb`, `4a36009`, `a17f91e`, `8a0d813`)  
**Released:** `v0.4.1`

---

## Overview

A transparent vision proxy that lets text-only OpenCode models "see" images by relaying them to a configured vision-capable Copilot model. Also bundles two bug fixes: a 64-token safety margin against `estimateTokenCount` underestimation, and removal of a stray `.show(true)` that popped the Output pane over the chat on empty responses.

---

## Problem

1. **Text-only models silently dropped images.** DeepSeek, Qwen, Mimo (text-only variants), Big Pickle, and other non-vision models had no way to process image attachments. VS Code's Copilot Chat stripped image parts before they reached our provider because `modelCapabilities()` reported `imageInput: false`. Users got no feedback, the model just never "saw" the image.

2. **Context overflow 400 on large prompts.** `estimateTokenCount()` underestimates token counts by 0–2%. On large prompts (~130K tokens on a 262K context window), this pushed the payload 1–2 tokens past the limit, triggering a hard 400 rejection. Reported with GLM-5.2.

3. **Output pane focus steal on empty responses.** `streamChatCompletions()` called `options.output?.show(true)` when logging a "empty response" warning. The `true` flag forced the Output panel into focus, stealing focus from the chat view every time a model returned an empty response (common with free Zen models).

---

## Solution

### Vision Proxy Architecture

```
User attaches image → text-only model selected
  ↓
modelCapabilities() reports imageInput: true
  (because isVisionProxyEnabled() && globalState has visionProxyModelId)
  ↓
VS Code keeps image parts in the request (does not strip them)
  ↓
provideLanguageModelChatResponse() detects:
  hasImageInput && !actuallySupportsVision (cached RAW metadata)
    && visionProxyModelId (configured via command)
  ↓
proxyVision() called:
  1. vscode.lm.selectChatModels({ id: visionProxyModelId })
     + fallback substring match on id/name/family
  2. filter out agent-host variants (-agent:)
  3. build requestMessages preserving image DataParts + text
  4. append configurable vision prompt
  5. model.sendRequest(requestMessages, {}, token)  ← real CancellationToken
  6. accumulate response.text → description string
  ↓
Image_url parts replaced with:
  [{ type: "text", text: "[Image described by vision proxy]: <description>" }]
  + original text parts preserved
  ↓
Original text-only model processes the text normally
```

**Key fix for circular dependency:** `actuallySupportsVision` is cached from `metadata.supportsVision` BEFORE `modelCapabilities()` overrides it. Without this cache, `modelCapabilities()` would report `imageInput: true` (because proxy is on), and the provider would incorrectly skip the proxy for text-only models, making the whole feature dead code.

### Configuration UX

Single command: **OpenCode Go: Configure Vision Proxy** (`opencodego.configureVisionProxy`).

QuickPick shows:

- **None (disable)** — clears `VISION_PROXY_MODEL_ID_KEY`, proxy turns off
- **Customize description prompt...** — edit `VISION_PROXY_PROMPT_KEY` via InputBox (defaults to `DEFAULT_VISION_PROXY_PROMPT`)
- **Vision-capable models** — filtered by `VISION_CAPABLE_MODELS` set + `models.dev` metadata's `supportsVision` flag

No settings JSON, no boolean toggle. If a model ID is stored in `globalState`, the proxy is on.

Storage keys (in extension `globalState`):

- `opencodego.visionProxyModelId` — target Copilot model ID (e.g. `copilot:gpt-5.5`)
- `opencodego.visionProxyPrompt` — description instruction sent to the vision model

### Graceful Fallback

If the proxy fails (model not found, API error, empty description), images are stripped with a placeholder `[Image unavailable — vision proxy unavailable]` instead of forwarding raw image data to a text-only model (which would 400). Original text parts are preserved.

### Context Overflow Safety Margin

```typescript
const TOKEN_ESTIMATE_SAFETY_MARGIN = 64;
const promptReserve = (promptTokens ?? Math.floor(contextWindow * 0.8)) + TOKEN_ESTIMATE_SAFETY_MARGIN;
```

64 tokens compensates for `estimateTokenCount()`'s 0–2% underestimation. On a 130K-token prompt, 2% = 2,600 tokens of headroom beyond the 64-token margin, so the margin is conservative without wasting meaningful output budget.

### Output Pane Fix

Removed `.show(true)` from the empty-response warning in `streamChatCompletions()` (`src/streaming.ts`). The diagnostic log still appends to the Output channel; users can open it manually when debugging.

---

## Files Changed

| File                           | Change                                                                                                                                                                                     | Lines     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `src/extension.ts`             | Vision proxy logic (`proxyVision`, `showVisionProxyPicker`, `isVisionProxyEnabled`), `modelCapabilities()` override, `notifyModelInfoChanged()` method, 64-token margin in `modelLimits()` | +312 / −8 |
| `src/metadata.ts`              | Export `VISION_CAPABLE_MODELS` (was private)                                                                                                                                               | +1 / −1   |
| `src/streaming.ts`             | Remove `.show(true)` from empty-response warning                                                                                                                                           | +2 / −1   |
| `package.json`                 | Register `opencodego.configureVisionProxy` command                                                                                                                                         | +4 / 0    |
| `README.md`                    | Add "Vision proxy" row to features table                                                                                                                                                   | +1 / 0    |
| `CHANGELOG.md`                 | `[Unreleased]` → `[0.4.1]` section                                                                                                                                                         | +11 / −1  |
| `src/test/metadata.test.ts`    | `VISION_CAPABLE_MODELS` membership tests                                                                                                                                                   | +23 / −1  |
| `src/test/visionProxy.test.ts` | New: 9 tests for proxy condition + circular-regression guard                                                                                                                               | +90 / 0   |

**Total:** 8 files, +444 / −12

---

## Code Locations

| Concern                                       | Location                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Proxy condition + image replacement           | `src/extension.ts` `provideLanguageModelChatResponse()` (~L1818–L1860) |
| `proxyVision()` function                      | `src/extension.ts` (~L3345)                                            |
| `showVisionProxyPicker()` QuickPick           | `src/extension.ts` (~L3380)                                            |
| `isVisionProxyEnabled()` + storage keys       | `src/extension.ts` (~L3520)                                            |
| `modelCapabilities()` proxy override          | `src/extension.ts` (~L3283)                                            |
| `actuallySupportsVision` cache (circular fix) | `src/extension.ts` (~L1821)                                            |
| `notifyModelInfoChanged()` refresh trigger    | `src/extension.ts` `OpenCodeProvider` (~L1303)                         |
| 64-token safety margin                        | `src/extension.ts` `modelLimits()` (~L3240)                            |
| Command registration                          | `src/extension.ts` `activate()` (~L709)                                |
| Output pane fix                               | `src/streaming.ts` `streamChatCompletions()` (~L107)                   |
| `VISION_CAPABLE_MODELS` export                | `src/metadata.ts` (~L238)                                              |

---

## Tests

**Total: 107 tests, 0 failing** (across all test files after this PR).

### `src/test/visionProxy.test.ts` (new, 9 tests)

Covers the 6 boolean combinations of the proxy condition (`hasImageInput && !actuallySupportsVision && visionProxyModelId`):

| Scenario                                             | Expected              |
| ---------------------------------------------------- | --------------------- |
| Text-only model + images + proxy configured          | Proxy fires           |
| No images present                                    | Proxy skipped         |
| Model natively supports vision                       | Proxy skipped         |
| No vision model configured (empty string)            | Proxy skipped         |
| All conditions false                                 | Proxy skipped         |
| Circular-regression guard: text-only vs vision model | Both behave correctly |

Plus 3 tests for `modelCapabilities()` flag behavior (proxy on text-only, native vision, neither).

### `src/test/metadata.test.ts` (3 new tests)

- `VISION_CAPABLE_MODELS` includes known vision models (minimax-m2.7, kimi-k2.6, mimo-v2.5, glm-5.1, mimo-v2.5-pro)
- `VISION_CAPABLE_MODELS` excludes text-only models (deepseek-v4-flash, hy3-preview, big-pickle)
- `VISION_CAPABLE_MODELS` is an exported `Set` with >10 entries

---

## Review Notes

PR #76 went through one review round before merge.

### Round 1 (pre-force-push) — Requested changes

1. **🔴 Blocker: context overflow fix missing from code.** CHANGELOG claimed "64-token safety margin in `modelLimits()`" but the function was not modified in the diff. The claim existed only in CHANGELOG text.
2. **🟡 README table rows merged into one line.** Three feature rows collapsed into a single line with `||`, breaking Markdown rendering.
3. **🟡 CHANGELOG lost the `[0.3.7]` heading.** The diff removed `## [0.3.7] — 2026-07-09`, orphaning the `### Added` block below it.
4. **🟢 `proxyVision` used a dummy CancellationToken.** Should pass `options.token` (now `token` from the method signature) so canceling the chat also cancels the proxy.
5. **🟢 Vision proxy consumed Copilot quota silently.** Suggested logging or documenting.

### Round 2 (post-force-push) — Approved

Wallacy force-pushed commit `8a0d813` ("fix: PR review") addressing all items:

- ✅ `TOKEN_ESTIMATE_SAFETY_MARGIN = 64` added to `modelLimits()` with explanatory comment
- ✅ README table rows split into 3 separate lines
- ✅ `## [0.3.7] — 2026-07-09` heading restored
- ✅ `proxyVision()` now accepts `token: vscode.CancellationToken` parameter, wired from the `provideLanguageModelChatResponse` method signature
- ⚠️ Quota logging: not explicitly documented in README, but `[vision-proxy]` log lines (`Forwarding`, `Replaced`, `Error`, `Stripped`) added to the Output channel provide runtime visibility

### Merge strategy

Merged via **regular merge commit** (`d2fcbe4`) to preserve all 4 of Wallacy's commits. No squash (per project policy — contributor history preservation).

---

## Limitations & Follow-ups

1. **Quota consumption.** The vision proxy calls `model.sendRequest()` on a Copilot model, which consumes the user's Copilot quota. Not documented in README; only visible via `[vision-proxy]` log lines. A README note would improve discoverability.
2. **No cancellation feedback.** If the vision model call is slow, the user sees no progress indicator in the chat UI. The chat just appears to "think" longer than usual.
3. **First-match model selection.** `proxyVision()` uses the first match from `selectChatModels`. If multiple models match the substring, the selection is non-deterministic. Not a problem in practice because the picker filters to vision-capable models, but worth noting.

---

## Related Docs

- `docs/features/01-20260514-vision-image-input.md` — native vision support (the foundation this proxy builds on)
- `docs/issues/08-20260520-vision-image-request-fixes.md` — earlier vision fixes
- `CHANGELOG.md` `[0.4.1]` section
