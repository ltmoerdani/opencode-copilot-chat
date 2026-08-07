**Status:** ✅ Implemented

# Model Validation Suite & Runtime Retry for HTTP 400 Errors

**Topic:** models / validation / retry / reliability
**Updated:** 2026-06-15
**Tags:** #models #validation #retry #http400 #models-dev #reliability
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#24](https://github.com/ltmoerdani/opencode-copilot-chat/issues/24) (Zen HTTP 400 errors)
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#25](https://github.com/ltmoerdani/opencode-copilot-chat/issues/25) (Kimi K2.7 constraints)
**GitHub PR:** [#46](https://github.com/ltmoerdani/opencode-copilot-chat/pull/46) (Kimi K2.7 fix)

---

## Overview

Two complementary mechanisms to prevent and recover from HTTP 400 errors caused by parameter mismatches between the extension and upstream model APIs:

1. **Runtime retry** (`src/retry.ts`) — when the upstream rejects a parameter, the extension patches the request body and retries once automatically
2. **Validation script** (`scripts/validate-models.mts`) — pre-release testing that catches parameter mismatches before users encounter them

Additionally, the models.dev cache TTL was reduced from 6 hours to 1 hour to detect provider API changes faster.

---

## Problem

The upstream OpenCode API serves 30+ models from different providers (Moonshot, DeepSeek, ZhipuAI, Alibaba, etc.). Each provider has its own API contract for parameters like `thinking`, `temperature`, and `reasoning_effort`. These contracts change over time, but the extension's metadata cache (models.dev) only refreshes every 6 hours.

**Issue #25:** Kimi K2.7-code introduced breaking changes — `thinking.type: "disabled"` and non-default `temperature` are now rejected with HTTP 400. The extension's hardcoded defaults sent both rejected values.

**Issue #24:** After the K2.7 fix, similar 400 errors appeared for `kimi-k2.5` (`enable_thinking` rejected) and `minimax-m2.7` (`reasoning_effort` format mismatch). These were caused by stale models.dev cache — the upstream API changed parameters between cache refreshes.

**Root cause:** Every new model with API constraints requires a code change + release. This doesn't scale.

---

## Solution

### 1. Runtime Retry (`src/retry.ts`)

When the upstream returns HTTP 400, the extension now:

1. Parses the error message to identify the problematic parameter
2. Removes or adjusts it in the request body
3. Retries the request once

**Handled error patterns:**

| Error Message Pattern                                    | Action                           |
| -------------------------------------------------------- | -------------------------------- |
| `invalid thinking: only type=enabled`                    | Force `thinking.type: "enabled"` |
| `invalid thinking: only type=disabled`                   | Remove `thinking` field          |
| `invalid thinking` (generic)                             | Remove `thinking` field          |
| `invalid temperature`                                    | Remove `temperature` field       |
| `Extra inputs are not permitted, field: enable_thinking` | Remove `enable_thinking`         |
| `reasoning_effort` rejected                              | Remove `reasoning_effort`        |
| `Extra inputs are not permitted, field: '<field>'`       | Remove the specified field       |

**Key constraints:**

- At most **1 retry** per request (no infinite loops)
- Only HTTP 400 is retried (not 401, 429, 5xx)
- Each retry is logged to the Output panel for debugging
- Auth errors (401/403) and rate limits (429) are never retried

### 2. Validation Script (`scripts/validate-models.mts`)

A standalone Node.js script that tests all models against the OpenCode API before release.

**Features:**

- Fetches live model list from `models.dev` (no hardcoded model list)
- Tests each model's parameter acceptance (temperature, thinking, reasoning_effort)
- Detects recoverable 400 errors and verifies retry patch works
- Generates markdown or JSON report

**Usage:**

```bash
# Test all Go + Zen free models
npx tsx scripts/validate-models.mts --api-key YOUR_KEY

# Test only specific families
npx tsx scripts/validate-models.mts --api-key YOUR_KEY --families deepseek,kimi

# Test specific models
npx tsx scripts/validate-models.mts --api-key YOUR_KEY --models kimi-k2.7-code,minimax-m2.7

# Include paid Zen models
npx tsx scripts/validate-models.mts --api-key YOUR_KEY --zen-paid

# Dry run (no requests)
npx tsx scripts/validate-models.mts --dry-run
```

**Flags:**

| Flag            | Default             | Description                                                       |
| --------------- | ------------------- | ----------------------------------------------------------------- |
| `--api-key`     | `$OPENCODE_API_KEY` | API key for OpenCode                                              |
| `--go`          | `true`              | Include OpenCode Go models                                        |
| `--zen-free`    | `true`              | Include Zen free models                                           |
| `--zen-paid`    | `false`             | Include Zen paid models                                           |
| `--families`    | all                 | Filter by family (gpt,claude,deepseek,kimi,glm,minimax,qwen,mimo) |
| `--models`      | all                 | Specific model IDs (comma-separated)                              |
| `--skip-models` | none                | Exclude model IDs (comma-separated)                               |
| `--dry-run`     | `false`             | Print models without sending requests                             |
| `--json`        | `false`             | Output as JSON                                                    |
| `--timeout`     | `30000`             | Request timeout in ms                                             |

**npm scripts:**

```bash
npm run validate-models        # Run validation
npm run validate-models -- --zen-paid  # Include paid models
```

### 3. Cache TTL Reduction (`src/metadata.ts`)

```typescript
// Before:
export const MODEL_METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// After:
export const MODEL_METADATA_CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour
```

This means the extension re-fetches model metadata from models.dev every hour instead of every 6 hours. When a provider changes their API contract, the extension detects it faster.

---

## Architecture

```
                    ┌─────────────────────┐
                    │   models.dev/api.json │
                    └──────────┬──────────┘
                               │ (every 1h)
                    ┌──────────▼──────────┐
                    │   metadata.ts cache  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼───────┐ ┌─────▼──────┐ ┌──────▼──────┐
     │ thinking.ts    │ │ metadata   │ │ extension.ts │
     │ (payload build)│ │ (limits)   │ │ (request)    │
     └────────┬───────┘ └─────┬──────┘ └──────┬──────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   streaming.ts       │
                    │   + retry.ts         │◄── HTTP 400 → patch & retry
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  OpenCode API        │
                    └─────────────────────┘
```

---

## Files Changed

| File                          | Change                                                                    |
| ----------------------------- | ------------------------------------------------------------------------- |
| `src/retry.ts`                | **New** — `analyzeHttp400ForRetry()` function with error pattern matching |
| `src/streaming.ts`            | Modified — integrated retry logic around fetch call                       |
| `src/metadata.ts`             | Modified — cache TTL reduced from 6h to 1h                                |
| `src/test/retry.test.ts`      | **New** — 8 unit tests for retry logic                                    |
| `scripts/validate-models.mts` | **New** — standalone validation script                                    |
| `package.json`                | Modified — added `validate-models` and `prepackage` scripts               |
| `tsconfig.json`               | Modified — excluded `scripts/` from compilation                           |

---

## Test Coverage

**Unit tests (`npm test`):** 40 tests passing

- `src/test/retry.test.ts` — 8 tests for `analyzeHttp400ForRetry()` (pure function)
- `src/test/thinking.test.ts` — 24 tests for thinking payloads (pure functions)
- `src/test/metadata.test.ts` — 8 tests for metadata resolution (pure functions)

**E2E tests (`npm run test-retry`):** 7 tests passing ✅ PROVEN

- Mock server simulates OpenCode API behavior
- Tests full flow: HTTP 400 → `analyzeHttp400ForRetry()` → patch body → retry → HTTP 200
- Covers: thinking.type rejection, invalid temperature, reasoning_effort, generic extra fields

**Live API validation (`npm run validate-models`):** 89/89 tests passing ✅ PROVEN

- Reuses extension's exact logic (`buildThinkingPayload`, `resolveModelRouting`, `buildOpenCodeGatewayAuthHeaders`)
- Tests ALL thinking/reasoning parameter combinations for each model
- 18 models (13 Go + 5 Zen free) validated against live OpenCode API

**Key findings from live validation:**

- DeepSeek `reasoning_effort` low/medium/high/max — **all work** ✅
- Kimi K2.7 `thinking=disabled` — handled by gateway (returns 200, not 400)
- MiniMax M2.7 `thinking` enabled/disabled — works ✅
- Qwen `enable_thinking` true/false/budget — all work ✅

---

## Why No Retry Logs in Output Panel?

The retry mechanism only triggers when the upstream API returns HTTP 400. If all models are working correctly (as validated), no 400 errors occur and no retry logs appear. This is expected behavior — the retry is a safety net for edge cases when providers change their API contracts.

---

## Status of Referenced Issues

**Issue #25 (Kimi K2.7):** Already fixed by PR #45 (ltmoerdani). Our retry mechanism is a **redundant safety net** — the thinking.ts special case already handles K2.7 correctly. The retry would only trigger if the hardcoded special case somehow fails.

**Issue #24 (Zen HTTP 400):** **Not fully resolved.** The root cause is stale models.dev cache (now 1h TTL instead of 6h). The retry mechanism is a **runtime safety net** that patches the request body when the cache is stale. It doesn't prevent the error — it recovers from it after the first attempt fails. The user will see a brief delay on the first request after a provider API change.

---

## Why Not Just Reduce Cache TTL?

Reducing the cache TTL (6h → 1h) helps detect API changes faster, but it doesn't solve the problem:

- A provider can change their API between cache refreshes
- The user would still see HTTP 400 errors until the next refresh
- There's no guarantee models.dev updates immediately

The runtime retry mechanism handles errors **at the moment they occur**, regardless of cache freshness. The reduced TTL is a complementary improvement that reduces the window of vulnerability.

---

## Future Improvements

1. **CI integration** — run `validate-models` in GitHub Actions before release
2. **Auto-detect new models** — when models.dev adds a model, test it automatically
3. **Expand error patterns** — add more recoverable error patterns as they're discovered
4. **Model constraints registry** — auto-generate `docs/model-constraints.md` from validation results
