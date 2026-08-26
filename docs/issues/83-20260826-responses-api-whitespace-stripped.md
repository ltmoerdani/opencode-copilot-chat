**Status:** ✅ Solved
**Fix PR:** [#194](https://github.com/ltmoerdani/opencode-copilot-chat/pull/194)
**Related:** #192
**Landed:** PR #194 (ltmoerdani/fix/issue-192-responses-whitespace-stripped, merge `717f6b5`)

# Responses API whitespace stripped from all OpenAI model responses (#192)

**Topic:** streaming / responses-api / routing
**Updated:** 2026-08-26
**Tags:** #responses-api #bug #whitespace #streaming

---

## Problem

All whitespace between words was stripped from responses when using OpenAI models (GPT family) on both OpenCode Go and OpenCode Zen. Every word in the reply was concatenated together with no spaces between them, e.g. `thisiswhattheresponselookslike`, making answers unreadable.

Models from other providers (Claude, Gemini, DeepSeek, Kimi, MiniMax, etc.) worked as intended and preserved all spaces between words.

The bug also reproduced on a brand-new Temporary VS Code Profile with only the extension installed, confirming it was not caused by an extension conflict.

## Environment

- Extension version: **0.7.1**
- VS Code version: **1.134.0**
- Platform: Linux (reporter)
- Providers: OpenCode Go + OpenCode Zen
- Models: All GPT-family models routed through the Responses API

## Root cause

The Responses API streams text content in small delta chunks via the `response.output_text.delta` SSE event. Each chunk carries a fragment of the full response — often a single word or a few characters, with spaces at chunk boundaries.

The `normalizeResponsesStreamEvent()` function in `src/core/routing.ts` used `firstString()` to extract the text from each delta event. `firstString()` calls `.trim()` on the value before returning it:

```ts
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim(); // ← BUG: trims each chunk individually
    }
  }
  return undefined;
}
```

Because `.trim()` was applied to **each individual delta chunk**, leading/trailing whitespace was stripped from every fragment. When the caller accumulated the fragments, the spaces between words were permanently lost:

```text
Chunk 1: "hello "  → trim → "hello"
Chunk 2: "world"   → trim → "world"
Accumulated:        "helloworld"  ← spaces gone!
```

### Why only OpenAI models?

The GPT model family is routed through the **Responses API** transport (`src/transports/responses.ts`), which normalizes events via `normalizeResponsesStreamEvent()` in `src/core/routing.ts`. Other transports use different code paths:

| Transport                  | Endpoint               | Text extraction                                   | Affected? |
| -------------------------- | ---------------------- | ------------------------------------------------- | --------- |
| Responses API (GPT)        | `/v1/responses`        | `normalizeResponsesStreamEvent` → `firstString()` | ✅ Yes    |
| Chat-completions (non-GPT) | `/v1/chat/completions` | `extractTextFromDelta()` (no trim)                | ❌ No     |
| Anthropic Messages         | `/v1/messages`         | `anthropic.ts` (separate path)                    | ❌ No     |
| Google generateContent     | (SSE)                  | `google.ts` (separate path)                       | ❌ No     |

### Affected code paths

The bug affected two call sites in `src/core/routing.ts`:

1. **`normalizeResponsesStreamEvent()` — line 59** — `response.output_text.delta` events: the main text content stream.
2. **`extractResponsesReasoningText()` — line 373** — reasoning events from the Responses API (less visible because reasoning goes to the thinking panel, but still affected).

Non-text fields (`call_id`, `stop_reason`, `arguments_delta`) used `firstString()` correctly — `.trim()` is safe for identifiers and enums — and were left unchanged.

## Fix

### Changes in `src/core/routing.ts`

1. **Added `firstStringRaw()`** — a new helper identical to `firstString()` but **without** the `.trim()` call. This preserves all whitespace in the extracted value.

```ts
function firstStringRaw(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}
```

1. **`normalizeResponsesStreamEvent()`** — changed the `response.output_text.delta` handler to use `firstStringRaw()` instead of `firstString()`.

2. **`extractResponsesReasoningText()`** — changed to use `firstStringRaw()` for reasoning text deltas.

3. `firstString()` is **unchanged** — it continues to be used for non-text fields (`call_id`, `stop_reason`, `arguments_delta`) where `.trim()` is appropriate.

### Changes in `src/test/routing.test.ts`

Added 8 tests in two suites:

- **`finish_reason mapping`** (3 existing tests, unchanged)
- **`output_text.delta whitespace preservation (#192)`** (8 new tests):
  - Trailing space preserved in a single chunk
  - Leading space preserved in a single chunk
  - Whitespace preserved across two consecutive chunks (the exact bug scenario)
  - Fallback to `text` field when `delta` is absent
  - Newlines and tabs preserved in deltas
  - Empty delta handled gracefully (no choices emitted)
  - Realistic multi-chunk scenario: 8 chunks accumulating to `"This is a test sentence with multiple   spaces"`
  - Baseline: no-spaces-in-deltas produces concatenated string as expected

## Verification

| Check                        | Result                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `npm run compile`            | ✅ Clean                                               |
| `npm run lint`               | ✅ All 7 checks pass                                   |
| Unit tests                   | ✅ **429/429 pass** (0 fail, 4 new tests for this fix) |
| Existing finish_reason tests | ✅ Unchanged, still pass                               |

## Traceability

| Artifact     | Location                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------- |
| Bug report   | [#192](https://github.com/ltmoerdani/opencode-copilot-chat/issues/192)                        |
| Root cause   | `src/core/routing.ts` — `firstString()` calls `.trim()` on each delta                         |
| Fix          | `src/core/routing.ts` — `firstStringRaw()` no-trim helper                                     |
| Tests        | `src/test/routing.test.ts` — 8 new tests in whitespace suite                                  |
| Transport    | `src/transports/responses.ts` (uses `normalizeResponsesStreamEvent`)                          |
| Architecture | [Provider Adapter Architecture](../architecture/02-20260809-provider-adapter-architecture.md) |
