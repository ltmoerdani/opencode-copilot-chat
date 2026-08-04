# Issue #45 — DeepSeek 400 "Upstream response was not valid JSON" on large sessions (payload trimmer dead code)

**Date:** 2026-08-04
**Status:** ✅ Resolved
**Related:** GitHub Issue [#104](https://github.com/ltmoerdani/opencode-copilot-chat/issues/104)
**Reporter:** [@aotr](https://github.com/aotr)
**Extension version affected:** 0.4.5
**Fixed in:** 0.4.6 (unreleased)

## Problem

Sending a message in a long session fails with:

```
OpenCode Go API request failed (400) model=deepseek-v4-flash payloadBytes=563749:
Error from provider (Console Go): Upstream request failed: [server_error]
Upstream response was not valid JSON
```

The OpenCode Go gateway rejects request bodies over ~400 KB with a wrapped
4xx/5xx, even when the model's token context window (e.g. 1M tokens on
`deepseek-v4-flash`) is nowhere near full — the limit is raw JSON bytes, not
tokens. Long sessions accumulate history past that ceiling.

### Steps to reproduce

1. Build a long session (~500 KB+ of accumulated context / file attachments).
2. Send a message.

## Root Cause (Evidence-Based)

### Location

The extension ships a byte-aware trimmer, `messageTrimmer.ts`, with:

- `MAX_PAYLOAD_BYTES = 380_000` (hard ceiling)
- `MESSAGE_BYTE_BUDGET = 200_000` per endpoint kind
- `trimApiMessages()` — prunes older conversation turns while preserving the
  system prompt, the most recent turns, and tool-call atomicity.

Its header documents the exact failure mode: *"The OpenCode Go API proxy
returns HTTP 500 when the JSON request body exceeds ~400 KB."*

**However, no code path ever calls `trimApiMessages()`.** A grep across the
extension's `src/` shows it is referenced only inside `messageTrimmer.ts`
itself. The safety net is dead code — it was never wired into the request
path. A 563 KB body therefore goes straight to the gateway and gets rejected.

### Why issue #83 / PR #84 did not fix this

Issue #83 (DeepSeek 400 on a ~754 K-token prompt) was fixed by capping
`maxOutputTokens` in `modelLimits()` so prompt + completion never exceeds the
token context window. That bounds *tokens*, not raw *bytes* — a request can
still exceed the gateway's ~400 KB byte ceiling while being well inside the
token window. Two independent limits, two fixes.

## Fix

### 1. Wire the trimmer into the request path (`src/extension.ts`)

After the existing image-history trim, prune `apiMessages` to the endpoint's
byte budget before any request body is built:

```typescript
const messageBudget = MESSAGE_BYTE_BUDGET[routing.endpointKind]
  ?? MESSAGE_BYTE_BUDGET["chat-completions"];
const trimmedMessages = trimApiMessages(apiMessages, messageBudget);
if (trimmedMessages.length < apiMessages.length) {
  this.log(`[payload-trim] Trimmed messages from ${apiMessages.length} to
    ${trimmedMessages.length} (${messageBudget} byte budget) to stay under
    the gateway payload limit.`);
  apiMessages.splice(0, apiMessages.length, ...trimmedMessages);
}
```

All four endpoints (`chat-completions`, `messages`, `responses`, `google`)
share this single path, so one trim covers every routed model.

### 2. Safety net for pathological single turns (`src/extension.ts`)

If even the guaranteed minimum context alone exceeds the gateway limit (e.g.
a single turn carrying a very large attachment), fail with a clear,
actionable error instead of the cryptic upstream 400:

```typescript
if (JSON.stringify(apiMessages).length > MAX_PAYLOAD_BYTES) {
  throw new OpenCodeRequestError(
    "OpenCode Go payload too large (messages exceed 380000 bytes)...",
    "Start a new chat session to continue.",
  );
}
```

### 3. Unit tests (`src/test/messageTrimmer.test.ts`)

Six cases covering: short-conversation fast path, system-prompt survival,
guaranteed recent turns, tool-call/tool-result atomicity, budget
enforcement, and per-endpoint budget exports.

## Behavior after fix

| Session | Before | After |
|---|---|---|
| Short session | Works | Works (fast path, untouched) |
| Long session > 400 KB | Cryptic 400 | Oldest turns trimmed; request succeeds |
| Single giant turn | Cryptic 400 | Clear "start a new chat" error |

## Validation

- `npm run compile` — clean.
- `npm test` — new trimmer suite 6/6 pass; no regressions (the 9
  `usageProfile.test.ts` failures are pre-existing on `main` with Node 22).
- `npm run test-retry` (E2E mock server) — 7/7 pass.
