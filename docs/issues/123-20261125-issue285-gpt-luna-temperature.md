**Status:** ✅ Solved
**Related issue:** [#285](https://github.com/ltmoerdani/opencode-copilot-chat/issues/285)

# GPT Luna rejects `temperature` despite models.dev claiming support

**Topic:** models / metadata / request / provider
**Updated:** 2026-11-25
**Tags:** #models #metadata #temperature #provider #go

---

## Problem

Selecting `gpt-6-luna` or `gpt-5.6-luna` on OpenCode Go (extension 0.8.1,
VS Code 1.146) failed immediately with:

```text
OpenCode Go API request failed (HTTP 400) for gpt-6-luna:
Unsupported parameter: 'temperature' is not supported with this model.
```

## Root cause

The request builders include `temperature` unless
`metadata.temperature === false` (`src/request/openai.ts:39`,
`src/request/google.ts:42`, `src/request/anthropic.ts:48`). The default is
`0.2` (`src/provider/settings.ts:136`).

`resolveModelMetadata()` trusted live models.dev data first. The `opencode-go`
provider entry for both Luna models reports `temperature: true`, so the
parameter was always sent. `MODELS_WITHOUT_TEMPERATURE` only contained the
Kimi models, and the HTTP 400 retry classifier only recognised
`invalid temperature...` — not the gateway's `Unsupported parameter: ...`
wording, so there was no self-heal either.

This is a data mismatch, not a regression in the request builders: the
temperature guard has existed since PR #21 (0.2.7).

## Fix

- `src/models/modelTables.ts` — add `gpt-6-luna` and `gpt-5.6-luna` to
  `MODELS_WITHOUT_TEMPERATURE`.
- `src/models/metadata.ts` — make that set a **gateway-level override**: it now
  wins over live and cached models.dev values, not just the offline fallback.
- `src/retry.ts` — add a recoverable-400 pattern for
  `Unsupported parameter: 'temperature'`, which strips the field and retries.

## Verification

- `src/test/metadata.test.ts` — fallback metadata for both Luna models reports
  `temperature: false`, and a live `temperature: true` record is overridden.
- `src/test/retry.test.ts` — the gateway wording produces a patch that removes
  `temperature` while preserving the rest of the body.
- `npm run lint` (compile + unit tests + all strict checks) passes.
