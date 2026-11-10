**Status:** 🟢 Active (upstream regression — fixed in VS Code 1.146.0 / Insiders; extension-side mitigation shipped in `0.8.1`)

# VS Code 1.145 Splits Streamed Reasoning Into One "Thought for Xs" Card Per Chunk

**Topic:** thinking / reasoning / vscode / byok / chat-ui / upstream
**Updated:** 2026-11-10
**Tags:** #thinking #reasoning #vscode-1.145 #byok #upstream #regression
**Affected host:** VS Code **1.145.0 / 1.145.1** (not reproducible on 1.144.0)
**Upstream:** [microsoft/vscode#345390](https://github.com/microsoft/vscode/issues/345390) (closed, fixed by [#346106](https://github.com/microsoft/vscode/pull/346106)), [microsoft/vscode#346240](https://github.com/microsoft/vscode/issues/346240) (open, same symptom), [microsoft/vscode#343322](https://github.com/microsoft/vscode/issues/343322) (related: invisible markers split markdown parts)
**Extension code touched:** `src/transports/reasoningCoalescer.ts` (new), `src/transports/extractors.ts`, `src/transports/streamParts.ts`, `src/test/extractors.test.ts`

---

## Problem

On VS Code 1.145.x, reasoning from a BYOK provider registered through
`vscode.lm.registerLanguageModelChatProvider` renders as **one collapsed
"Thought for 1s" card per streamed delta** instead of one contiguous thinking
block:

```text
Thought for 1s
Ah
Thought for 1s
, "clean" = one stack
Thought for 1s
(
Thought for 1s
Drupal
```

The reasoning text itself is intact and correctly ordered — only the grouping
is broken. Reported by users of several BYOK extensions
([#346240](https://github.com/microsoft/vscode/issues/346240): "OpenCode for
Copilot Chat v0.8.0 used as a BYOK provider"), so it is not specific to this
extension or to a single model.

## Root Cause (upstream, verified)

VS Code 1.145 rewrote the `thinking` branch of `ChatModel.Response.updateContent()`
(PR "chat: persist timing for contiguous reasoning runs"). Two additions cause
the split:

1. **Client-side reasoning timer.** The first untimed thinking part starts an
   internal `_activeReasoning = { part, startedAt: Date.now() }`. When the run is
   finalized, that span is stamped onto the part as
   `reasoningStartedAt` + `reasoningDurationMs`.
2. **Id-based run boundary.** A thinking part whose `id` differs from the previous
   thinking part is treated as a _new reasoning run_ (`differentId` →
   `finalizeReasoningDuration()` + push a new part).

So a provider whose deltas reach the chat model carrying a **unique id per
delta** produces one `IChatThinkingPart` per delta, each stamped with its own
~50 ms duration → one "Thought for Xs" card each.

The unique ids are **not created by this extension** — we report
`new vscode.LanguageModelThinkingPart(chunk)` with no id (the documented BYOK
pattern, identical to what issue #345390 describes). They are assigned
downstream, in the agent-host ("Local harness") protocol → `ChatModel` converter:

```js
// workbench.desktop.main.js (1.145.1) — responseParts -> ChatModel part
case "reasoning": p.content && l.push(G0t(p));
// ...
function G0t(s, o = s.content) {
  return { kind: "thinking", id: s.id, value: o, reasoningTimingSource: "provider", ... };
}
```

1.144.0 had no timing branch and ignored the id when merging, which is why the
same extension looked correct there.

## Evidence From This Machine

Local transcript comparison (`~/.config` workspace storage, `chatSessions/*.jsonl`),
same extension build, different host version:

| Session                  | Host    | `thinking` parts | distinct ids | parts with timing | avg chars/part     |
| ------------------------ | ------- | ---------------- | ------------ | ----------------- | ------------------ |
| `ade9c784…` (2026-10-27) | 1.144.x | 425              | 126          | **0**             | 114.3 (max 12,326) |
| `a00757b8…` (2026-11-05) | 1.145.1 | **3,298**        | **3,248**    | **3,251**         | 11.2 (max 848)     |

Sample persisted parts from the 1.145.1 session — ids are epoch-ms, one per
delta, each with a sub-100 ms duration:

```json
{"kind":"thinking","value":"User","id":"1793858221379","reasoningStartedAt":1793858221363,"reasoningDurationMs":67}
{"kind":"thinking","value":" wants to check GitHub issues","id":"1793858221432","reasoningStartedAt":1793858221430,"reasoningDurationMs":48}
{"kind":"thinking","value":" (","id":"1793858221480","reasoningStartedAt":1793858221478,"reasoningDurationMs":48}
```

Host check: `extensions/copilot` bundle reports `vscodeReasoningDone` markers,
and the workbench bundle's `updateContent` matches the 1.145.0 source
(`_activeReasoning`, `finalizeReasoningDuration`, `differentId`).

## Upstream Fix

- [PR #346106](https://github.com/microsoft/vscode/pull/346106) — "chat: keep
  BYOK reasoning untimed and grouped": removes the client-side reasoning timers,
  merges untimed chunks, and only splits on id mismatch when _provider_ timing is
  present. Milestone **1.146.0**, released to Insiders.
- [PR #345121](https://github.com/microsoft/vscode/pull/345121) is the change
  that introduced the regression.

## Options for Users (no extension change required)

| Option                                   | Effect                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Upgrade to VS Code **1.146+** / Insiders | Authoritative fix (#346106)                                         |
| Downgrade to **1.144.0**                 | Symptom absent (verified above)                                     |
| Accept for now                           | Correctness of reasoning text is unaffected; only grouping/CPU cost |

## Candidate Extension-Side Mitigation (shipped)

**Coalesce reasoning before reporting.** `ReasoningCoalescer`
(`src/transports/reasoningCoalescer.ts`) buffers reasoning deltas and flushes
one `LanguageModelThinkingPart` per ~512 chars
(`REASONING_COALESCE_MAX_CHARS`), with a stable per-request run id
(`rc-<epoch36>-<counter>`) on every part. Because the downstream harness
creates one reasoning part per reported thinking part, this reduces card count
proportionally (3,298 → tens) and cuts the re-layout cost reported in #346240.

Constraints handled:

- Ordering is mandatory: buffered thinking **is** flushed before any visible
  text or tool-call part is emitted (`flushReasoningBeforeContent()` at every
  visible-text, tool-call, think-filter, and end-of-stream flush site),
  otherwise reasoning appears after the text.
- Flushes in `flushReasoningFallback` and on cancellation/error paths (the
  transports' `finally` blocks call it unconditionally).
- Cannot restore a single block on 1.145 — the ids/timings are generated below
  `progress.report()`. Single-block rendering only returns with the upstream fix.
- The stable run id is a forward hint, not the primary strategy: 1.145.0's
  `differentId` check and 1.146's `differentReasoningRun` check both merge
  same-id parts, so id-preserving hosts group our parts into one card.

**Verification:** `npm run lint` passes (7/7: editorconfig, eslint, markdown,
prettier, shellcheck, typecheck, 597 unit tests). New tests in
`src/test/extractors.test.ts`: 40 one-word deltas coalesce into < 40 parts
with zero text loss; reasoning flushes before visible text; run id carried on
the no-progress fallback path.

## References

- [microsoft/vscode#345390](https://github.com/microsoft/vscode/issues/345390) — "many `Thought for 0s` … custom endpoint + Local harness" (fixed by #346106)
- [microsoft/vscode#346240](https://github.com/microsoft/vscode/issues/346240) — per-word "Thought for 1s" blocks (same root cause)
- [microsoft/vscode#343322](https://github.com/microsoft/vscode/issues/343322) — invisible marker parts / markdown split (adjacent bug, same merge logic)
- `src/transports/extractors.ts` — `handleReasoning()` → coalesced `ReasoningCoalescer` → `emitThinkingPart()` (~512-char parts)
- `src/transports/reasoningCoalescer.ts` — buffer + stable run id + flush-before-content ordering
- `src/transports/streamParts.ts` — `emitThinkingPart()` contract (+ optional run id)
