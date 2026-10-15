**Status:** 🟢 Active

# Data-Driven Model Registry + God-File Split (PR #155)

**Topic:** architecture / registry / routing / thinking / provider / models / transports / usage / refactor
**Updated:** 2026-08-15
**Tags:** #architecture #registry #routing #thinking #provider #models #transports #usage #refactor
**PR:** [#155](https://github.com/ltmoerdani/opencode-copilot-chat/pull/155) (merge commit `a95565f`, 2026-08-14)
**Supersedes:** god-file-era file map in `docs/architecture/01-...` (structure changed)
**Related:** issue doc [`67-20260814-pr155-split-god-files-review-merge.md`](../issues/67-20260814-pr155-split-god-files-review-merge.md) · architecture doc [`02-20260809-provider-adapter-architecture.md`](../architecture/02-20260809-provider-adapter-architecture.md)

---

## Overview

This doc is the **living reference for the new folder structure** and the **data-driven model registry** introduced by PR #155. The three god files (`extension.ts` 4,653 lines, `streaming.ts` 1,620, `goUsageTracker.ts` 1,510) are split into domain modules, and per-model wiring (transport + thinking family) now lives in one table instead of two hardcoded if-chains.

The navigation map of the whole codebase (domain ownership, LoC, dependency graph, execution flows) is in `ARCHITECTURE-MAP.md` at the repo root.

---

## Folder Structure (post-#155)

```text
src/
├── extension.ts              ← thin entry (~415 lines): activation + command wiring
├── config.ts                 ← all tunable constants (URLs, timeouts, limits, storage keys, settings keys)
├── utils.ts                  ← shared pure helpers (isRecord, firstString, getErrorMessage, formatUsd, ...)
├── errors.ts                 ← OpenCodeRequestError taxonomy
├── apiKeyResolution.ts       ← resolveResponseApiKey (BYOK → registry → SecretStorage)
├── openCodeAuth.ts           ← gateway auth headers
├── providerTypes.ts          ← GO_VENDOR / ZEN_VENDOR / agent variants / resolveBaseVendor
├── providerEnablement.ts     ← enabled flags + toggle
├── chatParts.ts              ← LanguageModelResponsePart helpers
├── tokenEstimate.ts          ← token estimation
├── contextWindowHook.ts      ← context-window metadata injection (+ bridge)
├── imageNormalizer.ts        ← image normalization
├── visionProxyCache.ts       ← vision-proxy description cache
├── reasoningHistory.ts       ← thinking-history echo helpers
├── retry.ts / responsesRequest.ts / runtimeDiagnostics.ts / toolCallAccumulator.ts
│
├── core/
│   ├── registry.ts           ← MODEL_REGISTRY (data-driven: transport + thinking family)  ★
│   ├── routing.ts            ← resolveModelRouting() reads the registry
│   └── transport.ts          ← transport contract types (StreamRequestOptions, summary)
│
├── provider/
│   ├── OpenCodeProvider.ts   ← LanguageModelChatProvider implementation
│   ├── definitions.ts        ← PROVIDERS table + OpenCodeModel types
│   ├── messages.ts           ← message conversion (normalize/convert/trim images)
│   ├── tokens.ts             ← chat-message token estimation
│   ├── settings.ts           ← schema / getSettings / limits / capabilities
│   └── visionProxy.ts        ← vision proxying
│
├── transports/               ← one file per transport + shared engine
│   ├── chatCompletions.ts    ← OpenAI chat-completions SSE
│   ├── responses.ts          ← OpenAI Responses API SSE
│   ├── anthropic.ts          ← Anthropic Messages SSE
│   ├── google.ts             ← Google GenerateContent SSE
│   ├── engine.ts             ← shared HTTP+SSE streaming engine + retry/backoff
│   ├── sse.ts                ← pure SSE data-line parser
│   ├── extractors.ts         ← Base/OpenAi/Anthropic response extractors
│   ├── extract.ts            ← non-stream extraction + pure delta helpers
│   ├── streamParts.ts        ← progress/thinking part emission
│   └── thinkTags.ts          ← pure inline <think> tag stripper
│
├── thinking/                 ← per-provider thinking strategies
│   ├── provider.ts           ← ThinkingProvider interface + thinkingProviderFor() factory
│   ├── base.ts               ← shared base class
│   ├── types.ts / schema.ts / payload.ts / resolve.ts
│   ├── deepseek.ts / glm.ts / kimi.ts / minimax.ts / openai.ts / qwen.ts / mimo.ts / fallback.ts
│   └── thinking.ts           ← thin barrel (historical public API)
│
├── models/                   ← model metadata domain
│   ├── metadata.ts           ← resolveModelMetadata + bundled fallback
│   ├── metadataFetcher.ts    ← models.dev live fetch + cache
│   ├── modelLimits.ts / modelCapabilities.ts / modelNames.ts / pricing.ts
│
├── usage/                    ← Go usage domain
│   ├── tracker.ts            ← GoUsageTracker class
│   ├── history.ts            ← OpenCode CLI SQLite read/aggregation
│   ├── pricing.ts            ← bundled pricing + estimateCost
│   ├── formatting.ts         ← status-bar / quick-pick formatting
│   ├── dashboard.ts          ← status bar + usage webview + tooltip SVG
│   ├── usage.ts / usageProfile.ts / goUsageSync.ts
│
├── request/                  ← per-endpoint request builders
│   ├── openai.ts / anthropic.ts / google.ts
│   ├── types.ts / schema.ts / shared.ts / headers.ts
│
├── commands/                 ← command handlers
│   ├── providers.ts / agentsWindow.ts / diagnostics.ts / thinkingPicker.ts
│
└── autocomplete/             ← inline-completion feature (pre-existing, unchanged)
```

---

## The Registry (`src/core/registry.ts`)

**Single source of truth** for "which model family uses which transport + thinking strategy." Context limits/capabilities/cost are **not** here — those stay metadata-driven (live models.dev). Both consumers read the same table:

- `core/routing.ts` → `resolveModelRouting()` (passes the resolved base vendor)
- `thinking/provider.ts` → `thinkingFamily()` (vendor-agnostic lookup)

```ts
interface ModelRegistryEntry {
  family: string;
  patterns: RegExp[]; // first match wins — order matters
  endpointKind: "chat-completions" | "messages" | "responses" | "google";
  sdkPackage?: string;
  thinkingFamily: ThinkingFamily | null;
  vendors?: ProviderVendor[]; // optional vendor restriction
}
```

### Current rows (11 families + catch-all)

| Order | Family          | Patterns                                                   | endpointKind     | thinkingFamily | vendors    |
| ----- | --------------- | ---------------------------------------------------------- | ---------------- | -------------- | ---------- |
| 1     | `gpt`           | `/^gpt-/i`                                                 | responses        | openai         | —          |
| 2     | `claude`        | `/^claude-/i`                                              | messages         | null           | —          |
| 3     | `minimax-m2`    | `/^minimax-m2\./i`                                         | messages         | minimax        | opencodego |
| 4     | `qwen-messages` | `/^qwen3\.(?:5\|6)-plus(?:-free)?$/i`, `/^qwen3\.7-max$/i` | messages         | qwen           | —          |
| 5     | `gemini`        | `/^gemini-/i`                                              | google           | gemini         | —          |
| 6     | `minimax`       | `/^minimax-/i`                                             | chat-completions | minimax        | —          |
| 7     | `deepseek`      | `/^deepseek-/i`                                            | chat-completions | deepseek       | —          |
| 8     | `glm`           | `/^glm-/i`                                                 | chat-completions | glm            | —          |
| 9     | `kimi`          | `/^kimi-/i`                                                | chat-completions | kimi           | —          |
| 10    | `mimo`          | `/^mimo-/i`                                                | chat-completions | mimo           | —          |
| 11    | `qwen`          | `/^qwen3(?:\.\|-)/i`                                       | chat-completions | qwen           | —          |
| 12    | `default`       | `/.*/`                                                     | chat-completions | null           | —          |

**Vendor-restriction semantics:** `minimax-m2.*` served by **Go** → Messages API (Anthropic); on **Zen** it falls through to the generic `minimax` row → chat-completions. `gemini-*` → Google API on **both** vendors; the route base is `googleModelsUrl ?? modelsUrl`, so Go's built-in gateway uses its own Google base while Zen (and any custom `apiBaseUrl` gateway) keeps building from `modelsUrl`. Agent-host variants are resolved to their base vendor via `resolveBaseVendor()` before lookup.

### How to add a model family

1. Add **one row** to `MODEL_REGISTRY` (specific patterns before generic ones).
2. If it needs a dedicated thinking strategy, add `src/thinking/<family>.ts` and wire it in `thinking/provider.ts`.
3. Context limits / capabilities / cost come from live models.dev metadata — nothing to do here unless the model is missing upstream (then update `models/metadata.ts` fallback).

---

## Routing (behavior map)

| Model prefix                                                | Transport                            | Notes                                                                                  |
| ----------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `gpt-`                                                      | **responses** (OpenAI Responses API) | reasoning only supported there; OpenCode Go requires `gpt-5.6-luna` on `/v1/responses` |
| `claude-`                                                   | **messages** (Anthropic)             | any vendor                                                                             |
| `minimax-m2.*` (Go)                                         | **messages**                         | on Zen → chat-completions                                                              |
| `qwen3.5-plus(-free)`, `qwen3.6-plus(-free)`, `qwen3.7-max` | **messages**                         | others → chat-completions                                                              |
| `gemini-*` (Zen + Go)                                       | **google**                           | Go uses `googleModelsUrl` base, Zen uses `modelsUrl`                                   |
| everything else                                             | **chat-completions**                 | default                                                                                |

---

## Thinking (per-provider strategies)

Each family owns its picker schema, request-payload mapping, and whether `reasoning_content` surfaces as chat content (`treatReasoningAsContent`). Configuration resolves from a **single authority** (VS Code per-model config), with workspace settings and per-family defaults as fallbacks. The old `globalState` shadow copy is removed — a thinking effort chosen for one model can no longer leak onto another.

| Family       | Settings                    | Request mapping                                                    |
| ------------ | --------------------------- | ------------------------------------------------------------------ |
| DeepSeek     | `off/low/medium/high/max`   | `reasoning_effort` (DeepSeek/Mimo: CoT never echoed to chat)       |
| GLM          | `off/high/max`              | `reasoning_effort`; `off` → `thinking:{type:"disabled"}` (GLM 5.2) |
| Kimi         | `on/off`                    | Anthropic `thinking` block; `kimi-k2.7-code` force-on              |
| MiniMax      | `off/on`                    | `thinking` enabled/disabled/adaptive by route                      |
| Mimo         | `off/low/medium/high`       | `reasoning_effort` (+ `budget_tokens`)                             |
| OpenAI (GPT) | `off/low/medium/high/xhigh` | Responses reasoning                                                |
| Qwen         | `auto/on/off` + budget      | `enable_thinking` / `thinking_budget` or Anthropic-native          |
| fallback     | generic                     | metadata-driven `reasoning_options`                                |

---

## API Key Model (BYOK only)

- Keys configured **exclusively** via VS Code native BYOK flow (**Chat: Manage Language Models → "+ Add Models"**).
- `SecretStorage` is an internal per-vendor mirror: `opencodego.apiKey` / `opencodezen.apiKey` (`secretKeyFor(vendor)` in `src/config.ts`). BYOK resolution writes it so agent variants + cold-start requests inherit the group key.
- `Refresh Models` / `Test Connection` point at BYOK when no key is configured.
- **Known follow-up:** users who set the Zen key via the old `Set API Key` command still hold it under `opencodego.apiKey`; a one-time migration into `opencodezen.apiKey` is planned before release (see issue doc 67).

---

## Verification

- `npm run compile` clean · `npm test` **310/310** · `npm run test-retry` 7/7 · `npm run lint` green.
- 14 new `registry.test.ts` cases cover transport×vendor routing, thinking family, lookup mechanics, and row ordering.
- Author live-tested DeepSeek V4 Flash via F5 Debug host (streaming, reasoning, tool calls).
- Maintainer independently re-verified on a worktree (see issue doc 67).

---

## Related

- Issue doc [`67-20260814-pr155-split-god-files-review-merge.md`](../issues/67-20260814-pr155-split-god-files-review-merge.md) — review + merge + follow-up list.
- `ARCHITECTURE-MAP.md` (repo root) — full navigation map.
- Architecture doc [`02-20260809-provider-adapter-architecture.md`](../architecture/02-20260809-provider-adapter-architecture.md) — the plan this executes.
- Feature doc [`02-20260517-per-model-thinking-controls.md`](02-20260517-per-model-thinking-controls.md) — thinking controls feature.
