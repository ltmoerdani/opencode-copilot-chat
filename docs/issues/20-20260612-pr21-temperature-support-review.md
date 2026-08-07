**Status:** ✅ Solved

# PR #21 Review — Respect Model Temperature Support from models.dev

**Topic:** models / metadata / provider
**Updated:** 2026-06-12
**Tags:** #models #metadata #temperature #provider #fix
**Supersedes:** —

---

## Overview

Full review and community feedback for contributor PR #21 by Wallacy Freitas. The extension was unconditionally sending the `temperature` parameter in all request payloads, causing HTTP 400 errors on models that have deprecated it (e.g., `claude-opus-4-8`, GPT-5 family). The fix reads the `temperature: boolean` field from `models.dev` metadata and omits the parameter when the model declares it unsupported.

---

## Problem

Several models have deprecated the `temperature` parameter. When the extension sends it, the API returns HTTP 400:

```text
Sorry, your request failed. Please try again.
Reason: OpenCode Zen API request failed (400) model=claude-opus-4-8
{"message":"temperature is deprecated for this model."}
```

**Related Issue:** [ltmoerdani/opencode-copilot-chat#20](https://github.com/ltmoerdani/opencode-copilot-chat/issues/20)

---

## Root Cause

The extension was unconditionally sending `temperature` in all request payloads (`buildChatCompletionsRequestBody`, `buildAnthropicMessagesRequestBody`, `buildResponsesRequestBody`), regardless of whether the model supports it. The `models.dev` registry already declares which models support temperature via the `temperature: boolean` field, but the extension was not reading or respecting this field.

---

## Solution

### `src/metadata.ts` — Read and propagate temperature support

- Added `temperature?: boolean` field to `ModelMetadataFields`, `ResolvedModelMetadata`, and `ModelsDevModelRecord` interfaces
- Parse the `temperature` field from `models.dev` API responses
- Propagate the field through the metadata resolution pipeline (live → cached → fallback)

### `src/extension.ts` — Conditionally send temperature

- Modified all 3 request body builders to accept `ResolvedModelMetadata` parameter
- Only include `temperature` in the request payload when `metadata.temperature !== false`
- When `temperature` is `false`, the parameter is omitted entirely from the request

### Pattern Used

```typescript
// Only send temperature if the model supports it (not deprecated)
...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
```

This is backward-compatible: if `metadata.temperature` is `undefined` (unknown model, no metadata), the spread includes `temperature` as before.

---

## Changes

| #   | Change                                                        | Files              | Impact                                                                 |
| --- | ------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| P0  | Added `temperature` field to 3 interfaces                     | `src/metadata.ts`  | `ModelMetadataFields`, `ResolvedModelMetadata`, `ModelsDevModelRecord` |
| P1  | Parse `temperature` from models.dev API                       | `src/metadata.ts`  | `normalizeModelsDevProvider()` reads `model.temperature`               |
| P2  | Propagate through resolution pipeline                         | `src/metadata.ts`  | `resolveModelMetadata()` + `normalizeModelMetadataFields()`            |
| P3  | `buildChatCompletionsRequestBody` — conditional temperature   | `src/extension.ts` | Omits `temperature` when `metadata.temperature === false`              |
| P4  | `buildAnthropicMessagesRequestBody` — conditional temperature | `src/extension.ts` | Same pattern for Anthropic endpoint                                    |
| P5  | `buildResponsesRequestBody` — conditional temperature         | `src/extension.ts` | Same pattern for Responses endpoint                                    |
| P6  | Portuguese comment → English                                  | `src/extension.ts` | Minor cleanup in `buildThinkingPayload()`                              |
| P7  | CHANGELOG entry                                               | `CHANGELOG.md`     | Documents the fix under `[Unreleased]`                                 |

---

## Affected Models (OpenCode Zen)

Models with `temperature: false` in models.dev:

- **Claude:** `claude-fable-5`, `claude-opus-4-7`, `claude-opus-4-8`
- **GPT-5 family:** `gpt-5`, `gpt-5-codex`, `gpt-5-nano`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.4`, and more

---

## Review Findings

| Category               | Finding                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| ✅ Bug fix valid       | Resolves issue #20 — HTTP 400 on models that deprecated `temperature`               |
| ✅ Backward-compatible | `undefined` (no metadata) still sends `temperature` as before                       |
| ✅ Consistent pattern  | Follows the same approach as `reasoning`/`reasoningOptions` already in the codebase |
| ✅ Uniform update      | All 3 request builders updated with same pattern                                    |
| ✅ Clean code          | Spread pattern is idiomatic and readable                                            |
| ✅ CI                  | GitGuardian Security Checks — **PASSED**                                            |
| ✅ CHANGELOG           | Updated with clear description                                                      |
| ✅ Low risk            | Only affects models with `temperature: false` in metadata                           |

**Verdict:** ✅ Approved to merge — no revisions needed.

---

## Verification

```bash
# List all PRs
gh pr list --repo ltmoerdani/opencode-copilot-chat --state all --json number,title,state,headRefName,baseRefName

# Full diff review
gh pr diff 21 --repo ltmoerdani/opencode-copilot-chat

# CI status checks
gh pr checks 21 --repo ltmoerdani/opencode-copilot-chat
# Result: All checks were successful (GitGuardian Security Checks ✓)
```

---

## Community Feedback

Review comment posted — [PR #21 comment](https://github.com/ltmoerdani/opencode-copilot-chat/pull/21#issuecomment-4692922424).

Content:

> ## Review Summary ✅
>
> Code looks clean and ready to merge. Quick notes:
>
> - **Bug fix valid** — resolves #20 (HTTP 400 on models that deprecated `temperature`)
> - **Backward-compatible** — `undefined` (no metadata) still sends `temperature` as before
> - **Consistent pattern** — follows the same approach as `reasoning`/`reasoningOptions` already in the codebase
> - **All 3 request builders** (`chat-completions`, `anthropic`, `responses`) updated uniformly
> - **CI passed** — GitGuardian Security Checks ✅
> - **CHANGELOG** updated
>
> No revisions needed. Approved to merge 👍

---

## Post-Merge: Version Bump to 0.2.7

After PR #21 was merged (by maintainer), the following changes were made locally:

### Changes

| #   | Change                                         | Files          | Impact                    |
| --- | ---------------------------------------------- | -------------- | ------------------------- |
| V1  | Rename `[Unreleased]` → `[0.2.7] — 2026-06-12` | `CHANGELOG.md` | Version stamp for release |
| V2  | Version bump `0.2.6` → `0.2.7`                 | `package.json` | Extension version updated |

### `CHANGELOG.md` — Section Header

```markdown
## [0.2.7] — 2026-06-12

### Fixed

- **Kimi thinking format correction.** ...
- **Respect model `temperature` support from models.dev.** ...
```

### `package.json`

```json
"version": "0.2.7",
```

---

## Files Changed

- `src/metadata.ts` — Interface additions + parsing logic
- `src/extension.ts` — Conditional temperature in 3 request builders + comment cleanup
- `CHANGELOG.md` — Version header `[0.2.7] — 2026-06-12` + fix entries
- `package.json` — Version `0.2.6` → `0.2.7`

---

## Lessons Learned

1. **Model capability flags must be respected** — when `models.dev` declares `temperature: false`, the extension must not send the parameter. Future model deprecations should follow the same pattern.
2. **Spread pattern for conditional fields** — `...(condition ? { field } : {})` is clean and avoids `if/else` branching for request body construction.
3. **Contributor PR reviews should check CI** — `gh pr checks` is a quick way to verify CI passes before approving.
4. **Version bump after merge** — When contributor PRs include CHANGELOG entries under `[Unreleased]`, maintainer needs to stamp the version header and bump `package.json` after merge.

---

## Result

✅ PR #21 reviewed, approved, and comment posted on GitHub. PR merged by maintainer. Version bumped to 0.2.7 with CHANGELOG entry.
