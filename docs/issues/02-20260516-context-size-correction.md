**Status:** ✅ Solved

# Context Size Display Correction — Per-Provider Model Limits

**Topic:** models / provider / metadata  
**Updated:** 2026-05-16  
**Tags:** #models #provider #metadata #vscode #context-window #models-dev  
**Supersedes:** —

---

## Overview

The VS Code Copilot Chat model picker displayed incorrect context sizes for several OpenCode models — most notably showing **2M** for models with ~262K actual context. Root causes were: (1) an inflation formula that added max output tokens on top of context window, (2) incorrect hardcoded limit values, (3) a flat `MODEL_LIMITS` table shared between Go and Zen providers, and (4) stale VS Code picker metadata cache that didn't refresh after corrections.

This document covers the investigation and fix performed on **2026-05-16** (session date). Documentation was consolidated on **2026-06-13**.

---

## Problem

### Symptom 1 — "2M" Context in Picker

The VS Code model picker showed `2M` for Qwen models that actually have ~262K context. The displayed value came from:

```ts
// OLD — inflated
advertisedContextWindow = contextWindow + apiMaxOutputTokens;
// e.g. 262144 + 65536 = 327680 → VS Code rounds to nearest M → displays "2M" for larger models
// e.g. 1000000 + 384000 = 1384000 → rounds up to "2M"
```

VS Code internally does `Math.ceil(tokens / 1_000_000)` for display, so the inflated value caused misleading "2M" labels.

### Symptom 2 — Wrong Limit Values

Several models had incorrect hardcoded context/output values:

| Model                        | Old Context |  Old Output | Correct Context | Correct Output | Source     |
| ---------------------------- | ----------: | ----------: | --------------: | -------------: | ---------- |
| `qwen3.6-plus-free`          |   1,000,000 |           ? |     **262,144** |     **65,536** | models.dev |
| `glm-5.1` / `glm-5`          |     202,752 |  **32,768** |         202,752 |    **131,072** | models.dev |
| `minimax-m2.5` (Go)          |     204,800 |  **65,536** |         204,800 |    **131,072** | models.dev |
| `mimo-v2-omni`               |     262,144 |  **65,536** |         262,144 |    **128,000** | models.dev |
| `hy3-preview`                | **262,144** | **128,000** |     **256,000** |     **64,000** | models.dev |
| `ring-2.6-1t-free`           |     262,144 |      65,536 |     **262,000** |     **66,000** | models.dev |
| `nemotron-3-super-free`      | **262,144** |  **65,536** |     **204,800** |    **128,000** | models.dev |
| `trinity-large-preview-free` |     262,144 |      65,536 |     **131,072** |    **131,072** | models.dev |
| `big-pickle`                 | **262,144** |  **65,536** |     **200,000** |    **128,000** | models.dev |

### Symptom 3 — Cross-Provider Contamination

A flat `MODEL_LIMITS` map was shared between Go and Zen. When both providers expose the same model ID (e.g. `qwen3.6-plus`, `glm-5.1`, `minimax-m2.7`), the last-loaded limit won — causing one provider's metadata to silently override the other's.

### Symptom 4 — "Deprecated" Label on Active Model

`qwen3.6-plus-free` was labelled "Deprecated upstream" based on a community PR (#21855) to remove it. That PR was rejected ("closed abandoned") and OpenCode re-launched the model:

> "Round 2. We found more GPUs."

The label was misleading — the model is active but has limited GPU capacity.

### Symptom 5 — Picker Cache Not Refreshing

After correcting limit values in code, VS Code continued showing stale metadata because it caches model info by `id`, `family`, and `version`. Changing the underlying code had no effect on already-registered models.

---

## Root Cause

1. **Inflation formula** — `advertisedContextWindow = contextWindow + maxOutputTokens` was designed to reserve output tokens, but VS Code doesn't subtract output from display. The result was double-counting.

2. **Stale values** — several models were entered with approximate or wrong values before `models.dev` became the canonical registry.

3. **Flat limit table** — `MODEL_LIMITS: Record<string, BaseLimits>` had no provider dimension. Go's `qwen3.6-plus` could overwrite Zen's `qwen3.6-plus` or vice versa.

4. **Wrong deprecation** — label was based on an abandoned PR, not on actual model status.

5. **VS Code caching** — no mechanism existed to force metadata refresh. VS Code treats a model with the same `id` as the same model, even if the extension re-registers it with different limits.

---

## Solution

### Fix 1 — Remove Inflation

```ts
// NEW — exact context window, no inflation
const advertisedContextWindow = contextWindow;
```

### Fix 2 — Source All Limits from models.dev

Queried `https://models.dev/api.json` and updated every model entry. Verified against live endpoints:

```bash
curl -s "https://models.dev/api.json" | python3 -c "..."
curl -s "https://opencode.ai/zen/v1/models"
curl -s "https://opencode.ai/zen/go/v1/models"
```

### Fix 3 — Per-Provider Limit Tables

```ts
// OLD — flat
const MODEL_LIMITS: Record<string, BaseLimits> = { ... };

// NEW — per-provider
const MODEL_LIMITS_BY_PROVIDER: Record<ProviderVendor, Record<string, BaseModelLimits>> = {
  [GO_VENDOR]: { ... },
  [ZEN_VENDOR]: { ... },
};
```

Lookup function accepts vendor:

```ts
function modelLimits(metadata, settings, vendor): ModelLimits {
  const limits = MODEL_LIMITS_BY_PROVIDER[vendor][modelId];
  // ...
}
```

### Fix 4 — Correct Label

```ts
// OLD
const DEPRECATED_MODEL_NOTES = { "qwen3.6-plus-free": "Deprecated upstream — ..." };

// NEW
const CAPACITY_LIMITED_MODEL_NOTES: Record<string, string> = {
  "qwen3.6-plus-free": "Limited capacity — GPU resources may be constrained. Retry on 5xx errors.",
};
```

### Fix 5 — Cache-Bust via Revision Token

```ts
const MODEL_METADATA_REVISION = "ctxfix-2026-05-16-b";

function toEffectiveModelId(modelId: string, vendor: ProviderVendor): string {
  return `${vendor}:${modelId}::${MODEL_METADATA_REVISION}`;
}
```

Model registration embeds the revision in `family` and `version`:

```ts
family: `${vendor}-${modelId}-${MODEL_METADATA_REVISION}`,
version: `1.2.0-${MODEL_METADATA_REVISION}-${contextWindow}-${maxOutputTokens}`,
```

API requests strip the revision back to the raw upstream ID:

```ts
const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
```

---

## Files Changed

| File               | Change                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` | `CAPACITY_LIMITED_MODEL_NOTES` rename, `advertisedContextWindow = contextWindow`, `rawModelId` for API calls                                  |
| `src/metadata.ts`  | `MODEL_LIMITS_BY_PROVIDER` (per-vendor), `MODEL_METADATA_REVISION`, `toEffectiveModelId()`, `resolveRawModelId()`, `hasExplicitModelLimits()` |
| `CHANGELOG.md`     | `[0.1.3]` entry with all fixes                                                                                                                |
| `README.md`        | Per-provider model limits tables, corrected values, updated advertisedContextWindow description                                               |

---

## Verification

```bash
# 1. TypeScript compile — clean
npm run compile

# 2. Verify per-provider limits exist
rg -n "MODEL_LIMITS_BY_PROVIDER" src/metadata.ts

# 3. Verify revision mechanism
rg -n "MODEL_METADATA_REVISION|toEffectiveModelId|resolveRawModelId" src/metadata.ts src/extension.ts

# 4. Verify no inflation
rg -n "advertisedContextWindow" src/extension.ts

# 5. Verify raw model ID used in API calls
rg -n "rawModelId" src/extension.ts

# 6. Verify capacity-limited label
rg -n "CAPACITY_LIMITED_MODEL_NOTES" src/extension.ts

# 7. Cross-check against models.dev
curl -s "https://models.dev/api.json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for pid, provider in data.items():
  if 'opencode' not in pid.lower(): continue
  for mid, model in provider.get('models', {}).items():
    lim = model.get('limit', {})
    print(f'{mid:30s} ctx={str(lim.get(\"context\",\"?\")):>8s} out={str(lim.get(\"output\",\"?\")):>8s}')
"
```

Result: ✅ All values match `models.dev`. Compile clean. Picker shows correct context sizes.

---

## Lessons Learned

1. **Never inflate metadata values** — VS Code displays what you give it. If the value is wrong, the display is wrong. Use the exact upstream value.

2. **`models.dev` is the source of truth** — always verify against the registry, not community PRs or assumptions.

3. **Per-provider isolation** — when two providers share model IDs, limits must be keyed by `(vendor, modelId)` not just `modelId`.

4. **Cache-bust with revision tokens** — VS Code aggressively caches model metadata. Embed a revision constant in `id`/`family`/`version` to force refresh, and strip it before API calls.

5. **Verify deprecation before labeling** — a closed PR is not proof of deprecation. Check live endpoints and official announcements.
