**Status:** ✅ Solved

# Context Window Usage Indicator and PR #6 Integration

**Topic:** usage / context-window / streaming / provider / release  
**Updated:** 2026-05-27  
**Tags:** #usage #context-window #streaming #provider #vscode #byok #release #pr-review  
**Supersedes:** —

---

## Overview

This document records the full 2026-05-27 Asia/Jakarta session for making the VS Code Copilot Chat **Context Window** indicator work with OpenCode BYOK models.

The original user request was to make the extension compatible with the Context Window UI shown in Copilot Chat so users could see how many context tokens were used. The first implementation improved VS Code's provider token-count callback, but user testing showed the footer still stayed at `0%`. A second investigation found that Copilot's Context Window widget also expects provider usage metadata to be reported through a `LanguageModelDataPart` with MIME type `usage`.

The final solution combined:

1. More complete local token counting for prompt estimation.
2. Streamed usage capture from provider responses.
3. Native VS Code usage reporting via `LanguageModelDataPart(..., "usage")`.
4. Compatibility with PR #6's broader usage telemetry, diagnostics, status bar, Qwen routing, and experimental context hook work.
5. A clean `develop` → `main` merge for the `0.1.7` release.

This document is intentionally backdated to the original implementation and merge session date, **2026-05-27**, although it was later written during documentation cleanup on 2026-06-13.

---

## Problem

The Context Window popup in VS Code Copilot Chat showed the correct model context size, for example:

```text
0 / 1M tokens
0%
Reserved for response
```

but it did not move during long conversations when OpenCode Go or Zen models were selected.

Users reported:

- Qwen 3.6 via OpenCode Go subscription had long chat sessions but the Context Window UI stayed at `0%`.
- PR #6 introduced a compatibility layer but had mixed results: some models worked, others did not.

The key requirement was not only to advertise a model context window, but to make the active Copilot Chat footer receive usage updates in the form it understands.

---

## Root Cause

There were two separate mechanisms involved:

| Mechanism                            | Purpose                                                                         | Initial State            |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------ |
| `maxInputTokens` / `maxOutputTokens` | Lets VS Code display the model's total context capacity                         | Already present          |
| `provideTokenCount()`                | Lets VS Code estimate tokens for prompt content                                 | Present, but too shallow |
| Streamed `usage` DataPart            | Lets Copilot Chat update the Context Window usage widget from provider metadata | Missing                  |

The first fix focused on `provideTokenCount()` and made the estimator more complete, but that alone did not update the footer. Investigation of another VS Code extension that did update the Context Window showed the missing piece:

```ts
progress.report(new vscode.LanguageModelDataPart(bytes, "usage"));
```

Copilot Chat was not relying only on the provider token-count callback. It also consumed normalized provider usage metadata emitted during or after the response stream.

PR #6 added OpenCode-specific usage telemetry and an experimental context hook, but its initial usage DataPart MIME was custom:

```ts
application / vnd.opencode.usage + json;
```

That MIME is useful for OpenCode internal diagnostics, but it is not the native Copilot Context Window usage channel. The final integration therefore emits both:

| MIME                                  | Consumer                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| `usage`                               | VS Code / Copilot Chat Context Window                          |
| `application/vnd.opencode.usage+json` | OpenCode-specific diagnostics and future internal integrations |

---

## Session Timeline

### 1. 2026-05-27 — Initial Context Window Compatibility Request

**Problem:** The user asked for the extension to show context usage in the VS Code Context Window popup, matching the Copilot Chat UI.

**Investigation:**

```bash
rg -n "context|token|statusBar|webview|chat|compact|model|provider" -S .
sed -n '295,620p' src/extension.ts
sed -n '620,980p' src/extension.ts
sed -n '20570,20730p' node_modules/@types/vscode/index.d.ts
```

**Finding:** The extension already registered `maxInputTokens` and `maxOutputTokens` through `LanguageModelChatInformation`, so VS Code could display total context size. The `provideTokenCount()` implementation only counted a flattened text string and ignored richer chat message parts.

**Action:** Implemented improved local token counting for:

- Message role/name overhead
- Tool calls
- Tool results
- Structured JSON/object parts
- Data parts
- Image parts

**Status:** ✅ Implemented, but later testing showed this was necessary but not sufficient.

---

### 2. 2026-05-27 — User Retest Showed Context Window Still at 0%

**Problem:** User tested the build and reported the Context Window still showed:

```text
0 / 1M tokens
0%
```

**Investigation:**

Searched installed extensions and found a working implementation in another provider extension:

```bash
rg -n "Context Window|usage|LanguageModelDataPart|provideTokenCount" "$HOME/.vscode/extensions" -S
```

The relevant implementation explicitly said:

```text
Report accumulated token usage as a LanguageModelDataPart so VS Code
can display usage stats in the Context Window widget.
```

**Root Cause:** Copilot Chat needed streamed provider usage metadata reported through a `LanguageModelDataPart` with MIME `usage`.

**Action:** Added streamed usage capture and reporting:

- Request `stream_options: { include_usage: true }` for OpenAI-compatible chat completions.
- Capture usage from OpenAI-compatible response payloads.
- Capture usage from Responses API normalized events.
- Capture usage from Google/Gemini `usageMetadata`.
- Capture usage from Anthropic-style `usage` payloads.
- Report usage with `new vscode.LanguageModelDataPart(data, "usage")`.

**Status:** ✅ Implemented.

---

### 3. 2026-05-27 — v0.1.7 Local Build and Install

**Action:** Bumped local package metadata to `0.1.7`, compiled, tested, packaged, and installed the extension locally.

**Commands:**

```bash
npm test
npm run package
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension /Users/ltmoerdani/Startup/opencode-copilot-chat/opencode-copilot-chat-0.1.7.vsix \
  --force
```

**Verification:**

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --list-extensions --show-versions | rg -i 'opencode|ltmoerdani'

rg -n "COPILOT_USAGE_DATA_MIME|application/vnd.opencode.usage|stream_options|include_usage|estimateChatMessageTokenCount" \
  "$HOME/.vscode/extensions/ltmoerdani.opencode-copilot-chat-0.1.7/out"
```

**Result:** ✅ The installed `0.1.7` VSIX contained the native usage MIME, `include_usage`, and improved token counting.

---

### 4. 2026-05-27 — User Random Sampling Confirmed the Fix

**Result from user testing:** Most sampled models worked. The user had not tested every model, but random sampling showed the Context Window indicator now moved.

**Important limitation:** The implementation can only report real usage when upstream/provider responses include token usage metadata. Models or endpoint paths that do not return usage may still show incomplete usage until the provider supplies it or a fallback estimator is accepted by VS Code.

**Status:** ✅ Fix direction confirmed.

---

### 5. 2026-05-27 — PR #6 Conflict and Compatibility Review

**Context:** PR #6, `feature/opencode-byod-debug-followup`, was merged into `main` and added:

- Transport diagnostics history
- Usage status bar
- OpenCode custom usage DataPart
- Experimental context-indicator hook
- Qwen `/messages` routing and auth/body fixes
- `streaming.ts`, `usage.ts`, `chatParts.ts`, `openCodeAuth.ts`

**Conflict check:**

```bash
git fetch origin --prune
git merge-tree "$(git merge-base develop origin/main)" develop origin/main
```

**Initial conflict files:**

- `CHANGELOG.md`
- `src/extension.ts`

**Key difference between the standalone fix and PR #6:**

| Area                          | Standalone context fix                  | PR #6 initial behavior                      | Final integration           |
| ----------------------------- | --------------------------------------- | ------------------------------------------- | --------------------------- |
| Native Copilot Context Window | Emits MIME `usage`                      | Custom MIME only                            | Emits MIME `usage`          |
| OpenCode internal telemetry   | Not separate                            | Emits `application/vnd.opencode.usage+json` | Keeps custom MIME           |
| Chat-completions usage        | Requests `stream_options.include_usage` | Not present initially                       | Restored                    |
| Token count estimator         | Counts tools/data/images                | Flattened text only                         | Restored improved estimator |
| Context hook                  | Not needed                              | Experimental optional hook                  | Kept as optional supplement |

**Status:** ✅ Strategy chosen: keep PR #6 improvements but preserve native `usage` path as source of truth for the Copilot Context Window.

---

### 6. 2026-05-27 — Merge `main` into `develop` and Resolve Conflicts

**Action:** Merged `origin/main` into `develop` after PR #6 landed, then resolved conflicts by taking the PR #6 modular structure and porting the validated context fix into it.

**Commands:**

```bash
git checkout develop
git fetch origin --prune
git merge --no-ff origin/main
```

**Resolution decisions:**

| File                                 | Resolution                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `CHANGELOG.md`                       | Kept `0.1.7` release heading and merged PR #6 notes plus native Context Window fix notes |
| `src/extension.ts`                   | Kept PR #6 modular structure and restored improved `provideTokenCount()`                 |
| `src/chatParts.ts`                   | Emit both `usage` and `application/vnd.opencode.usage+json` DataParts                    |
| `src/streaming.ts`                   | Report all usage DataParts after stream summary                                          |
| `package.json` / `package-lock.json` | Keep version `0.1.7`                                                                     |

**Important implementation details:**

```ts
export const OPENCODE_USAGE_DATA_MIME = "application/vnd.opencode.usage+json";
export const COPILOT_USAGE_DATA_MIME = "usage";
```

```ts
stream_options: {
  include_usage: true;
}
```

```ts
return typeof text === "string" ? estimateTokenCount(text) : estimateChatMessageTokenCount(text);
```

**Verification:**

```bash
npm test
npm run package
```

**Result:** ✅ `develop` integrated PR #6 and preserved native Context Window behavior.

---

### 7. 2026-05-27 — Simulate and Merge `develop` Back to `main`

**Action:** Simulated the merge to make sure `develop` could go back to `main` without conflict:

```bash
tmpdir=$(mktemp -d /tmp/opencode-main-merge.XXXXXX)
git worktree add --detach "$tmpdir" origin/main
cd "$tmpdir"
git merge --no-commit --no-ff develop
```

**Result:**

```text
MERGE_STATUS=0
UNMERGED:
```

Then merged and pushed:

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff develop -m "Merge develop for 0.1.7 context usage release"
npm test
git push origin main
```

**Final relevant commits:**

| Commit    | Branch    | Purpose                                           |
| --------- | --------- | ------------------------------------------------- |
| `5a36933` | `develop` | Merge `main` and preserve context usage reporting |
| `ca8bbb6` | `main`    | Merge `develop` for `0.1.7` context usage release |

**Status:** ✅ `main` and `develop` were synchronized for `0.1.7`.

---

### 8. 2026-05-27 — GitHub Issue Reply and Triage Plan

**Issue discussion context:**

Users reported that the Context Window indicator did not move for long sessions, including Qwen 3.6 on OpenCode Go. Wallacy noted PR #6 had mixed results across models.

**Recommended public reply:**

```text
Thanks for the report. We’ve added a follow-up fix for the next release (`0.1.7`) that builds on #6.

The extension now reports normalized usage to VS Code through the native Context Window usage channel, requests streamed usage where supported, and improves token estimation for messages, tools, structured data, and images. Random sampling shows the indicator now works for most tested models.

Some models may still depend on whether the upstream provider returns usage metadata, so please retest after `0.1.7` and let us know which model still stays at 0%.
```

**Issue management decision:**

Keep the issue open until `0.1.7` is released and users retest. If general support works but a specific model still stays at `0%`, close the broad feature request and ask for a new model-specific issue with:

- Model ID
- Provider (`OpenCode Go` or `OpenCode Zen`)
- VS Code version
- Copilot Chat version if available
- OpenCode output logs with secrets removed

**Status:** ✅ Triage plan prepared.

---

## Files Changed

| File                                | Change                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/chatParts.ts`                  | Added usage DataPart helpers and dual MIME reporting (`usage` + OpenCode custom MIME)                                 |
| `src/streaming.ts`                  | Centralized SSE/non-stream response handling, usage capture, usage DataPart emission, transport summaries             |
| `src/extension.ts`                  | Restored improved `provideTokenCount()`, added `stream_options.include_usage`, integrated status bar/diagnostics flow |
| `src/usage.ts`                      | Added normalized usage snapshot helpers, status bar text, cache ratio, provider payload conversion                    |
| `src/contextWindowHook.ts`          | Added optional experimental internal context-window bridge from PR #6                                                 |
| `src/contextWindowHookBridge.ts`    | Added request-id bridge for experimental context hook                                                                 |
| `src/openCodeAuth.ts`               | Added OpenCode gateway auth header builder for messages/google/bearer routes                                          |
| `src/routing.ts`                    | Added Qwen `/messages` routing changes from PR #6                                                                     |
| `src/metadata.ts`                   | Refreshed fallback metadata from PR #6                                                                                |
| `test/openCodeAuth.test.js`         | Added auth-header tests                                                                                               |
| `test/usage.test.js`                | Added usage helper tests                                                                                              |
| `test/routing.test.js`              | Updated routing tests                                                                                                 |
| `CHANGELOG.md`                      | Added `0.1.7` release notes combining PR #6 and context-window fix                                                    |
| `README.md`                         | Documented usage status bar, context integration, diagnostics, and routing updates                                    |
| `package.json`, `package-lock.json` | Version `0.1.7` and new settings                                                                                      |

---

## Verification

### Compile and Tests

```bash
npm test
```

Expected result from the final integration:

```text
tests 12
pass 12
fail 0
```

### Package

```bash
npm run package
```

Expected VSIX:

```text
opencode-copilot-chat-0.1.7.vsix
```

### Local Install

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension /Users/ltmoerdani/Startup/opencode-copilot-chat/opencode-copilot-chat-0.1.7.vsix \
  --force
```

### Installed Build Check

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --list-extensions --show-versions | rg -i 'opencode|ltmoerdani'
```

Expected:

```text
ltmoerdani.opencode-copilot-chat@0.1.7
```

### Source/Compiled Fix Check

```bash
rg -n "COPILOT_USAGE_DATA_MIME|application/vnd.opencode.usage|stream_options|include_usage|estimateChatMessageTokenCount" src out
```

Expected:

- `COPILOT_USAGE_DATA_MIME = "usage"`
- `OPENCODE_USAGE_DATA_MIME = "application/vnd.opencode.usage+json"`
- `stream_options: { include_usage: true }`
- `estimateChatMessageTokenCount()`

---

## Final Solution

The final `0.1.7` solution uses a layered design:

1. **Advertised context window:** `maxInputTokens` and `maxOutputTokens` still expose the model's capacity to VS Code.
2. **Local estimate:** `provideTokenCount()` now counts richer request content, including tools, tool results, data parts, structured JSON, and image attachments.
3. **Provider usage:** response streams capture normalized usage from the upstream provider when available.
4. **Native Copilot Context Window channel:** usage is emitted as a `LanguageModelDataPart` with MIME `usage`.
5. **OpenCode diagnostics channel:** the same normalized usage payload is emitted with the OpenCode custom MIME for internal diagnostics.
6. **Optional experimental hook:** PR #6's context-window bridge remains available as a supplement where VS Code internals allow it.

This design makes the native VS Code path the primary compatibility layer and keeps OpenCode-specific diagnostics as an additive feature.

---

## Known Limitations

The Context Window indicator can still fail to move for a specific model if:

- The upstream endpoint does not return usage metadata.
- The provider omits usage for streamed responses.
- VS Code/Copilot changes the internal interpretation of usage DataParts.
- A model is routed through a transport that reports usage in a new shape not yet normalized.

When this happens, file a model-specific issue rather than reopening the broad feature request.

---

## Lessons Learned

1. **`provideTokenCount()` is not enough** — it improves estimates, but Copilot Chat's footer needs streamed usage metadata.
2. **MIME type matters** — `usage` is the native VS Code/Copilot channel; custom MIME types are useful for extension-owned diagnostics only.
3. **Keep experimental hooks optional** — VS Code internals can change, so the stable path should be public API behavior whenever possible.
4. **PR integration should preserve proven compatibility fixes** — PR #6 was valuable, but needed the validated native usage channel added back during merge.
5. **Issue triage should separate broad support from model-specific gaps** — once the generic Context Window path ships, remaining failures should be tracked by model/transport.

---

_This document covers the full context-window usage session from 2026-05-27._
