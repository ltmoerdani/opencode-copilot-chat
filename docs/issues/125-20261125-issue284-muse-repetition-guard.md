**Status:** ✅ Solved
**Related issue:** [#284](https://github.com/ltmoerdani/opencode-copilot-chat/issues/284)
**Related docs:** `91-20260903-issue207-big-pickle-repetition-loop.md`, `36-20260723-mimo-thinking-infinite-loop.md`

# Muse Spark repeated the same answer across agent turns

**Topic:** provider / tool-calling / thinking / muse
**Updated:** 2026-11-25
**Tags:** #provider #muse #tool-calling #repetition

---

## Problem

In Agent mode with `muse-spark-1.3-contributor`, the same Chinese sentence was
emitted hundreds of times, interleaved with tool calls (`Revert forced
Preinclud...`, `Remove port shim he...`, `Read Bootloader.ewp`, ...). The run
never converged.

## Root cause

This is model-level degenerate repetition, not a transport retry or a stream
duplication bug: each turn was a fresh response with the same text.

The extension had no guard for repeated **visible content**:

- `src/thinking/muse.ts` emits only `reasoning.effort`; unlike `big-pickle`
  (#207) and MiMo (#36), Muse has no `repetition_penalty`.
- `src/transports/extractors.ts` suppresses repeated **reasoning** fragments
  only; visible text is unaffected.
- `detectBeamToolLoop()` was gated to `beam-*` models.

## Fix

`src/toolLoopGuard.ts` gains `detectMuseRepetitionLoop()`:

- Muse-only (`/^muse-/i`);
- looks at assistant turns after the last user message, including turns with
  tool calls in between;
- normalizes visible text and compares a bounded signature (200 chars, minimum
  40 chars) across the last three turns;
- returns a warning when the same signature repeats three times consecutively.

`src/provider/chatPrep.ts` combines the Beam and Muse warnings into the existing
`toolLoopWarning` path. That path already appends a recovery instruction and
drops `tools` from the request for that turn (`OpenCodeProvider.ts:339`), so the
model is forced to produce a tool-free final answer instead of continuing the
loop. The log tag is now the generic `[loop-guard]`.

The guard is deliberately conservative: short answers and varying text never
fire, and non-Muse models are untouched.

## Verification

- `src/test/toolLoopGuard.test.ts` — three consecutive identical Muse answers
  with tool calls between them trigger the guard; two repeats, varying answers,
  short answers, and non-Muse models do not.
- `npm run lint` (compile + unit tests + all strict checks) passes.
