**Status:** ✅ Solved

# Unavailable and Deprecated Model Filtering

**Topic:** models / provider / registry / availability  
**Updated:** 2026-05-16  
**Tags:** #models #provider #routing #vscode #byok #zen #go  
**Supersedes:** —

---

## Overview

This document records the full session that investigated stale OpenCode model entries and implemented filtering so unavailable or deprecated models do not appear in the VS Code Copilot Chat model picker.

The session was backdated to the actual work date from the original chat session: **2026-05-16 Asia/Kuala_Lumpur**.

The immediate failures involved:

- `ring-2.6-1t-free`, which upstream moved out of the free tier
- `trinity-large-preview-free`, which the provider no longer had a serving endpoint for
- `ring-2.6-1t`, which should not be surfaced by this extension when it cannot be accessed through the configured OpenCode catalog

The final approach was not just to delete two strings. The extension now combines:

- live OpenCode `/models` discovery
- cached `models.dev` metadata
- `status: "deprecated"` filtering
- a local safety list for model IDs known to return provider 404s
- cleaned bundled fallback lists

---

## Problem

The model picker could expose models that looked available from the extension's perspective but failed at request time.

The runtime failures were:

```text
OpenCode Go API request failed (400) model=trinity-large-preview-free:
Error from provider: No endpoints found for arcee-ai/trinity-large-preview:free.
```

```text
OpenCode Go API request failed (400) model=ring-2.6-1t-free:
Error from provider: Ring-2.6-1T is no longer available as a free model.
It has transitioned to a paid model.
```

Sensitive request identifiers and upstream user identifiers were intentionally omitted from this document.

---

## Session Timeline

### 1. 2026-05-16 — Initial Request

The user reported that `ring-2.6-1t` and `trinity-large-preview:free` were no longer accessible or no longer free, and asked whether they should be removed from the list.

The key design question was whether the extension could do better than manual removal by automatically detecting deprecated models.

### 2. 2026-05-16 — Codebase Inspection

The model registration flow was traced through the provider implementation:

- `provideLanguageModelChatInformation()` obtains the model list before registering VS Code language models
- `fetchModels()` queries the OpenCode `/models` endpoint
- fallback model lists are used when the live request fails or returns no IDs
- model metadata is resolved from live metadata, cached `models.dev` data, and bundled fallback metadata
- Zen can be filtered to free models via `opencodego.freeOnly`

Relevant files:

- [`src/extension.ts`](../../src/extension.ts)
- [`src/metadata.ts`](../../src/metadata.ts)
- [`src/routing.ts`](../../src/routing.ts)
- [`src/providerTypes.ts`](../../src/providerTypes.ts)

### 3. 2026-05-16 — External Registry Check

The live OpenCode endpoints and `models.dev` registry were checked.

Findings:

| Source                          | Finding                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| OpenCode Go `/zen/go/v1/models` | `ring-2.6-1t` was not returned in the active Go list                                   |
| OpenCode Zen `/zen/v1/models`   | `ring-2.6-1t-free` and `trinity-large-preview-free` could still appear in the catalog  |
| `models.dev/api.json`           | `ring-2.6-1t-free` and `trinity-large-preview-free` were marked `status: "deprecated"` |

The important discovery was that OpenCode `/models` is not a sufficient serving guarantee. A model can still be listed in the catalog while the underlying provider returns a 404 because no endpoint exists or the free tier was withdrawn.

### 4. 2026-05-16 — Runtime Error Context Added

The user supplied the actual Copilot failure details. The errors showed that:

- `trinity-large-preview-free` mapped to an upstream `arcee-ai/trinity-large-preview:free` provider route with no endpoint
- `ring-2.6-1t-free` mapped to a provider route that explicitly said the model was no longer free
- the OpenCode gateway wrapped provider 404s as HTTP 400 responses
- the local error message could misleadingly say `OpenCode Go API request failed` even when the selected model came from Zen

This confirmed that filtering only by the live `/models` response was not enough.

### 5. 2026-05-16 — Implementation

The implementation added two filtering layers.

First, a local safety list blocks model IDs that are known to fail even if a registry still mentions them:

```ts
const KNOWN_UNAVAILABLE_MODEL_IDS = new Set(["ring-2.6-1t", "ring-2.6-1t-free", "trinity-large-preview-free"]);
```

Second, model registration filters Zen models marked deprecated in the resolved metadata snapshot:

```ts
private async filterAvailableModels(modelIds: string[]): Promise<string[]> {
  const metadataSnapshot = await this.getMetadataSnapshot();
  return uniqueModelIds.filter((modelId) =>
    !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId)
    && !shouldHideDeprecatedModel(modelId, this.definition.vendor, metadataSnapshot)
  );
}
```

If `models.dev` metadata cannot be fetched, the extension still applies the local safety list so known-broken model IDs do not come back through offline fallback.

### 6. 2026-05-16 — Documentation and Devlog

Documentation was updated to reflect the final behavior:

- unavailable and deprecated model filtering is documented as part of model discovery
- stale model examples were removed from the visible free-model documentation
- this issue document records the investigation and final fix
- `docs/devlog.md` records the completed session and leaves the next open task as the Qwen tool-call loop

---

## Root Cause

There were three root causes.

| Root Cause                  | Detail                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Catalog drift               | OpenCode `/models` could still list models that no longer had a usable provider endpoint                                |
| Fallback drift              | Bundled fallback lists could reintroduce stale model IDs when live model discovery failed                               |
| Missing availability filter | The extension previously did not use resolved model `status` metadata to hide deprecated Zen models before registration |

There was also a diagnostics issue: the transport error text could use the wrong provider display name, making Zen failures appear as OpenCode Go failures.

---

## Solution

The final solution is a registration-time filter:

1. Fetch live model IDs from OpenCode.
2. Apply the provider's normal filter, such as Zen free-only mode.
3. Resolve model metadata from live metadata, `models.dev`, and bundled fallback metadata.
4. Hide IDs in `KNOWN_UNAVAILABLE_MODEL_IDS`.
5. Hide Zen models whose resolved status is `deprecated`.
6. If metadata fetch fails, still apply the local safety list.
7. Register only the remaining models with VS Code.

This keeps the picker clean without requiring an extension release for every upstream catalog change, while still giving maintainers a quick local override for provider-side breakage.

---

## Files Changed

| File                                         | Change                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`src/extension.ts`](../../src/extension.ts) | Added known-unavailable model filtering, registration-time deprecated filtering, and provider-aware error text |
| [`src/metadata.ts`](../../src/metadata.ts)   | Provides cached `models.dev` metadata and status fields consumed by the provider filter                        |
| [`README.md`](../../README.md)               | Documents model discovery behavior and removes stale free-model examples                                       |
| [`CHANGELOG.md`](../../CHANGELOG.md)         | Records the model filtering fix                                                                                |
| [`docs/devlog.md`](../devlog.md)             | Adds the completed backdated session entry                                                                     |

---

## Verification

```bash
npm run compile
```

Result: ✅ TypeScript compiled successfully.

Registry check:

```text
ring-2.6-1t-free: deprecated
trinity-large-preview-free: deprecated
```

Expected picker result for Zen free mode:

```text
big-pickle
deepseek-v4-flash-free
qwen3.6-plus-free
minimax-m2.5-free
nemotron-3-super-free
```

The removed models should not appear after reloading VS Code and refreshing the model list.

---

## Notes

This fix intentionally treats availability as a dynamic property. The extension should trust live catalog data only after applying status metadata and local safety filters.

Future improvement: cache the last successful filtered model list in `globalState` and use that as the first offline fallback before bundled defaults.
