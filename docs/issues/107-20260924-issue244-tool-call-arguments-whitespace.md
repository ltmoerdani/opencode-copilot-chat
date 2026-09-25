# Issue #244 — Whitespace Stripped from Tool-Call Arguments on OpenAI Models (Responses API)

**Status:** ✅ Solved
**Topic:** streaming / responses-api / tool-calls
**Updated:** 2026-09-24
**Tags:** #responses-api #bug #whitespace #streaming #tool-calls
**GitHub Issue:** [#244](https://github.com/ltmoerdani/opencode-copilot-chat/issues/244)
**Related:** doc [83 — Responses API whitespace stripped (#192)](83-20260826-responses-api-whitespace-stripped.md) — same bug class, different delta path

---

## Problem

Reporter (KonradDebski, ext 0.7.6): all whitespace is stripped from tool calls and responses when using **OpenAI models** on both OpenCode Go and OpenCode Zen — every word concatenated (`thisiswhattheresponselookslike`). Corrupted tool-call arguments also cause the model to enter **reasoning loops** (stuck re-resolving mangled tool input). Other providers unaffected. Reproducible on a fresh VS Code profile with only this extension installed.

## Root Cause — regression of the #192 fix's scope assumption

Doc 83 (PR #194, merge `717f6b5`) fixed the visible-text path by introducing `firstStringRaw()` (no `.trim()`) for `output_text.delta` and reasoning deltas, and **deliberately left `arguments_delta` on the trimming `firstString()`** under the assumption that "whitespace stripping is correct for arguments".

That assumption was wrong. OpenAI Responses API streams tool arguments as arbitrary JSON slices — fragments **can split inside JSON string values** (`"hello wo` + `rld"`). Trimming each fragment destroys the boundary whitespace:

```ts
// src/core/routing.ts (BEFORE — bug)
if (eventType === "response.function_call_arguments.delta") {
  const delta = firstString(data.delta, data.arguments_delta); // ← .trim() per fragment
```

Because GPT models route to the `responses` transport (`resolveModelRouting`), and in agent mode most output flows through tool calls, the corruption surfaced as "all whitespace stripped".

## Reporter Diagnostics (from the issue, verified 2026-09-24)

The reporter's OpenCode Diagnostics dumps (Go + Zen) corroborate the root cause:

- **Every affected request hit the `responses` endpoint** — `gpt-5.6-luna` on `opencode.ai/zen/go/v1/responses` and `gpt-5.6-sol` on `opencode.ai/zen/v1/responses`. This is exactly the transport whose normalizer carried the bug; other families (DeepSeek, GLM, …) route to `chat-completions`/`messages`, whose tool-call arguments are appended raw — which is why the reporter saw "models from other providers work as intended".
- **All requests returned HTTP 200 with `finishReason: stop`** — the corruption happened silently in the normalization layer, invisible to the HTTP layer. Consistent with per-fragment `.trim()`, which leaves no trace on the wire.
- **Repeat-request pattern fits the reasoning loop**: Go — two `gpt-5.6-luna` calls 18 s apart with an overlapping prompt cache (37%); Zen — three `gpt-5.6-sol` calls in 4 minutes at 98.6–98.9% prompt-cache hit (identical prompts retried), then tiny completions (7–15 tokens). Classic agent retry-after-corrupted-tool-input behaviour.
- **`totalEvents: 11–98`** — many small delta fragments means many fragment boundaries, i.e. many chances for the trim to eat a space.
- Reported models carry `thinkingFamily: openai` — no think-tag filter is active for this family, ruling out `filterText` as the whitespace eater on the visible-text path.

## Evidence (official sources, verified 2026-09-24)

- **openai-node `response-accumulator.ts`**: the official SDK accumulates via raw `output.arguments += event.delta` — no trim, no falsy filtering, even for empty-string deltas.
- **OpenAI API reference** (`ResponseFunctionCallArgumentsDeltaEvent.delta`): "The function-call arguments delta that is added" — an incremental fragment to append.
- **openai-node test mocks** split argument streams **on whitespace boundaries**, exactly the case per-fragment trimming destroys.
- **`response.function_call_arguments.done`** carries the final authoritative `arguments` string — used as a repair net.

## Fix

| File                         | Change                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/routing.ts`        | `response.function_call_arguments.delta`: `firstString` → `firstStringRaw` (root-cause fix)                                                         |
| `src/core/routing.ts`        | New handler for `response.function_call_arguments.done`: emits a `tool_calls` delta tagged `argumentsDone: true` carrying the final arguments       |
| `src/toolCallAccumulator.ts` | `collect()` honours `argumentsDone` — **replaces** (not appends) pending arguments, healing any delta-join corruption even if a gateway mis-streams |

Design note: the done-event path makes the fix **permanent** — even if some gateway trims or mangles delta fragments, the final `response.function_call_arguments.done` value overwrites the accumulated string, matching official SDK semantics (`output.arguments = event.arguments`).

> **⚠️ Follow-up regression (fixed in 0.7.8):** the original repair delta also forwarded `id: firstString(call_id, item_id)` — and the real luna done event carries only `item_id` (`fc_1`), which the accumulator adopted, clobbering the real `call_*` identity and causing `400 No tool output found` (item ids are reused across turns). See [doc 108](108-20260925-issue244-followup-done-event-id-clobber.md). The arguments-only repair remains; identity is never touched.

## Tests

- `src/test/routing.test.ts` — "function_call_arguments whitespace preservation (#244)": fragments split inside a JSON string value must preserve the space; done-event mapping; done-event without arguments emits no choices.
- `src/test/toolCallAccumulator.test.ts` — "argumentsDone replaces accumulated arguments (#244)": replace semantics + append-only path unaffected.

Verification: `npm test` 489/489 pass, `npm run compile` clean.

## Impact

- Models: all OpenAI-family models on Go and Zen (responses transport). Non-OpenAI providers unaffected (chat-completions arguments already appended raw).
- No changes to text/reasoning paths — the #192 fix remains intact.
