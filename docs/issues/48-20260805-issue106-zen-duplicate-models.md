# Issue #106 — OpenCode Zen models listed twice with native BYOK group

**Date:** 2026-08-05
**Status:** ✅ Resolved
**Related:** GitHub Issue [#106](https://github.com/ltmoerdani/opencode-copilot-chat/issues/106)
**Reporter:** [@CoderTCY](https://github.com/CoderTCY)
**Extension version affected:** 0.5.0
**Fixed in:** Next release (unreleased)

## Problem

With the API key configured via VS Code's native Manage Models / BYOK flow, every OpenCode Zen model appears twice: `vscode.lm.selectChatModels({ vendor: "opencodezen" })` returns **16** models instead of **8**.

## Root Cause

VS Code resolves a provider that declares a `configuration` schema in two passes: once **without** a group (`configuration` undefined), then once **per configured group** (with the group's resolved `apiKey`). It namespaces model identifiers by group (`toModelIdentifier` → `opencodezen/<id>` vs `opencodezen/<group>/<id>`), so both sets land in `_modelCache` and are never deduplicated.

Since 0.5.0, the groupless call falls back to the extension's secret storage (issue #86 fix, PR #101). The group call also persists its key into that same storage, so on the next resolution the groupless call emits a **second**, separately-namespaced set alongside the group's set — every model twice.

## Fix

`src/extension.ts` — track per vendor (in `globalState`) whether a BYOK group call has been served, and make the groupless call stay silent when it has:

```typescript
// A call that carries a BYOK key is a configured-group call.
if (apiKey) {
  await this.markByokGroupConfigured();
}

// Groupless call: when a BYOK group exists, the group call(s) are
// authoritative — do not emit a secrets-backed duplicate set.
if (!apiKey) {
  if (await this.hasByokGroupConfigured()) {
    return [];
  }
  apiKey = await this.context.secrets.get(SECRET_KEY);
}
```

The `Clear API Key` action resets the flag so the extension's own secret-storage flow can take over again.

### Behavior

| Scenario                              | Result                                               |
| ------------------------------------- | ---------------------------------------------------- |
| BYOK group only (reporter)            | 8 models, never duplicated                           |
| Key via extension command only (#86)  | 8 models, unchanged                                  |
| Multiple BYOK groups (#63)            | one set per group, unchanged                         |
| Key via command + BYOK group          | transient 16 for one resolution, then heals to 8     |
| Group removed, key lingers in secrets | 0 models until `Clear API Key` / re-adding the group |

## Verification

- `npm run compile` → passes.
- Unit tests (`node --test out/test/**/*.test.js`) → 133/133 pass.
- Not yet verified inside VS Code.

## Files Changed

- `src/extension.ts` — per-vendor BYOK-group flag in `globalState`; groupless call returns `[]` when a group exists; `Clear API Key` resets the flag.
- `CHANGELOG.md` — entry under `[Unreleased]`.

## References

- GitHub Issue: [#106](https://github.com/ltmoerdani/opencode-copilot-chat/issues/106)
- Related fix (introduced the fallback that enables the duplication): [#86](https://github.com/ltmoerdani/opencode-copilot-chat/issues/86) — `docs/issues/43-20260803-issue86-zen-nonagent-0-models.md`
- VS Code: `LanguageModelsService._resolveAllLanguageModels` (groupless call first, then per-group) and `toModelIdentifier` (group-scoped identifiers).
