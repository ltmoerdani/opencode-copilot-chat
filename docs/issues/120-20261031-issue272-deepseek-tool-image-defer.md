**Status:** ✅ Solved

# Issue #272 — DeepSeek Rejects Image-Bearing Tool Messages

**Topic:** provider / serialization / vision / chat-completions
**Updated:** 2026-11-01
**Tags:** #deepseek #tool-calling #vision #serialization
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#272](https://github.com/ltmoerdani/opencode-copilot-chat/issues/272)
**Related:** [Issue #233 — GLM tool-image defer](103-20260923-issue233-glm-tool-image-defer.md)

---

## Problem

When DeepSeek history contained a tool result with an image, OpenCode Go
returned HTTP 400:

```text
tool message content must be a string on the gRPC path
```

The failure repeated because the same image-bearing history was sent on every
retry and subsequent turn.

## Root Cause

`convertMessage()` correctly serializes tool-result images as OpenAI
`image_url` parts, but the OpenCode Go DeepSeek path accepts those parts only in
user messages. It rejects an array-valued `content` on `role: "tool"`.

The existing GLM-5.3 workaround already provided the required safe shape:
flatten the tool message to a string and append the image parts in a follow-up
user message.

## Fix

`requiresStringToolContent()` now maps the DeepSeek family (`deepseek-*`) to
`"defer"`. MiMo's drop behavior and the default multimodal behavior for other
families are unchanged.

## Regression Coverage

- DeepSeek v4.1 Flash and v4 Pro defer tool images.
- Case-insensitive DeepSeek IDs are accepted.
- Non-family IDs such as `deepseekfoo` are not matched.
- GLM-5.3 continues to defer images.
- MiMo continues to drop tool images.
- Kimi, GLM-5.2, and MiniMax continue to forward multimodal tool content.
- Text-only tool results remain plain strings.

Verification completed with `npm run compile`, `npm test` (569/569), the
serialization E2E simulation (20/20), `npm run lint`, and `git diff --check`.
The lint run was green before the live host generated the untracked
`.vscode-test/` cache. A later rerun was blocked by that cache's binary files,
not by source or documentation changes; no source files were changed by the
live request.

## Live Extension Development Host Verification

Verified on 2026-11-01 in the already-running VS Code Extension Development
Host for the separate `~/Startup/novaliners` project, using local OpenCode Go
with `OpenCode Go / Deepseek V4 Pro`:

- The request reached OpenCode Go and reported `Provider: OpenCode Go Model:
deepseek-v4-pro`.
- The browser tool opened `https://example.com` and returned `Captured browser
screenshot`; the UI showed an attached image.
- The request completed in 21 seconds with `Finish reason: stop` and no
  `tool message content must be a string` or HTTP 400 error.
- The model response explicitly noted that this DeepSeek model does not
  support vision and used the browser accessibility snapshot for its textual
  description, confirming the image was not sent as unsupported model input.
