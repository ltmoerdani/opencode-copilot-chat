**Status:** ✅ Solved

# Muse Spark stream completion without [DONE] / finish_reason

**Topic:** streaming / transport / responses-api / muse-spark
**Updated:** 2026-08-22
**Tags:** #streaming #transport #responses-api #muse-spark #regression
**Supersedes:** —

---

## Overview

Muse Spark on the Responses API delivers content successfully but closes the connection without sending `data: [DONE]` or a `response.completed` event with `stop_reason`. The truncated-stream detector from #178 was throwing an error **after** content was already delivered to VS Code, creating a confusing error popup on an otherwise successful response.

---

## Problem

User reports after installing v0.7.0:

```text
OpenCode Zen stopped sending data before the response was complete (the
connection closed unexpectedly). Your message may be cut off — try sending
it again; a single resend usually succeeds.
```

The error fires **after** the model has answered the query — the content is visible in the chat, then the error popup appears.

### Root Cause

PR #178 added `isStreamTruncated()` to detect streams that end without `data: [DONE]` or `finish_reason`. The check correctly identifies abnormal termination, but treats ALL missing-signal streams the same:

- `extractedPartCount === 0` → retry (safe, no content to duplicate) ✅
- `extractedPartCount > 0` → throw error ❌ (confusing: content was delivered)

Muse Spark on the Responses API sends 12 events / 212 KB of content, then closes the connection without `[DONE]` or `finish_reason`. This is a **gateway quirk**, not a truncation. The stream was complete from the user's perspective.

### Why it only affects Muse Spark

Other Responses API models (GPT-5 family) always send `data: [DONE]` and/or `response.completed` with `stop_reason`. Muse Spark's gateway does not, even for successful responses.

---

## Solution

When `isStreamTruncated()` returns `true` AND `extractedPartCount > 0`, the engine logs a `[warn]` line and returns successfully instead of throwing. The user received their content — the missing termination signals are logged for diagnostics but don't surface as an error.

```text
[warn] stream ended without [DONE] / finish_reason but 12 parts were
delivered (212970 bytes / 12 events)
```

### Files Changed

| File                       | Change                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/transports/engine.ts` | Added `extractedPartCount > 0` branch in truncation check: log warning + emit summary + return (instead of throwing) |

---

## Verification

```bash
npm run compile  # passes
npm run lint     # passes (7 checks)
npm test         # passes (305+ tests)
```

Manual testing: Muse Spark delivers content without error popup.

---

## Notes

- The `isStreamTruncated()` function itself is unchanged — it still correctly identifies streams without `[DONE]`/`finish_reason`. The fix is in how the engine _handles_ the result.
- This is a regression from #178, which was designed for the case where content was NOT delivered. The Muse Spark case (content delivered, no termination signals) was not anticipated.
