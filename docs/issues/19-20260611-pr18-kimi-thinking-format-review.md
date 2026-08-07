**Status:** ✅ Solved

# PR #18 Review — Fix Kimi Thinking Format and Update Documentation

**Topic:** models / thinking / provider  
**Updated:** 2026-06-11  
**Tags:** #models #thinking #kimi #community-pr #bugfix  
**Supersedes:** —

---

## Overview

Full review and community feedback for contributor PR #18 by [Wallacy](https://github.com/Wallacy), which fixes the Kimi (MoonshotAI) thinking payload format. The extension was sending `enable_thinking: true | false` but the OpenCode Go gateway rejects this field with HTTP 400: "Extra inputs are not permitted". The correct format is `thinking: { type: "enabled" | "disabled" }` — matching the GLM family format.

**PR:** [ltmoerdani/opencode-copilot-chat#18](https://github.com/ltmoerdani/opencode-copilot-chat/pull/18)  
**Branch:** `fix/kimi-thinking-format` → `main`  
**Author:** Wallacy Freitas  
**Files changed:** 3 (+14 / −5)

---

## Problem

The `opencodego.thinking.kimi` setting was documented and implemented to send `enable_thinking: true | false` in the request payload. However, the OpenCode Go gateway **rejects** this field with:

```text
HTTP 400: "Extra inputs are not permitted"
```

The correct format for MoonshotAI (Kimi) models on the chat-completions endpoint is:

```json
{ "thinking": { "type": "enabled" | "disabled" } }
```

This is the same format used by GLM models.

### Root Cause

The `[0.2.4]` CHANGELOG entry incorrectly documented that Kimi models should use `enable_thinking`. The extension code in `src/extension.ts` was returning `{ enable_thinking: thinking.kimi === "on" }` for Kimi models.

---

## Changes

### `src/extension.ts` — Thinking payload correction (+7 / −4)

| #   | Change                       | Detail                                                                                                                                             |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | **Kimi payload fix**         | `buildThinkingPayload()` now returns `thinking: { type: "enabled" \| "disabled" }` instead of `enable_thinking: true \| false`                     |
| P1  | GLM comment clarification    | Added comment explaining the gateway's `transform.ts variants()` returns `{}` for GLM — gateway doesn't validate/transform GLM thinking parameters |
| P2  | MiniMax inline documentation | Clarified that `thinking.type = "adaptive"` is the correct format for M3 (not `"enabled"`)                                                         |

### `package.json` — Description fix (+1 / −1)

| #   | Change                     | Detail                                                                                                                                |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P3  | Setting description update | `opencodego.thinking.kimi` description updated from `enable_thinking: true \| false` to `thinking: { type: 'enabled' \| 'disabled' }` |

### `CHANGELOG.md` — Documentation correction (+6 / −0)

| #   | Change                     | Detail                                                                                                                                                                                           |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P4  | New `[Unreleased]` section | Corrects the `[0.2.4]` changelog entry that incorrectly stated Kimi uses `enable_thinking`. Notes that the extension code was always using `thinking: { type }`; this entry corrects the record. |

---

## Diff Analysis

### Before (main)

```ts
if (/^kimi-/i.test(modelId)) {
  // MoonshotAI/Kimi API uses enable_thinking (boolean) on the OpenAI-compatible
  // chat-completions endpoint. This is more universally supported than the
  // Anthropic-style thinking: { type: "enabled"|"disabled" } object.
  return { enable_thinking: thinking.kimi === "on" };
}
```

### After (PR #18)

```ts
if (/^kimi-/i.test(modelId)) {
  // Testes confirmam que o gateway aceita thinking: { type } para Kimi
  // (HTTP 200). enable_thinking causa 400 ("Extra inputs not permitted").
  return { thinking: { type: thinking.kimi === "on" ? "enabled" : "disabled" } };
}
```

---

## Review Findings

| Category             | Finding                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| ✅ **Correct**       | `enable_thinking` → `thinking: { type }` matches gateway expectations                                 |
| ✅ **Consistent**    | Now uses same format as GLM family — better maintainability                                           |
| ✅ **Well-tested**   | 70 API calls: 67 × HTTP 200, 3 × expected HTTP 400                                                    |
| ✅ **Documentation** | `package.json` description and `CHANGELOG.md` updated in sync                                         |
| ✅ **Low risk**      | Only affects `kimi-*` model family conditional branch                                                 |
| ⚠️ **Minor nit**     | New comment in Portuguese: "Testes confirmam que o gateway aceita..." — rest of codebase uses English |
| ✅ **CI**            | GitGuardian Security Checks — SUCCESS                                                                 |
| ✅ **Mergeable**     | Yes                                                                                                   |

### Risk Assessment: 🟢 LOW

| Signal             | Assessment                         |
| ------------------ | ---------------------------------- |
| Symbols changed    | <3 (1 conditional branch)          |
| Affected processes | 1 (Kimi thinking payload)          |
| Breaking changes   | None — fixes existing bug          |
| Blast radius       | Small — only `kimi-*` model family |

---

## Verification

```bash
# Fetch PR metadata
gh pr view 18 --repo ltmoerdani/opencode-copilot-chat --json title,body,state,author,headRefName,baseRefName,additions,deletions,changedFiles,files,commits,reviewDecision,mergeable,statusCheckRollup,labels

# Fetch full diff
gh pr diff 18 --repo ltmoerdani/opencode-copilot-chat

# Cross-reference with current main code
# Confirmed main still has: return { enable_thinking: thinking.kimi === "on" };
```

---

## Community Feedback Posted

Review comment posted to PR #18 on 2026-06-11: [comment link](https://github.com/ltmoerdani/opencode-copilot-chat/pull/18#issuecomment-4679210157)

**Verdict:** 👍 Approved to merge. Minor nit about Portuguese comment is non-blocking — suggested follow-up or leave as-is.

---

## Lessons Learned

1. **Gateway payload formats vary** — the OpenCode Go gateway validates request fields strictly. `enable_thinking` is rejected as an "extra input" for Kimi even though it's the MoonshotAI-native format. The gateway normalizes everything through its own `transform.ts`.
2. **CHANGELOG accuracy matters** — the `[0.2.4]` entry incorrectly documented the format, which could mislead future contributors. PR #18's `[Unreleased]` correction is the right approach.
3. **Cross-family format consistency** — aligning Kimi with GLM's `thinking: { type }` format reduces mental overhead for maintainers.
4. **Comment language consistency** — contributor PRs should ideally match the project's primary language (English). This is a minor nit that can be addressed in follow-up.

---

## Files Changed

| File               | Changes                                                |
| ------------------ | ------------------------------------------------------ |
| `src/extension.ts` | Kimi thinking payload fix + GLM comment + MiniMax docs |
| `package.json`     | Kimi setting description update                        |
| `CHANGELOG.md`     | `[Unreleased]` section correcting `[0.2.4]` entry      |

---

**Reviewed:** 2026-06-11 | Comment posted: 2026-06-11 | Status: Awaiting merge
