**Status:** ✅ Solved

# PR #42 / PR #43 — Duplicate Agent-Host Model Fix (Issue #41)

**Topic:** models / vscode / agents-window / byok / routing  
**Updated:** 2026-06-15  
**Tags:** #models #agents-window #byok #duplicate #routing #vendor #community-pr  
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#41](https://github.com/ltmoerdani/opencode-copilot-chat/issues/41)  
**GitHub PR:** [#42](https://github.com/ltmoerdani/opencode-copilot-chat/pull/42) (by [@Marinski](https://github.com/Marinski)) — opt-in gate hotfix  
**GitHub PR:** [#43](https://github.com/ltmoerdani/opencode-copilot-chat/pull/43) (by [@Wallacy](https://github.com/Wallacy)) — separate vendor IDs (final solution)  
**Related Feature Doc:** [`docs/features/06-20260614-agents-window-model-visibility.md`](../features/06-20260614-agents-window-model-visibility.md)  
**Supersedes:** PR #42 (`showInAgentsWindow` setting replaced by `agentsWindow` + `showAgentModelsInManagePanel`)

---

## Overview

PR #39 introduced Agents Window support by registering each model twice (general variant + `::agent-host` variant with `targetChatSessionType: "copilotcli"`) under the same vendor. While `filterModelsForSession()` correctly partitions the two variants in the Chat view and Agents window pickers, the **Language Models management UI** (BYOK enable/disable list) enumerates the raw registration list with no session filter — so every model appeared twice there. Issue #41 reported this regression. Two competing hotfixes were proposed; PR #43 (separate vendor IDs) was adopted for v0.3.2.

---

## Problem

### Duplication in the Manage Language Models panel

Each model appeared as two entries in the VS Code Manage Language Models UI:

```
opencodego:qwen3.7-max::session-2026-05-21-b
opencodego:qwen3.7-max::session-2026-05-21-b::agent-host
```

- **Chat view picker:** Shows only general variant (correct)
- **Agents window picker:** Shows only agent-host variant (correct)
- **Manage Language Models panel:** Shows **both** — this is the bug

The VS Code Manage panel has no session filtering and lists all raw registrations for a vendor.

### Impact

- Every model appeared twice in the Manage panel
- Duplicate entries caused confusion for users managing their BYOK API keys
- Agent-host variants leaked a `::agent-host` suffix visible in the panel (confusing for end users)

### Reporter

[@hu3bi](https://github.com/hu3bi) — Issue #41, opened 2026-06-15

---

## Solution 1: Opt-in Gate (PR #42 by @Marinski)

### Approach

Gate the `::agent-host` duplicate behind a new boolean setting `opencodego.showInAgentsWindow` (default `false`). When disabled (default), only the general variant is registered — each model appears exactly once everywhere, restoring pre-#39 behavior. When enabled, the agent-host variant is also registered with an `(Agents)` name suffix for visual distinction.

### Settings

| Setting                         | Default | Effect                                                                                  |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `opencodego.showInAgentsWindow` | `false` | When `true`, also registers the `::agent-host` variant; `(Agents)` suffix added to name |

### Files Changed (PR #42)

| File               | Change                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/extension.ts` | Read `showInAgentsWindow`; return `[info]` by default, `[info, agentHostInfo]` when opted in; add `(Agents)` name suffix |
| `package.json`     | Add `opencodego.showInAgentsWindow` boolean setting (default `false`)                                                    |

### Trade-off

- Agent models disabled by default → users who rely on Agents window (from v0.3.0) must manually enable the setting after upgrade
- When enabled, the Manage panel still shows both variants (duplication returns if opted in)
- `showInAgentsWindow: true` users see both entries in the Manage panel — confusing if user doesn't understand why

### Merged

PR #42 merged to main on 2026-06-15 (merge commit). Included in **v0.3.1** release.

---

## Solution 2: Separate Vendor IDs (PR #43 by @Wallacy — Final Solution)

### Approach

Register agent models under **dedicated vendor IDs** (`opencodego-agent`, `opencodezen-agent`) so each vendor group shows only its models. Eliminates duplication entirely across all surfaces.

### Vendor Architecture

| Vendor              | Models                                                    | Visible in                                      |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `opencodego`        | General models                                            | Chat view, Manage panel                         |
| `opencodego-agent`  | Agent-only models (`targetChatSessionType: "copilotcli"`) | Agents window, Manage panel (hidden by default) |
| `opencodezen`       | General models                                            | Chat view, Manage panel                         |
| `opencodezen-agent` | Agent-only models (`targetChatSessionType: "copilotcli"`) | Agents window, Manage panel (hidden by default) |

### Settings (replaces `showInAgentsWindow`)

| Setting                                   | Default | Purpose                                                                           |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `opencodego.agentsWindow`                 | `true`  | Register agent providers at runtime (controls whether Agents window works at all) |
| `opencodego.showAgentModelsInManagePanel` | `false` | Show agent vendors in the Manage Language Models panel                            |

Two independent controls: `agentsWindow` controls registration (whether agent models work), `showAgentModelsInManagePanel` controls UI visibility in the Manage panel.

### Key Implementation Details

#### `resolveBaseVendor()` in `providerTypes.ts`

Maps agent vendor IDs back to base vendor for routing and metadata lookups:

```typescript
export function resolveBaseVendor(vendor: AllProviderVendor): ProviderVendor {
  return vendor === AGENT_GO_VENDOR ? GO_VENDOR : vendor === AGENT_ZEN_VENDOR ? ZEN_VENDOR : (vendor as ProviderVendor);
}
```

#### `routing.ts` vendor comparison fix

All vendor comparisons in `resolveModelRouting()` now use `resolveBaseVendor()` before comparing:

```typescript
const baseVendor = resolveBaseVendor(provider.vendor);
if (baseVendor === ZEN_VENDOR && /^gpt-/i.test(modelId)) { ... }
if (baseVendor === GO_VENDOR && /^minimax-m2\./i.test(modelId)) { ... }
if (baseVendor === ZEN_VENDOR && /^gemini-/i.test(modelId)) { ... }
```

Without this, agent vendors would not match any routing rule → all requests would fall through to `chat-completions` → broken.

#### BYOK Key Sync (Cross-Provider Secret Sharing)

When a user sets an API key for `opencodego` in the Manage panel:

1. Main provider stores key via `context.secrets.store(SECRET_KEY, apiKey)`
2. Main provider calls `agentProvider.triggerChange()` to force re-resolution
3. Agent variant reads key from `context.secrets.get(SECRET_KEY)`

This is a **new mechanism** in the codebase — previously all providers read keys from their own vendor's secret storage.

#### `providerVariant()` DRY Helper (extension.ts)

Creates agent provider definitions from base definitions to avoid duplicate data:

```typescript
function providerVariant(base: OpenCodeProviderDefinition, agentVendor: AllProviderVendor): OpenCodeProviderDefinition;
```

### Why This Is Cleaner Than PR #42

1. **Zero duplication** — each vendor shows exactly its models, in every UI surface
2. **Agent models on by default** — `agentsWindow: true` means agents work out of the box (no manual opt-in required)
3. **Manage panel clean by default** — agent vendors hidden via `when` clause (`"config.opencodego.showAgentModelsInManagePanel"`), not visible unless explicitly enabled
4. **Independent controls** — registration vs. visibility are separate concerns
5. **No name suffixes needed** — no `(Agents)` hack since models aren't in the same vendor group

### Migration from v0.3.1

Users who set `opencodego.showInAgentsWindow: true` in v0.3.1:

- **Remove** the `showInAgentsWindow` setting (it no longer exists)
- Agent models are **on by default** — no action required for basic usage
- To see agent vendors in Manage panel, set `showAgentModelsInManagePanel: true`

### Files Changed (PR #43)

| File                                                          | Change                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                | Added `agentsWindow` and `showAgentModelsInManagePanel` configs; declared agent vendors (`opencodego-agent`, `opencodezen-agent`) with `when` clause |
| `src/extension.ts`                                            | DRY provider definitions via `providerVariant()`; agent registration; BYOK key sync via `context.secrets` + `triggerChange()`; `baseVendor` getter   |
| `src/providerTypes.ts`                                        | Agent vendor constants (`AGENT_GO_VENDOR`, `AGENT_ZEN_VENDOR`); `AllProviderVendor` type; `resolveBaseVendor()` helper                               |
| `src/routing.ts`                                              | Uses `resolveBaseVendor()` before all vendor comparisons in `resolveModelRouting()`                                                                  |
| `src/metadata.ts`                                             | Widened `toEffectiveModelId` vendor parameter from `ProviderVendor` to `AllProviderVendor`                                                           |
| `docs/features/06-20260614-agents-window-model-visibility.md` | Updated to document both approaches                                                                                                                  |
| `README.md`                                                   | Updated Agents Window section with new settings                                                                                                      |
| `CHANGELOG.md`                                                | Added v0.3.2 section                                                                                                                                 |

**Lines changed:** +273 / −169 across 8 files.

### Merged

PR #43 merged to main on 2026-06-15 (merge commit, all Wallacy commits preserved). Included in **v0.3.2** release.

---

## Known Open Issues (vs Code Side)

Two additional bugs were reported by [@hu3bi](https://github.com/hu3bi) in the Issue #41 thread:

1. **Disabled models still show up twice** in the Agents window — even after PR #43
2. **Disabling models has no effect** for the Agents window Copilot CLI / local window

These appear to be **VS Code Agents window bugs** (the Agents window does not respect BYOK enable/disable state the same way the Manage panel does), not bugs in this extension. Tracked as potential follow-up if VS Code fixes the BYOK filter in Agents window.

---

## Behavioral Matrix After PR #43

| Setting                                                     | Chat View Picker    | Agents Window Picker  | Manage Panel                                |
| ----------------------------------------------------------- | ------------------- | --------------------- | ------------------------------------------- |
| `agentsWindow: true` (default)                              | General models only | Agent models visible  | General vendors only (agent vendors hidden) |
| `agentsWindow: true` + `showAgentModelsInManagePanel: true` | General models only | Agent models visible  | General + agent vendors visible             |
| `agentsWindow: false`                                       | General models only | ❌ No OpenCode models | General vendors only                        |

---

## Verification Results

| Check                                                  | Result                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `npm run compile`                                      | ✅ 0 errors                                                                   |
| VSIX build + install                                   | ✅ `ltmoerdani.opencode-copilot-chat@0.3.2`                                   |
| Chat view model picker                                 | ✅ Each model appears exactly once (no duplication)                           |
| Manage Language Models panel                           | ✅ Only `opencodego` + `opencodezen` visible by default (no `-agent` vendors) |
| Manage panel with `showAgentModelsInManagePanel: true` | ✅ Agent vendors visible alongside general vendors                            |
| Routing: GPT (Zen)                                     | ✅ `responses` API                                                            |
| Routing: Claude                                        | ✅ `messages` API                                                             |
| Routing: Gemini (Zen)                                  | ✅ `google` API                                                               |
| Routing: Qwen3.7-max                                   | ✅ `messages` API                                                             |
| Routing: MiniMax                                       | ✅ `chat-completions` API                                                     |
| BYOK key sync                                          | ✅ API key set on main provider syncs to agent provider via `triggerChange()` |
| Agents window (Copilot CLI)                            | ✅ Agent models appear in picker                                              |
| Marketplace safety                                     | ✅ No `enabledApiProposals` needed (`targetChatSessionType` is stable API)    |

---

## Timeline

| #   | Date       | Event                                                                                                                |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-06-14 | PR #39 merged — Agents Window support with `flatMap` double registration (regression: model duplication)             |
| 2   | 2026-06-15 | Issue #41 opened by @hu3bi — models shown twice in Manage panel                                                      |
| 3   | 2026-06-15 | PR #42 opened by @Marinski — opt-in gate fix (`showInAgentsWindow: false` default)                                   |
| 4   | 2026-06-15 | PR #42 merged to main → shipped in v0.3.1                                                                            |
| 5   | 2026-06-15 | PR #43 opened by @Wallacy — alternative: separate vendor IDs (no duplication at all)                                 |
| 6   | 2026-06-15 | PR #43 merged to main → shipped in v0.3.2                                                                            |
| 7   | 2026-06-15 | Issue #41 comment by @hu3bi: disabled models still show twice in Agents window (VS Code-side bug, not extension bug) |

---

## Lessons Learned

1. **VS Code Manage panel has no session filter** — `filterModelsForSession()` works in Chat view and Agents window pickers, but the Manage Language Models panel enumerates raw registrations. Any model registered twice under the same vendor will show as duplicated there.
2. **Separate vendor IDs > double registration** — for BYOK extensions, registering variants under separate vendors is cleaner than duplicating under the same vendor. Each vendor gets its own section in the Manage panel with independent visibility control.
3. **BYOK key sync across providers requires a new mechanism** — the existing `apiKeysByModelId` map is per-provider. Cross-provider key sync needs explicit secret storage + `triggerChange()`. This pattern should be reused for any future multi-vendor scenarios.
4. **Default `true` for agent models is the right call** — user feedback from @hu3bi and @Wallacy confirmed that most users who discover the Agents window expect OpenCode models to be available without manual configuration.
5. **VS Code Agents window does not fully respect BYOK enable/disable state** — the two remaining bugs (disabled models still show / disabling has no effect) appear to be VS Code-side issues affecting all BYOK providers, not just this extension.

---

_Resolved by @Marinski (PR [#42](https://github.com/ltmoerdani/opencode-copilot-chat/pull/42), hotfix) and @Wallacy (PR [#43](https://github.com/ltmoerdani/opencode-copilot-chat/pull/43), final solution). Issue [#41](https://github.com/ltmoerdani/opencode-copilot-chat/issues/41) reported by @hu3bi._
