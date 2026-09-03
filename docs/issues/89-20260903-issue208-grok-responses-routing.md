# Issue #208 — grok-4.6 "not supported for format oa-compat" → Route Grok to the Responses API

**Status:** ✅ Solved (branch `fix/issues-204-214-batch`, commit `1db6031`)
**Topic:** models / registry / routing / responses
**Updated:** 2026-09-03
**Tags:** #models #registry #grok #responses-api #routing
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#208](https://github.com/ltmoerdani/opencode-copilot-chat/issues/208)
**Related:** feature doc [17 — data-driven model registry](../features/17-20260814-data-driven-model-registry.md), issue doc [12](12-20260604-qwen-oa-compat.md)

---

## Problem

Every request to `grok-4.6` (OpenCode Go) fails with:

```text
OpenCode Go API request failed (401) model=grok-4.6 payloadBytes=46429:
Model grok-4.6 is not supported for format oa-compat
```

The 401 is a red herring — the gateway reuses it for "wrong endpoint/format", not an API-key problem.

## Root Cause

The OpenCode gateway serves **all** grok models exclusively via `/v1/responses` (`@ai-sdk/openai`, per the Zen endpoint table — verified against `opencode.ai/docs/zen` on 2026-09-03). `MODEL_REGISTRY` (`src/core/registry.ts`) had **no grok row at all** (not even `grok-4.5`/`grok-build-0.1`), so the family fell to the catch-all `default` row → `chat-completions` → the gateway's `oa-compat` (OpenAI-compatible `/chat/completions`) endpoint, which rejects the model. "oa-compat" never appears in `src/` — it is the gateway's external name for the OpenAI-compatible endpoint.

## Fix

One new registry row (data-driven registry = one-row fix), placed before the chat-completions family rows:

```ts
{ family: "grok", patterns: [/^grok-/i, /^grok-build-/i], endpointKind: "responses", sdkPackage: "@ai-sdk/openai", thinkingFamily: null },
```

`thinkingFamily: null` keeps the generic fallback payload (no reasoning fields) — safe default until grok reasoning knobs are mapped.

## Files Changed

| File                        | Change                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `src/core/registry.ts`      | New `grok` family row → `responses`                                     |
| `src/test/registry.test.ts` | Routing test for `grok-4.6` / `grok-4.5` / `grok-build-0.1` on Go + Zen |

## Verification

- `npx tsc --noEmit` clean; 449/449 tests pass (incl. 6 new routing assertions); staged-lint gate pass.
- Manual: `grok-4.6` chat request succeeds through `/v1/responses`.

## Lessons Learned

1. New gateway models without a registry row silently degrade to chat-completions — the catch-all is a footgun for responses-only models. Consider surfacing a diagnostic when an unknown family 400s with "not supported for format".
2. Gateway HTTP status codes are unreliable for classification (401 used for format errors) — match on the message, not the status.

---

Detected 2026-09-03 | Reported by @mk311
