# 10 — Per-Profile Go Usage Tracking for Multi-Account Setups

**Status:** 🟢 Active  
**Author:** Wallacy (Wallacy Freitas)  
**PR:** [#75](https://github.com/ltmoerdani/opencode-copilot-chat/pull/75)  
**Issue:** [#63](https://github.com/ltmoerdani/opencode-copilot-chat/issues/63)  
**Merged:** 2026-07-12  
**Commits:** 4 (`4353c1e`, `7d8a008`, `1734242`, `7b9fae5`)

---

## Problem

Users with multiple OpenCode Go subscriptions (e.g. work + personal) could not use separate Go accounts in the same VS Code window. The usage panel mixed data from all keys because:

1. `opencode.db` (SQLite) is shared per-machine with no API key column
2. `GoUsageTracker` read all rows where `providerID = 'opencode-go'` without filtering
3. Switching API keys via "Update API Key" didn't reset the tracker

This caused the usage panel to show combined costs from both accounts, making the5h rolling window, weekly, and monthly limits inaccurate.

## Solution

Profile-based multi-account tracking. Each API key gets a named profile ("Profile 1", "Profile 2", etc.) with isolated storage. The extension auto-detects when a second key is added and activates the multi-profile mode.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  VS Code Manage Language Models                  │
│  ┌──────────┐  ┌──────────┐                     │
│  │ Go Key 1 │  │ Go Key 2 │                     │
│  └────┬─────┘  └────┬─────┘                     │
│       │              │                           │
│       ▼              ▼                           │
│  ┌─────────┐   ┌─────────┐                      │
│  │Profile 1│   │Profile 2│   ← usageProfile.ts │
│  │  fp1    │   │  fp2    │                      │
│  └────┬────┘   └────┬────┘                      │
│       │              │                           │
│       ▼              ▼                           │
│  ┌─────────┐   ┌─────────┐                      │
│  │Tracker 1│   │Tracker 2│  ← GoUsageTracker   │
│  │storage. │   │storage. │    (namespaced keys) │
│  │  fp1    │   │  fp2    │                      │
│  └─────────┘   └─────────┘                      │
│                                                  │
│  SQLite (opencode.db) → SKIPPED in multi-profile │
└─────────────────────────────────────────────────┘
```

## What Changed

### New file: `src/usageProfile.ts`

Profile registry module. Core types and functions:

| Export                                                   | Purpose                                         |
| -------------------------------------------------------- | ----------------------------------------------- |
| `UsageProfile`                                           | Interface: `{ fingerprint, label, lastSeenAt }` |
| `keyFingerprint(apiKey)`                                 | Deterministic 8+8 char fingerprint from API key |
| `readProfiles(ctx)` / `writeProfiles(ctx, profiles)`     | CRUD for profile list in `globalState`          |
| `readActiveProfile(ctx)` / `writeActiveProfile(ctx, fp)` | Track which profile is active                   |
| `findProfile(profiles, fp)`                              | Lookup by fingerprint                           |
| `renameProfile(ctx, fp, newLabel)`                       | Rename a profile                                |
| `getOrCreateProfile(ctx, fp)`                            | Auto-create on first request                    |
| `readActiveProfiles(ctx)`                                | Filter out legacy singleton                     |
| `nonLegacyCount(profiles)`                               | Count real (non-legacy) profiles                |

Storage keys:

- `opencodego.profiles.v1` — profile registry array
- `opencodego.activeProfile.v1` — active profile fingerprint
- `opencodego.migratedTo.v1` — one-time migration flag

### Modified: `src/goUsageTracker.ts`

**Constructor change:**

```typescript
constructor(
  private readonly context: vscode.ExtensionContext,
  log?: (msg: string) => void,
  costResolver?: CostResolver,
  private readonly storageKeySuffix: string = "",  // NEW
)
```

**Key additions:**

- `storageKey(base)` — appends `.${suffix}` to storage keys for namespace isolation
- `migrateFromSingleton()` — copies legacy singleton data (entries, baseline, session costs) into the new profile's namespaced storage. Called once during first multi-profile activation.

**SQLite skip (the fix for issue #63's 5h bug):**

```typescript
getSummary(): UsageSummary {
  const isPerProfile = this.storageKeySuffix.length > 0;
  if (!isPerProfile) {
    const sqliteRows = readOpenCodeHistory();
    if (sqliteRows) {
      return this.buildSqliteEnrichedSummary(nowMs, sqliteRows, clamp);
    }
  }
  // Fall back to extension-tracked data (per-profile, isolated)
  return this.buildSummaryFromTracked(nowMs, clamp);
}
```

When `storageKeySuffix` is set (multi-profile mode), the tracker skips `readOpenCodeHistory()` entirely. This is necessary because `opencode.db` has no API key column, so reading it would mix quota from all accounts. Instead, the tracker uses only extension-tracked entries (which are namespaced per profile).

Same skip applied in `setManualSpentTargets()` for consistency.

**All persist/restore methods** now use `this.storageKey(...)` instead of raw storage key constants, ensuring complete isolation.

### Modified: `src/extension.ts`

**Profile lifecycle:**

- `goUsageTrackers: Map<string, GoUsageTracker>` — per-profile tracker instances
- `getOrCreateTracker(fingerprint)` — lazy-create tracker with namespaced storage
- `activeGoUsageTracker()` — returns tracker for currently active profile
- `ensureProfileSync(apiKey)` — called on startup and per-request; creates profile if new, runs one-time migration, updates active profile
- `setActiveProfile(fingerprint)` — switch active profile + refresh UI

**Model ID namespacing:**

```typescript
const fp = keyFingerprint(apiKey);
const fpEffectiveModelId = `${effectiveModelId}::${fp}`;
```

Two Manage Language Models entries with the same vendor now produce distinct model IDs, preventing the `apiKeysByModelId` map from overwriting keys.

**UI updates:**

- Status bar: shows `[Profile 1]` suffix when2+ profiles exist
- SVG hover card: title includes profile name
- QuickPick: profile switching section when2+ profiles (active marked with ✓, others are clickable)
- Webview: profile-aware title and content

**New commands:**

- `opencodego.renameActiveProfile` — rename via input box
- `opencodego.deleteProfile` — select from list, confirm, then delete with cleanup

### New file: `src/test/usageProfile.test.ts`

Unit tests covering:

- `keyFingerprint`: empty input, 8+8 extraction, stability
- Profile registry: empty state, round-trip, find, rename
- Active profile: default to legacy, round-trip

### Documentation

- **CHANGELOG.md**: Entry under `[Unreleased] > Added` describing the feature
- **README.md**: New section "Multiple Go accounts" with usage instructions
- **package.json**: Two new command entries

## Edge Cases Handled

1. **Single-key users**: Feature only activates when2+ keys detected. Existing behavior unchanged.
2. **Legacy migration**: First time a second key is created, existing singleton data migrates to Profile 1 automatically.
3. **SQLite unavailability**: In multi-profile mode, SQLite is skipped entirely. Accuracy falls back to extension-tracked entries.
4. **Profile deletion**: Cleans up all storage keys (entries, baseline, session costs) and resets to legacy if deleted profile was active.
5. **Same model across profiles**: Fingerprint in model ID prevents key collision in `apiKeysByModelId`.

## Known Limitations

1. **Accuracy trade-off in multi-profile mode**: Since SQLite is skipped, cost estimates rely on extension-tracked entries (which use bundled/live pricing, not actual billed amounts). This is documented in the README.
2. **5h rolling usage**: Still shows combined data in edge cases where SQLite is read before the multi-profile check activates. The fix in commit `7b9fae5` addresses the primary path, but `setManualSpentTargets` also needed the same treatment.
3. **No cross-profile usage view**: Each profile shows only its own usage. There's no combined view for users who want to see total spend across all accounts.

## Testing

- 95/95 unit tests pass
- Manual testing by taojunnan with two Go accounts: profile creation, auto-switch, QuickPick switch, rename, delete all verified
- The5h rolling usage isolation was reported as still showing combined data (taojunnan's feedback, issue #63 comment). This was fixed in commit `7b9fae5` (SQLite skip in `getSummary()`).
