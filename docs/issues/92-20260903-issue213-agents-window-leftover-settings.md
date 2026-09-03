# Issue #213 — "Extension permanently hijacked my Agents Window" → Force-Revert Command for Leftover Core Settings

**Status:** ✅ Solved (branch `fix/issues-204-214-batch`, commit `7316b6d`; JSDoc corrected in `0b32f5f`)
**Topic:** agents-window / vscode-core-settings / uninstall-cleanup
**Updated:** 2026-09-03
**Tags:** #agents-window #byok-bridge #settings #uninstall #cleanup
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#213](https://github.com/ltmoerdani/opencode-copilot-chat/issues/213)
**Related:** issue doc [58 — PR #125 agents-window BYOK bridge](58-20260811-pr125-agents-window-byok-bridge.md), [28 — PR #42/#43 duplicate agent-host models](28-20260615-pr42-pr43-duplicate-agent-host-model-fix.md), feature doc [06](../features/06-20260614-agents-window-model-visibility.md)

---

## Problem

After uninstalling the extension (and restarting VS Code / the machine), `OpenCode Go/...` models still appear — and still **work** — in the Agents window/Copilot agent. Nested-looking model names appear when creating new profiles (`OpenCode Go/OCGo/OpenCode Go / Glm 5.3 Flash (OCGo/opencodego:glm-5.3-flash::session-2026-05-21-b)`). Environment: v0.7.3, VS Code 1.137 insiders.

## Root Cause

On activation (PR #125, issue #122) the extension auto-enables two **core VS Code settings in Global scope**: `extensions.supportAgentsWindow.<id>` and `chat.agentHost.byokModels.enabled` (1.129+). VS Code has **no uninstall hook**, so `revertAgentsWindowSupport()` could never run after an uninstall — both settings survived and the BYOK bridge kept mirroring the extension's vendors into agent-host sessions. Nothing "session"-based is left behind: `::session-2026-05-21-b` is the static `MODEL_METADATA_REVISION` cache tag (`src/config.ts:115`), part of the normal model id. The reporter also observed the settings are not even required on 1.137 (models appear via the bridge regardless) and that enabling them creates duplicate provider entries in the Language Models editor.

## Fix

`revertAgentsWindowSupport(context, { force?: true })` — force mode reverts both core settings even without the globalState markers (for machines already in the leftover state). Other extensions' `supportAgentsWindow` entries are never touched. Non-force behavior unchanged. New registered command (package.json + extension.ts):

> **OpenCode: Clean Up Agents Window Core Settings (fix leftover/hijacked models)**

shows a confirmation-free revert + a reload notification.

## Files Changed

| File                           | Change                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| `src/commands/agentsWindow.ts` | `force` option on `revertAgentsWindowSupport` + accurate JSDoc |
| `src/extension.ts`             | `opencodego.revertAgentsWindowSupport` command registration    |
| `package.json`                 | Command contribution                                           |

## Verification

- `npx tsc --noEmit` clean; 449/449 tests pass; staged-lint gate pass.
- Manual (victim machine): run the command → reload → no OpenCode models in the Agents window; `settings.json` no longer contains the two keys.

## Open Follow-ups

1. Consider stopping the auto-enable of `chat.agentHost.byokModels.enabled` on VS Code builds where the bridge works without it (1.137 report) — needs confirmation before changing the default.
2. The duplicate-provider-entries-in-Manage-panel report may be the VS Code-side BYOK filtering gap already recorded in issue doc 28.

## Lessons Learned

1. Writing global user settings from an extension is a one-way door without an uninstall hook — every auto-enabled setting needs a user-invokable cleanup command from day one.
2. Record not just _what_ was flipped but a recovery path for when the extension is gone (docs: README uninstall section is the fallback when globalState is unavailable).

---

Detected 2026-09-03 | Reported by @nickchomey
