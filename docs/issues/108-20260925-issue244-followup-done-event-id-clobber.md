# Issue #244 Follow-up — 0.7.7 Done-Event Repair Corrupted Tool-Call Identity (`400 No tool output found`)

**Status:** ✅ Solved (0.7.8)
**Topic:** streaming / responses-api / tool-calls / pairing
**Updated:** 2026-09-25
**Tags:** #responses-api #bug #tool-calls #pairing #regression
**GitHub Issue:** [#244](https://github.com/ltmoerdani/opencode-copilot-chat/issues/244) (comment 18h after the 0.7.7 fix)
**Related:** doc [107 — #244 arguments whitespace](107-20260924-issue244-tool-call-arguments-whitespace.md) (the fix this regressed), docs [96 — #216 pairing](../issues/96-20260808-issue216-no-tool-output-for-function-call.md), [90 — #206 fc_ ids](90-20260903-issue206-luna-responses-fc-id-mismatch.md)

---

## Problem

Immediately after updating to 0.7.7, the reporter's every OpenAI-model request failed:

```text
OpenCode Zen API request failed (400) model=gpt-5.6-luna payloadBytes=19484:
No tool output found for function call call_Vf1vzJwf5xa44CfwtrzYe4y7.
```

Same on OpenCode Go (`gpt-6-luna`, `call_d0KxiJXE7jjKAM4MQrXdbCZl`). All requests 400 at the gateway, before streaming.

## Root Cause — the done-event repair changed tool-call IDENTITY

The #244 fix (0.7.7) added a `response.function_call_arguments.done` handler emitting a repair delta tagged `argumentsDone: true`, with:

```ts
id: firstString(data.call_id, data.item_id) ?? "",
```

The captured REAL luna event shapes (#216/#217 suite) show the done event carries **only `item_id: "fc_1"` — never `call_id`**. So the repair delta adopted `fc_1`, and `ToolCallAccumulator.collect()` REPLACEd the real `call_*` id captured from `output_item.added`.

Fatal because **item ids are per-response and reused across turns**. Two turns both carrying `fc_1` as the part id produce, at the gateway: `function_call(fc_1) ×2` + `function_call_output(fc_1) ×1` — our pairing's `consumedOutputs` drops the second output, so the second function_call reaches the gateway unpaired → the exact 400.

Proven empirically: replaying the captured luna event sequence through `normalizeResponsesStreamEvent` + `OpenAiResponseExtractor` emitted `callId: "fc_1"` instead of `call_Vf1vzJwf5xa44CfwtrzYe4y7`.

## Fix

| Layer      | File                         | Change                                                                                                                                                                       |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root cause | `src/core/routing.ts`        | Done event forwards `id` **only when a real `call_id` is present**; otherwise no id — the repair is arguments-only                                                           |
| Defense    | `src/toolCallAccumulator.ts` | An id is captured **once** (first fragment that carries one) and never overwritten by later fragments                                                                        |
| Self-heal  | `src/responsesRequest.ts`    | `pairResponsesFunctionCallItems` collapses duplicate `function_call` items sharing one call_id (keeps the first) — histories already poisoned by 0.7.7 recover automatically |

### Identity Rule extended to every Responses entry point

The post-fix audit found the same latent fallback in two more places and removed it — **no Responses path may ever derive call identity from `item.id`**:

- `output_item.added` handler: `firstString(item.call_id, item.id)` → `call_id` only (empty → the flush fabricates a unique id, which cannot collide).
- `normalizeResponsesFullResponse` function_call mapping: same fallback removed.

Gateways that always send `call_id` (all known real shapes) are unaffected; only the hypothetical call_id-less shape changes behavior, and strictly for the better.

The `argumentsDone` REPLACE repair for arguments (the actual #244 fix) is preserved and pinned by test.

## Tests

`src/test/issue244-followup-regression.test.ts` (renamed from the repro) — 6 tests:

1. Part id stays `call_*` when done carries only `item_id` (the exact reported shape).
2. Full round-trip: wire request pairs function_call with its output.
3. `argumentsDone` still repairs mis-joined arguments (#244 fix preserved).
4. Pairing collapses duplicate function_call items (poisoned-history self-heal).
5. `output_item.added` without `call_id` never adopts the `fc_` item id.
6. `normalizeResponsesFullResponse` maps `call_id` only (no `item.id` fallback).

### Pre-release E2E (`tmp/e2e-issue244-prerelease.mjs` — 17/17 checks)

Full Copilot Chat loop simulated without VS Code, against the captured luna shapes:

- Turn 1: stream → part id = gateway `call_id`, arguments `"what is 2 plus 2?"` keep their spaces (the original #244 symptom).
- Turn 2: history replay → wire request → pairing call/output = 1:1, no 400 possible.
- Turn 3: second turn reusing item id `fc_1` (the 0.7.7 poison) stays clean.
- Poisoned-history self-heal: a history already written by 0.7.7 collapses to 1 call + 1 output — users recover without clearing the chat.
- Non-stream full-response path sanity.

Verification: **495/495** unit tests, `npm run lint` 7/7, retry E2E mock server 9/9, `npm run compile` clean.

## Lesson Recorded

A streaming **repair** event must never mutate call **identity** — identity comes from `output_item.added`, arguments from `*.delta`/`*.done`. When forwarding fields from a done event, forward only the fields the repair needs; `firstString(call_id, item_id)`-style fallbacks across semantically different identifiers are how `fc_` item ids leaked into call identity.
