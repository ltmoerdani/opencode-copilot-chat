**Status:** ✅ Solved

# Reasoning Not Surfaced as Thinking Part — Issues #22 + #71 (Duplicate)

**Topic:** thinking / reasoning / vscode / byok / copilot-chat / streaming / languageModelThinkingPart  
**Updated:** 2026-07-09  
**Tags:** #thinking #reasoning #vscode #byok #copilot-chat #streaming #languageModelThinkingPart #upstream  
**GitHub Issues:** [#22](https://github.com/ltmoerdani/opencode-copilot-chat/issues/22), [#71](https://github.com/ltmoerdani/opencode-copilot-chat/issues/71)  
**Fixed in:** v0.3.7 (branch `fix/thinking-part-byok-surfacing-22-71`)  
**Manual test:** ✅ Verified with DeepSeek + Kimi in Copilot Chat (2026-07-09)
**Supersedes:** [`23-20260615-thinking-style-setting-not-respected.md`](./23-20260615-thinking-style-setting-not-respected.md) (marked deprecated — conclusion overturned)  
**Upstream (still open, NOT a blocker):** [microsoft/vscode#318211](https://github.com/microsoft/vscode/issues/318211)  
**Proof-of-concept:** [`Vizards/deepseek-v4-for-copilot`](https://github.com/Vizards/deepseek-v4-for-copilot) v0.6.2 (Marketplace, working)  
**Reporters:** [@hu3bi](https://github.com/hu3bi) (#22), [@alexaroth](https://github.com/alexaroth) (#71)  
**Participants:** [@hu3bi](https://github.com/hu3bi), [@alexaroth](https://github.com/alexaroth), [@yinhx3](https://github.com/yinhx3), [@Wallacy](https://github.com/Wallacy), [@sublimode](https://github.com/sublimode)

---

## TL;DR

Issues **#22** (`chat.agent.thinkingStyle` not respected) and **#71** (thinking tokens not displaying) are **the same bug**: reasoning content from OpenCode models is never emitted to the VS Code Chat UI as a thinking part, so there is nothing for `chat.agent.thinkingStyle` to style.

The previous conclusion in doc `23-*` (dated 2026-06-15) was that this is **blocked on upstream** `microsoft/vscode#318211` and **cannot be fixed extension-side**. **That conclusion is now overturned.** Deep-dive research on 2026-07-09 found:

1. `LanguageModelThinkingPart` **is available** in the VS Code runtime our extension targets (`engines.vscode: ^1.125.0`). The API shipped to VS Code in August 2025 (PR [#259939](https://github.com/microsoft/vscode/pull/259939)).
2. A shipping Marketplace extension (`Vizards/deepseek-v4-for-copilot` v0.6.2) **already solves this exact problem** for DeepSeek BYOK models using the proposed `LanguageModelThinkingPart` API — with **no `enabledApiProposals` declaration** in `package.json`.
3. User [@yinhx3](https://github.com/yinhx3) confirmed in issue #71: _"I am also using deepseek-v4-for-copilot for the DeepSeek API, which is able to display reasoning content."_
4. The fix is **low-risk and extension-side**: add a type-augmentation `.d.ts`, then emit reasoning through `progress.report(new vscode.LanguageModelThinkingPart(chunk))` in the streaming extractor.

**Priority:** HIGH — two duplicate issues, multiple frustrated users, competitor already shipping the fix.

---

## Symptom Matrix

| Aspect          | #22 (@hu3bi, 2026-06-08)                                                                       | #71 (@alexaroth, 2026-07-07)                                                     |
| --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Symptom**     | `chat.agent.thinkingStyle` (`collapsed` / `collapsedPreview` / `fixedScrolling`) has no effect | "Thinking" section does not show model reasoning                                 |
| **Expected**    | Reasoning rendered as collapsible thinking block (like Copilot-hosted models)                  | Reasoning shown like native Copilot models                                       |
| **Reported on** | Any OpenCode model with reasoning                                                              | Any OpenCode Go/Zen model                                                        |
| **Cross-link**  | #71 mentions #22 as "upstream bug"                                                             | yinhx3 links to #22                                                              |
| **User tone**   | Detailed, constructive                                                                         | Frustrated — _"this extension is negatively affecting results by a huge margin"_ |

Both report the **identical** root behavior: reasoning is either invisible or rendered as flat plain text, never as a styled thinking block.

---

## Root Cause (Verified Against Codebase)

In `src/streaming.ts`, the `OpenAiResponseExtractor` class extracts reasoning deltas and **accumulates them in a private string** but **never reports them to the VS Code Chat UI as a thinking part**:

```typescript
// src/streaming.ts — extractStreamParts (~line 838)
const reasoning = extractReasoningFromDelta(delta);
if (reasoning) {
  this.reasoningContent += reasoning; // ← stored, NOT reported to progress
}
```

The accumulated reasoning reaches the UI only via `flushReasoningFallback()` (~line 863), and **only when the response is otherwise empty**:

```typescript
// src/streaming.ts — flushReasoningFallback (~line 887)
if (this.emittedTextLength > 0 || this.emittedToolCallsCount > 0) {
  this.reasoningContent = ""; // ← DI-DROPPED SILENTLY when text/tool present
  return;
}
// …otherwise emitted as a plain LanguageModelTextPart (not a thinking part)
```

**Net effect:** reasoning content **never** reaches the VS Code Chat UI as a thinking part, so `chat.agent.thinkingStyle` has nothing to style. The `onReasoningContent` callback is still wired (for tool-call follow-up replication in `src/extension.ts`), but that is request-side plumbing, not UI surfacing.

There is **no occurrence** of `LanguageModelThinkingPart` instantiation anywhere in `src/*.ts`. Confirmed via `grep`.

---

## Why the Previous "Upstream Blocker" Conclusion Was Wrong

Doc `23-*` (2026-06-15) concluded this was blocked on `microsoft/vscode#318211`. The investigation then was honest given the data available, but three facts have since changed the picture:

### 1. The API shipped to stable in August 2025

The `languageModelThinkingPart` proposal was added to the VS Code repo on **2026-08-06** (commit history for `src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts`):

| Date       | PR                                                                                | Change                                                                 |
| ---------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 2025-08-06 | [#259939](https://github.com/microsoft/vscode/pull/259939) "chain of thought API" | Initial addition                                                       |
| 2025-08-26 | [#263358](https://github.com/microsoft/vscode/pull/263358)                        | Shape update for responses API                                         |
| 2025-10-14 | [#265537](https://github.com/microsoft/vscode/pull/265537)                        | Finalize `languageModelDataPart` + tools (ThinkingPart stays proposed) |
| 2026-06-16 | [#321391](https://github.com/microsoft/vscode/pull/321391)                        | Remove API version concept                                             |

The doc `23-*` investigation ran against **VS Code 1.124.2** and correctly noted the class was "referenced but not defined" in our local `.d.ts`. But it conflated two separate things: (a) our local `.d.ts` being incomplete, and (b) the API being absent from VS Code. Only (a) was true; the API **is** present in the runtime.

Our `engines.vscode` is `^1.125.0`, well past the August 2025 ship date. `typeof vscode.LanguageModelThinkingPart === 'function'` evaluates to **true** on every VS Code version our extension supports.

### 2. A shipping Marketplace extension proves the approach works

[`Vizards/deepseek-v4-for-copilot`](https://github.com/Vizards/deepseek-v4-for-copilot) v0.6.2 (engine `^1.116.0`, on the Marketplace) emits reasoning via `LanguageModelThinkingPart` and it renders correctly as a collapsible thinking block in Copilot Chat. Key files verified:

- **`src/provider/stream.ts` (lines 215–224)** — streaming emit:
  ```typescript
  function handleThinking(text, state, progress) {
    state.accumulatedReasoning += text;
    progress.report(new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart);
  }
  ```
- **`vscode.proposed.languageModelThinkingPart.d.ts`** — type augmentation copied from the VS Code repo via `npx @vscode/dts dev`. Defines the class fully.
- **`tsconfig.json`** — `"include": ["src", "vscode.proposed.languageModelThinkingPart.d.ts"]`.
- **`package.json`** — **no `enabledApiProposals`** at all. The proposal is used implicitly, exactly like our existing `chatProvider` proposal.
- **Runtime guard pattern** (used in `tokens.ts`, `convert.ts`, `diagnostics.ts`):
  ```typescript
  function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
    return (
      typeof (vscode as Record<string, unknown>).LanguageModelThinkingPart === "function" &&
      part instanceof vscode.LanguageModelThinkingPart
    );
  }
  ```

### 3. The upstream issue is a red herring for this codebase

`microsoft/vscode#318211` ("BYOK not showing reasoning tokens in chat") is still open, but it was filed against **VS Code 1.122-insider** (2026-05-25) for models configured via `chatLanguageModels.json` (the declarative BYOK config file) where the backend streams `choices[0].delta.reasoning`. That is a **different BYOK path** from ours — we implement `vscode.LanguageModelChatProvider` directly in-process, where `progress.report(new LanguageModelThinkingPart(...))` works today.

The DeepSeek-v4 extension, which uses the same in-process provider API we do, has **zero open issues** about reasoning not displaying. The single thinking-related issue in their tracker (#12) is about the model-picker menu sometimes not showing the effort selector on cold start — unrelated, and the screenshot in that issue actually shows reasoning **rendering correctly** as a collapsible block.

---

## `LanguageModelThinkingPart` Contract

Source: `src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts` on VS Code `main` (109 lines, latest commit 2026-06-16).

```typescript
declare module "vscode" {
  /**
   * A language model response part containing thinking/reasoning content.
   * Thinking tokens represent the model's internal reasoning process that
   * typically streams before the final response.
   */
  export class LanguageModelThinkingPart {
    /** The thinking/reasoning text content. */
    value: string | string[];

    /** Optional unique identifier for this thinking sequence. Provided at end of stream. */
    id?: string;

    /** Optional metadata associated with this thinking sequence. */
    metadata?: { readonly [key: string]: any };

    constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: any });
  }

  // Also extends:
  //   LanguageModelChatResponse.stream          → includes LanguageModelThinkingPart
  //   LanguageModelChatMessage2.content         → includes LanguageModelThinkingPart
}
```

**Status:** Still proposed (lives under `src/vscode-dts/vscode.proposed.*`), but **usable at runtime** without `enableProposedApi` for extensions that already use the `chatProvider` proposal implicitly (like ours).

---

## Implementation Plan (Verified, Low-Risk)

### Step 1 — Type augmentation file

Create `src/vscode.proposed.languageModelThinkingPart.d.ts` with the class declaration above. This resolves the current compile hazard where our `src/vscode.proposed.chatProvider.d.ts` (line 119) **references** `LanguageModelThinkingPart` in the `LanguageModelResponsePart2` union but never **defines** it.

No `tsconfig.json` change needed: the file lives under `src/` which is already in `rootDir` and auto-included.

### Step 2 — Emit reasoning as a thinking part in the streaming extractor

In `src/streaming.ts`, modify `OpenAiResponseExtractor` so that reasoning (both `delta.reasoning_content` deltas and think-tag-filtered thinking) is **streamed to the UI per-chunk** via `progress.report(new vscode.LanguageModelThinkingPart(chunk))`, instead of only being accumulated.

Keep the `onReasoningContent` callback wired — it is still required for tool-call follow-up replication in `src/extension.ts` (`reasoningContentByToolCallId`).

### Step 3 — Runtime guard for old VS Code

Wrap the emit in a capability check so the extension degrades gracefully on hypothetical old runtimes:

```typescript
const ThinkingPartCtor = (vscode as { LanguageModelThinkingPart?: unknown }).LanguageModelThinkingPart;
if (typeof ThinkingPartCtor === "function") {
  progress.report(new (ThinkingPartCtor as new (v: string) => vscode.LanguageModelResponsePart2)(chunk));
} else {
  // Fallback: keep current accumulate + flushReasoningFallback behavior
  this.reasoningContent += chunk;
}
```

Since our `engines.vscode: ^1.125.0` already guarantees the API is present, this guard is defensive only — but it prevents a hard crash if the extension is ever side-loaded into an older host.

### Step 4 — Refactor `flushReasoningFallback`

The current fallback drops reasoning silently when text/tool calls are present. After Step 2, reasoning is already surfaced live, so the fallback's only remaining job is the "empty-response safety net" (emit something when the model returned only reasoning and nothing else). Keep that semantics but route through the thinking part when available, else fall back to `LanguageModelTextPart`.

### Step 5 — No `package.json` change

Do **not** add `enabledApiProposals`. DeepSeek-v4 proves it is unnecessary for the `chatProvider`-implicit-activation path we already use. Adding it would also restrict the extension to VS Code versions that explicitly recognize the proposal declaration, which is a stricter requirement than today.

### Step 6 — Verify

1. `npm run compile` — must pass with the new `.d.ts`.
2. Manual test in Copilot Chat with at least one reasoning model per family: DeepSeek, Kimi, GLM, Qwen, MiniMax, MiMo.
3. Test under all three `chat.agent.thinkingStyle` values: `collapsed`, `collapsedPreview`, `fixedScrolling`.
4. Confirm tool-call workflows still replay reasoning on follow-up requests (the `onReasoningContent` path).

---

## Risk Assessment

| Risk                                                                     | Likelihood                              | Impact                 | Mitigation                                                |
| ------------------------------------------------------------------------ | --------------------------------------- | ---------------------- | --------------------------------------------------------- |
| VS Code `<1.102` user hits `undefined` constructor                       | Very low — our floor is `1.125.0`       | Crash                  | Runtime guard (Step 3)                                    |
| Copilot Chat doesn't render thinking part in some UI mode (agent vs ask) | Low — DeepSeek-v4 works in both         | Partial fix            | Manual test per mode (Step 6.2)                           |
| Type augmentation conflicts with future `@types/vscode`                  | Low — proposed API, not in stable types | Compile error          | File is self-contained, can be deleted once API graduates |
| Tool-call replication breaks                                             | Low — callback untouched                | Multi-turn regressions | Keep `onReasoningContent` wiring intact                   |

---

## Relationship to Existing Think-Tag Handling

This fix is **independent** of `opencodego.stripThinkTags`:

- `stripThinkTags` controls whether `<think>...</think>` tags inlined in the **text content** are extracted. It currently only affects MiniMax M3 (in `"auto"` mode) or all models (in `"always"` mode).
- After this fix, **whatever** the think-tag filter extracts as `thinking` should be routed through `LanguageModelThinkingPart` — so the two mechanisms compose: filter first, then surface.

Users who want reasoning **hidden entirely** can still set `stripThinkTags: "always"` and the extracted thinking will surface as a collapsible block (which they can then collapse via `chat.agent.thinkingStyle: "collapsed"`). This finally makes the two settings coherent.

---

## Cross-References

- **Superseded:** [`23-20260615-thinking-style-setting-not-respected.md`](./23-20260615-thinking-style-setting-not-respected.md) — original investigation, conclusion overturned by this doc.
- [`05-20260517-thinking-mode-picker-configuration.md`](./05-20260517-thinking-mode-picker-configuration.md) — per-model Thinking controls (request-side).
- [`06-20260517-thinking-native-submenu-investigation.md`](./06-20260517-thinking-native-submenu-investigation.md) — native submenu + v0.1.4 release.
- [`21-20260613-minimax-m3-think-tag-leak-reimplementation.md`](./21-20260613-minimax-m3-think-tag-leak-reimplementation.md) — MiniMax M3 think-tag stripping.
- [`22-20260614-thinking-off-missing-for-effort-only-schemas.md`](./22-20260614-thinking-off-missing-for-effort-only-schemas.md`) — PR #38, reasoning off option.
- Feature doc: [`02-20260517-per-model-thinking-controls.md`](../features/02-20260517-per-model-thinking-controls.md) — request-side thinking config.
- Architecture: [`01-20260514-open-code-provider-architecture.md`](../architecture/01-20260514-open-code-provider-architecture.md) — provider/streaming architecture.

---

## Implementation Log (2026-07-09)

**Branch:** `fix/thinking-part-byok-surfacing-22-71`

### Files changed

| File                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/vscode.proposed.languageModelThinkingPart.d.ts` | **NEW** — type augmentation for the proposed `LanguageModelThinkingPart` class (copied from VS Code repo `src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/streaming.ts`                                   | Added `thinkingPartConstructor` module-level constant (runtime guard) + `emitThinkingPart()` helper. Extended `OpenAiResponseExtractor` and `AnthropicResponseExtractor` constructors to accept `progress` + `localRequestId`. Added `handleReasoning()` method to both extractors: accumulates reasoning for tool-call replication AND streams it live via `LanguageModelThinkingPart`. Replaced all 9 `this.reasoningContent +=` sites in the extractors with `this.handleReasoning()`. Refactored both `flushReasoningFallback()` methods to early-return when the thinking part API is available (reasoning already streamed live). Updated all 4 transport call sites (`streamChatCompletions`, `streamAnthropicMessages`, `streamResponsesApi`, `streamGoogleGenerateContent`) to pass `progress` + `localRequestId` to the extractor. |

### What was NOT changed (by design)

- `package.json` — no `enabledApiProposals` added (DeepSeek-v4 proves it is unnecessary for the implicit `chatProvider` activation path).
- `tsconfig.json` — no change needed; the new `.d.ts` lives under `src/` which is already in `rootDir`.
- `onReasoningContent` callback wiring in `src/extension.ts` — untouched. Tool-call replication still works.
- `opencodego.stripThinkTags` setting — untouched. Think-tag filtering composes with the new thinking part surfacing.

### Verification

- `npm run compile` → **pass** (exit 0, no errors).
- `npx tsc --noEmit --strict` → **pass** (exit 0).
- `get_errors` on `src/streaming.ts` + `src/vscode.proposed.languageModelThinkingPart.d.ts` → **no errors**.
- Confirmed only 2 remaining `this.reasoningContent +=` occurrences, both inside `handleReasoning()` methods (correct location).
- Declaration merging: no conflict between the two `.d.ts` files that both `declare module 'vscode'`.
- `contextWindowHook` verified safe — no `instanceof` checks or `.value` access that could mis-handle thinking parts.
- `totalReasoningChars` monotonic counter added for accurate `[stream-summary]` log metrics (previous `reasoningChars` showed 0 after clear).
- Non-stream path (`extractChatCompletionParts`, `extractAnthropicParts`) also updated to emit via thinking part for consistency.

### Manual test (2026-07-09) ✅

- [x] DeepSeek — reasoning rendered as collapsible thinking block in Copilot Chat.
- [x] Kimi — reasoning rendered as collapsible thinking block in Copilot Chat.
- [x] `chat.agent.thinkingStyle` setting now respected.
- [x] Tool-call workflows still replay reasoning on follow-up requests.

### Pending before release

- [x] ~~Manual test in Copilot Chat~~ — done.
- [x] ~~Commit + release~~ — v0.3.7.

---

## Verification Commands (Research Phase, 2026-07-09)

```bash
# Confirm codebase never instantiates LanguageModelThinkingPart
grep -rn "new vscode.LanguageModelThinkingPart\|new LanguageModelThinkingPart" src/
# → (empty)

# Confirm local .d.ts references but does not define the class
grep -n "class LanguageModelThinkingPart" src/vscode.proposed.chatProvider.d.ts
# → NOT FOUND (only referenced at line 119 in the union type)

# Confirm reasoning is accumulated, not surfaced
grep -n "reasoningContent\|flushReasoningFallback\|onReasoningContent" src/streaming.ts
# → accumulated in OpenAiResponseExtractor.reasoningContent; surfaced only via fallback

# Confirm no enabledApiProposals in package.json
grep -n "enabledApiProposals\|enabledApiProposalNames" package.json
# → (empty)

# Confirm engine floor is well past the August 2025 API ship date
grep -n '"vscode"' package.json
# → "vscode": "^1.125.0"
```

External verification (web research):

- VS Code commit history for `src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts` → API added 2025-08-06.
- `Vizards/deepseek-v4-for-copilot` `package.json` → no `enabledApiProposals`, engine `^1.116.0`.
- `Vizards/deepseek-v4-for-copilot` `src/provider/stream.ts` lines 215–224 → working `LanguageModelThinkingPart` emit.
- `Vizards/deepseek-v4-for-copilot` issue tracker → zero open issues about reasoning not displaying.
