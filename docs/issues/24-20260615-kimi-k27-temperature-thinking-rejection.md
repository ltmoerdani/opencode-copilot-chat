**Status:** ✅ Solved

# Kimi K2.7-Code Rejects `temperature` and `thinking.type: "disabled"` — Dual 400 Errors

**Topic:** models / thinking / temperature / provider / kimi  
**Updated:** 2026-06-15  
**Tags:** #models #thinking #kimi #temperature #breaking-change #bugfix  
**GitHub Issue:** [#25](https://github.com/ltmoerdani/opencode-copilot-chat/issues/25)  
**Related:** [#20](./20-20260611-pr18-kimi-thinking-format-review.md) (Kimi thinking format fix for K2.6/K2.5)  
**Reporters:** [@JacksApps](https://github.com/JacksApps), [@Tynamix](https://github.com/Tynamix)

---

## Overview

The newly released `kimi-k2.7-code` model (Moonshot AI) introduces **breaking changes** from `kimi-k2.6` that cause two distinct HTTP 400 errors. Both share a single root theme: the extension sends request parameters that K2.7-code no longer accepts.

| #   | Reporter   | Error Message                                                   | Status                                          |
| --- | ---------- | --------------------------------------------------------------- | ----------------------------------------------- |
| 1   | @JacksApps | `invalid temperature: only 1 is allowed for this model`         | Initially intermittent → reproduced by @Tynamix |
| 2   | @Tynamix   | `invalid thinking: only type=enabled is allowed for this model` | Reproducible                                    |

@JacksApps noted the issue disappeared when starting a fresh chat — but this only masked the bug. The fresh-chat workaround succeeds only because the default thinking setting is `off`, and the _first_ request to K2.7 doesn't always trigger the thinking-disabled branch depending on session state. @Tynamix's reproduction confirms the bug is real and persistent.

---

## Evidence — Official Moonshot/Kimi API Contract

Source: [platform.kimi.ai/docs/api/chat](https://platform.kimi.ai/docs/api/chat) (verified 2026-06-15)

### `thinking` object — K2.7-code specific behavior

> Controls thinking for the kimi-k2.7-code model, and whether to fully preserve `reasoning_content` across multi-turn conversations. Optional parameter. Default value is `{"type": "enabled", "keep": "all"}`.
>
> **Differences from kimi-k2.6:**
>
> - `type` **only accepts `"enabled"`**. Unlike kimi-k2.6, `"disabled"` is NOT supported — passing it returns an error. **Thinking is always on for this model.**
> - `keep` only accepts the valid value `"all"`; omitting it or passing `"all"` is treated as `"all"` on the server, while any other invalid value returns an error. Preserved Thinking is therefore always enabled for this model.

### `temperature` parameter

The K2.7-code API spec does **not** list `temperature` as a supported body parameter (unlike K2.6 which accepts it). The error message from the OpenCode Go gateway — _"invalid temperature: only 1 is allowed for this model"_ — confirms the upstream Moonshot API rejects any non-default temperature for K2.7-code.

### Contract summary for K2.7-code

| Parameter       | K2.6 / K2.5                 | K2.7-code (NEW)                           |
| --------------- | --------------------------- | ----------------------------------------- |
| `thinking.type` | `"enabled"` OR `"disabled"` | **`"enabled"` ONLY** (error otherwise)    |
| `thinking.keep` | not documented              | `"all"` only (server defaults if omitted) |
| `temperature`   | supported                   | **rejected** (must omit or send `1`)      |

---

## Root Cause — Codebase Side

### A. Temperature leak (`metadata.temperature` undefined → temperature sent)

`kimi-k2.7-code` is **not registered** in `src/metadata.ts` `MODEL_LIMITS_BY_PROVIDER[GO_VENDOR]` — only `kimi-k2.6` and `kimi-k2.5` are listed:

```typescript
// src/metadata.ts — MODEL_LIMITS_BY_PROVIDER[GO_VENDOR]
"kimi-k2.6": { contextWindow: 262144, maxOutputTokens: 65536 },
"kimi-k2.5": { contextWindow: 262144, maxOutputTokens: 65536 },
// ← kimi-k2.7-code MISSING
```

Consequence:

- `fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR)` → **`undefined`**
- Live metadata fetch from models.dev _may_ return a record (if models.dev has indexed K2.7), but is not guaranteed
- When metadata is absent or lacks an explicit `temperature` field, `metadata.temperature` resolves to `undefined`

In `src/extension.ts` `buildChatCompletionsRequestBody` (line ~1634):

```typescript
...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
```

`undefined !== false` → `true` → **temperature is sent** to K2.7-code → 400 error.

### B. Thinking-disabled leak (extension sends `disabled` when user picks `off`)

In `src/extension.ts` `buildThinkingPayload` (lines ~2945-2947):

```typescript
if (/^kimi-/i.test(modelId)) {
  // Tests confirm the gateway accepts thinking: { type } for Kimi
  return { thinking: { type: thinking.kimi === "on" ? "enabled" : "disabled" } };
}
```

- `kimi-k2.7-code` matches `/^kimi-/i`
- Default setting `opencodego.thinking.kimi` is `"off"` (see `getSettings`, line ~2916)
- When user keeps default OR explicitly picks "off", the extension sends `{ thinking: { type: "disabled" } }`
- K2.7-code **rejects `disabled`** → 400 error: _"invalid thinking: only type=enabled is allowed for this model"_

This branch is correct for K2.6 and K2.5 (they accept `disabled`), but K2.7 is a breaking change.

### Why issue #20's fix doesn't cover this

Issue #20 ([doc](./20-20260611-pr18-kimi-thinking-format-review.md)) fixed the payload _format_ (`enable_thinking: true/false` → `thinking: { type: "enabled"|"disabled" }`). That fix remains correct for K2.6/K2.5. Issue #25 is about K2.7's _new constraint_ on the `type` value — a narrower restriction on top of the same format. The K2.7 special case must be added on top of the K2.6/K2.5 default behavior.

---

## Reproduction

**Minimal repro for Error B (thinking-disabled):**

1. Install extension with default settings (`opencodego.thinking.kimi: "off"`)
2. Open Copilot Chat, select `kimi-k2.7-code`
3. Send any message
4. Observe: `Sorry, your request failed... invalid thinking: only type=enabled is allowed for this model`

**Minimal repro for Error A (temperature):**

1. Any request to `kimi-k2.7-code` (regardless of thinking setting), because the temperature branch always sends `settings.temperature` (default `0.2`) when metadata doesn't explicitly set `temperature: false`.

---

## Proposed Fix (two-part)

### Fix A — Register `kimi-k2.7-code` in metadata + mark `temperature: false`

**File:** `src/metadata.ts`

1. Add to `MODEL_LIMITS_BY_PROVIDER[GO_VENDOR]`:

   ```typescript
   "kimi-k2.7-code": { contextWindow: 262144, maxOutputTokens: 65536 },
   ```

   _(Context/output limits to be verified against models.dev live registry — K2.7-code may have different limits than K2.6.)_

2. Add `"kimi-k2.7-code"` to `VISION_CAPABLE_MODELS` if K2.7 supports vision (K2.6 does; K2.7 spec mentions multimodal understanding).

3. Ensure `fallbackModelMetadata` returns `temperature: false` for `kimi-k2.7-code` specifically, so the temperature branch in `extension.ts:1634` correctly omits it.

   Approach: either add a per-model `temperature: false` override in the fallback table, or add a small K2.7-specific branch in `fallbackModelMetadata`. Preferred: add an explicit field in `MODEL_LIMITS_BY_PROVIDER` entries (would require extending `BaseModelLimits` to include `temperature?`) OR keep the current ModelMetadataFields shape and add K2.7 to a `TEMPERATURE_UNSUPPORTED_MODELS` set.

### Fix B — Special-case K2.7 in `buildThinkingPayload`

**File:** `src/extension.ts` — `buildThinkingPayload` (before the generic `kimi` branch)

```typescript
if (/^kimi-k2\.7/i.test(modelId)) {
  // K2.7-code only accepts thinking.type: "enabled" — thinking cannot be
  // disabled (Moonshot API breaking change from K2.6). keep: "all" preserves
  // reasoning_content across multi-turn conversations per the API spec.
  return { thinking: { type: "enabled", keep: "all" } };
}

if (/^kimi-/i.test(modelId)) {
  // K2.6 and earlier accept both enabled and disabled.
  return { thinking: { type: thinking.kimi === "on" ? "enabled" : "disabled" } };
}
```

### Fix C — Thinking picker: show special label for K2.7

**File:** `src/extension.ts` — `buildFamilyThinkingSchema` (in the `kimi` family branch)

User preference: **show the picker with a special label** so users understand thinking is always on for K2.7 (not hidden, not force-on silently).

Approach: detect K2.7 specifically and return a single-option schema with descriptive label:

```typescript
if (/^kimi-k2\.7/i.test(modelId)) {
  return {
    properties: {
      reasoningEffort: {
        type: "string",
        title: "Thinking Effort",
        enum: ["on"],
        enumItemLabels: ["Always On (K2.7)"],
        enumDescriptions: [
          "Kimi K2.7-code requires thinking enabled (Moonshot API constraint)"
        ],
        default: "on",
        group: "navigation"
      }
    }
  };
}

if (family === "kimi") {
  // existing K2.6/K2.5 off/on schema
  ...
}
```

Also update `applyRequestThinkingOverride` so the `kimi` branch ignores the override for K2.7 (always returns `kimi: "on"` regardless of user selection — defensive, since the picker only offers `on`).

### Fix D — Documentation / settings schema

- Update `package.json` configuration description for `opencodego.thinking.kimi` to note that K2.7 ignores this setting (always on).
- Update `README.md` model support table if it lists Kimi thinking capabilities.

---

## Verification Plan

After implementation:

1. **Compile:** `npm run compile` — must pass with no errors.
2. **Metadata fallback test:** verify `fallbackModelMetadata("kimi-k2.7-code", GO_VENDOR)` returns an object with `temperature: false` (or equivalent).
3. **Payload inspection:** enable debug logging, send a request to `kimi-k2.7-code`, confirm:
   - No `temperature` field in request body
   - `thinking: { type: "enabled", keep: "all" }` is present
4. **Live test via Copilot Chat:**
   - `kimi-k2.7-code` with default settings → should succeed
   - `kimi-k2.7-code` with thinking picker set to "off" (if exposed) → should still succeed (forced enabled internally)
   - `kimi-k2.6` → unchanged behavior (off disables thinking correctly)
5. **Regression check:** `kimi-k2.6` and `kimi-k2.5` still respect `off` → `disabled`.

---

## Open Questions

All open questions have been resolved via models.dev registry evidence (verified 2026-06-15):

- [x] **Context/output limits for K2.7-code** — models.dev `opencode-go` entry: `context: 256000`, `output: 262144`. Registered in `MODEL_LIMITS_BY_PROVIDER[GO_VENDOR]` accordingly.
- [x] **Does K2.7 support vision?** — Yes. models.dev `attachment: true` and `modalities.input: ["text","image","video"]`. Added to `VISION_CAPABLE_MODELS`.
- [x] **`kimi-k2.7-code-highspeed`** — Not yet listed on OpenCode Go. The `/^kimi-k2\.7/i` regex in `buildThinkingPayload` and `buildFamilyThinkingSchema` already covers it if/when it ships.
- [x] **models.dev registry** — Already indexed. Live fetch will return `temperature: false` and `attachment: true`. Bundled fallback now mirrors this via `MODELS_WITHOUT_TEMPERATURE` set so the fix works even when live fetch fails.

## Implementation (2026-06-15) — ✅ Complete

All changes applied on branch `25-open-code-go-kimi-k27-issue`. `npm run compile` passes with zero errors.

### Files changed

| File                   | Change                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/metadata.ts`      | Register `kimi-k2.7-code` in `MODEL_LIMITS_BY_PROVIDER[GO_VENDOR]`; add to `VISION_CAPABLE_MODELS`; add `MODELS_WITHOUT_TEMPERATURE` set + propagate `temperature: false` in `fallbackModelMetadata`                           |
| `src/extension.ts`     | Special-case `/^kimi-k2\.7/i` in `buildThinkingPayload` (force `enabled`+`keep:"all"`); special-case in `buildFamilyThinkingSchema` (single "Always On" option); defensive force `kimi:"on"` in `applyRequestThinkingOverride` |
| `docs/issues/25-...md` | This document — status → ✅ Solved                                                                                                                                                                                             |

### Why `MODELS_WITHOUT_TEMPERATURE` instead of extending `BaseModelLimits`

`BaseModelLimits` only carries numeric limits (context/output). Adding an optional `temperature` field there would conflate limits with capability flags, which already live in `ModelMetadataFields`. The dedicated set keeps the fallback path explicit and self-documenting, and mirrors how `VISION_CAPABLE_MODELS` already works. If more models lose temperature support in the future, adding them is a one-line set entry.

### Regression safety

- `kimi-k2.6` and `kimi-k2.5` still match `/^kimi-/i` and use the existing off/on branch (they accept `disabled`).
- `MODELS_WITHOUT_TEMPERATURE` is empty for all other models → `fallbackModelMetadata` returns `temperature: undefined` → behavior unchanged.
- Live models.dev fetch still wins when available; the set is only the fallback safety net.

---

## Cross-References

- Issue #20 ([doc](./20-20260611-pr18-kimi-thinking-format-review.md)) — Kimi thinking format fix (`enable_thinking` → `thinking: { type }`)
- Issue #24 ([doc](./24-20260615-thinking-style-setting-not-respected.md)) — Thinking UI surfacing (unrelated; upstream VS Code API blocker)
- Feature #02 ([doc](../features/02-20260517-per-model-thinking-controls.md)) — Per-model thinking controls architecture
- Moonshot API docs: <https://platform.kimi.ai/docs/api/chat>
- GitHub issue: <https://github.com/ltmoerdani/opencode-copilot-chat/issues/25>
