**Status:** ✅ Solved

# PR #13 Review, Merge, and v0.2.2 Release

**Topic:** streaming / models / provider  
**Updated:** 2026-06-08  
**Tags:** #streaming #models #minimax #thinking #community-pr  
**Supersedes:** —

---

## Overview

Full review and merge cycle for community contributor PR #13 by [Wallacy](https://github.com/Wallacy), which adds configurable stripping of `অসমীয়া...অসমীয়া` inline think tags from model output. Covers code review, local testing, merge via GitHub, version bump to 0.2.2, VSIX packaging, and local installation.

---

## Problem

MiniMax M3 (and family) inline their reasoning content inside `অসমীয়া...অসমীয়া` tags in the regular `content` field of streaming deltas, rather than using a dedicated `reasoning_content` field. This caused the raw tag text to leak into the VS Code Copilot Chat history as visible garbage text.

Related issue: [#12 — Minimax M3 `<think />` blocks are displayed in the response](https://github.com/ltmoerdani/opencode-copilot-chat/issues/12)

---

## Root Cause

The OpenCode Go/Zen proxy passes through model output as-is. MiniMax's API choice to embed reasoning in `content` rather than a separate field meant the extension's streaming extractors (`OpenAiResponseExtractor`, `AnthropicResponseExtractor`) treated the entire content — including `অসমীয়া` tags — as regular text output.

---

## Solution

PR #13 adds a configurable think-tag stripping pipeline:

| Component                                            | Detail                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `processThinkTagsStream()`                           | Streaming handler in both extractors with partial-tag buffering (`thinkOpenBuffer`) across SSE chunks |
| `stripThinkTags()`                                   | Synchronous non-streaming fallback that removes tags and discards inner content                       |
| `shouldStripThinkTags()` / `resolveStripThinkTags()` | Config resolution: `"auto"` (only known models), `"always"` (all models), `"never"` (disabled)        |
| `KNOWN_INLINE_THINK_MODELS`                          | Conservative regex list — currently only `/^minimax-/i`                                               |
| `flushReasoningFallback()` update                    | Flushes unclosed `অসমীয়া` buffer at stream end                                                       |
| `opencodego.stripThinkTags` setting                  | New VS Code configuration with `"auto"` default                                                       |

---

## Changes

| #   | Change                                                 | Files              | Impact                                                                                  |
| --- | ------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------- |
| P0  | `processThinkTagsStream()` for OpenAI extractor        | `src/streaming.ts` | Strips `অসমীয়া` tags with partial-tag buffering across SSE chunks                      |
| P1  | `processThinkTagsStream()` for Anthropic extractor     | `src/streaming.ts` | Same logic for Anthropic SSE event types (`content_block_start`, `content_block_delta`) |
| P2  | `stripThinkTags()` non-streaming helper                | `src/streaming.ts` | Strips tags from non-streaming response bodies                                          |
| P3  | `KNOWN_INLINE_THINK_MODELS` + `shouldStripThinkTags()` | `src/streaming.ts` | Config-gated model detection                                                            |
| P4  | `stripThinkTags` in `ApiSettings`                      | `src/extension.ts` | Reads config, passes to all 4 streaming callers                                         |
| P5  | `opencodego.stripThinkTags` setting                    | `package.json`     | `"never"` / `"auto"` / `"always"` with `"auto"` default                                 |
| P6  | CHANGELOG entry                                        | `CHANGELOG.md`     | Unreleased section (later versioned to 0.2.2)                                           |

**Lines changed:** +293 / −22 across 4 files.

---

## Design Decisions

1. **Only MiniMax in known-models list** — No model is added without confirmation that it inlines `অসমীয়া` in the content field. Other models can be added to `KNOWN_INLINE_THINK_MODELS` as reported.

2. **Config-gated** — `opencodego.stripThinkTags` defaults to `"auto"` (apply only to known models). Set to `"always"` to strip for every model, or `"never"` to disable.

3. **No type pollution** — Everything uses `LanguageModelResponsePart[]` internally. No changes to `vscode.proposed.chatProvider.d.ts`.

4. **Partial-tag safe** — `processThinkTagsStream` maintains a `thinkOpenBuffer` so `অসমীয়া` tags that split across SSE chunks are correctly handled.

5. **`processThinkTagsStream()` duplicated** across both extractor classes — Could be extracted to a shared utility, but not a blocker.

---

## Session Timeline

### 1. (2026-06-08) PR Review

**Action:** Fetched PR #13 details from GitHub, analyzed code changes, checked CI status.

**Findings:**

- CI: ✅ GitGuardian — no secrets detected
- Compilation: ✅ TypeScript strict, 0 errors
- Author: Wallacy (external contributor)
- Branch: `fix/minimax-think` → `main`
- Closes: Issue #12

### 2. (2026-06-08) Local Testing

**Action:** Checked out PR branch locally, compiled, reviewed diff per-file.

```bash
git fetch origin pull/13/head:pr-13-fix-minimax-think
git checkout pr-13-fix-minimax-think
npm install
npm run compile    # 0 errors
```

**Verified:**

- All 4 files reviewed (`streaming.ts`, `extension.ts`, `package.json`, `CHANGELOG.md`)
- Streaming and non-streaming code paths both covered
- Partial-tag buffering handles edge cases

### 3. (2026-06-08) Manual Merge Attempt (Rolled Back)

**Action:** Initially merged locally with `git merge --no-ff`, then realized this would not credit the contributor via GitHub's PR merge.

**Problem:** Local merge would not show as a merged PR on GitHub — Wallacy wouldn't get proper contributor credit.

**Resolution:** `git reset --hard origin/main` to undo, then merged via GitHub UI instead.

### 4. (2026-06-08) Merge via GitHub + Version Bump

**Action:** Approved and merged PR #13 via GitHub UI, pulled result, bumped version to 0.2.2.

```bash
git pull origin main    # Fast-forward to merged PR
# Updated package.json: 0.2.1 → 0.2.2
# Updated CHANGELOG.md: Unreleased → [0.2.2] — 2026-06-08
npm run compile         # 0 errors
git commit -m "chore: bump version to 0.2.2"
```

### 5. (2026-06-08) CHANGELOG Ordering Fix

**Problem:** CHANGELOG sections were ordered `0.2.1 → 0.2.0 → 0.2.2 → 0.1.10` instead of `0.2.2 → 0.2.1 → 0.2.0 → 0.1.10`.

**Resolution:** Used Python to reorder sections (em-dash UTF-8 chars prevented standard text replacement). Amend + force push.

```bash
python3 -c "..." # Reordered CHANGELOG sections
git add CHANGELOG.md && git commit --amend --no-edit
git push --force origin main
```

### 6. (2026-06-08) VSIX Build + Local Install

```bash
vsce package --no-dependencies    # opencode-copilot-chat-0.2.2.vsix (108.76 KB)
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.2.2.vsix --force
# ✅ Successfully installed
```

---

## Files Changed

- `src/streaming.ts` — `processThinkTagsStream()`, `stripThinkTags()`, `KNOWN_INLINE_THINK_MODELS`, `shouldStripThinkTags()`, `resolveStripThinkTags()`, updated extractors and `flushReasoningFallback()`
- `src/extension.ts` — `stripThinkTags` in `ApiSettings`, reads config, passes to streaming callers
- `package.json` — New `opencodego.stripThinkTags` setting
- `CHANGELOG.md` — `[0.2.2] — 2026-06-08` entry

---

## Verification

```bash
npm run compile                              # 0 errors
vsce package --no-dependencies               # 108.76 KB VSIX
code --install-extension *.vsix --force      # Successfully installed
```

---

## Lessons Learned

1. **Always merge community PRs via GitHub** — Not locally — to preserve contributor credit and PR linkage.
2. **CHANGELOG ordering** — When merging PRs that add to "Unreleased", the new version section must be moved above all previous versions, not just appended.
3. **UTF-8 em-dash in file editing** — Standard string replace tools may fail on `—` (em-dash) characters; Python file I/O handles them correctly.

---

_Reviewed and merged on 2026-06-08. Released as v0.2.2._
