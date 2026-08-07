# Issue #103 — gpt-5.6-luna Responses API `invalid_prompt` (HTTP 400)

**Date:** 2026-08-04
**Status:** 🔴 Active
**Severity:** High
**GitHub:** [#103](https://github.com/ltmoerdani/opencode-copilot-chat/issues/103)
**Related:** #41 (`docs/issues/41-20260803-gpt56-luna-routing-fix.md`)

## Problem

Requests to `gpt-5.6-luna` via the Responses API fail once a session grows past a certain size:

```
OpenCode Go API request failed (400) model=gpt-5.6-luna payloadBytes=1528273:
Error from provider (Console Go): Upstream request failed:
[invalid_prompt] Invalid Responses API request
```

The payload in the failing request was around 1.5 MB (1,528,273 bytes). Short sessions still work. The model only breaks once the conversation accumulates enough history, tool outputs, or attached content.

## Investigation

### What was checked

- Routing is correct. `gpt-5.6-luna` routes to the Responses API in `src/routing.ts` (lines 27–33), endpoint `https://opencode.ai/zen/go/v1/responses`.
- The model is registered with limits in `src/metadata.ts`: `{ contextWindow: 1050000, maxOutputTokens: 128000 }`, and listed in the Go provider's `fallbackModels`.
- Issue #41 is not this bug. That fix addressed response parsing (tool-call `finish_reason: null`), not request validation. The two live in different layers.

### Root cause

Checked against the official OpenAI Responses API reference (`https://developers.openai.com/api/reference/resources/responses`). Three gaps in `buildResponsesRequestBody()` (`src/extension.ts` lines 2826–2849).

**1. `truncation` is never sent, so it defaults to `disabled`.**

The OpenAI docs spell this out:

> `truncation: "disabled"` (default): If the input size will exceed the context window size for a model, the request will fail with a 400 error.
> `truncation: "auto"`: truncate by dropping items from the beginning.

The body builder does not set the field. Every long conversation inherits the default and hits a hard 400.

**2. `max_output_tokens` is not capped against the remaining context window.**

```ts
max_output_tokens: limits.maxOutputTokens,  // 128000 for gpt-5.6-luna
```

Do the arithmetic. Context window is 1,050,000 tokens. Static `max_output_tokens` is 128,000. So the request fails the moment the prompt exceeds `1,050,000 − 128,000 = 922,000` tokens.

The 1.5 MB payload is roughly 375K tokens on a 4-char-per-token estimate. That estimate breaks down fast once tool definitions, reasoning history, and image content are in the mix. Once `prompt + 128K > 1.05M`, the 400 is guaranteed.

**3. `text.verbosity` is sent on every Responses call.**

```ts
text: { verbosity: modelId === "gpt-5-codex" ? "medium" : "low" },
```

`text.verbosity` is a native OpenAI Responses API field. The OpenCode Go gateway is a proxy in front of other providers, and there is no guarantee it understands or forwards this field. A provider that rejects unknown fields will return `invalid_prompt`.

### Why short sessions still work

Small payload, so `prompt + 128K < 1.05M`. The gateway also appears to tolerate `verbosity` on small requests. As the payload grows, one of the three conditions above trips. The bug only shows up under load.

## Proposed fix

Ranked by impact, largest first.

### 1. Send `truncation: "auto"` on the Responses body

**File:** `src/extension.ts`, inside `buildResponsesRequestBody()`.

```ts
return {
  model: modelId,
  input,
  max_output_tokens: limits.maxOutputTokens,
  ...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
  stream: true,
  truncation: "auto", // ← add
  ...thinkingPayload,
  ...(tools.length ? { tools, tool_choice: toolChoice(options.toolMode) } : {}),
  text: { verbosity: modelId === "gpt-5-codex" ? "medium" : "low" },
};
```

OpenAI explicitly recommends `"auto"` for stateless multi-turn usage. This alone fixes most long-session failures without user intervention.

### 2. Cap `max_output_tokens` against the remaining window

**File:** `src/extension.ts`, inside `buildResponsesRequestBody()`.

```ts
// Rough estimate: 4 chars ≈ 1 token
const inputByteLength = JSON.stringify(input).length;
const estimatedInputTokens = Math.ceil(inputByteLength / 4);
const safeMaxOutput = Math.max(
  1024, // floor
  Math.min(limits.maxOutputTokens, limits.contextWindow - estimatedInputTokens - 1024),
);
```

This handles the edge case where `prompt + max_output_tokens` would overshoot the window. A rough estimate is fine here because fix #1 already provides a safety net.

### 3. (Optional) Stop sending `text.verbosity`

**File:** `src/extension.ts`, inside `buildResponsesRequestBody()`.

Drop the `text` field from the body entirely. The field is non-essential, and the risk of a provider rejecting it outweighs the marginal verbosity control. Lower priority than #1 and #2.

## Verification plan

1. `npm run compile` clean.
2. Launch the Extension Development Host (F5).
3. Run `gpt-5.6-luna` against three scenarios:
   - Short session, 1–3 turns. Confirm no regression.
   - Long session, 10+ turns with code output and MCP tool results. Confirm no 400.
   - Image input. Confirm vision still works. Caveat: with `truncation: "auto"`, the earliest image will be dropped first on overflow.
4. Inspect the Output Channel. The `[request]` log should show payload size and a 200 response.

## Risk assessment

| Fix                     | Risk                                                                                        | Mitigation                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `truncation: "auto"`    | Drops early conversation turns, possibly including the system message, when overflow occurs | Surface a user-facing warning when truncation triggers. Dropping context is still better than a hard 400. |
| Cap `max_output_tokens` | Output may come back shorter than expected                                                  | Floor of 1024 tokens. Users can still override via thinking config if they need more.                     |
| Remove `text.verbosity` | Output becomes slightly more verbose by default                                             | Negligible.                                                                                               |

## Scope note

This bug is not specific to `gpt-5.6-luna`. Any GPT model routed to the Responses API will hit the same wall. `gpt-5.6-luna` is just the one where it shows up first, because it is the model most often used in long agent sessions with many tool calls.

The fix should apply to every model that routes to the Responses transport. No per-model hardcoding.

## References

- OpenAI Responses API reference: `https://developers.openai.com/api/reference/resources/responses` (see `truncation` field)
- Issue #41: `docs/issues/41-20260803-gpt56-luna-routing-fix.md`
- Source: `src/extension.ts` lines 2826–2849 (`buildResponsesRequestBody`)
- Source: `src/routing.ts` lines 27–33 (Responses routing for `gpt-*`)
- Source: `src/metadata.ts` line 177 (`gpt-5.6-luna` limits)
