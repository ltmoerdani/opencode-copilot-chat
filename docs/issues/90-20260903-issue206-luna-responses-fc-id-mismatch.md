# Issue #206 — GPT 5.6 Luna "Expected an ID that begins with 'fc'" → Normalize Responses function_call Item IDs

**Status:** ✅ Solved (branch `fix/issues-204-214-batch`, commit `40be420`)
**Topic:** responses-api / tool-calls / request-builder
**Updated:** 2026-09-03
**Tags:** #responses-api #tools #luna #gpt #400
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#206](https://github.com/ltmoerdani/opencode-copilot-chat/issues/206)
**Related:** issue docs [41](41-20260803-gpt56-luna-routing-fix.md), [47](47-20260803-gpt56-luna-responses-api-invalid-prompt.md), [80](80-20260823-issue184-incomplete-toolcall-guard.md), [87](87-20260828-issue199-400-body-double-read.md) — the long gpt-5.6-luna saga

---

## Problem

Follow-up requests to `gpt-5.6-luna` (after any tool call in the conversation) fail with HTTP 400:

```text
Invalid 'input[1].id': 'call_UcTCsvlGS7Gj4uZevJwaSF1y'.
Expected an ID that begins with 'fc'.
```

## Root Cause

A Responses `function_call` input item carries **two distinct identifiers**:

- `id` — the item id, which the API requires to start with `fc_`
- `call_id` — the tool-invocation id (`call_*`) that must pair with `function_call_output.call_id`

`responsesInputItemsFromMessage()` (`src/responsesRequest.ts`) set **both** to the same value — the id from the upstream stream (chat-completions-style `call_*`), which travels verbatim through VS Code's `LanguageModelToolCallPart` (`src/transports/extractors.ts`) with no rewriting in between. Echoing `call_*` back as the item `id` violates the Responses grammar, so the gateway rejects the whole request.

## Fix

New pure helper in `src/responsesRequest.ts`:

```ts
export function responsesFunctionCallItemId(originalId: string): string {
  return originalId.startsWith("fc_") ? originalId : `fc_${randomUUID().replace(/-/g, "")}`;
}
```

The `function_call` item id is regenerated as a synthetic `fc_` id; `call_id` keeps the original value so the pairing with `function_call_output.call_id` stays intact. Ids already in the `fc_` namespace pass through unchanged.

## Files Changed

| File                                | Change                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `src/responsesRequest.ts`           | `responsesFunctionCallItemId()` + wiring in `responsesInputItemsFromMessage()` |
| `src/test/responsesRequest.test.ts` | `call_*` → `fc_` rewrite test + `fc_*` pass-through test                       |

## Verification

- `npx tsc --noEmit` clean; 449/449 tests pass; staged-lint gate pass.
- Manual: multi-turn tool-calling session on `gpt-5.6-luna` no longer 400s on turn 2+.

## Lessons Learned

1. The Responses API item grammar is stricter than chat-completions: identifier fields are namespaced (`fc_`, `msg_`, `rs_`) and validated on replay.
2. Any converter that round-trips ids through a third party (VS Code tool-call parts) must assume the id namespace changes and normalize on the way back in.

---

Detected 2026-09-03 | Reported by @mk311 (👍3)
