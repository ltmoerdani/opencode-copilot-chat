# Issue #214 — Thinking Level Settings "don't do anything" → Scope-Robust Config Reading

**Status:** ✅ Solved (branch `fix/issues-204-214-batch`, commit `609b344`) — ⚠️ fix is evidence-based but root cause on insiders 1.137 not yet reproduced locally
**Topic:** thinking / configuration-scope / agent-host
**Updated:** 2026-09-03
**Tags:** #thinking #settings #configuration #agent-host
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#214](https://github.com/ltmoerdani/opencode-copilot-chat/issues/214)
**Related:** feature doc [02 — per-model thinking controls](../features/02-20260517-per-model-thinking-controls.md), issue doc [22 (thinking part bypass)](22-20260609-thinking-part-bypass.md)

---

## Problem

`opencodego.thinking.mimo` (and all other thinking settings) are set, but every new chat starts with thinking `off`. Environment: latest extension, VS Code latest insiders, OpenCode Go.

## Analysis

Settings resolution chain (`src/thinking/resolve.ts`): per-model `modelConfiguration` > workspace `opencodego.thinking.*` > `THINKING_DEFAULTS` (all `"off"` by design — `src/config.ts`). The family keys and allowed values are correct (`src/provider/settings.ts`), and the registry maps `mimo-*` → the MiMo strategy, so a plain misconfiguration is ruled out.

Remaining plausible root cause: `getSettings()` used plain `config.get()`, which merges scopes via the **workspace context of whichever process calls it**. The Agents window (and some insiders builds) run the extension in a separate agent-host process that can resolve the workspace root differently — or have none — making user-scope (`settings.json`) thinking values fall through to the baked-in defaults.

## Fix

Scope-robust read for all nine thinking keys (`src/provider/settings.ts`):

```ts
function readConfigValue<T>(config: vscode.WorkspaceConfiguration, key: string, fallback: T): T {
  const inspected = config.inspect<T>(key);
  const value = inspected?.workspaceValue ?? inspected?.globalValue;
  return value === undefined ? fallback : value;
}
```

An explicitly set workspace value wins, then an explicitly set user value, and only then the default — regardless of which process/scope resolves first. Non-thinking keys (temperature, timeouts) intentionally stay on `config.get()` to keep the blast radius minimal.

## Files Changed

| File                       | Change                                                    |
| -------------------------- | --------------------------------------------------------- |
| `src/provider/settings.ts` | `readConfigValue()` + all thinking keys routed through it |

## Verification

- `npx tsc --noEmit` clean; 449/449 tests pass; staged-lint gate pass.
- ⚠️ **Still to reproduce on VS Code insiders 1.137** (set `opencodego.thinking.mimo: "high"` in User settings → new chat → confirm `reasoning_effort` reaches the payload). If the symptom persists there, the next suspect is host-supplied `modelConfiguration` overriding the workspace baseline (see `resolveThinkingConfig` priority).

## Lessons Learned

1. `config.get()` vs `inspect()` matters in multi-process surfaces (agent host, remote) — explicit scope preference is the defensive read.
2. "Default off" is by design, so first triage for this class of report is confirming the value actually resolves in the process that makes the request, not in the main window.

---

Detected 2026-09-03 | Reported by @nickchomey
