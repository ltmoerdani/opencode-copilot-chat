# Model-List 401 Hint + Bundled Catalog Refresh (Issue #269)

**Status:** ✅ Solved
**Topic:** provider / models / errors / fallback
**Updated:** 2026-10-27
**Tags:** #provider #models #errors #fallback #fetch-models
**Related:** issue [#269](https://github.com/ltmoerdani/opencode-copilot-chat/issues/269), doc [100 — bundled model data sync](100-20260908-bundled-model-data-sync.md), doc [112 — Zen free-tier policy](112-20261020-zen-free-tier-policy-followup.md), doc [78 — deprecated cross-check #182](78-20260822-issue182-deprecated-model-gateway-crosscheck.md)

---

## Problem

Reporter (`@aalam95`, ext 0.7.10, both providers): "Deepseek v.4.1 is not shown" in the model picker. Logs showed every `fetchModels` call failing with `Model list request failed (401): Unauthorized` on **both** Go and Zen, falling back to the bundled list — and the Zen log filtering 38 models down to a nearly-empty picker.

## Evidence (verified live 2026-10-26/27)

| Probe (×3, deterministic)                                            | Result                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /zen/go/v1/models` + `/zen/v1/models`, anonymous                | **200** — the model list is a public catalog; the official docs curl it without auth          |
| Same endpoints with `Authorization: Bearer sk-invalid-test`          | **401** — the gateway validates the bearer whenever one is sent                               |
| status.opencode.ai (Console component owns keys/auth)                | operational; no auth incident around Oct 23                                                   |
| Upstream issue search `401 unauthorized models` (anomalyco/opencode) | no gateway-side `/models` 401 defect; #46169 confirms the "models list works, chat 401" split |

**Root cause:** the reporter's stored API key (both vendors) was invalid/expired/revoked. The live catalog never loaded, so the September-era bundled list took over — and it simply didn't contain `deepseek-v4.1-flash` (Go bundled was a 27-model snapshot vs 38 live; Zen 42 vs 84 live).

**Forensics on the reporter's Zen log:** the 38-entry `Filtered unavailable/deprecated models` line equals the bundled Zen list minus its 4 free-tier ids plus `deepseek-v4-flash-free` (KNOWN_UNAVAILABLE) — exactly the _keep-free-only_ `filterModel` of the pre-#266 era. So the reporting session was running pre-0.7.10 code (VS Code swaps extensions only on reload). On current main, `shouldHideDeprecatedModel` is fail-open without live ids (nothing hidden on fallback), so a fresh 0.7.10 session shows ~37 stale Zen models instead — the stale-bundled problem is the same either way.

## Changes

| File                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/provider/modelList.ts`         | New `isUnauthorizedModelListError()` (matches the thrown `Model list request failed (401)` prefix so `retry.ts` classification is untouched); on final failure with 401, logs an actionable hint: "the stored API key was rejected (401). Update or clear it via `…: Manage Provider`". 401 remains non-transient — one attempt, no retry                                                                                                                   |
| `src/provider/definitions.ts`       | Go `fallbackModels`: 27 → 38, mirroring the live gateway catalog 2026-10-27 (adds `deepseek-v4.1-flash`, `gpt-6-luna`, `grok-4.7`, `kimi-k3.1-pro`, `mimo-v2.6-*`, `step-5-preview`, `beam-free`, `claude-haiku-5-5`, `gemini-4-argon`, …; drops dead `deepseek-v4-flash`/`-vision-exp`). Zen `fallbackModels`: 42 → 72, live catalog minus the policy-hidden free tier, the non-chat `jev-*` decision API, and junk ids (`test`, `claude-opus-5-5-backup`) |
| `src/test/modelList401Hint.test.ts` | New: 401 → bundled fallback + hint logged + exactly one fetch attempt; non-401 permanent (400) → fallback without the hint                                                                                                                                                                                                                                                                                                                                  |

## Decisions

- **No anonymous retry on 401.** The catalog endpoint is public, so retrying without the `Authorization` header would load the live list even with a dead key — but it would mask the key problem until the first chat request. The hint keeps the diagnosis loud at the exact point of failure; Test Connection / chat errors already carry actionable messages.
- **`deepseek-v4-flash` is NOT blocklisted.** It is dead on Go but still served (flakily) on Zen; `KNOWN_UNAVAILABLE_MODEL_IDS` is vendor-agnostic, so blocklisting would hide a live Zen model (same reasoning as the #182 cross-check). Removing it from the Go bundled list is enough.
- **Zen bundled mirrors live minus free tier** rather than models.dev: the gateway is the source of truth (#182), and the officially-deprecated-but-still-served ids (`gpt-5-codex` family, `minimax-m2.5`, `glm-5`, `kimi-k2.5`) stay listed exactly as the live path shows them today.
- **Hint applies to the cached branch too** — a 401 with a fresh (<1 h) cached snapshot has the same root cause, so the hint logs before the cached/bundled choice.

## Verification

- `npm run compile` — no errors.
- `npm test` — **561/561 pass** (559 prior + 2 new).
- Live re-probes: both `/models` endpoints anonymous 200 / invalid-bearer 401 (deterministic ×3); Go live catalog 38 ids, Zen 84 ids (2026-10-27).

Follow-up for the reporter: after updating the key, note that **DeepSeek V4.1 Flash / V4 Pro on Go require the "Global" region** in Console → Settings → Privacy (default is EU+US; upstream [#50155](https://github.com/anomalyco/opencode/issues/50155)) — otherwise chat requests for those models are rejected even with a valid key.
