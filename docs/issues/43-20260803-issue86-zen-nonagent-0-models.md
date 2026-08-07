# Issue #43 — Non-agent OpenCode Zen returns 0 models (API key via extension command)

**Date:** 2026-08-03
**Status:** ✅ Resolved
**Related:** GitHub Issue [#86](https://github.com/ltmoerdani/opencode-copilot-chat/issues/86)
**Reporter:** [@Witchcraft2k](https://github.com/Witchcraft2k)
**Extension version affected:** 0.4.3
**Fixed in:** 0.4.6 (unreleased)

## Problem

When the OpenCode Zen API key is stored via the extension's own command (`OpenCode Go: Set API Key`) — rather than through VS Code's native Language Models → Add Models BYOK flow — the non-agent `opencodezen` provider returns **0 models** in `vscode.lm.selectChatModels({ vendor: "opencodezen" })`. The Zen free models never appear in the Chat model picker dropdown.

### Symptom matrix (reported)

| Provider                      | Models visible | Expected |
| ----------------------------- | -------------- | -------- |
| `opencodego` (non-agent Go)   | ✅ 23          | 23       |
| `opencodego-agent`            | ✅ 23          | 23       |
| `opencodezen-agent`           | ✅ 7           | 7        |
| `opencodezen` (non-agent Zen) | ❌ **0**       | 7        |

### Steps to reproduce

1. Install the extension.
2. Set the OpenCode API key via the command `OpenCode Go: Set API Key` (NOT via the native VS Code Language Models → Add Models BYOK flow).
3. Run `OpenCode: Model Picker Diagnostics` — observe `vendor: opencodezen` shows `models: 0`.
4. Run `OpenCode Zen: Diagnostics` — observe `Models visible through vscode.lm.selectChatModels({ vendor: "opencodezen" }): 0`.

## Root Cause (Evidence-Based)

### Location

`src/extension.ts`, `OpenCodeLMChatProvider.provideLanguageModelChatInformation()` — the API-key fallback guard:

```typescript
// BEFORE FIX
if (!apiKey && (this.definition.isAgentVariant || options.configuration)) {
  apiKey = await this.context.secrets.get(SECRET_KEY);
}

if (!apiKey) {
  return []; // ← Zen non-agent stops here → 0 models
}
```

### Why non-agent Zen returns 0 models

When a user stores the API key via the extension command, the key lives in `context.secrets` (VS Code SecretStorage). VS Code itself has no BYOK data for the provider (no group configured in `language-models.json`). When VS Code calls `provideLanguageModelChatInformation`, it passes `options.configuration = undefined`.

For non-agent providers with `options.configuration = undefined`:

- `!apiKey` = `true` (no BYOK key)
- `isAgentVariant` = `false` (non-agent Zen)
- `options.configuration` = `undefined` (falsy)
- Condition: `true && (false || undefined)` → `undefined` (falsy) → **skips the fallback entirely**
- Proceeds to `if (!apiKey) { return []; }` → **0 models**

Agent variants (`-agent`) always enter the block because `isAgentVariant=true` short-circuits the `||`, so they inherit the persisted key and work normally.

### The previous in-code comment was wrong

The comment block at `extension.ts:1876-1885` (pre-fix) claimed:

> `configuration=undefined → VS Code is still resolving; return [] and let it call again with the real BYOK key`

Investigation against the **official VS Code source** proves this is incorrect. `options.configuration = undefined` is **not** a transient "still resolving" state — it means the provider has no configured BYOK group. VS Code does not retry with a key the user never set up.

## Verification Against VS Code Source (Definitive)

Two pieces of evidence from `microsoft/vscode` confirm the correct pattern.

### 1. Contract for `PrepareLanguageModelChatModelOptions`

`src/vscode-dts/vscode.proposed.chatProvider.d.ts:163-171`:

```typescript
export interface PrepareLanguageModelChatModelOptions {
  /**
   * Configuration for the model. This is only present if the provider
   * has declared that it requires configuration via the `configuration`
   * property. The object adheres to the schema that the extension
   * provided during declaration.
   */
  readonly configuration?: {
    readonly [key: string]: any;
  };
}
```

Reading: `configuration` is present **only** when (a) the provider declared a `configurationSchema` in `package.json` **AND** (b) the user has actually configured a BYOK group. For users who set the key via the extension command only, VS Code correctly passes `undefined` and will never retry with a different value.

### 2. Reference implementation in Copilot's own BYOK provider

`extensions/copilot/src/extension/byok/vscode-node/abstractLanguageModelChatProvider.ts:60-83`:

```typescript
async provideLanguageModelChatInformation(
    { silent, configuration }: PrepareLanguageModelChatModelOptions,
    token: CancellationToken
): Promise<T[]> {
    let apiKey: string | undefined = (configuration as C)?.apiKey;
    if (!apiKey) {
        apiKey = await this.configureDefaultGroupWithApiKeyOnly();  // ← fallback to own storage
    }
    const models = await this.getAllModels(silent, apiKey, configuration as C);
    return models.map(...);
}
```

Copilot's own provider has **no guard** resembling ours. It always falls back to its own storage when `configuration.apiKey` is absent — exactly the behavior the fix restores.

## Fix

`src/extension.ts` — drop the `isAgentVariant || options.configuration` guard so the fallback to SecretStorage is unconditional:

```diff
- if (!apiKey && (this.definition.isAgentVariant || options.configuration)) {
+ if (!apiKey) {
    apiKey = await this.context.secrets.get(SECRET_KEY);
  }

  if (!apiKey) {
    return [];
  }
```

The accompanying comment was rewritten to document the verified lifecycle semantics and reference issue #86.

### Why this is safe (no regression)

| Scenario                                  | `isAgentVariant` | `options.configuration` | `apiKey` after step 1 | After fix                                  |
| ----------------------------------------- | ---------------- | ----------------------- | --------------------- | ------------------------------------------ |
| Non-agent + key set via extension command | false            | undefined               | undefined             | ✅ falls back to secrets                   |
| Non-agent + key set via native BYOK       | false            | `{apiKey:"sk-…"}`       | `"sk-…"`              | ✅ step 1 already set it; fallback skipped |
| Non-agent + empty config (VS Code 1.126+) | false            | `{}`                    | undefined             | ✅ falls back to secrets                   |
| Agent variant (any state)                 | true             | (ignored)               | undefined             | ✅ falls back to secrets                   |
| Non-agent + no key anywhere               | false            | undefined               | undefined             | ✅ returns `[]` (no behavior change)       |

Because step 1 (`getConfiguredApiKey(opts)`) already resolves the BYOK key when present, the new `if (!apiKey)` only fires when BYOK truly has nothing to offer — at which point secret storage is the only remaining source of truth.

## Additional impact: `opencodego` non-agent is also fixed

`opencodego` (non-agent Go) has the same latent bug. If a user sets the Go API key via the extension command and never configures a native BYOK group, Go non-agent would also return 0 models. The fix resolves this case automatically. The reporter did not observe it because they had a Go BYOK group configured, which made `getConfiguredApiKey` succeed in step 1.

## Verification Steps

After applying the fix, verify with the diagnostic commands the reporter used:

**`OpenCode: Model Picker Diagnostics`**

- Before: `vendor: opencodezen` → `models: 0`
- After: `vendor: opencodezen` → `models: N` (N > 0)

**`OpenCode Zen: Diagnostics`**

- Before: `Models visible through vscode.lm.selectChatModels({ vendor: "opencodezen" }): 0`
- After: `... : N`

Compile verification: `npm run compile` → ✅ no errors.

## Files Changed

- `src/extension.ts` — removed the `isAgentVariant || options.configuration` guard; rewrote the comment block with verified lifecycle semantics and an explicit reference to issue #86 and the reference implementation in `microsoft/vscode`.

## References

- GitHub Issue: [#86](https://github.com/ltmoerdani/opencode-copilot-chat/issues/86)
- VS Code proposed API: [`vscode.proposed.chatProvider.d.ts`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatProvider.d.ts) (`PrepareLanguageModelChatModelOptions`)
- Reference BYOK implementation: [`abstractLanguageModelChatProvider.ts`](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/byok/vscode-node/abstractLanguageModelChatProvider.ts)
- Internal research note: `/memories/repo/issue86-zen-non-agent-0-models-research.md`
