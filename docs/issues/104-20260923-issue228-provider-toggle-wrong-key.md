# Issue #228 — `toggleProvider` Removes the Provider but "Re-add" Never Brings It Back

**Status:** ✅ Solved — implemented + verified end-to-end
**Topic:** provider / commands / configuration
**Updated:** 2026-09-23
**Tags:** #provider #byok #commands #configuration
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#228](https://github.com/ltmoerdani/opencode-copilot-chat/issues/228)
**Related:** issue doc [93 — #214 thinking settings scope](93-20260903-issue214-thinking-settings-scope.md) (same section-scoped-config failure class)

---

## Problem

Running **OpenCode Zen: Remove/Re-add Provider in Language Models** removed the provider; running it again did not re-add it. The only workaround was manually deleting `"opencodezen.enabled": false` from `settings.json`.

## Root Cause — two defects, both confirmed from code

### 1. Wrong-key write on agent variants

`manageProvider` (gear-icon flow) reads the current state correctly via `providerEnabledSetting(deps.definition.vendor)`, which resolves agent variants to their base vendor (`opencodezen-agent` → `opencodezen`). But it then called `toggleProviderEnabled(deps.definition.vendor, …)`, which writes to the **section-scoped configuration of that vendor** — for an agent variant that is `opencodezen-agent.enabled`, a key **nothing reads**: the vendor contribution's `when` clause and the settings schema only know `config.opencodezen.enabled`.

Result: settings look "enabled" while the provider stays unregistered — permanent divergence between config and runtime. (Class sibling of the #214 scope bug: section-scoped reads/writes vs. root keys.)

### 2. Blind toggle + reload dependency

The command flipped `enabled` unconditionally (`next = !current`) while its title promised "Remove/Re-add". Provider (de)registration only happens at startup (`onLanguageModelChatProvider` activation), so re-adding requires a window reload — invoking the command twice without reloading left the picker empty even though the setting had flipped back.

## Fix

`src/commands/providers.ts` — `toggleProviderEnabled` rebuilt:

1. **Base-vendor resolution first:** `resolveBaseVendor(vendor)` before any configuration access, mirroring the `providerEnabledSetting` contract (agent variants follow the same switch as the vendor they mirror).
2. **State-aware, not a blind toggle:** the command derives the available action from the current setting and shows a quick-pick — _"Remove from Language Models"_ when enabled, _"Re-add to Language Models"_ when disabled — so repeated invocations can never leave the provider in an unexpected state. Esc cancels without touching anything.
3. Reload prompt in both directions (unchanged behavior), action key in `providerDialogs.ts` collapsed to a single `"toggle"` entry (the old code reused the `"remove"` action for two opposite labels), and the command titles now read "Toggle Provider Registration in Language Models".

## Files Changed

| File                              | Change                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `src/commands/providers.ts`       | Base-vendor resolution + state-aware quick-pick replacing the blind toggle            |
| `src/provider/providerDialogs.ts` | Manage menu: one "Toggle Registration…" entry; dropped the now-unused enablement read |
| `package.json`                    | Retitled `opencodego.toggleProvider` / `opencodezen.toggleProvider` commands          |

## Verification

- `npm run lint` (full 7-check gate) pass; 480/480 unit tests pass.
- Static regression check: grep confirms the only `enabled` write site is now `getConfiguration(baseVendor)` — no section-scoped writer remains.
- Real manual test (Extension Development Host): palette command twice in a row, gear-icon manage flow, `settings.json` key inspection after each step — PASS (2026-09-23).

---

Detected 2026-09-19 | Fixed 2026-09-23
