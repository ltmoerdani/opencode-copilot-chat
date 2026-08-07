**Status:** ✅ Solved

# Go Usage Tracker — Status Bar Not Updating

**Topic:** debug / status-bar / logging / cli-removal / rest-api-research
**Updated:** 2026-06-05
**Tags:** #debug #status-bar #go-usage #cli #rest-api #logging
**Related:** `docs/features/03-20260605-go-usage-tracker.md`

---

## Symptom

After installing v0.2.0 and using OpenCode Go models in Copilot Chat, the status bar item `Go: 0%·0%·0%` did not change. No usage data was being recorded despite confirmed model usage.

---

## Investigation

### Phase 1: CLI Dependency Problem

**Discovery:** Initial implementation used SQLite-first approach — reading `~/.local/share/opencode/opencode.db` to get server-computed cost data. This required the user to have run OpenCode CLI (TUI) at least once.

**User Rejection:**

> "Kenapa anda masih bahasa terkait CLI, mac saya memang pernah menjalankan opencode dan melaui CLI, tapi jauh sebelum itu open usage sudha berfungsi"

**Root Cause:** The SQLite reader path was the primary data source. If `opencode.db` didn't exist or had no data, the tracker fell back to extension-tracked data. But the fallback was incomplete — it only worked for requests made AFTER extension install.

### Phase 2: Exhaustive REST API Search

Searched all possible OpenCode endpoints for programmatic usage data:

| Endpoint                   | Status |
| -------------------------- | ------ |
| `/zen/go/v1/usage`         | 404    |
| `/billing`                 | 404    |
| `/subscription`            | 404    |
| `/me`                      | 404    |
| `/account`                 | 404    |
| `/quota`                   | 404    |
| `/limits`                  | 404    |
| `/balance`                 | 404    |
| `/api/billing/*`           | 404    |
| `/api/workspace/*/billing` | 404    |

**Conclusion:** No public REST API for usage/billing. All billing functions are server-side only. Extension-tracked estimation is the only viable approach.

### Phase 3: Architecture Pivot

Removed all CLI-dependent code paths:

| Removed                         | Detail                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| `askUsdAmount()`                | Manual dollar input Quick Pick                                          |
| `setManualGoUsageBaseline()`    | Manual baseline setting                                                 |
| Manual baseline Quick Pick item | "Set manual baseline..." option                                         |
| SQLite-first path               | Removed from `getSummary()`, now only calls `buildSummaryFromTracked()` |
| CLI messaging                   | Removed all references to "run CLI first"                               |

**Result:** `getSummary()` now exclusively uses extension-tracked data. SQLite reader `readOpenCodeHistory()` kept as dead code for potential future enrichment.

### Phase 4: Debug Logging

Added diagnostic logging to identify why `record()` might silently skip entries:

**`goUsageTracker.ts` — `record()` method:**

```typescript
// Guard 1: Provider filter
if (!providerDisplayName.toLowerCase().includes("go")) {
  this.log(`[GoUsage] SKIP: provider "${providerDisplayName}" is not Go`);
  return;
}

// Guard 2: Zero tokens
if (promptTokens === 0 && completionTokens === 0) {
  this.log(`[GoUsage] SKIP: zero tokens for model ${modelId}`);
  return;
}
```

**`extension.ts` — `onTransportSummary` callback:**

```typescript
// Log before recording
console.log(`[GoUsage] onTransportSummary: vendor=${vendor}, provider=${providerDisplayName}, model=${modelId}`);

goUsageTracker.record({ ... });
```

**Output channel:** "OpenCode Go Usage" — visible in VS Code Output panel.

### Phase 5: `session.percent` Bug

**Found:** Session percentage calculation used `GO_LIMITS.weekly` ($30) instead of `GO_LIMITS.session` ($12).

**Fix:** Changed denominator to `GO_LIMITS.session` for the 5-hour rolling window percentage.

---

## Resolution

| Change                  | File                | Detail                                                 |
| ----------------------- | ------------------- | ------------------------------------------------------ |
| Removed CLI dependency  | `goUsageTracker.ts` | `getSummary()` → only `buildSummaryFromTracked()`      |
| Removed manual baseline | `extension.ts`      | Deleted `askUsdAmount()`, `setManualGoUsageBaseline()` |
| Added debug logging     | `goUsageTracker.ts` | `record()` guards log skip reasons                     |
| Added debug logging     | `extension.ts`      | `onTransportSummary` logs vendor/provider/model        |
| Fixed session.percent   | `goUsageTracker.ts` | Use `GO_LIMITS.session` not `GO_LIMITS.weekly`         |
| Built test VSIX         | `package.json`      | Temporarily v0.2.1 for testing                         |

## Verification

```bash
# Build test VSIX with debug logging
npx @vscode/vsce package --no-dependencies  # 103 KB VSIX (v0.2.1)
code --install-extension opencode-copilot-chat-0.2.1.vsix --force
```

**Testing approach:**

1. Open Copilot Chat
2. Send a message using a Go model
3. Check Output panel → "OpenCode Go Usage" channel
4. Verify status bar updates after request completes
5. Check `[GoUsage]` log lines for skip reasons

---

## Lessons Learned

1. **No external dependency for billing** — OpenCode has no public billing API. Extension-tracked estimation is the only option.
2. **Guard clauses are silent by default** — Adding logging to `record()` skip conditions makes debugging 10× faster.
3. **CLI requirements alienate VS Code users** — The extension's value is avoiding the CLI. Requiring CLI runs defeats the purpose.
4. **SQLite reader is future enrichment only** — Keep the code but don't depend on it.

---

## Remaining Work

- [ ] Verify status bar updates correctly with debug logging in production
- [ ] Remove dead SQLite reader code if enrichment path is abandoned
- [ ] Consider adding `onDidChangeConfiguration` to reset tracker if pricing changes
- [ ] Revert v0.2.1 test version → proper version bump
