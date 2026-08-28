**Status:** ✅ Solved
**Fix PR:** pending
**Related:** #197, #198, #193, #187, #79
**Landed:** pending

# finishReason never captured + zero text extraction — Responses API root cause

**Topic:** streaming / transport / responses-api / muse-spark
**Updated:** 2026-08-28
**Tags:** #streaming #transport #responses-api #bug #muse-spark #gpt-luna

---

## Problem

Issue [#197](https://github.com/ltmoerdani/opencode-copilot-chat/issues/197): Muse
Spark 1.2 throws `"response stream ended before completion"` on **every** request
after upgrading to v0.7.1/v0.7.2. Stack shows 3 retry frames (engine.js:415:17 ×3)
then throw (line 439:34). HanHan666666 confirmed the same signature on **gpt-5.6-luna**
(issue #198 comment).

Issue [#198](https://github.com/ltmoerdani/opencode-copilot-chat/issues/198):
Identifies the root cause — `finishReason` is never set for Responses API streams,
which also explains why Muse Spark returns 0 extracted text parts.

---

## Root Cause Analysis

### Gap 1 — `finishReason` never captured (P1)

`updateRequestUsageSummary` in `src/transports/extract.ts` receives the **raw SSE
JSON** from the parse loop. It reads `finishReason` from exactly two paths:

- `data.delta.stop_reason` (Anthropic shape)
- `data.choices[0].finish_reason` (chat-completions shape)

A raw Responses API terminal event looks like:

```json
{ "type": "response.completed", "response": { "stop_reason": "completed" } }
```

This has **neither** field. So `finishReason` stays `undefined` on every Responses
API stream that doesn't send `data: [DONE]`.

`isStreamTruncated` checks `params.finishReason === undefined && totalBytes > 0`
(with `usesDoneSentinel = true`). The result is always `true` → retry 3× → throw.

Why GPT models survived: the OpenCode gateway forwards the `data: [DONE]` sentinel
for upstream OpenAI models, so `sawDone = true` bypasses the `finishReason` check.
Muse Spark (upstream Meta) and gpt-5.6-luna paths do **not** forward `[DONE]` →
always flagged as truncated.

### Gap 2 — 0 text parts extracted (P2)

Log analysis from weizhen25 (issue #198, uploaded `opencode-fail-muse.txt`):

- 11 events / 264KB — dominated by reasoning events with `encrypted_content`
- `extractResponsesReasoningText` returns `""` for encrypted blobs → 0 reasoning parts
- The actual text response arrives in `response.output_text.done` (or `response.output_item.done`)
- Both event types were not handled by `normalizeResponsesStreamEvent` → `{ choices: [] }` → 0 parts

This is why retry attempts see 0 extracted parts → engine assumes truncation → retry → throw.

### Historical context

This single root cause explains the entire Muse Spark saga:

| Issue         | Symptom                              | Root                      |
| ------------- | ------------------------------------ | ------------------------- |
| #79 (Aug 22)  | 12 parts + no `[DONE]` → throw       | finishReason not captured |
| #187 (v0.7.1) | Patched symptom: parts > 0 → success | Didn't fix finishReason   |
| #193 (v0.7.1) | Zen models "try again"               | finishReason not captured |
| #195 (v0.7.2) | Wrong fix (hasCompletePendingWork)   | Didn't fix finishReason   |
| #197 (v0.7.2) | Muse Spark 0 parts → retry → throw   | Both gaps                 |
| #198 (v0.7.2) | gpt-5.6-luna same signature          | Gap 1 only                |

---

## Fix

### P1 — `src/transports/extract.ts`

Treat `response.completed` as a terminal signal in `updateRequestUsageSummary`.
Set `finishReason` from `response.stop_reason` when present, defaulting to `"stop"`:

```ts
if (data.type === "response.completed") {
  const response = isRecord(data.response) ? data.response : data;
  summary.finishReason = typeof response.stop_reason === "string" ? response.stop_reason : "stop";
  return;
}
```

The `return` is placed **after** the usage block (which runs first), so token
counts from `response.completed` are still captured correctly.

### P1b — `src/core/routing.ts` (defense in depth)

Added `?? "stop"` fallback to the `response.completed` block in
`normalizeResponsesFinishReason`, so the normalized `choices[0].finish_reason`
is never `null` for a terminal event:

```ts
finish_reason: normalizeResponsesFinishReason(firstString(...)) ?? "stop",
```

Routing test updated from `null` to `"stop"` for the no-`stop_reason` case.

### P2 — `src/core/routing.ts` + `src/transports/extractors.ts`

Two new handlers in `normalizeResponsesStreamEvent`:

- `response.output_text.done` → `delta.responseDoneText = data.text`
- `response.output_item.done` (message type) → `delta.responseDoneText = item.content[].text`

`OpenAiResponseExtractor.extractStreamParts` emits `responseDoneText` only when
`this.emittedTextLength === 0` — the dedup guard that prevents double-emission
on models (GPT-4o, etc.) that send both streaming deltas AND the done snapshot.

```text
GPT-4o:    delta×N → emittedTextLength > 0 → responseDoneText SKIPPED ✅
Muse Spark: (no delta) → emittedTextLength = 0 → responseDoneText EMITTED ✅
```

---

## Tests Added

**`src/test/extractors.test.ts`:**

- `"sets finishReason to 'stop' on response.completed without stop_reason"` (P1)
- `"sets finishReason from stop_reason on response.completed"` (P1)
- `"emits text from responseDoneText when no delta text was seen"` (P2)
- `"skips responseDoneText when delta text was already emitted"` (P2)
- `"ignores empty responseDoneText"` (P2)

**`src/test/routing.test.ts`:**

- `"defaults finish_reason to 'stop' when no stop_reason is present"` (P1b — updated)
- `"maps response.output_text.done to responseDoneText in delta"` (P2)
- `"maps response.output_item.done (message) to responseDoneText"` (P2)
- `"ignores response.output_item.done for non-message items"` (P2)
- `"returns empty choices for response.output_text.done with no text"` (P2)

All 7 lint checks pass (`npm run lint`).

---

## User Impact

**Before:** Every Muse Spark and gpt-5.6-luna request fails with "Try again"
(3 retries → throw). Users see the error popup regardless of how simple the prompt.

**After:**

- "Try again" error is gone for all Responses API streams without `[DONE]`
- Muse Spark returns text correctly (extracted from `response.output_text.done`)
- gpt-5.6-luna works (finishReason captured → stream not flagged as truncated)
- All models that send both delta + done events: no duplicate text emission

---

## Files Changed

| File                           | Change                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `src/transports/extract.ts`    | P1: `response.completed` → `finishReason` capture                       |
| `src/core/routing.ts`          | P1b: `?? "stop"` + P2: `output_text.done` / `output_item.done` handlers |
| `src/transports/extractors.ts` | P2: `responseDoneText` guard with `emittedTextLength`                   |
| `src/test/extractors.test.ts`  | +5 tests                                                                |
| `src/test/routing.test.ts`     | +4 tests, 1 updated                                                     |
