**Status:** ✅ Solved
**Related issue:** [#282](https://github.com/ltmoerdani/opencode-copilot-chat/issues/282)
**Upstream:** [microsoft/vscode#346223](https://github.com/microsoft/vscode/issues/346223) (closed, by design)

# Agent mode: hidden picker and a misleading 400 error

**Topic:** vscode / agents-window / errors / provider
**Updated:** 2026-11-25
**Tags:** #vscode #agents-window #errors #provider

---

## Problem

The reporter had three separate symptoms in one issue:

1. Switching to Agent mode made the "Set agent" dropdown disappear.
2. No `Agent.md` file/folder existed in
   `%AppData%\Code\User\globalStorage\github.copilot-chat`.
3. Sending a prompt failed with HTTP 400 for `iceman-contributor-free`:
   _"This Go model trains on request data. Turn on 'Allow paid endpoints that
   train on request data'..."_

## Analysis

- The hidden picker is a VS Code 1.145 change: the experimental setting
  `sessions.chat.experimental.agentsPickerInAttachContextMenu` moves the picker
  into the `+` menu. Upstream closed #346223 as by design; the workaround is to
  pin the setting to `false`. The setting and its `experiment: { mode: "auto" }`
  registration are present in the local VS Code bundle, confirming why some
  users get it without opting in.
- Custom agents are a VS Code/Copilot feature (`.github/agents/*.agent.md` or
  the Agent Customizations editor). This extension never creates them; there is
  no `Agent.md` reference anywhere in `src/`.
- The 400 is a Go workspace privacy gate, not an Agent-mode failure. The log
  was from extension 0.7.11 while the report said 0.8.0. The gateway message
  already contains a Console URL, but Copilot Chat renders only the short
  reason, so users saw "Sorry, your request failed" with no next step.

## Fix

- `src/config.ts` — new setting key and globalState marker for the picker
  experiment.
- `src/commands/agentsWindow.ts` — `ensureAgentsWindowSupport()` now pins
  `sessions.chat.experimental.agentsPickerInAttachContextMenu` to `false`
  alongside the existing `extensions.supportAgentsWindow` and
  `chat.agentHost.byokModels.enabled` settings. `revertAgentsWindowSupport()`
  restores it (only when the extension set it, unless `force` is used). A
  window reload is still required, and the existing notification covers it.
- `src/errors.ts` — `describeTrainingOptInRestriction()` converts the Go
  training opt-in rejection into an actionable message naming the exact
  Console privacy setting. It is included in both the chat-visible `message`
  and the toast `userMessage`; the raw gateway URL stays in the Output channel.

## Verification

- `src/test/errors.test.ts` — the new hint matches the gateway wording, does
  not fire on unrelated errors, and reaches both error surfaces.
- `npm run lint` (compile + unit tests + all strict checks) passes.

## User guidance

Custom agents are created through **Chat: Open Customizations → Agents → New
Agent** or by adding `.github/agents/<name>.agent.md` to the workspace. The
extension does not generate those files.
