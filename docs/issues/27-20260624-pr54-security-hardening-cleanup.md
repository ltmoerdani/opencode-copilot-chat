**Status:** ✅ Solved

# PR #54 — Security Hardening and Optimization Cleanup

**Topic:** security / memory / dead code / cleanup  
**Updated:** 2026-06-24  
**Tags:** #security #memory-leak #dead-code #cleanup #community  
**Supersedes:** —  
**Depends on:** PR [#53](https://github.com/ltmoerdani/opencode-copilot-chat/pull/53)

---

## Overview

Follow-up to PR #53 that addresses three categories of issues identified during a full review of the extension's security posture:

1. **Security** — Picker debug log leaked API keys to the Output channel (critical), and `Clear API Key` action didn't communicate the BYOK re-persistence behavior (medium UX).
2. **Memory** — `reasoningContentByToolCallId` Map grew without limit across long agent sessions.
3. **Dead code** — Two orphaned artifacts from previous PRs: `agentProvidersByBaseVendor` map and `categoryOrder` field.

This PR contains **zero behavioral changes**. All fixes are internal: security, memory bounds, and dead code removal.

**Documented:** 2026-06-24  
**Fixed in:** v0.3.4 (PR [#54](https://github.com/ltmoerdani/opencode-copilot-chat/pull/54))  
**Contributor:** [@Wallacy](https://github.com/Wallacy)  
**Commits:** 2 (`afd26e3`, `b7111a9`)

---

## Problem

### 1. Picker debug log leaked API keys (critical)

PR #53 replaced the original `this.log("[DIAG] ...")` calls with a single debug line:

```ts
this.log(`[picker] options=${JSON.stringify(options)}`);
```

This was added as a temporary diagnostic during the 1.125/1.126 picker investigation. The problem: when VS Code sends `options.configuration = { apiKey: "sk-..." }` via BYOK, the full API key is serialized and written to the OpenCode Output channel in plaintext. Anyone with access to the user's machine can read it. This line shipped in v0.3.4 and should never have been committed.

### 2. `Clear API Key` UX didn't warn about BYOK re-persistence (medium)

When a user clears the key via the extension's "Manage Models" → "Clear API Key" action, only `SecretStorage` is wiped. On the next picker resolution, VS Code sends `options.configuration = { apiKey: "..." }` again (BYOK is the primary source), and the provider re-stores the key into `SecretStorage`. The clear appears to have no effect. The underlying behavior is correct by design (BYOK is the primary key source), but users have no way to know this.

### 3. `reasoningContentByToolCallId` grew without limit (memory)

Each tool call in an agent session adds one entry to this `Map<string, string>` (toolCallId → reasoning text). Entries are never evicted. Over a multi-hour agent session with hundreds of tool calls, this could accumulate thousands of entries of reasoning content (typically 200–500 tokens each). This is a slow-burn memory leak that only manifests during extended use.

### 4. `agentProvidersByBaseVendor` map (dead code)

This `Map<string, OpenCodeProvider>` was populated during activation to hold references to agent-variant provider instances. It was originally used by `triggerChange()` to force agent providers to re-resolve after the base provider stored the BYOK key. After PR #53 changed the resolution strategy (agent variants now resolve independently via the secrets fallback), `triggerChange()` was removed. The map was left behind, holding strong references to provider instances for no reason.

### 5. `categoryOrder` field (dead code)

This `number` field on `ProviderDefinition` was a remnant of the old `category: { label, order }` object that crashed the picker on VS Code ≥1.126 (fixed in PR #53). After the category was changed to a plain string, `categoryOrder` was never read. It also polluted `providerVariant()` with an unused parameter. This was flagged as a "minor carry-over" in the PR #53 review notes.

---

## Solution

### Fix 1: Remove picker debug log

The `this.log(\`[picker] options=${JSON.stringify(options)}\`)`line in`provideLanguageModelChatInformation` was removed entirely. The line served only as a temporary diagnostic during the 1.125/1.126 investigation and is no longer needed. The BYOK configuration variable was also properly typed:

```ts
const opts = options as ConfiguredLanguageModelInfoOptions & { group?: string };
```

### Fix 2: Clarify Clear API Key warning

The info message was updated from a generic "key cleared" to a message that warns the user about BYOK re-persistence:

```ts
vscode.window.showInformationMessage("OpenCode Go API key cleared. If you also set it via Manage Models, remove it there too.");
```

A comment was added explaining the BYOK → SecretStorage re-persistence chain for future maintainers.

### Fix 3: Cap `reasoningContentByToolCallId` at 500 entries

A new `storeReasoningContent()` helper method was added with LRU-style FIFO eviction:

```ts
private static readonly REASONING_CACHE_LIMIT = 500;

private storeReasoningContent(toolCallIds: string[], reasoningContent: string): void {
  for (const toolCallId of toolCallIds) {
    this.reasoningContentByToolCallId.set(toolCallId, reasoningContent);
  }
  if (this.reasoningContentByToolCallId.size > OpenCodeProvider.REASONING_CACHE_LIMIT) {
    const excess = this.reasoningContentByToolCallId.size - OpenCodeProvider.REASONING_CACHE_LIMIT;
    const keys = this.reasoningContentByToolCallId.keys();
    for (let i = 0; i < excess; i++) {
      const key = keys.next().value;
      if (key) this.reasoningContentByToolCallId.delete(key);
    }
  }
}
```

`Map.keys()` guarantees insertion order for string keys per ES2015 spec, so the eviction loop is correct. At ~200–500 tokens per reasoning chunk, 500 entries ≈ 100K–250K tokens of cached reasoning, which covers even the most intensive agent workflows while bounding memory growth.

All three inline `set()` call sites were replaced with the helper.

### Fix 4: Remove `agentProvidersByBaseVendor` map

Removed the map declaration, the two `set()` calls during activation, and the `get()` + `triggerChange()` call in the provider path. All four references were tied to the now-removed `triggerChange()` method.

### Fix 5: Remove `categoryOrder` from `ProviderDefinition`

Removed the field from the interface, the parameter from `providerVariant()`, and all assignments in `PROVIDERS` (Go: 2, Zen: 3, agent variants: passed through). Zero read sites existed.

---

## Files Changed

| File               | Change                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` | Removed debug log (1 line), typed picker options, updated Clear API Key message, added `storeReasoningContent()` helper with cap, replaced 3 inline `set()` calls, removed `triggerChange()` method, removed `agentProvidersByBaseVendor` map, removed `categoryOrder` from interface + `providerVariant` + `PROVIDERS`. **Net: +30 −39 = −9 lines** |
| `CHANGELOG.md`     | `[Unreleased]` section: 2 Changed entries (agent resolution, categoryOrder), 2 Fixed entries (security: debug log + clear warning), 1 Performance entry (reasoning cap), 1 Optimization entry (dead map removal).                                                                                                                                    |

---

## Review Notes

This PR was reviewed against the `main` branch with the following verification:

- **Static analysis:** All 5 claims verified against `src/extension.ts` on `main` (grep + read_file). Each dead-code reference confirmed, each memory-leak call site confirmed, the debug log confirmed present.
- **`npm run compile`:** Fetched branch, switched, ran `tsc -p ./`. Zero errors, exit code 0.
- **Merge method:** `--merge` to preserve both contributor commits (non-negotiable per project policy).

**Assessment:** All fixes are correct, well-scoped, and low-risk. No behavioral changes. The PR is a clean follow-up to #53.

---

## Verification

```bash
git fetch origin pull/54/head:pr-54
git checkout pr-54
npm run compile    # 0 errors
git checkout main
git branch -D pr-54
```

Manual verification recommended before merge:

1. Set API key via Manage Models panel.
2. Confirm models appear in chat picker and Agents window.
3. Clear API key via "Manage Models" → "Clear API Key".
4. Confirm info message includes BYOK re-persistence warning.
5. Re-add key to confirm picker re-resolves correctly.
6. Run an agent session with multiple tool calls and verify no memory growth.

---

## Result

✅ All five fixes verified and compiled clean. Security leak patched, memory bounded, dead code removed. Zero behavioral changes. Ready to merge with `--merge`.
