**Status:** ✅ Solved

# Agents Window Model Visibility — OpenCode Models in Copilot CLI Picker

**Topic:** models / vscode / agents-window
**Updated:** 2026-06-15
**Tags:** #models #vscode #agents-window #targetChatSessionType #marketplace #copilotcli
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11)
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#41](https://github.com/ltmoerdani/opencode-copilot-chat/issues/41) (duplication regression)
**GitHub PR:** [#39](https://github.com/ltmoerdani/opencode-copilot-chat/pull/39) (by [@Marinski](https://github.com/Marinski)) — initial implementation
**GitHub PR:** [#42](https://github.com/ltmoerdani/opencode-copilot-chat/pull/42) (by [@Marinski](https://github.com/Marinski)) — opt-in gate fix
**GitHub PR:** Alternative by [@Wallacy](https://github.com/Wallacy) — separate vendor approach (this document)
**Related Research:** [`docs/references/01-20260611-agents-window-model-visibility.md`](../references/01-20260611-agents-window-model-visibility.md)

---

## Overview

OpenCode Go and OpenCode Zen models now appear in the VS Code **Agents window** model picker when starting a Copilot CLI / Background agent session. Previously they were only visible in the regular Chat view.

GitHub Issue #11 requested this feature. The full research investigation (3 options evaluated, VS Code source code analysis) is documented in [`docs/references/01-20260611-agents-window-model-visibility.md`](../references/01-20260611-agents-window-model-visibility.md).

This document covers two implementation approaches:

1. **PR #39** (original) — double registration with `::agent-host` suffix under the same vendor
2. **Alternative** — separate vendor IDs for agent models (cleaner Manage panel UX)

---

## Problem

VS Code has two chat surfaces with **separate** model pickers:

| Surface                             | Session Type | Picker Filter                                                |
| ----------------------------------- | ------------ | ------------------------------------------------------------ |
| **Chat View**                       | `local`      | Shows models WITHOUT `targetChatSessionType`                 |
| **Agents Window** (Copilot CLI tab) | `copilotcli` | Shows ONLY models WITH `targetChatSessionType: "copilotcli"` |

Models registered via `vscode.lm.registerLanguageModelChatProvider()` without `targetChatSessionType` were completely absent from the Agents window. The root cause: VS Code's `filterModelsForSession()` excludes models without a matching `targetChatSessionType` whenever **any** model targets that session type (Copilot's built-in models do).

### The Duplication Bug (Issue #41)

PR #39's approach registered each model **twice** under the same vendor. While `filterModelsForSession()` correctly partitions them in the Chat view and Agents window pickers, the **Language Models management UI** (BYOK enable/disable list) enumerates the raw registration list with no session filter — so both variants appeared there, showing every model twice with a `::agent-host` suffix.

---

## Approach 1: Double Registration (PR #39 / #42)

Register each model **twice** from `provideLanguageModelChatInformation()`, using `flatMap`:

| Variant       | `id`                                       | `targetChatSessionType` | Visible in                          |
| ------------- | ------------------------------------------ | ----------------------- | ----------------------------------- |
| General       | `opencodego:deepseek-v4-flash`             | _(none)_                | Chat view                           |
| Agents-window | `opencodego:deepseek-v4-flash::agent-host` | `"copilotcli"`          | Agents window > Copilot CLI session |

**Fix for #41 (PR #42):** Gated the `::agent-host` duplicate behind `opencodego.showInAgentsWindow` (default `false`). When enabled, the duplicate gets an `(Agents)` name suffix.

**Trade-off:** Users must explicitly enable the setting, and when enabled, the Manage panel still shows both variants.

---

## Approach 2: Separate Vendor IDs (Alternative)

Register agent models under **dedicated vendor IDs** (`opencodego-agent`, `opencodezen-agent`) so each vendor group shows only its variant in the Manage panel.

| Vendor              | Models                                                    | Visible in                                      |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `opencodego`        | General models                                            | Chat view, Manage panel                         |
| `opencodego-agent`  | Agent-only models (`targetChatSessionType: "copilotcli"`) | Agents window, Manage panel (hidden by default) |
| `opencodezen`       | General models                                            | Chat view, Manage panel                         |
| `opencodezen-agent` | Agent-only models (`targetChatSessionType: "copilotcli"`) | Agents window, Manage panel (hidden by default) |

### Why This Is Cleaner

- **No duplication anywhere** — each vendor shows exactly its models
- **Manage panel is clean** — agent vendors are hidden by default via `when` clause (`opencodego.showAgentModelsInManagePanel`, default `false`)
- **Agent models still work** — `agentsWindow` (default `true`) registers the providers at runtime
- **Independent controls** — `agentsWindow` controls registration, `showAgentModelsInManagePanel` controls Manage panel visibility

### Configuration

| Setting                                   | Default | Purpose                             |
| ----------------------------------------- | ------- | ----------------------------------- |
| `opencodego.agentsWindow`                 | `true`  | Register agent providers at runtime |
| `opencodego.showAgentModelsInManagePanel` | `false` | Show agent vendors in Manage panel  |

### Key Implementation Details

- `resolveBaseVendor()` in `providerTypes.ts` maps agent vendors back to base for routing/metadata
- `providerVariant()` helper creates agent definitions from base (DRY)
- BYOK key sync: main provider stores key via `context.secrets.store()`, then calls `agentProvider.triggerChange()`
- Agent variant reads key from `context.secrets.get(SECRET_KEY)`

---

## `targetChatSessionType` Value

The correct value is `"copilotcli"` — the `type` field from the Copilot extension's `chatSessions` contribution in its `package.json`:

```json
{ "type": "copilotcli", "requiresCustomModels": true, ... }
```

> **Note:** Earlier research (Issue #11) tested `"agent-host-copilotcli"` (the VS Code internal resource URI scheme), which is different and does not work. The working value is the bare `"copilotcli"`.

---

## Required User Setting

The Agents window does **not** activate third-party extensions by default. Users must opt in via VS Code `settings.json`:

```json
"extensions.supportAgentsWindow": {
    "ltmoerdani.opencode-copilot-chat": true
}
```

Without this setting, the extension will not load in the Agents window process and no OpenCode models will appear in the picker, regardless of the `targetChatSessionType` registration.

---

## Files Changed (Approach 2)

| File                   | Change                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `package.json`         | Added `agentsWindow` and `showAgentModelsInManagePanel` configs; declared agent vendors with `when` clause |
| `src/extension.ts`     | DRY provider definitions via `providerVariant()`; agent registration; BYOK key sync; `baseVendor` getter   |
| `src/providerTypes.ts` | Agent vendor constants, `AllProviderVendor` type, `resolveBaseVendor()` helper                             |
| `src/routing.ts`       | Uses `resolveBaseVendor()` before vendor comparisons                                                       |
| `src/metadata.ts`      | Widened `toEffectiveModelId` vendor parameter                                                              |

No `enabledApiProposals` needed — `targetChatSessionType` is **stable API**.

```typescript
return models.flatMap((modelId) => {
  // ... metadata, routing, limits resolution ...
  const effectiveModelId = toEffectiveModelId(modelId, this.definition.vendor);
  const agentHostModelId = `${effectiveModelId}::agent-host`;
  // ...
  this.apiKeysByModelId.set(modelId, apiKey);
  this.apiKeysByModelId.set(effectiveModelId, apiKey);
  this.apiKeysByModelId.set(agentHostModelId, apiKey);

  const sharedFields: Omit<OpenCodeModel, "id" | "targetChatSessionType"> = {
    rawModelId: modelId,
    name: `${this.definition.modelNamePrefix} / ${formatModelName(modelId)}`,
    // ... all shared fields (family, version, maxInputTokens, capabilities, etc.)
  };

  // General variant — no targetChatSessionType → visible in Chat view
  const info: OpenCodeModel = { ...sharedFields, id: effectiveModelId };

  // Agents-window variant — targetChatSessionType matches Copilot CLI session
  const agentHostInfo: OpenCodeModel = {
    ...sharedFields,
    id: agentHostModelId,
    targetChatSessionType: "copilotcli",
  };

  return [info, agentHostInfo];
});
```

---

## Verification (PR #39, 2026-06-14)

| Check                | Result                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `tsc` compile        | ✅ 0 errors                                                                                    |
| VSIX build + install | ✅ Models appear in Agents window (Copilot CLI session) model picker                           |
| Chat view picker     | ✅ Each model shows exactly once (no `::agent-host` entries)                                   |
| Routing chain        | ✅ `::agent-host` suffix stripped by `resolveRawModelId()`; API key + model resolution correct |
| Marketplace safety   | ✅ No `enabledApiProposals` needed                                                             |
| `vsce ls`            | ✅ Manifest valid, publishable                                                                 |

### Known Minor Issue (non-blocking)

`showDiagnostics()` calls `vscode.lm.selectChatModels({ vendor })`, which now returns both variants. Since `resolveRawModelId()` strips `::agent-host`, both resolve to the same `rawModelId` → diagnostics output lists each model twice. This is purely cosmetic in the diagnostics view and can be addressed separately by filtering out `model.id.includes("::agent-host")` in `showDiagnostics()`.

---

## Timeline

| #   | Date       | Event                                                                                                                                       |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-06-11 | Research session — 3 options evaluated, Option A recommended ([reference doc](../references/01-20260611-agents-window-model-visibility.md)) |
| 2   | 2026-06-11 | Issue #11 opened with detailed VS Code source code analysis                                                                                 |
| 3   | 2026-06-13 | Reference doc completed; Option A documented for implementation                                                                             |
| 4   | 2026-06-14 | PR #39 opened by @Marinski — implemented Option A with `flatMap` + `targetChatSessionType: "copilotcli"`                                    |
| 5   | 2026-06-14 | Local verification: compile + VSIX install + Agents window test — all PASS                                                                  |
| 6   | 2026-06-14 | PR #39 merged (merge commit) to main                                                                                                        |

---

## Lessons Learned

1. **`targetChatSessionType` is stable API** — no `enabledApiProposals` needed, fully marketplace-compatible. This is the only hook into the Agents window model picker without proposed APIs.
2. **Model duplication is the standard pattern** — Copilot's own built-in models do the same (registered with `targetChatSessionType: "copilotcli"`, invisible in Chat view). VS Code's filter logic cleanly partitions variants per surface.
3. **`extensions.supportAgentsWindow` is a prerequisite** — the Agents window runs extensions in a separate process that must be explicitly enabled per-extension. Easy to miss during testing.
4. **The bare session type value works, not the resource scheme** — `"copilotcli"` (from `SessionType.CopilotCLI`) is correct; `"agent-host-copilotcli"` (the resource URI scheme) is not.

---

_Implemented by @Marinski in PR [#39](https://github.com/ltmoerdani/opencode-copilot-chat/pull/39). Resolves Issue [#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11)._
