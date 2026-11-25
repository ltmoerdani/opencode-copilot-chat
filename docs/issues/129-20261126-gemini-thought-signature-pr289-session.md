**Status:** ✅ Solved

# Gemini thoughtSignature — PR #289 Session Record

**Topic:** routing / streaming / models / provider / documentation / process
**Updated:** 2026-11-26
**Tags:** #gemini #routing #streaming #thought-signature #pr289 #vscode #documentation
**Supersedes:** -
**Related:** `docs/issues/128-20261126-gemini-thought-signature-and-triage.md` · `docs/architecture/01-20260514-open-code-provider-architecture.md`

---

## Overview

Session record for the Gemini 4 Hydrogen `thoughtSignature` fix: implementation, verification, PR #289 review and merge, and an honest evaluation of what remains unverified. The code change is complete and merged to `main`; live verification on the reporter's model is still open. Doc 128 holds the technical analysis and the verdicts for all five reported symptoms. This file records the work itself and its evidence trail, so the two documents stay distinct: one explains the bug, this one explains what was done and what is still unknown.

## Timeline

### 1. 2026-11-26 — Triage and implementation

The starting point was a triage table produced in the previous chat session from the reporter's LinkedIn message. Four symptoms were classified as upstream VS Code behaviour, model-generated tool arguments, or old design debt. One was a gap in this extension: Gemini 4 Hydrogen on Zen failed on follow-up turns because the Google normalizers discarded the opaque `thoughtSignature` and the request builder never replayed it.

The fix was implemented on a new branch `fix/gemini-thought-signature` as one atomic commit, `5ca6130`. It carries the signature from the Google response through the Copilot Chat transcript as an internal data part and replays it on the next `model` turn. The full mechanism is described in doc 128 §Fix.

### 2. 2026-11-26 — Verification and commit

- `npm run compile` — clean.
- `npm run lint` — 7/7 (Editorconfig, ESLint, Markdown, Prettier, Shell, TypeScript, Tests).
- `src/test/google-thought-signature.test.ts` — 11/11 pass, covering stream and full-response normalization, a signature-only event, transcript round-trip and malformed payloads, replay on plain and tool-call turns, no extra parts when no signature was received, and history normalization retaining and merging signatures.
- `git diff --check` — clean. The pre-commit staged-lint gate passed on all 13 staged files.
- Not run: `npm run package`, `npm run test-retry`, and any live Gemini 4 Hydrogen session.

### 3. 2026-11-26 — PR #289 and review

The branch was pushed and PR [#289](https://github.com/ltmoerdani/opencode-copilot-chat/pull/289) was opened with a body that explicitly called the change ready for review rather than confirmed fixed on the model. The owner asked for a direct approval. `gh pr review 289 --approve` failed with `Review Can not approve your own pull request (addPullRequestReview)`. No workaround was attempted. The PR was subsequently merged by the owner as merge commit `a368c5a` on `main`; `gh pr view 289` reports state `MERGED`.

### 4. 2026-11-26 — Evaluation and communication draft

A follow-up evaluation separated what is verified from what is inferred. Three gaps remain visible:

1. The original report contained no error text for Gemini 4 Hydrogen, only "not working". The `MISSING_THOUGHT_SIGNATURE` diagnosis is an inference from our code and Google's official documentation, not a captured reporter log.
2. The internal data part seam has not been proven at runtime. VS Code's API allows `LanguageModelDataPart` in assistant messages, but a scan of real chat-session JSONL files on the maintainer's machine found only image MIME types, no custom `application/vnd.opencode.*` parts. The older reasoning-marker path that uses the same seam was never live-verified and is currently dormant, so this fix is its first real production use.
3. Replaying the signature as a trailing `{ text: "", thoughtSignature }` part matches the shape the gateway returned and Google's statement that a signature can attach to any part, but tool-call turns with Gemini 4 have not been exercised live.

A reply draft to the reporter was prepared in English and simplified at the owner's request. It was not posted: no approval to send it was given. The final draft said the Gemini issue was our bug and had been fixed, asked the reporter to update once the new version is live, and noted that Haiku 5.5 sits with VS Code, the skill loader arguments come from the model, and the storage warning is older debt.

## Files Changed

- `src/core/routing.ts` — signature collection in both Google normalizers; signature-only events no longer treated as empty.
- `src/transports/google.ts`, `src/transports/extractors.ts` — capture across SSE events and emit one internal transcript part.
- `src/chatParts.ts`, `src/config.ts` — internal data part helpers and `MAX_THOUGHT_SIGNATURES`.
- `src/provider/messages.ts` — read the part back, keep it through message merging, and count signature-only turns as payload.
- `src/request/types.ts`, `src/request/google.ts` — carry and replay the signatures on the wire.
- `src/thinking/gemini.ts` — contract note updated.
- `src/test/google-thought-signature.test.ts` — 11 regression tests.
- `CHANGELOG.md`, `ARCHITECTURE-MAP.md`, `docs/issues/128-20261126-gemini-thought-signature-and-triage.md` — release and navigation records.

## Verification

See §2 above for the checks actually executed. The distinction that matters: unit tests prove our own normalization, transcript helpers, and request builder; they do not prove that VS Code carries a custom-MIME data part from a response into the next request. That boundary needs a live two-turn Gemini 4 Hydrogen session with `opencodego.debugReasoning` enabled, checking both the emitted signature part and the `thoughtSignature` field in the second request body.

## Open follow-ups

- Live Gemini 4 Hydrogen verification after the release that contains PR #289 (`0.8.2`). If it still fails, the exact error text is the next piece of evidence.
- Confirm the internal data part survives a VS Code chat round-trip. If it does not, the signature needs a different carrier (for example a provider-side map keyed by a stable turn identifier).
- `globalState` usage-log migration to `globalStorageUri` remains a separate task; see doc 128 §Open follow-ups and `docs/features/03-20260605-go-usage-tracker.md`.
- Haiku 5.5 compaction remains upstream [microsoft/vscode#336797](https://github.com/microsoft/vscode/issues/336797).

## Sources

- [microsoft/vscode#336797](https://github.com/microsoft/vscode/issues/336797)
- [Gemini thinking — thought signatures](https://aistudio.google.com/docs/thinking#signatures)
- [GenerateContent API reference](https://aistudio.google.com/api-reference/generate-content)
- Local evidence: `git log`, `gh pr view 289`, `npm run lint` output, `src/test/google-thought-signature.test.ts`, and the chat-session history that produced the triage table.
