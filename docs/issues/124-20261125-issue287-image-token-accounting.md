**Status:** ✅ Solved
**Related issue:** [#287](https://github.com/ltmoerdani/opencode-copilot-chat/issues/287)
**Related docs:** `75-20260821-issue173-vision-byte-cap.md`, `20-20261105-history-trim-context-notice.md`

# Base64 images inflated the token budget and evicted conversation history

**Topic:** provider / history-trim / token-estimate / vision
**Updated:** 2026-11-25
**Tags:** #provider #history-trim #vision #token-estimate #bug

---

## Problem

In a long agentic visualization session, viewing a few figures caused the
trimmer to drop 291 messages at once (455 → 168). The model then re-read files
and redid work it had already validated. The chat transcript still showed the
full history, so the reset looked like a model failure.

The reporter's log showed the extension estimating 538,239 tokens for a
request the provider counted at 91,033, while the byte check passed comfortably.
Their direct gateway probes also showed that DeepSeek/GLM/Qwen accepted prompts
well beyond the extension's 70% budget, so the trim was protecting against a
limit that did not bind.

## Root cause

`estimatePromptTokenCount()` measured `JSON.stringify(prompt)` with
`ceil(chars / 4) × 1.1`. Image parts are base64 data URLs, so a 1 MB figure was
charged roughly 393,000 "tokens" instead of the few hundred the provider
actually counts.

Issue #173 had already fixed the **byte** side by stripping image data in
`stripImageData()` before measuring `MAX_REQUEST_PAYLOAD_BYTES`. The **token**
side kept counting base64, so the two ceilings disagreed: bytes passed, tokens
failed, and the trimmer dropped the oldest text middle in one block. The
`[Context notice]` added by #274 then told the model to re-read files, which
re-added history and made the next figure trigger the same cut again.

A second inconsistency existed on the VS Code-facing side:
`estimateDataPartTokenCount()` reports `IMAGE_TOKEN_ESTIMATE = 1024` per image,
so Copilot Chat never saw the weight the extension was charging internally.

## Fix

- `src/request/shared.ts` — move `stripImageData()` out of `historyTrim.ts` and
  export it together with `countImageDataParts()`, so byte and token accounting
  use the same image detection.
- `src/tokenEstimate.ts` — `estimatePromptTokenCount()` now strips base64 data
  URLs before the character heuristic and charges a bounded
  `IMAGE_TOKEN_ESTIMATE` (1024) per stripped image. Hosted URLs remain counted
  as text. `estimateMessageTokenCount()` applies the same rule to one message,
  used for per-unit trim measurements.
- `src/provider/historyTrim.ts` — imports the shared helper; its contract now
  states that images are excluded from both ceilings.

Because `finalTokens` also feeds `calculateModelLimits()`, this removes the
arithmetic path where an inflated prompt estimate collapsed `max_tokens` to 1
(the shape reported in #83 / `docs/issues/37-...`).

## Verification

- `src/test/tokenEstimate.test.ts` — a 400 KB base64 image yields an estimate
  under 10,000 tokens instead of ~110,000.
- `src/test/messages.test.ts` — a vision-only payload no longer removes any
  text history, and `finalTokens` stays near the real prompt size.
- `npm run lint` (compile + unit tests + all strict checks) passes.
