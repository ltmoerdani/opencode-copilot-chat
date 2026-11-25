**Status:** ✅ Solved
**Related issue:** [#283](https://github.com/ltmoerdani/opencode-copilot-chat/issues/283)
**Introduced by:** `ec92a44` (2026-07-20, PR #79 / issue #34)

# Gemini tool results used an invalid `functionResponse` shape

**Topic:** provider / request / google / tool-calling
**Updated:** 2026-11-25
**Tags:** #provider #google #tool-calling #regression

---

## Problem

`gemini-4-argon` on OpenCode Go returned HTTP 400 for every request after the
first tool call:

```text
Unknown name "content" at 'contents[2].parts[0].function_response': Cannot find field.
```

The same error repeated for every tool result in the conversation, so the model
could never continue an agentic session.

## Root cause

`src/request/google.ts` built tool results as
`functionResponse: { name, content }`. The official Gemini
`generateContent` reference defines `FunctionResponse` as `name` plus a
**required `response` object**; there is no top-level `content` field. Older
Gemini models tolerated the unknown field, but the strict validator on
`gemini-4-argon` rejects it.

Git history confirms a regression. Before `ec92a44` the builder emitted the
valid shape:

```diff
- functionResponse: { name, response: { name, content } }
+ functionResponse: googleFunctionResponseContent(message.content, name)
```

The helper introduced by that commit moved `content` to the top level while
adding multimodal `parts`. `b8f6b45` later moved the helper into
`src/request/google.ts` without changing the shape.

## Fix

`googleFunctionResponseContent()` now returns:

- `{ name, response: { content: text } }` for text-only tool results;
- `{ name, response: { content: text }, parts: [...] }` when the tool result
  carries an image — `parts` stays at `functionResponse` level, as documented;
- `{ name, response: { content: JSON.stringify("") } }` for null content.

No top-level `content` is emitted in any branch. The RULES comment above the
helper now states the wire contract explicitly.

## Verification

- `src/test/google-function-response.test.ts` — three cases: text-only shape,
  multimodal `parts` with a valid `response`, and null content. Each asserts
  that `content` is absent at `functionResponse` level.
- `npm run lint` (compile + unit tests + all strict checks) passes.
