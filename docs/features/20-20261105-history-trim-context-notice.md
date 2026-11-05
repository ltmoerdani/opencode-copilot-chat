**Status:** ✅ Solved

# History Trimming Tells the Model What Was Dropped (#274)

**Topic:** provider / tool-calling
**Updated:** 2026-11-05
**Tags:** #provider #history-trim #context-window #tool-calling

---

## Overview

When `trimOldMessagesToFitContext()` (`src/provider/historyTrim.ts`) drops old
conversation turns to fit the model's context window or the hard byte ceiling,
the trim used to be completely silent: the model received a history whose
middle section had vanished, with no signal at all. It kept answering
confidently from an incomplete history, re-derived facts established earlier,
and users could not tell "the model forgot" from "the model never saw it"
(GitHub issue #274, reported by @TONYtang001).

The trimmer now inserts a short user-role notice at the cut boundary so the
model knows earlier turns are unavailable:

```text
[Context notice] N earlier message(s) were omitted here to fit the model
context window. Information from before this point is NOT available in this
request; re-read files or ask the user if you need those details.
```

## Implementation

- The notice is spliced at `dropStart` immediately after the existing
  `messages.splice(dropStart, removed)` — `dropStart` is already a drop-unit
  boundary, so no `tool` message is ever separated from the assistant message
  carrying its `tool_calls`, and the anchor (index 0) plus the current prompt
  (last index) are untouched.
- The notice is re-inserted on **every** trim: each request rebuilds the
  payload from the full conversation, so the notice must be re-added each time
  the trim fires.
- The notice's token/byte cost is added to the returned `finalTokens` /
  `finalBytes` estimates (tokens via the existing `estimateTokenCount`, bytes
  as `noticeText.length + 32`), keeping the output budget honest. The payload
  can therefore overshoot the ceilings by at most one notice (~250 bytes /
  ~50 tokens) — negligible against the real byte-cap floor (512 KB).

## Behavior

| Scenario                            | Result                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Trim fires                          | Exactly one `[Context notice]` at the cut boundary, count matches `removed` |
| Payload already fits                | No notice, array unchanged                                                  |
| Second request on a trimmed history | Trim is a no-op, exactly one notice (no duplication)                        |
| Tool-call group dropped             | Group stays whole; notice never lands inside a group                        |
| Anchor / current prompt             | Never dropped, never altered                                                |

## Testing

- `src/test/historyTrim-notice.test.ts` — notice placement, count, no-trim,
  no-duplication, and tool-group invariants.
- `src/test/messages.test.ts` — payload-trim assertions updated for the `+1`
  notice message; wire-payload assertions include bounded notice slack.
- E2E (`tmp/e2e-issues-274-230-232.mjs` against compiled `out/`): realistic
  38-message agent session with tool groups — 12 checks, all PASS.

Closes #274.
