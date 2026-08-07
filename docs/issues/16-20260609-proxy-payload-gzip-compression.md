**Status:** ⚠️ Deprecated

# Proxy Payload Limit — Gzip Compression & Message Trimming

**Topic:** streaming / proxy / payload
**Updated:** 2026-06-10
**Tags:** #streaming #proxy #gzip #trimming #byok
**Supersedes:** None

---

## Overview

OpenCode Go API proxy returns HTTP 500 "Internal server error" when the JSON request body exceeds ~400 KB. Long chat sessions accumulate message history and tool definitions that push past this limit, even though the model's token context window (e.g. 1M tokens for deepseek-v4-pro) is far from full. This document traces the investigation, multiple fix iterations, and final solution.

> **Note:** Gzip compression was later removed in v0.2.6 because the OpenCode Go/Zen proxy does not support gzip request bodies. See devlog entry for v0.2.6 Payload Simplification.

---

## Timeline

### 1. (2026-06-09) Initial Error Report

**Problem:** User reported HTTP 500 errors after long chat sessions with `deepseek-v4-pro`:

```
payloadBytes=393980: Internal server error
```

Error repeated 3x with retry — VS Code kept retrying the same oversized payload.

**Root Cause:** OpenCode Go API proxy has an internal HTTP body size limit of ~400 KB. No guard existed in the extension.

**Solution (Phase 1 — Payload Size Guard):** Added `MAX_PAYLOAD_BYTES = 350_000` constant and `buildPayloadTooLargeError()` in `src/streaming.ts`. Guard checked `payload.length` before `fetch()` and threw a descriptive error.

**Status:** ✅ Solved (band-aid only)

### 2. (2026-06-09) User Feedback — "Start New Session Is Wrong"

**Problem:** User correctly pointed out that the model's context window (1M tokens) was far from full (~10% used). Forcing new sessions was the wrong approach.

**Solution (Phase 2 — Message Trimming):** Created `src/messageTrimmer.ts` with byte-aware conversation-turn trimming:

- Generic function `<T extends TrimmableMessage>` compatible with all endpoint body builders
- Dropped oldest complete conversation turns (user → assistant → tool results kept atomic)
- System prompt always preserved
- Budget: 250 KB per endpoint for messages
- Minimum 2-turn guarantee
- User notification when >30% messages trimmed

**Files:**

- `src/messageTrimmer.ts` (NEW) — `trimApiMessages()`, `MESSAGE_BYTE_BUDGET`, `MAX_PAYLOAD_BYTES`
- `src/extension.ts` — integrated `trimApiMessages()` before body builders
- `src/streaming.ts` — safety net updated to reference trimmer

**Status:** ✅ Solved (but trimming was the wrong approach)

### 3. (2026-06-09) User Feedback — "Trimming Hurts Quality"

**Problem:** User asked if trimming hurts quality. Analysis confirmed it does — older context is dropped even though the model can handle it.

### 4. (2026-06-10) User Insight — "Issue Is Proxy Limit, Not Context"

**Problem:** User correctly identified that the issue is the **proxy byte limit**, not the model's context window. Trimming sacrifices context unnecessarily.

**Solution (Phase 3 — Gzip Compression, CORRECT FIX):**

- Added `gzipSync` from `node:zlib` in `src/streaming.ts`
- Payloads >50 KB get gzip-compressed before sending
- `Content-Encoding: gzip` header set
- 400 KB JSON → ~50-80 KB compressed (85% reduction)
- Message trimming budget increased to 800 KB (rarely triggers)
- Hard safety net: checks compressed payload against `MAX_PAYLOAD_BYTES` (350 KB)

**Changes:**

| #   | Fix                                          | Files                   | Impact                                          |
| --- | -------------------------------------------- | ----------------------- | ----------------------------------------------- |
| P0  | Gzip compression for payloads >50 KB         | `src/streaming.ts`      | Primary fix — reduces payload 5-10x             |
| P1  | Import `MAX_PAYLOAD_BYTES` from trimmer      | `src/streaming.ts`      | Deduplicated constant                           |
| P2  | Message trimmer with generous 800 KB budgets | `src/messageTrimmer.ts` | Soft fallback, almost never triggers            |
| P3  | Trim integration in request flow             | `src/extension.ts`      | `trimApiMessages()` called before body builders |
| P4  | User notification when >30% trimmed          | `src/extension.ts`      | Informational, not error                        |
| P5  | Hard safety net on compressed size           | `src/streaming.ts`      | Last resort check                               |

**Verification:**

```bash
npx tsc --noEmit  # 0 errors
npm run compile   # clean build
```

**Status:** ✅ Solved (later removed — proxy doesn't support gzip request bodies)

### 5. (2026-06-10) Git Workflow — Merge main → develop

**Action:** Stashed feature changes, attempted to merge `main` → `develop`, then apply stash as feature commit on top.

**Issues encountered:**

1. Multiple `git reset --hard` to `a5e4c0f` (main HEAD) **lost develop's original history** — develop had its own commits predating main
2. Created fake merge commits with identical parents via `git hash-object` — graph showed "jump" instead of proper divergence
3. Failed to check `git reflog develop` for original develop HEAD before resetting

**Recovery:** Found original develop HEAD via `git reflog develop@{19}` = `22700e4`. Properly restored develop history, merged `main --no-ff` (2 different parents), then applied feature patch on top.

**Final commit on develop:**

```
* 64be1ad feat: gzip compression + message trimming fallback for proxy payload limit
*   80c635b Merge branch 'main' into develop
|\
| * a5e4c0f (main) feat: update extension icon...
* | 22700e4 feat: release version 0.2.1...
```

**Lessons Learned:**

1. **ALWAYS** check `git reflog develop` and `git log --oneline develop -10` before any `reset --hard` — never assume branch history
2. `git merge main --no-ff` only creates a merge commit if the branches have diverged — if develop is an ancestor of main or vice versa, it says "Already up to date"
3. Fake merge commits with identical parents (via `git hash-object`) look wrong in the graph — the `|\` converges immediately
4. The correct workflow is: (a) find original develop HEAD, (b) merge main → develop with `--no-ff`, (c) apply feature changes on top

---

## Final Solution (Later Reverted)

Gzip compression was the architecturally correct fix (transport-layer solution for a transport-layer problem), but was later removed in **v0.2.6** because the OpenCode Go/Zen proxy does not support gzip-encoded request bodies.

The message trimmer was also removed in the same release to avoid context loss.

---

## Files Changed

- `src/messageTrimmer.ts` (NEW — later removed)
- `src/streaming.ts` (gzip + safety net — later removed)
- `src/extension.ts` (trimming integration — later removed)

---

_This document records the full investigation and iteration history for reference._
