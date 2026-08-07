**Status:** ✅ Solved

# MiniMax M3 `<think>` Tag Leak — Reimplementation

**Topic:** streaming / models / thinking / provider  
**Updated:** 2026-06-13  
**Tags:** #streaming #models #minimax #thinking #bugfix  
**Supersedes:** —

---

## Overview

MiniMax M3 (and the broader MiniMax M-series family) inline their chain-of-thought reasoning directly inside the `content` text field wrapped in `<think>...</think>` tags, rather than using a dedicated `reasoning_content` field. This caused raw reasoning text to leak into the VS Code Copilot Chat UI, making responses unreadable.

The original fix for this problem was shipped in **v0.2.2** (PR #13 by community contributor Wallacy). However, at some point during the v0.2.4–v0.2.7 merge/refactor cycle, **the actual stripping implementation was lost** — the `opencodego.stripThinkTags` setting remained declared in `package.json` and was read from config in `extension.ts`, but the logic to actually strip `<think>` tags was **never executed**. This session re-implements the feature from scratch with a cleaner, more robust design.

**Documented:** 2026-06-13

---

## Problem

User reported that MiniMax M3's `<think>` reasoning blocks were appearing verbatim in the Copilot Chat window, polluting the visible response with long chains of internal reasoning.

### Investigation

| Component           | File               | Finding                                                                                                           |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Setting declaration | `package.json`     | `opencodego.stripThinkTags` with `"never"` / `"auto"` / `"always"` enum, default `"auto"` — ✅ present            |
| Config reader       | `src/extension.ts` | `stripThinkTags` in `ApiSettings` interface + `config.get()` call — ✅ present                                    |
| Type mismatch       | `src/extension.ts` | `ApiSettings.stripThinkTags` typed as `"auto" \| "on" \| "off"` — ❌ **wrong**, doesn't match `package.json` enum |
| **Stripping logic** | `src/streaming.ts` | **❌ MISSING** — no `ThinkTagFilter`, `processThinkTagsStream`, or any tag-stripping code existed                 |
| Extractors          | `src/streaming.ts` | `OpenAiResponseExtractor` and `AnthropicResponseExtractor` emitted text verbatim — no filtering applied           |

**Root cause:** The setting was wired through the config layer but the runtime implementation was absent. The `OpenAiResponseExtractor` constructor only accepted `onReasoningContent` and `onReasoningDebug` callbacks — no think-tag filter. All text from `delta.content` / `delta.text` was emitted directly to the chat UI.

---

## Solution

Implemented a new `ThinkTagFilter` class with a streaming-safe state machine design, wired into both response extractors and all four streaming entry points.

### Architecture

```
SSE chunk arrives
    │
    ▼
OpenAiResponseExtractor.extractStreamParts()
    │
    ├── extractTextFromDelta(delta) → raw text
    │
    ├── this.filterText(text)
    │       │
    │       ├── thinkFilter present? ── No ──▶ { visible: text, thinking: "" }
    │       │
    │       └── Yes ──▶ ThinkTagFilter.process(text)
    │                       │
    │                       ├── Separates <think> content → thinking
    │                       └── Returns { visible: cleanText, thinking: rawReasoning }
    │
    ├── visible text → LanguageModelTextPart → emitted to chat
    └── thinking text → accumulated into reasoningContent
```

### Components

| Component                                       | Location               | Purpose                                                                                           |
| ----------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `ThinkTagFilter` class                          | `src/streaming.ts`     | Streaming state machine — processes text chunk-by-chunk, handles tags split across SSE boundaries |
| `shouldStripThinkTags()`                        | `src/streaming.ts`     | Config resolution: `"auto"` → only `/^minimax-m/i` models, `"always"` → all, `"never"` → none     |
| `createThinkTagFilter()`                        | `src/streaming.ts`     | Factory: returns `ThinkTagFilter \| undefined` based on mode + modelId                            |
| `filterText()` method                           | Both extractor classes | Private helper: passes text through filter if active, passthrough otherwise                       |
| `flushReasoningFallback()` update               | Both extractor classes | Calls `thinkFilter.finish()` to flush remaining buffer at stream end                              |
| `stripThinkTags` in `StreamRequestOptions`      | `src/streaming.ts`     | New optional field on the streaming options interface                                             |
| `stripThinkTags` threaded to all 4 stream calls | `src/extension.ts`     | `settings.stripThinkTags` passed to messages, responses, google, and chat-completions             |
| `ApiSettings.stripThinkTags` type fix           | `src/extension.ts`     | `"auto" \| "on" \| "off"` → `"never" \| "auto" \| "always"` to match `package.json`               |

### ThinkTagFilter Design

The filter maintains two pieces of state:

1. **`carry`** — A text buffer held from the previous chunk. Because `<think>` (7 chars) or `</think>` (8 chars) tags can be split across SSE chunk boundaries, the filter keeps up to `max(7, 8) = 8` characters of trailing text in `carry` to ensure boundary tags are detected in the next chunk.

2. **`insideThink`** — Boolean flag tracking whether the current position is inside a `<think>` block.

**Edge cases handled:**

| Case                                | Behavior                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| `<think>` split across chunks       | `carry` buffer preserves partial tag, matched on next chunk |
| `</think>` split across chunks      | Same carry mechanism                                        |
| Unclosed `<think>` at end of stream | `finish()` flushes remaining carry as thinking content      |
| Leading whitespace after `<think>`  | Single `\n` or `\r\n` skipped for cleaner reasoning capture |
| Leading whitespace after `</think>` | Single `\n` or `\r\n` skipped for cleaner visible output    |
| No think tags in content            | Passthrough — zero overhead                                 |

### Differences from PR #13 (v0.2.2)

| Aspect            | PR #13 (v0.2.2)                           | This Fix (v0.2.8)                                       |
| ----------------- | ----------------------------------------- | ------------------------------------------------------- |
| Class name        | `processThinkTagsStream()` function       | `ThinkTagFilter` class with `process()` + `finish()`    |
| Known-model regex | `/^minimax-/i` (all MiniMax)              | `/^minimax-m/i` (M-series only)                         |
| State management  | `thinkOpenBuffer` string in extractor     | Dedicated `carry` + `insideThink` in filter class       |
| Extraction        | Inner think content discarded             | Inner think content accumulated into `reasoningContent` |
| Config type       | Correct (`"never" \| "auto" \| "always"`) | Fixed (was wrong in `ApiSettings`, now matches)         |

---

## Changes

| #   | Change                                              | Files              | Impact                                                                                                                  |
| --- | --------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| P0  | New `ThinkTagFilter` class                          | `src/streaming.ts` | Streaming-safe `<think>` tag parser with carry buffer                                                                   |
| P1  | `shouldStripThinkTags()` + `createThinkTagFilter()` | `src/streaming.ts` | Config-gated model detection (auto/always/never)                                                                        |
| P2  | `thinkFilter` in `OpenAiResponseExtractor`          | `src/streaming.ts` | Constructor param + `filterText()` method + wired into delta/message text extraction                                    |
| P3  | `thinkFilter` in `AnthropicResponseExtractor`       | `src/streaming.ts` | Constructor param + `filterText()` method + wired into `content_block_start`, `content_block_delta`, and fallback paths |
| P4  | `flushReasoningFallback()` flush                    | Both extractors    | Calls `thinkFilter.finish()` at stream end to emit remaining visible text                                               |
| P5  | `stripThinkTags` in `StreamRequestOptions`          | `src/streaming.ts` | New optional field on streaming interface                                                                               |
| P6  | All 4 stream entry points create filter             | `src/streaming.ts` | `streamChatCompletions`, `streamAnthropicMessages`, `streamResponsesApi`, `streamGoogleGenerateContent`                 |
| P7  | Thread `stripThinkTags` to all 4 calls              | `src/extension.ts` | `settings.stripThinkTags` passed through                                                                                |
| P8  | Fix `ApiSettings.stripThinkTags` type               | `src/extension.ts` | `"auto" \| "on" \| "off"` → `"never" \| "auto" \| "always"`                                                             |

---

## Verification

```bash
npm run compile    # 0 errors, 0 warnings
```

No type errors across `src/streaming.ts` or `src/extension.ts`.

---

## Design Decisions

1. **Dedicated class vs function** — A stateful `ThinkTagFilter` class is cleaner than a function with closure-captured state. It encapsulates `carry` + `insideThink` and exposes `process()` + `finish()` — easy to reason about and test.

2. **Accumulate thinking content** — Unlike PR #13 which discarded the inner `<think>` content, this implementation routes it into the existing `reasoningContent` accumulator. This means if the model produces only thinking (no visible text), the reasoning fallback mechanism can still emit it. It also feeds `onReasoningContent` callbacks for tool-call associations.

3. **M-series regex (`/^minimax-m/i`)** — Slightly narrower than PR #13's `/^minimax-/i`. This avoids accidentally stripping `<think>` tags from hypothetical future MiniMax models that may use proper `reasoning_content` fields. Can be broadened if needed.

4. **Passthrough when inactive** — When `thinkFilter` is `undefined` (setting is `"never"` or model doesn't match in `"auto"` mode), `filterText()` returns the text unchanged with zero overhead.

5. **All 4 stream endpoints** — Even though MiniMax M3 currently routes through the chat-completions endpoint, the filter is wired into all four entry points (chat-completions, messages, responses, google) for future-proofing. If MiniMax models ever switch endpoints, the fix works automatically.

---

## Lessons Learned

1. **Settings without implementations are silent failures** — The `stripThinkTags` setting was declared in `package.json`, read from config, and threaded through `ApiSettings` — but the runtime code was missing. The user saw no error; think tags simply leaked. This type of "config-only ghost" is hard to detect without integration testing.

2. **Merge churn can silently drop features** — The v0.2.2 implementation (PR #13) was likely lost during one of the v0.2.4–v0.2.7 merge cycles. Code review during merges should verify that referenced settings have corresponding runtime implementations.

3. **Type mismatches hide bugs** — The `ApiSettings.stripThinkTags` type (`"auto" | "on" | "off"`) didn't match the `package.json` enum (`"never" | "auto" | "always"`). TypeScript didn't catch this because the config getter returns `string` and the assignment was implicit. Aligning types with the actual setting enum prevents this class of bug.

---

_Related: [Issue #15 — PR #13 Review (v0.2.2)](../issues/14-20260608-pr13-minimax-think-tags-review-merge-release.md) | [GitHub Issue #12](https://github.com/ltmoerdani/opencode-copilot-chat/issues/12)_
