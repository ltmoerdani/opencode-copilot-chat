**Status:** ✅ Solved

# Agents Window Model Visibility — OpenCode Models in VS Code Agents Tab

**Topic:** models / vscode / architecture
**Updated:** 2026-06-14
**Tags:** #models #vscode #agents-window #targetChatSessionType #marketplace #chatSessions
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11)
**Implementation:** [Feature doc 06-20260614](../features/06-20260614-agents-window-model-visibility.md) — shipped in PR [#39](https://github.com/ltmoerdani/opencode-copilot-chat/pull/39) by @Marinski

---

## Overview

Investigation into showing OpenCode Go/Zen models in the VS Code **Agents window** model picker. The Agents window (also known as "Agent Mode" or "Background Agent") has a separate model picker from the regular Chat view. By default, third-party language model providers only appear in the Chat view — they are invisible in the Agents window model picker.

This document captures the full research findings, API constraints, and the marketplace-compatible solution path.

---

## Problem Statement

GitHub Issue #11 requests: _"Show OpenCode models in the VS Code Agents window model picker."_

The user wants OpenCode models to appear when selecting a model in the Agents tab, not just in the Chat view. Additionally, the user initially wanted a dedicated "OpenCode" tab in the Agents window (not appearing under "Copilot CLI").

---

## VS Code Architecture Deep Dive

### How Models Appear in Model Pickers

VS Code has two main chat surfaces:

| Surface                             | Session Type | Model Picker Behavior                                        |
| ----------------------------------- | ------------ | ------------------------------------------------------------ |
| **Chat View**                       | `local`      | Shows all models WITHOUT `targetChatSessionType`             |
| **Agents Window** (Copilot CLI tab) | `copilotcli` | Shows ONLY models WITH `targetChatSessionType: 'copilotcli'` |

### Key Properties

#### `targetChatSessionType` (STABLE API)

- **Location:** `vscode.d.ts` (stable, NOT proposed)
- **Type:** `string | undefined` on `LanguageModelChatInformation`
- **Purpose:** When set, the model only appears in model pickers for the matching session type
- **9 matches** in stable `vscode.d.ts` including `registerLanguageModelChatProvider`
- **No `enabledApiProposals` needed** — fully marketplace-compatible

#### `languageModelChatProviders` (STABLE contribution point)

- Declared in `package.json` under `contributes`
- Our extension uses vendors `opencodego` and `opencodezen`
- Marketplace-compatible

#### `chatSessions` (STABLE contribution, BUT runtime requires proposed API)

- Declared in `package.json` under `contributes.chatSessions`
- Creates a new tab in the Agents window
- **HOWEVER:** The contribution handler in VS Code source code (`chatSessions.contribution.ts` line ~335) has a guard:

```typescript
// From VS Code source: chatSessions.contribution.ts
if (!isProposedApiEnabled(ext.description, "chatSessionsProvider")) {
  continue; // ← Contribution is SKIPPED without proposed API!
}
```

- And `registerChatSessionContentProvider()` requires proposed API `'chatSessionsProvider'`:

```typescript
// From VS Code source: extHost.api.impl.ts line 1730
registerChatSessionContentProvider(scheme, provider, chatParticipant, capabilities) {
    checkProposedApiEnabled(extension, 'chatSessionsProvider');
    ...
}
```

### Model Selection Filtering Logic

From `chatModelSelectionLogic.ts` (VS Code source):

```typescript
export function filterModelsForSession(
  models: ILanguageModelChatMetadataAndIdentifier[],
  sessionType: string | undefined,
  currentModeKind: ChatModeKind,
  location: ChatAgentLocation,
): ILanguageModelChatMetadataAndIdentifier[] {
  if (sessionType && sessionType !== "local" && hasModelsTargetingSession(models, sessionType)) {
    return models.filter((entry) => entry.metadata?.targetChatSessionType === sessionType && entry.metadata?.isUserSelectable !== false);
  }
  return models.filter(
    (entry) =>
      !entry.metadata?.targetChatSessionType &&
      entry.metadata?.isUserSelectable !== false &&
      isModelSupportedForMode(entry, currentModeKind) &&
      isModelSupportedForInlineChat(entry, location),
  );
}
```

**Key insight:** When ANY model targets a session type (e.g., Copilot's models target `'copilotcli'`), then ONLY models with that `targetChatSessionType` appear. Models without `targetChatSessionType` are **excluded**.

### Built-in Session Types

From VS Code `SessionType` namespace:

| Constant           | Value                     | Description                        |
| ------------------ | ------------------------- | ---------------------------------- |
| `CopilotCLI`       | `'copilotcli'`            | Copilot CLI / Background agent tab |
| `CopilotCloud`     | `'copilot-cloud-agent'`   | Cloud agent                        |
| `Local`            | `'local'`                 | Local chat sessions                |
| `ClaudeCode`       | `'claude-code'`           | Claude Code tab                    |
| `Codex`            | `'openai-codex'`          | Codex tab                          |
| `Growth`           | `'copilot-growth'`        | Growth                             |
| `AgentHostCopilot` | `'agent-host-copilotcli'` | Agent Host                         |

### Model Identifier Format

From `extHostLanguageModels.ts`:

```typescript
private toModelIdentifier(vendor: string, group: string | undefined, modelId: string): string {
    return group ? `${vendor}/${group}/${modelId}` : `${vendor}/${modelId}`;
}
```

Example: `opencodego/deepseek-v4-flash`

### Response Routing

Model responses are ALWAYS routed through the provider's `provideLanguageModelChatResponse()` regardless of `targetChatSessionType`. From `extHostLanguageModels.ts` line ~326:

```typescript
value = data.provider.provideLanguageModelChatResponse(knownModel.info, messages, options, progress, token);
```

This means setting `targetChatSessionType` on a model does not affect how the response is handled — it only affects which model picker shows the model.

---

## Options Evaluated

### Option A: Duplicate Models with `targetChatSessionType: 'copilotcli'`

| Aspect              | Detail                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Approach**        | Register each model twice — once without `targetChatSessionType` (Chat view) and once with `targetChatSessionType: 'copilotcli'` (Agents window) |
| **API Requirement** | `targetChatSessionType` is **STABLE API**                                                                                                        |
| **Marketplace**     | ✅ Fully compatible — no `enabledApiProposals` needed                                                                                            |
| **User Experience** | Models appear under existing "Copilot CLI" tab in Agents window                                                                                  |
| **Trade-off**       | Model picker shows twice as many entries (each model has 2 copies)                                                                               |
| **Implementation**  | Modify `provideLanguageModelChatInformation()` in `extension.ts`                                                                                 |

### Option B: Own Chat Session with `chatSessions` contribution

| Aspect              | Detail                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approach**        | Declare `chatSessions` in `package.json` with `type: "opencode-copilot"` and `requiresCustomModels: true`, plus register models with `targetChatSessionType: 'opencode-copilot'` |
| **API Requirement** | `chatSessionsProvider` **proposed API**                                                                                                                                          |
| **Marketplace**     | ❌ **REJECTED** — `vsce publish` blocks `enabledApiProposals`                                                                                                                    |
| **Evidence**        | `wlxms/opencode-copilot` uses this approach but is NOT on Marketplace (HTTP 404 on marketplace URL)                                                                              |
| **Runtime**         | VS Code allows proposed APIs at runtime (`isProposedApiEnabled` check is commented out in `extensions.ts`), but `vsce` blocks at publish time                                    |

### Option C: Distribute as VSIX only (bypass marketplace)

| Aspect           | Detail                                                              |
| ---------------- | ------------------------------------------------------------------- |
| **Approach**     | Use `enabledApiProposals` + `--allow-all-proposed-apis` with `vsce` |
| **Marketplace**  | ❌ Not publishable                                                  |
| **Distribution** | Manual VSIX install only                                            |
| **Verdict**      | Not viable for the project's goal                                   |

---

## Third-Party Reference: `wlxms/opencode-copilot`

The `wlxms/opencode-copilot` extension uses `chatSessions` with proposed API:

```json
// package.json
"enabledApiProposals": ["chatParticipantAdditions", "chatParticipantPrivate", "chatSessionsProvider"],
"contributes": {
    "chatSessions": [{
        "type": "opencode-copilot.opencode",
        "name": "opencode",
        "displayName": "OpenCode",
        "description": "AI coding agent powered by OpenCode",
        "requiresCustomModels": true,
        ...
    }]
}
```

This extension is **NOT on VS Code Marketplace** (verified: HTTP 404 on `https://marketplace.visualstudio.com/items?itemName=wlxms.opencode-copilot`).

---

## Recommended Solution: Option A

### Implementation Plan

1. **In `provideLanguageModelChatInformation()`** (`extension.ts` ~line 1035):
   - For each model, create TWO entries:
     - **Copy 1:** Without `targetChatSessionType` → appears in Chat view (existing behavior preserved)
     - **Copy 2:** With `targetChatSessionType: 'copilotcli'` → appears in Agents window

2. **ID uniqueness:** Duplicate models need unique identifiers
   - Option: Use different `id` (e.g., suffix with `-copilotcli`) or different group prefix
   - The `rawModelId` resolution in `provideLanguageModelChatResponse()` already handles this

3. **No package.json changes needed** — model registration is programmatic

4. **No `enabledApiProposals` needed** — fully marketplace-compatible

### Design Decision: Config Toggle

| Approach                           | Pros                           | Cons                          |
| ---------------------------------- | ------------------------------ | ----------------------------- |
| **Always duplicate**               | Zero config, works immediately | Model picker shows 2× entries |
| **Config toggle (default: true)**  | User can disable if unwanted   | Needs reload window           |
| **Config toggle (default: false)** | Backward compatible            | User must enable manually     |

### Visual Diagram

```
provideLanguageModelChatInformation()
│
├── Model "deepseek-v4-flash"
│   ├── Copy 1: id="deepseek-v4-flash", targetChatSessionType=undefined
│   │   └── → Visible in Chat view (sessionType='local')
│   │
│   └── Copy 2: id="deepseek-v4-flash", targetChatSessionType='copilotcli'
│       └── → Visible in Agents window (sessionType='copilotcli')
│
└── Both copies → same provideLanguageModelChatResponse() handler
```

---

## Files Investigated (VS Code Source)

| File                                                                              | Key Finding                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/vscode-dts/vscode.d.ts`                                                      | `targetChatSessionType` is in STABLE API (9 matches)                                     |
| `src/vs/workbench/api/common/extHostLanguageModels.ts`                            | Model identifier format: `${vendor}/${group}/${modelId}`                                 |
| `src/vs/workbench/api/common/extHost.api.impl.ts`                                 | `registerChatSessionContentProvider` → `checkProposedApiEnabled('chatSessionsProvider')` |
| `src/vs/workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.ts` | `chatSessions` contribution SKIPPED without proposed API                                 |
| `src/vs/workbench/contrib/chat/browser/widget/input/chatModelSelectionLogic.ts`   | `filterModelsForSession()` — targetChatSessionType filtering                             |
| `src/vs/workbench/contrib/chat/common/chatSessionsService.ts`                     | `IChatSessionsExtensionPoint` schema, `SessionType` namespace                            |
| `src/vs/workbench/contrib/chat/browser/agentSessions/agentSessions.ts`            | `AgentSessionProviders` enum — hardcoded built-in providers only                         |
| `extensions/copilot/src/extension/chatSessions/copilotcli/node/copilotCli.ts`     | Copilot CLI sets `targetChatSessionType: 'copilotcli'` on models                         |

---

## Files in Our Extension

| File                                    | Relevance                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/extension.ts`                      | `provideLanguageModelChatInformation()` at ~line 1035 — where models are registered    |
| `src/extension.ts`                      | `OpenCodeModel` interface at ~line 180 — extends `vscode.LanguageModelChatInformation` |
| `src/extension.ts`                      | `provideLanguageModelChatResponse()` — handles streaming for all models                |
| `src/vscode.proposed.chatProvider.d.ts` | Contains `targetChatSessionType?: string` at line 109                                  |
| `src/providerTypes.ts`                  | Exports `GO_VENDOR = "opencodego"` and `ZEN_VENDOR = "opencodezen"`                    |
| `package.json`                          | `languageModelChatProviders` contribution, NO `enabledApiProposals`                    |

---

## Status

- ✅ Research complete — all options evaluated with source code evidence
- ✅ Marketplace compatibility confirmed for Option A
- ✅ **Implemented in PR [#39](https://github.com/ltmoerdani/opencode-copilot-chat/pull/39)** (2026-06-14) by @Marinski — see [feature doc 06-20260614](../features/06-20260614-agents-window-model-visibility.md)
- ❌ Custom session type "opencode-copilot" NOT possible without proposed API

> **Note (2026-06-14, post-implementation):** Option A shipped successfully. Confirmed that the bare value `"copilotcli"` (from `SessionType.CopilotCLI`) is the correct `targetChatSessionType`, NOT `"agent-host-copilotcli"` (the resource URI scheme). The research below initially pointed to `"agent-host-copilotcli"` as the working value — that was incorrect; PR #39 verified `"copilotcli"` is what actually works. An additional prerequisite not covered in the original research: users must set `"extensions.supportAgentsWindow": { "ltmoerdani.opencode-copilot-chat": true }` for the extension to load in the Agents window process.

---

## Lessons Learned

1. **VS Code proposed API bypass is runtime-only** — `isProposedApiEnabled()` returns `true` always at runtime (check is commented out), but `vsce publish` enforces the block at publish time.
2. **`chatSessions` contribution is useless without proposed API** — the handler explicitly skips contributions from extensions without `chatSessionsProvider`.
3. **`targetChatSessionType` is the only marketplace-compatible hook** into the Agents window model picker.
4. **Model duplication is the standard pattern** — Copilot's own models do this (they register with `targetChatSessionType: 'copilotcli'` and are invisible in Chat view).
5. **Agent session providers are hardcoded** — `AgentSessionProviders` enum in VS Code source only includes built-in types; custom types get a generic string fallback for display name only.

---

_Research session: 2026-06-11 | Paired with GitHub Issue [#11](https://github.com/ltmoerdani/opencode-copilot-chat/issues/11)_
