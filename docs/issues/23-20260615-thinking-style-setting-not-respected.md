**Status:** ⚠️ Deprecated

> **⚠️ Superseded by [`33-20260709-thinking-part-byok-surfacing-research.md`](./33-20260709-thinking-part-byok-surfacing-research.md).**
>
> The conclusion below ("blocked on upstream, no extension-side fix") was **overturned** on 2026-07-09 after deep-dive research found that `LanguageModelThinkingPart` is available in the VS Code runtime we target, and a shipping Marketplace extension (`Vizards/deepseek-v4-for-copilot`) already solves this exact problem. This document is retained for historical reference only — do not act on its "Recommended Action" section. See doc `33-*` for the verified, implementable fix plan.

# `chat.agent.thinkingStyle` Not Respected — Reasoning Always Expanded

**Topic:** thinking / reasoning / vscode / byok / copilot-chat  
**Updated:** 2026-06-15  
**Tags:** #thinking #reasoning #vscode #byok #copilot-chat  
**GitHub Issue:** [#22](https://github.com/ltmoerdani/opencode-copilot-chat/issues/22)  
**Upstream Blocker:** [microsoft/vscode#318211](https://github.com/microsoft/vscode/issues/318211)  
**Reporter:** [@hu3bi](https://github.com/hu3bi)  
**Participants:** [@hu3bi](https://github.com/hu3bi), [@Wallacy](https://github.com/Wallacy), [@sublimode](https://github.com/sublimode)

---

## Overview

VS Code's built-in setting `chat.agent.thinkingStyle` controls how reasoning/thinking passages are rendered in Copilot Chat. It has three options:

| Option             | Expected Behavior                                                                 |
| ------------------ | --------------------------------------------------------------------------------- |
| `collapsed`        | All thinking hidden, surfaced as gray clickable text that expands on click        |
| `collapsedPreview` | Thinking visible initially, auto-collapses as the agent moves to the next passage |
| `fixedScrolling`   | Thinking rendered inside a fixed-height scrollable area                           |

**Observed bug:** Reasoning content from OpenCode models (DeepSeek, Qwen, GLM, Kimi, MiniMax, MiMo) is **always shown fully expanded as plain text**, regardless of the `chat.agent.thinkingStyle` setting.

This is **NOT** the same problem addressed by `opencodego.stripThinkTags`. That setting only removes `<think>` tags from MiniMax M3 output. The user's request here is to have reasoning **surfaced through the proper thinking channel** so that VS Code Chat UI can apply `chat.agent.thinkingStyle`.

---

## Investigation (2026-06-15)

### Environment

| Item             | Value                             |
| ---------------- | --------------------------------- |
| VS Code host     | **1.124.2** (stable)              |
| VS Code Insiders | Not installed on the test machine |
| `code` CLI       | Not on PATH                       |

### Root Cause — Codebase Side

In `src/streaming.ts`, the `StreamPartExtractor` class extracts reasoning deltas and **accumulates them in a private string property** but **never reports them to the VS Code Chat UI as a thinking part**:

```typescript
// src/streaming.ts — extractStreamParts (around line 792-798)
const reasoning = extractReasoningFromDelta(delta);
if (reasoning) {
  this.reasoningContent += reasoning; // ← stored, NOT reported to progress
}
```

The accumulated reasoning is only used in two places:

1. **Tool-call follow-up replication** — `onReasoningContent(toolCallIds, reasoningContent)` callback (wired in `src/extension.ts` lines 1397, 1426, 1453) stores reasoning into `reasoningContentByToolCallId` so follow-up tool-result requests can replay it. This is request-side plumbing, not UI surfacing.
2. **Fallback as `LanguageModelTextPart`** — `flushReasoningFallback()` (around line 840-855) emits the reasoning as a plain text part **only when the response is otherwise empty** (no text, no tool calls). When text or tool calls are present, the reasoning string is **silently discarded** (`this.reasoningContent = ""` at line 853).

Net effect: reasoning content **never reaches the VS Code Chat UI as a thinking part**, so `chat.agent.thinkingStyle` has nothing to style and is effectively ignored.

### Root Cause — VS Code API Side

To surface reasoning so that `chat.agent.thinkingStyle` applies, the extension would need to emit a dedicated **thinking part** via `progress.report(...)`. The proposed API type union in the extension's local declaration file references such a part:

```typescript
// src/vscode.proposed.chatProvider.d.ts (line 119)
export type LanguageModelResponsePart2 = LanguageModelResponsePart | LanguageModelDataPart | LanguageModelThinkingPart;
```

However, verification against the running VS Code 1.124.2 stable bundle shows the API is **not available**:

| Check                                                                                 | Result                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LanguageModelThinkingPart` in stable `vscode.d.ts` (1.124.2)                         | ❌ **Not present**                                                                                                                                                         |
| `LanguageModelTextPart` (stable) `thought` field                                      | ❌ **Not present** (only `value: string`)                                                                                                                                  |
| `chatProvider.d.ts` proposed file shipped in `vscode-dts/` bundle                     | ❌ **Not shipped**                                                                                                                                                         |
| `LanguageModelThinkingPart` declared in local `src/vscode.proposed.chatProvider.d.ts` | ⚠️ **Referenced only** (line 119) — no `class`/`interface` definition anywhere                                                                                             |
| `LanguageModelThinkingPart` instantiated anywhere in `src/*.ts`                       | ❌ **Never** (confirmed via `grep` + `npx tsc --noEmit` clean exit 0)                                                                                                      |
| `enabledApiProposalNames` / `enabledApiProposals` in `package.json`                   | ❌ **Empty** — proposed API is activated implicitly via `activationEvents: onLanguageModelChatProvider:opencodego` (lines 59-60), not via an explicit proposal declaration |

Stable `LanguageModelResponsePart` type union (vscode.d.ts line 20672):

```typescript
export type LanguageModelResponsePart =
  LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart | LanguageModelDataPart;
```

There is **no thinking-capable part** in the stable API surface.

### Related: Existing Think-Tag Handling

The extension has a separate mechanism for handling thinking that leaks into the text content via `<think>` tags:

- **`opencodego.stripThinkTags`** setting — values: `"auto"` (default, MiniMax M3 only), `"always"`, `"never"`.
- When active, the `ThinkTagFilter` splits incoming text into `{ visible, thinking }` and accumulates the thinking portion — but again, only stores it; does not surface it as a UI thinking part.
- This was the source of confusion in the issue thread: @Wallacy suggested `stripThinkTags: "always"` as a workaround, but the reporter correctly pointed out that stripping ≠ surfacing through the proper thinking channel.

---

## Upstream Dependency

This issue is **blocked on** [microsoft/vscode#318211](https://github.com/microsoft/vscode/issues/318211) — "[Insiders] BYOK not showing reasoning tokens in chat".

- **Status:** Open (as of 2026-06-15)
- **Assignees:** lramos15, vijayupadya, vritant24 (VS Code team)
- **Labels:** `bug`, `model-byok`
- **Symptom described upstream:** BYOK models configured via `chatLanguageModels.json` do not surface reasoning tokens in chat, even when the backend streams `choices[0].delta.reasoning`. Same class of problem as this extension faces.
- **Cross-link:** This repo's PR [#38](https://github.com/ltmoerdani/opencode-copilot-chat/pull/38) ("fix: add option to turn off reasoning") is linked from the upstream issue, but PR #38 only addresses turning reasoning **off** for models.dev effort-only schemas — it does not solve the surfacing problem.

Until the VS Code team finalizes and ships a thinking part API for BYOK providers (proposed `chatProvider` API with a concrete `LanguageModelThinkingPart` definition), there is **no extension-side fix** that will make `chat.agent.thinkingStyle` work for OpenCode BYOK models.

---

## Why a Naive Workaround Does Not Work

**Idea A — Emit reasoning as `LanguageModelTextPart`:**
Already done as a fallback (see `flushReasoningFallback`). It renders reasoning as **plain visible text**, which is exactly the current broken behavior the user is complaining about. It does not enable `chat.agent.thinkingStyle`.

**Idea B — Emit reasoning wrapped in markdown collapse (e.g. `<details>`):**
VS Code Chat renders markdown, but `chat.agent.thinkingStyle` is a **first-class renderer** for thinking parts, not for arbitrary markdown. Wrapping in `<details>` would produce a different visual (a disclosure triangle) that does not honor the user's chosen style and would not match Copilot-hosted models.

**Idea C — `stripThinkTags: "always"`:**
Removes the reasoning entirely. The user explicitly does **not** want removal — they want collapse/respect.

None of these honor `chat.agent.thinkingStyle`. The only correct fix is emitting a proper thinking part once the VS Code API provides one.

---

## Recommended Action

1. **Monitor** [microsoft/vscode#318211](https://github.com/microsoft/vscode/issues/318211) for the upstream fix. Once a concrete `LanguageModelThinkingPart` (or equivalent) ships in stable `vscode.d.ts`, proceed to step 2.
2. **When API is available**, update `src/streaming.ts`:
   - In `extractStreamParts` (and equivalents in Google/Anthropic/Responses transport handlers), instead of only accumulating `reasoningContent`, emit it through `progress.report(new vscode.LanguageModelThinkingPart(reasoningChunk))` so the UI can apply `chat.agent.thinkingStyle`.
   - Adjust `flushReasoningFallback` so that reasoning is emitted as a thinking part (not a text part), and only when no text/tool calls were emitted (preserve current "empty-response safety net" semantics but route to the thinking channel).
   - Keep the existing `onReasoningContent` callback and `reasoningContentByToolCallId` plumbing intact — they are still needed for tool-call follow-up replication.
3. **Update `src/vscode.proposed.chatProvider.d.ts`** to add the concrete `class LanguageModelThinkingPart { ... }` declaration once VS Code finalizes its shape, and remove the dangling reference at line 119 if the upstream API names it differently.
4. **Verify** `enabledApiProposalNames` / `enabledApiProposals` in `package.json` — if the upstream API lands as a proposal (not stable), declare it explicitly so the extension keeps compiling and running under stable VS Code.
5. **Manual test** with at least one reasoning-capable model per family (DeepSeek, Qwen, GLM, Kimi, MiniMax, MiMo) under all three `chat.agent.thinkingStyle` values.

---

## Verification Commands Used

```bash
# VS Code host version
cat "/Applications/Visual Studio Code.app/Contents/Resources/app/package.json" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('version'))"
# → 1.124.2

# Search stable vscode.d.ts for thinking API
grep -n "ThinkingPart\|class LanguageModelTextPart" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/vscode-dts/vscode.d.ts"
# → LanguageModelThinkingPart: NOT FOUND
# → LanguageModelTextPart has only `value: string` (no `thought` field)

# Search proposed files in VS Code bundle
grep -rln "ThinkingPart\|LanguageModelThinking" \
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/vscode-dts/"
# → (empty)

# Confirm local proposed d.ts references but does not define the class
grep -n "class LanguageModelThinkingPart\|LanguageModelThinkingPart\s*=" \
  src/vscode.proposed.chatProvider.d.ts
# → NOT DEFINED (only referenced at line 119)

# Confirm codebase never instantiates it + compiles clean
npx tsc --noEmit
# → exit 0

# Confirm package.json has no explicit proposal declaration
python3 -c "import json; p=json.load(open('package.json')); \
  print('enabledApiProposalNames:', p.get('enabledApiProposalNames', 'NONE')); \
  print('enabledApiProposals:', p.get('enabledApiProposals', 'NONE'))"
# → both NONE
```

---

## Cross-References

- Related issue doc: [`05-20260517-thinking-mode-picker-configuration.md`](./05-20260517-thinking-mode-picker-configuration.md) — per-model Thinking controls (request-side, not UI-side)
- Related issue doc: [`22-20260613-minimax-m3-think-tag-leak-reimplementation.md`](./22-20260613-minimax-m3-think-tag-leak-reimplementation.md) — MiniMax M3 think-tag stripping (UI leak fix, not surfacing)
- Related issue doc: [`23-20260614-thinking-off-missing-for-effort-only-schemas.md`](./23-20260614-thinking-off-missing-for-effort-only-schemas.md) — PR #38, reasoning **off** option (does not address surfacing)
- Feature doc: [`02-20260517-per-model-thinking-controls.md`](../features/02-20260517-per-model-thinking-controls.md) — request-side thinking config per model family
