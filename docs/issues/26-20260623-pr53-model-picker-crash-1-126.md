**Status:** ✅ Solved

# PR #53 — Model Picker Crash & Duplication on VS Code ≥1.126

**Topic:** models / provider / byok / vscode  
**Updated:** 2026-06-23  
**Tags:** #models #provider #byok #vscode #bugfix #community  
**Supersedes:** —

---

## Overview

VS Code 1.126 shipped a **unified model picker** (internal PR #321026) that changed how `LanguageModelChatProvider` implementations are resolved and displayed. Two regressions hit OpenCode providers on 1.126:

1. **Hard crash** the moment the model picker tried to read OpenCode model metadata.
2. **Duplicate entries** in the picker for every OpenCode model.

The crash blocked all model selection on 1.126. The duplication made the picker unusable even when it did not crash.

This document covers the root cause of both regressions, the two iterations the contributor (@Wallacy) went through, and the final approach that shipped.

**Documented:** 2026-06-23  
**Fixed in:** v0.3.4 (PR [#53](https://github.com/ltmoerdani/opencode-copilot-chat/pull/53))  
**Issue report:** [#51](https://github.com/ltmoerdani/opencode-copilot-chat/issues/51)

---

## Problem

### Crash: `category` type mismatch

The extension declared `category` on each model info object as:

```ts
category: {
  label: this.definition.displayName,
  order: this.definition.categoryOrder
}
```

VS Code's `LanguageModelChatInformation.category` expects a **plain `string`**. On 1.126 the unified picker calls `getCategoryLabel(model.metadata.category)` which internally does `category.charAt(0)`. Calling `.charAt()` on an object throws `TypeError`, killing the picker before it opens.

Verified against the bundled `src/vscode.proposed.chatProvider.d.ts` (provider version 5): the interface does not declare `category` as `{ label, order }`. The only category-adjacent field is `priceCategory?: string`. So the object form was never type-correct to begin with. It simply had not been exercised by a code path that cared about the shape until 1.126.

### Duplication: two-phase resolution on 1.126

VS Code 1.126 resolves models in two phases:

1. **Groupless phase.** All models returned by the provider.
2. **Group-based phase.** Per configured group, for vendors that declare a `configuration` schema.

Because OpenCode declares a `configuration` schema (`apiKey`), every model acquired a second cache identity (`vendor/group/modelId` versus `vendor/modelId`) and appeared twice in the picker.

A second duplication source surfaced during review: the API key fallback. Iteration 1 of the PR made every provider (agent and non-agent alike) fall back to `SecretStorage`. On 1.126 that fallback fired on both resolution phases, doubling the returned model list again.

---

## Solution

### Iteration 1 (abandoned)

The first attempt added three layers of defense:

1. Removed the object-typed `category` field.
2. Added a `group !== undefined` guard to skip the group-based phase.
3. Added a `Set<string>` dedup by `model.id` as a safety net.
4. Made the API key fallback unconditional for all providers.

During self-test the contributor discovered this still duplicated entries on 1.126, specifically because of the unconditional `SecretStorage` fallback. The comment thread on PR #53 (2026-06-22) confirms: _"1.126 still duplicate the entries, because the secret store failback... but whiout it dosent show on the model picker."_

### Iteration 2 (shipped)

The second attempt replaced the three-layer defense with a **single discriminator**: the shape of `options.configuration`.

```ts
let apiKey = getConfiguredApiKey(options);

if (!apiKey && (this.definition.isAgentVariant || options.configuration)) {
  apiKey = await this.context.secrets.get(SECRET_KEY);
}
```

The discriminator maps to four concrete cases:

| `options.configuration` | Provider type     | Behavior                                                                                               |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `undefined`             | Non-agent         | VS Code is still resolving. Return `[]`. VS Code calls again with the real BYOK key.                   |
| `{ apiKey: "sk-..." }`  | Non-agent         | BYOK key resolved by `getConfiguredApiKey`. No fallback needed.                                        |
| `{}` (empty object)     | Non-agent, 1.126+ | 1.126 sends an empty configuration for non-BYOK providers. Fall back to `SecretStorage`.               |
| absent / `undefined`    | Agent variant     | Agent variants never receive BYOK keys (no configuration schema). Always fall back to `SecretStorage`. |

This removed the need for version checks, the `group` guard, the `Set` dedup, and the unconditional fallback. The provider path returns `[]` during the unresolved phase, so VS Code resolves again cleanly without producing duplicate cache keys.

### Cleanup included in iteration 2

| Removed                                                                                   | Reason                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `category` object field from `OpenCodeModel` and the returned model info                  | Type mismatch with `LanguageModelChatInformation`.                                                                     |
| `group !== undefined` guard + explanatory comment                                         | No longer needed; `options.configuration` discriminator handles the same case.                                         |
| `Set<string>` dedup block                                                                 | No longer producing duplicates upstream.                                                                               |
| Eight `this.log("[DIAG] ...")` calls in the provider path                                 | Diagnostic noise from iteration 1. Replaced with a single `this.log(\`[picker] options=${JSON.stringify(options)}\`)`. |
| Sequential `warmModelPickerMetadata` (main vendors, then agent variants)                  | Reverted to the original parallel `Promise.allSettled` pattern.                                                        |
| `onLanguageModelChatProvider:opencodego-agent` and `:opencodezen-agent` activation events | Not needed with the new fallback strategy.                                                                             |

---

## Files Changed

| File               | Change                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` | Removed `category` field; rewrote `provideLanguageModelChatInformation` key resolution with the `options.configuration` discriminator; reverted `warmModelPickerMetadata` to parallel pattern; trimmed DIAG logs. |
| `CHANGELOG.md`     | v0.3.4 Fixed entries for the crash and the 1.126 visibility fix.                                                                                                                                                  |
| `README.md`        | Agents Window section: clarified Local vs Copilot split, `supportAgentsWindow` requirement note.                                                                                                                  |

---

## Review Notes

Two technical questions were raised during review (2026-06-22):

1. **API key fallback behavior change.** Iteration 1 broadened the fallback for non-agent providers, meaning clearing the key via Manage Models would not hide models if a stale key lingered in `secrets`. Iteration 2's discriminator narrows this: the fallback fires only when `options.configuration` is present but empty, or for agent variants. The stale-key edge case is still theoretically present but the blast radius is small enough to ship.
2. **Unconditional `triggerChange()`.** The call to `agentProvider.triggerChange()` after storing the key remains unconditional. With iteration 2 returning `[]` more often during the unresolved phase, the re-resolution cycle risk is reduced. No idempotency guarantee was confirmed, but no cycle was observed in testing.

**Minor carry-over:** `ProviderDefinition.categoryOrder` (interface field, `providerVariant` parameter, and assignments in `PROVIDERS`) is now dead code. Tracked as a follow-up cleanup; not blocking.

---

## Verification

```bash
npm run compile    # 0 errors
```

Manual testing (reported by contributor):

- ✅ VS Code 1.125: chat picker without duplication, Agent Window working.
- ✅ VS Code 1.126 Insiders: chat picker functional, no crash, no duplication.

---

## Result

✅ Both regressions resolved. The `category` field is gone, the unified picker no longer crashes, and the `options.configuration` discriminator prevents duplication without version checks or post-hoc dedup. The solution is smaller than iteration 1 (net code reduction) and handles all four key-resolution paths in one conditional.
