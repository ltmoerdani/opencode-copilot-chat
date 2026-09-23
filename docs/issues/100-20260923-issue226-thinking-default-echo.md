# Issue #226 — Global `opencodego.thinking.*` Ignored: Picker Schema Default "off" Echoed Back as Per-Model Override

**Status:** ✅ Solved — implemented + verified end-to-end
**Topic:** thinking / picker-schema / model-configuration
**Updated:** 2026-09-23
**Tags:** #thinking #schema #modelConfiguration #agent-host
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#226](https://github.com/ltmoerdani/opencode-copilot-chat/issues/226)
**Related:** issue doc [93 — #214 thinking settings scope](93-20260903-issue214-thinking-settings-scope.md), feature doc [02 — per-model thinking controls](../features/02-20260517-per-model-thinking-controls.md)

---

## Problem

Follow-up to #214: v0.7.4 fixed the settings-scope half, but global `opencodego.thinking.*` values still never take effect while per-model picks work. Diagnosis by @nickchomey (`chatLanguageModels.json` evidence) + verification against VS Code source.

## Root Cause (verified against VS Code source)

Two halves, both confirmed:

1. **Our picker schema declares `default: "off"`** for `reasoningEffort` (`src/thinking/schema.ts`: `effortProperty`, `schemaFromReasoningOptions`, `genericReasoningSchema`, plus family schemas).
2. **VS Code merges schema defaults into the resolved per-model configuration on every request.** `resolveModelConfiguration` (`chatModelConfigurationLogic.ts`) merges defaults in _every_ branch, and `_resolveModelConfigurationWithDefaults` (`languageModels.ts`) does `{...defaults, ...userConfig}` — so "user never set anything" arrives as `{reasoningEffort: "off"}`.

Our resolver (`resolveThinkingConfig`, `src/thinking/resolve.ts`) treated _any_ delivered `modelConfiguration` as the single authority — even a value equal to the baseline — so the echoed `"off"` outranked the global setting on every request.

Key extra evidence: `LanguageModelsService.setModelConfiguration` **strips stored values equal to the schema default**. An explicit user pick of "Off" is therefore indistinguishable from "never touched" — both resolve to the default. Treating a default-equal delivered value as "no override" is consequently lossless.

## Fix (Option B — resolver-side)

`src/thinking/resolve.ts`:

- `schemaDefaultsOf(schema)` — extracts per-key picker defaults (same shape as VS Code's `extractSchemaDefaults`).
- `stripSchemaDefaultEcho(override, defaults)` — drops override keys whose delivered value equals the family's picker schema default; per-key, so a genuine choice beside an echo still applies. Returns `undefined` when nothing survives → workspace global wins.
- `resolveThinkingConfig` now applies only the _stripped_ override and passes it (not the raw `modelConfiguration`) to `provider.applyOverride`.

**Why not Option A (remove `default: "off"` from the schema)?** Verified against VS Code source: the Agents window host reads `reasoningEffortSchema.default` as `defaultReasoningEffort` (`agentHostByokLmHandler.ts`); when absent, `resolveDefaultReasoningEffort` falls back to `'medium'`/`'high'` — removing our default would make Agents-window models think at medium/high by default (silent Go credit burn). The picker would also lose its initial Off display (`getModelConfigProperty` uses `currentConfig[key] ?? schema.default`).

## Files Changed

| File                                 | Change                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/thinking/resolve.ts`            | `schemaDefaultsOf` + `stripSchemaDefaultEcho`, resolver strips default-echo before applying override                                                                                        |
| `src/thinking.ts`                    | re-export `stripSchemaDefaultEcho`                                                                                                                                                          |
| `src/test/thinking.test.ts`          | updated the test that encoded the buggy behavior; added #226 regression tests (echo ignored, non-default global survives, per-key stripping, non-"off" defaults like kimi-k2.7-code `"on"`) |
| `tmp/e2e-issue226-thinking-echo.mjs` | e2e simulation of the request chain (`resolveThinkingConfig → buildPayload`)                                                                                                                |

## Verification

- `npm run compile` clean; `npm run lint` (full 7-check gate) pass; 466/466 unit tests pass.
- E2E simulation (`tmp/e2e-issue226-thinking-echo.mjs`) — 4/4 pass:
  1. global `mimo=high` survives the echoed default → payload carries `reasoning_effort: "high"`
  2. per-model picker choice (glm `high`) still applies
  3. untouched model stays off with empty payload (no behavior change)
  4. qwen: echo dropped, real `thinkingBudget` choice kept (budget correctly not sent while thinking off)
- ⚠️ Manual Copilot Chat test with a real Go key still pending (set global `opencodego.thinking.mimo: "high"` → new chat → confirm reasoning appears).

### Real-model E2E (2026-09-23, Go + `mimo-v2.6-flash` via Copilot Chat) — PASS

| Scenario                                  | Log evidence                                                                                                                                                                                                                 | Result                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Per-model picker pick `High`              | `modelConfiguration={"reasoningEffort":"high"}` `thinkingSource=modelConfiguration` payload carries `reasoning_effort:"high"`                                                                                                | ✅ override still applies (non-default → kept)              |
| No per-model setting, global `mimo: off`  | `modelConfiguration={"reasoningEffort":"off"}` (echo) `thinkingSource=workspace` — echo ignored, no `reasoning_effort` in payload                                                                                            | ✅ fix works (pre-fix: `thinkingSource=modelConfiguration`) |
| No per-model setting, global `mimo: high` | `modelConfiguration={"reasoningEffort":"off"}` (echo) `thinkingSource=workspace` `thinking={..."mimo":"high"...}` `thinkingPayload={..."reasoning_effort":"high","budget_tokens":32768}` `hasReasoningEffort=true`, HTTP 200 | ✅ the #214 symptom is gone end-to-end                      |

## Known UX Note (not part of #226)

The model picker's Thinking submenu keeps displaying **Off** even when a global `opencodego.thinking.*` default is in effect. This is by design of the two-layer architecture: the picker reflects only the _per-model_ `modelConfiguration` (VS Code does not surface our global settings in its UI), while the global setting fills in for models without an override — the request still carries the global value (`thinkingSource=workspace` in the log proves it). If this proves confusing, a separate enhancement (e.g. a picker label hinting at the effective global default) can be tracked independently.

## Lessons Learned

1. Picker schema defaults are not inert metadata: VS Code echoes them into `modelConfiguration` on every request and strips them from persisted user picks — so a default-equal delivered value can _never_ be a genuine user choice.
2. Removing a schema default changes host-side fallbacks (Agents window `resolveDefaultReasoningEffort`) — resolver-side filtering is the safe half of this fix.
3. Existing test "delivered modelConfiguration equal to workspace still reports modelConfiguration source" had encoded the buggy priority — tests can cement a bug as a contract; audit them when a spec-level assumption changes.

---

Detected 2026-09-09 | Reported by @nickchomey | Fixed 2026-09-23
