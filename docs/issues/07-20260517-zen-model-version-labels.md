**Status:** ✅ Solved

# Zen Model Version Labels — Naming, Packaging, and Changelog Classification

**Topic:** models / vscode / picker / packaging / changelog  
**Updated:** 2026-05-17  
**Tags:** #models #vscode #provider #zen #packaging #changelog  
**Supersedes:** -

---

## Overview

This document records the complete 2026-05-17 session that fixed incorrect OpenCode Zen model labels in the VS Code and Copilot Chat model pickers.

The visible bug was that upstream model IDs with version-like numeric suffixes were rendered with spaces instead of decimal dots. For example, `claude-opus-4-6` appeared as `OpenCode Zen / Claude Opus 4 6` instead of `OpenCode Zen / Claude Opus 4.6`.

The session also covered a packaging/cache discovery: the source fix compiled correctly, but the installed VSIX still contained the old build, so VS Code continued showing stale labels until the `0.1.4` VSIX was rebuilt with the corrected code. Finally, the `0.1.4` changelog was updated so `reasoningEffort` is listed under `Added`, not `Fixed`.

This document is intentionally backdated to **2026-05-17 Asia/Jakarta**, the original implementation and release-line session date for `0.1.4`.

---

## Problem

OpenCode Zen model names in the model picker were not preserving version decimals for IDs encoded with hyphen-separated numeric parts.

Examples observed in the picker:

| Raw model ID        | Incorrect label     | Expected label      |
| ------------------- | ------------------- | ------------------- |
| `claude-haiku-4-5`  | `Claude Haiku 4 5`  | `Claude Haiku 4.5`  |
| `claude-opus-4-1`   | `Claude Opus 4 1`   | `Claude Opus 4.1`   |
| `claude-opus-4-5`   | `Claude Opus 4 5`   | `Claude Opus 4.5`   |
| `claude-opus-4-6`   | `Claude Opus 4 6`   | `Claude Opus 4.6`   |
| `claude-sonnet-4-5` | `Claude Sonnet 4 5` | `Claude Sonnet 4.5` |
| `claude-sonnet-4-6` | `Claude Sonnet 4 6` | `Claude Sonnet 4.6` |

Models whose upstream IDs already contained dots, such as `gemini-3.1-pro`, `glm-5.1`, or `qwen3.5-plus`, were less affected because their decimal dot was already inside a single ID segment.

---

## Root Cause

The model picker name was generated in `provideLanguageModelChatInformation()` with:

```ts
name: `${this.definition.modelNamePrefix} / ${formatModelName(modelId)}`;
```

The old `formatModelName()` implementation split every model ID on `-`, title-cased each segment, and joined all segments with spaces:

```ts
modelId.split("-").map(...).join(" ")
```

That behavior was acceptable for names like:

| Raw model ID     | Display          |
| ---------------- | ---------------- |
| `big-pickle`     | `Big Pickle`     |
| `gpt-5-codex`    | `Gpt 5 Codex`    |
| `gemini-3-flash` | `Gemini 3 Flash` |

But it was wrong for version suffixes encoded as adjacent numeric segments:

```text
claude-opus-4-6
             ^ ^
             adjacent numeric segments should be a decimal version
```

Because the formatter did not distinguish word separators from version separators, it rendered `4-6` as `4 6` instead of `4.6`.

---

## Timeline

### 1. 2026-05-17 — User Reported Incorrect Zen Labels

**Input:** The user shared screenshots showing OpenCode Zen rows such as:

```text
OpenCode Zen / Claude Haiku 4 5
OpenCode Zen / Claude Opus 4 1
OpenCode Zen / Claude Opus 4 5
OpenCode Zen / Claude Opus 4 6
OpenCode Zen / Claude Sonnet 4 5
OpenCode Zen / Claude Sonnet 4 6
```

**Initial hypothesis:** The bug was likely in display-name normalization rather than model discovery, because tooltips still showed raw model IDs like `claude-opus-4-6`.

**Code search used:**

```bash
rg -n "OpenCode Zen|opencode zen|zen|model|models|naming|displayName|display_name|label" .
rg -n "formatModelName|model name|format.*Name" .
```

**Finding:** `src/extension.ts` contained the only relevant formatter:

```ts
function formatModelName(modelId: string): string;
```

---

### 2. 2026-05-17 — Formatter Fix Implemented

**Fix:** Update `formatModelName()` to collect adjacent numeric ID segments and join them with `.` before title-casing the final display parts.

Behavior after the fix:

| Raw model ID        | Correct label       |
| ------------------- | ------------------- |
| `claude-haiku-4-5`  | `Claude Haiku 4.5`  |
| `claude-opus-4-1`   | `Claude Opus 4.1`   |
| `claude-opus-4-5`   | `Claude Opus 4.5`   |
| `claude-opus-4-6`   | `Claude Opus 4.6`   |
| `claude-sonnet-4-6` | `Claude Sonnet 4.6` |
| `gemini-3-flash`    | `Gemini 3 Flash`    |
| `gemini-3.1-pro`    | `Gemini 3.1 Pro`    |
| `glm-5.1`           | `Glm 5.1`           |
| `gpt-5-codex`       | `Gpt 5 Codex`       |
| `qwen3.5-plus`      | `Qwen3.5 Plus`      |
| `ring-2.6-1t-free`  | `Ring 2.6 1t Free`  |

**Metadata refresh:** `MODEL_METADATA_REVISION` was bumped to force VS Code to drop stale picker metadata and re-query model information.

**Verification:**

```bash
npm run compile
```

The TypeScript compile passed.

---

### 3. 2026-05-17 — User Still Saw Old Labels

**Problem after source fix:** The user still saw:

```text
OpenCode Zen / Claude Opus 4 6
OpenCode Zen / Claude Sonnet 4 5
```

in both:

- Copilot Chat model picker
- VS Code Language Models table

**Investigation:** The compiled local `out/extension.js` already contained the new metadata revision and formatter, but the installed VSIX did not.

Commands used to inspect artifacts:

```bash
unzip -p opencode-copilot-chat-0.1.4.vsix extension/out/extension.js | rg -n "MODEL_METADATA_REVISION|formatModelName|thinking-2026|naming-2026"
unzip -p opencode-copilot-chat-dev.vsix extension/out/extension.js | rg -n "MODEL_METADATA_REVISION|formatModelName|thinking-2026|naming-2026"
```

**Finding:** Existing VSIX files still contained:

```ts
const MODEL_METADATA_REVISION = "thinking-2026-05-17-e";
```

instead of the new naming revision.

**Root Cause:** VS Code was running an installed extension package built before the source fix. Source and `out/` were correct, but the distributable VSIX was stale.

---

### 4. 2026-05-17 — Temporary `0.1.5` Packaging Was Created for Local Validation

To validate that packaging would solve the stale-label issue, a temporary patch build was created:

```bash
npm version patch --no-git-tag-version
npm run package
```

This produced:

```text
opencode-copilot-chat-0.1.5.vsix
```

The package contents were verified:

```bash
unzip -p opencode-copilot-chat-0.1.5.vsix extension/out/extension.js | rg -n "naming-2026|versionParts|formatModelName"
```

The `0.1.5` VSIX contained:

- `MODEL_METADATA_REVISION = "naming-2026-05-17-a"`
- `versionParts.join(".")`
- the updated `formatModelName()` implementation

Because the `code` and `cursor` CLIs were not available in the shell, the package was manually unpacked into the local VS Code extension folder for validation:

```text
~/.vscode/extensions/ltmoerdani.opencode-copilot-chat-0.1.5
```

**Important:** This was only a local validation step. The user later clarified that the project should stay focused on the `0.1.4` release line.

---

### 5. 2026-05-17 — Release Focus Returned to `0.1.4`

**User request:** Update all changelog data and latest information under `0.1.4` because the release focus was `0.1.4`.

**Actions taken:**

| File                               | Change                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `package.json`                     | Reverted temporary `0.1.5` version back to `0.1.4` during the historical session     |
| `package-lock.json`                | Reverted root package version metadata back to `0.1.4` during the historical session |
| `CHANGELOG.md`                     | Moved the Zen numeric label fix into the `0.1.4` section                             |
| `opencode-copilot-chat-0.1.4.vsix` | Rebuilt with the naming fix and new metadata revision                                |

**Artifact verification:**

```bash
unzip -p opencode-copilot-chat-0.1.4.vsix extension/package.json | rg -n '"version"'
unzip -p opencode-copilot-chat-0.1.4.vsix extension/out/extension.js | rg -n "naming-2026|versionParts|formatModelName"
```

Expected result:

- package version: `0.1.4`
- metadata revision: `naming-2026-05-17-a`
- formatter contains `versionParts.join(".")`

---

### 6. 2026-05-17 — `reasoningEffort` Changelog Classification Corrected

**User request:** `reasoningEffort` / Thinking Effort should be documented as `Added`, not `Fixed`.

**Reasoning:** `reasoningEffort` exposes Thinking controls and request configuration behavior. It is feature work, not a bug fix.

**Changelog adjustment:**

Moved this concept to `0.1.4` `### Added`:

```text
Added `reasoningEffort` support for Thinking controls and request logging for selected model configuration and final Thinking payload.
```

Kept `0.1.4` `### Fixed` focused on bug fixes:

- Numeric model version labels
- Model metadata refresh
- Tool schema sanitizer
- Qwen endpoint/stream compatibility
- Deprecated/unavailable model filtering
- Stale fallback cleanup
- Provider display name in errors

---

## Final Solution

The final solution for `0.1.4` was:

1. Preserve adjacent numeric model ID segments as decimal versions in `formatModelName()`.
2. Bump model metadata revision so VS Code refreshes stale picker metadata.
3. Rebuild the `0.1.4` VSIX after the source fix so installed users receive the corrected formatter.
4. Keep release documentation focused on `0.1.4`.
5. Document `reasoningEffort` under `Added`.

---

## Files Changed

| File                               | Role                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `src/extension.ts`                 | `formatModelName()` numeric-version preservation and model metadata revision bump |
| `CHANGELOG.md`                     | `0.1.4` release notes for label fix and `reasoningEffort` classification          |
| `package.json`                     | Historical temporary version bump was reverted during `0.1.4` consolidation       |
| `package-lock.json`                | Historical temporary version metadata was reverted during `0.1.4` consolidation   |
| `opencode-copilot-chat-0.1.4.vsix` | Historical rebuilt local package containing the `0.1.4` naming fix                |

---

## Verification

### Compile

```bash
npm run compile
```

**Result:** Passed during the session.

### Formatter Sanity Check

The formatter was manually checked against affected and unaffected IDs:

| Input               | Output              |
| ------------------- | ------------------- |
| `claude-haiku-4-5`  | `Claude Haiku 4.5`  |
| `claude-opus-4-1`   | `Claude Opus 4.1`   |
| `claude-opus-4-5`   | `Claude Opus 4.5`   |
| `claude-sonnet-4-6` | `Claude Sonnet 4.6` |
| `gemini-3-flash`    | `Gemini 3 Flash`    |
| `gemini-3.1-pro`    | `Gemini 3.1 Pro`    |
| `glm-5.1`           | `Glm 5.1`           |
| `gpt-5-codex`       | `Gpt 5 Codex`       |
| `qwen3.5-plus`      | `Qwen3.5 Plus`      |
| `ring-2.6-1t-free`  | `Ring 2.6 1t Free`  |

### Package Contents

The rebuilt `0.1.4` VSIX was inspected directly:

```bash
unzip -p opencode-copilot-chat-0.1.4.vsix extension/out/extension.js | rg -n "naming-2026|versionParts|formatModelName"
```

Expected package contents:

- `MODEL_METADATA_REVISION = "naming-2026-05-17-a"`
- `versionParts.join(".")`
- updated `formatModelName()`

---

## Regression Notes

The fix intentionally only joins adjacent all-numeric hyphen segments.

This avoids changing normal model-name structure:

| Pattern            | Behavior                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `gpt-5-codex`      | Keeps `5` as a standalone generation number                       |
| `gemini-3-flash`   | Keeps `3` as a standalone generation number                       |
| `ring-2.6-1t-free` | Does not attempt to rewrite mixed alphanumeric suffixes like `1t` |
| `claude-opus-4-6`  | Converts adjacent numeric suffix to `4.6`                         |

---

## Lessons Learned

| #   | Lesson                                                    | Detail                                                                                          |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Source fix is not enough for VS Code extension validation | The installed VSIX must contain the new compiled JavaScript                                     |
| 2   | Inspect packaged artifacts directly                       | `unzip -p ... extension/out/extension.js` quickly proved whether VS Code was running stale code |
| 3   | Metadata revision matters                                 | VS Code can keep model picker metadata cached unless model identity/version fields change       |
| 4   | Temporary package versions need release-line cleanup      | The local `0.1.5` validation build had to be folded back into the intended `0.1.4` release      |
| 5   | Changelog categories should reflect user impact           | `reasoningEffort` is a new capability, so it belongs under `Added`                              |

---

## Security Notes

- No API keys, tokens, or credentials are included in this document.
- Screenshot contents were summarized only by visible model labels and safe raw model IDs.
- Commands and package paths contain no secrets.

---

_Backdated issue document: 2026-05-17._
