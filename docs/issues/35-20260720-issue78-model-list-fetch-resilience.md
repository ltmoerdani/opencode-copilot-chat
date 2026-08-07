# Fix: Resilient Model List Fetch (Issue #78)

> **Status:** ✅ RESOLVED
> **Date:** July 20, 2026
> **Extension version:** 0.4.1 → unreleased
> **Severity:** Medium — model picker appears empty or "flashes then disappears" after VS Code startup on flaky networks
> **Root Cause:** `fetchModels()` had no timeout, no retry, no `User-Agent` header, and no graceful cache fallback. A single transient network failure at startup (DNS wobble, TCP reset, undici socket reuse race) caused the picker to fall back to the bundled list or `return []`, producing the "flash then disappear" symptom reported on VS Code 1.129.0.
> **GitHub issue:** [#78 — `[BUG] Could not fetch OpenCode Zen (Agents) model list. Using bundled model list. fetch failed`](https://github.com/ltmoerdani/opencode-copilot-chat/issues/78)

---

## Table of Contents

1. [Summary](#1-summary)
2. [Reporter Environment](#2-reporter-environment)
3. [Investigation & Authoritative Sources](#3-investigation--authoritative-sources)
4. [Root Cause](#4-root-cause)
5. [Solution](#5-solution)
6. [Code Changes](#6-code-changes)
7. [Behavior Matrix](#7-behavior-matrix)
8. [What This Does NOT Fix](#8-what-this-does-not-fix)
9. [Verification](#9-verification)
10. [References](#10-references)

---

## 1. Summary

Reporter `@leiyu1980` (VS Code 1.129.0 + extension 0.4.1) reported that on startup, the model picker only shows the default model and that the full Zen list "sometimes flashes briefly before disappearing." Output logs showed:

```
Could not fetch OpenCode Go model list. Using bundled model list. fetch failed
Could not fetch OpenCode Zen (Agents) model list. Using bundled model list. fetch failed
```

Investigation confirmed the bug is **not** in VS Code 1.129's API surface, and **not** a regression of the closed #51 (which was a TypeScript schema crash fixed by PR #53). It is a **transient network failure** that the extension did not previously tolerate:

- `fetchModels()` used a raw `fetch()` with no `AbortSignal`, no retry, and no `User-Agent`.
- Node's built-in `fetch` (undici) defaults to `headersTimeout=300s` and has **no connect timeout**, so a hung TCP connection could leave the picker stuck for up to 5 minutes before falling back.
- VS Code 1.129 introduced the **agent host** (a dedicated process for Copilot/Claude/Codex harnesses), which significantly increases concurrent model-resolution calls into the provider — multiplying the chance that a transient socket race (`ECONNRESET` / socket reuse) hits the picker.
- A successful fetch was never cached, so the picker fell straight from "live list" to "bundled list" (or `return []` in `provideLanguageModelChatInformation`), producing the flash/disappear UX.

The fix adds a 15s per-attempt timeout, exponential retry (3 attempts) for transient errors, `User-Agent` propagation, a 1-hour cached snapshot in `globalState`, and respect for the VS Code `CancellationToken`.

---

## 2. Reporter Environment

| Component  | Value                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| VS Code    | **1.129.0**                                                                                         |
| OS         | (not specified in report)                                                                           |
| Extension  | `ltmoerdani.opencode-copilot-chat` 0.4.1                                                            |
| Symptom    | Both `opencodego` and `opencodezen` providers fail to fetch; Zen list briefly flashes then vanishes |
| Comparison | `opencode zen list` (CLI) returns the full list correctly                                           |

---

## 3. Investigation & Authoritative Sources

### 3.1 Node.js / undici `fetch` defaults

Node's global `fetch` is backed by [undici](https://github.com/nodejs/undici). The default `Dispatcher` ships with:

| Option           | Default   | Effect                                                    |
| ---------------- | --------- | --------------------------------------------------------- |
| `headersTimeout` | **300 s** | Wait up to 5 minutes for response headers before throwing |
| `bodyTimeout`    | **300 s** | Wait up to 5 minutes between body chunks                  |
| connect timeout  | **none**  | A TCP connect that never returns can hang indefinitely    |

`TypeError: fetch failed` is undici's generic wrapper. The real cause is always attached as `error.cause` and is one of `ECONNRESET`, `ECONNREFUSED`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`, etc.

### 3.2 undici issue #5450 — concurrent-load socket reuse

[`nodejs/undici#5450`](https://github.com/nodejs/undici/issues/5450) ("`TypeError: fetch failed` under concurrent load due to socket reuse / keep-alive timeout mismatch") is the same symptom. Maintainer `@metcoder95` closed it as **expected behavior**:

> The behavior is expected as per undici queueing design … Each Socket maps to a single Client; each Client has its own request queue, when that Socket is teardown (by the remote server or by the Client itself), the Client is unusable and all its queue is also errored.
>
> The recommendation is to use either the `interceptor.retry` or the `RetryAgent` for this identified pattern.

In other words: a transient `TypeError: fetch failed` on concurrent load is **the documented, expected undici behavior**, and consumers are expected to handle it with retry.

### 3.3 VS Code 1.129 release notes

[VS Code 1.129](https://code.visualstudio.com/updates/v1_129) (July 15, 2026) introduced the **agent host** — a dedicated process for agent sessions (Copilot / Claude / Codex harnesses) that can be connected to from multiple windows simultaneously. This raises the number of concurrent `provideLanguageModelChatInformation` calls into BYOK providers, which in turn raises the probability of hitting the undici socket-reuse race per unit time.

No change to the `LanguageModelChatProvider` API itself breaks our extension; the regression is purely an increase in concurrent fetches against a flaky transport layer.

### 3.4 Prior issue #51 (closed via PR #53) — different root cause

[`#51`](https://github.com/ltmoerdani/opencode-copilot-chat/issues/51) shared the same log line ("Could not fetch … fetch failed") but the actual root cause was a `TypeError: Cannot read properties of undefined (reading 'charAt')` from VS Code 1.126's unified picker passing `category` as a plain string instead of `{ label, order }`. PR #53 fixed that schema mismatch.

The remaining "spamming notification" half of #51 was mitigated by replacing `showWarningMessage` with an Output-channel log (in the unreleased MCP image PR). **#78 is a new, separate issue**: transient network resilience, not a schema crash.

---

## 4. Root Cause

`src/extension.ts` `fetchModels()` (pre-fix):

```ts
private async fetchModels(apiKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const response = await fetch(this.definition.modelsUrl, { headers });
    // ... parse + filterAvailableModels ...
  } catch (error) {
    this.log(`[fetchModels] ... Using bundled model list.`);
    return this.filterAvailableModels(this.definition.fallbackModels);
  }
}
```

Gaps:

1. **No timeout** — a hung connect could hold the picker for up to 5 minutes.
2. **No retry** — a single `ECONNRESET`/`EAI_AGAIN` immediately downgraded to the bundled list.
3. **No `User-Agent`** — strict gateways can silently drop anonymous requests. (`refreshOpenCodeModelMetadata()` already sends one via the gateway-header builder, but `fetchModels` did not.)
4. **Stale `OPEN_CODE_USER_AGENT` constant** — hardcoded `"opencode-copilot-chat/0.3.6 VSCode"` while `package.json` was at `0.4.1` (drift, a recurring problem: see `docs/issues/17`).
5. **No `CancellationToken` threading** — VS Code cancelling a stale resolution (common during agent-host re-resolution) left the in-flight fetch running.
6. **No cache** — a previously fetched list was thrown away on every call, so transient failure always fell straight to bundled (or, via `provideLanguageModelChatInformation`'s `if (models.length === 0) return []`, to an empty list → "flash then disappear").

---

## 5. Solution

Six coordinated changes in `src/extension.ts`:

1. **Per-attempt timeout** — `AbortSignal.timeout(MODEL_LIST_FETCH_TIMEOUT_MS = 15_000)`.
2. **Exponential retry** — up to `MODEL_LIST_FETCH_MAX_RETRIES = 3` attempts with `500ms * 2^attempt` backoff (500 ms, 1 s, 2 s). Only transient errors are retried (`isTransientFetchError()` classifies by `error.cause.code`, `error.cause.name`, HTTP status 408/429/5xx, and the `TypeError: fetch failed` wrapper).
3. **`User-Agent` propagation** — `getUserAgent()` reads `context.extension.packageJSON.version` once, caches the result, and falls back to `FALLBACK_USER_AGENT` if unavailable. No more drift.
4. **`CancellationToken` threading** — `fetchModels(apiKey, token?)` composes the caller's token with the timeout signal via `AbortSignal.any([...])`. Cancellation short-circuits to a fallback and never retries.
5. **1-hour cached snapshot** — every successful fetch persists `{ ids, fetchedAt }` to `globalState` under `opencode.modelListCache.v1::<vendor>`. On final failure, `loadCachedModelList()` returns the cached list if fresher than `MODEL_LIST_CACHE_TTL_MS = 1h`; only then does it fall back to bundled.
6. **`Accept: application/json` header** — added after the reporter's reply revealed that POST `/chat/completions` (with `Content-Type: application/json`) was passing through their VPN + corporate firewall on Windows 11, while the bare GET `/models` (no `Content-Type`, no `Accept`) was being dropped. SSL-inspecting proxies (Zscaler, Netskope, Fortinet) commonly treat anonymous GETs as scanner traffic. The explicit `Accept` header makes the request look like a legitimate API call.

---

## 6. Code Changes

### 6.1 File map

| File               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts` | Replace hardcoded `OPEN_CODE_USER_AGENT` with `getUserAgent()`; add `FALLBACK_USER_AGENT`, `MODEL_LIST_FETCH_TIMEOUT_MS`, `MODEL_LIST_FETCH_MAX_RETRIES`, `MODEL_LIST_FETCH_RETRY_BASE_MS`, `MODEL_LIST_CACHE_TTL_MS`, `MODEL_LIST_CACHE_KEY_PREFIX`; add helpers `getUserAgent()`, `isTransientFetchError()`, `sleep()`. Rewrite `OpenCodeProvider.fetchModels()`; add `cachedModelList` field + `modelListCacheKey` getter + `signalFromToken()`, `errMsg()`, `fallbackModelList()`, `loadCachedModelList()` helpers. Thread `token` from `provideLanguageModelChatInformation`. Pass stored API key in `refreshMetadataAndModels()`. |

### 6.2 Key new constant

```ts
const MODEL_LIST_FETCH_TIMEOUT_MS = 15_000;
const MODEL_LIST_FETCH_MAX_RETRIES = 3;
const MODEL_LIST_FETCH_RETRY_BASE_MS = 500; // 500ms, 1s, 2s
const MODEL_LIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
```

### 6.3 Retry classification

```ts
function isTransientFetchError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const cause = (error as { cause?: { code?: string; name?: string } })?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code;
  const name = cause?.name ?? (error as { name?: string })?.name;
  if (code && /^E(AI_AGAIN|CONNRESET|CONNREFUSED|CONNABORTED|TIMEDOUT|HOSTUNREACH|NETUNREACH|PROTO|PIPE)$/.test(code)) return true;
  if (name && /^UND_ERR_(CONNECT_TIMEOUT|SOCKET|REQUEST_TIMEOUT)$/.test(name)) return true;
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) return true;
  const httpStatus = (error as { status?: number })?.status;
  if (typeof httpStatus === "number") {
    return httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
  }
  return false;
}
```

### 6.4 Fallback order on final failure

```
1. caller CancellationToken fired        → cached (fresh) > bundled
2. non-transient HTTP 4xx                → cached (fresh) > bundled
3. transient error after N retries       → cached (fresh) > bundled
4. cached snapshot expired (>1h)         → bundled only
5. cached snapshot absent                → bundled only
```

---

## 7. Behavior Matrix

| Scenario                                  | Pre-fix                               | Post-fix                                                |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| Healthy network                           | Live list                             | Live list (cached)                                      |
| Slow DNS (`EAI_AGAIN`) at startup         | Bundled list (after up to 5 min hang) | Live list after 1–2 retries (≤1.5 s extra)              |
| Stale keep-alive socket (`ECONNRESET`)    | Bundled list                          | Live list after 1 retry (500 ms)                        |
| Gateway 503 burst                         | Bundled list                          | Live list after retry, or cached if 503s persist        |
| Gateway 401/403 (bad key)                 | Bundled list (silent)                 | Cached if available, else bundled; no retry on 4xx      |
| VS Code cancels resolution mid-fetch      | In-flight fetch keeps running         | Aborted via `AbortSignal.any`, returns cached/bundled   |
| Sustained outage >1h                      | Bundled list                          | Bundled list (cache TTL expired)                        |
| VS Code 1.129 agent-host concurrent calls | Flash/disappear race                  | Each call hits cache after first success; picker stable |

---

## 8. What This Does NOT Fix

- **Corporate proxy / VPN / firewall blocking `opencode.ai`**: extension cannot route around an outright block. Users must configure VS Code's `http.proxy` setting.
- **Gateway outage longer than the retry budget (~3.5 s)**: still degrades to cached (1h) then bundled.
- **Underlying undici socket-reuse race**: this is upstream behavior (issue #5450, expected per maintainers). The extension now tolerates it via retry; we did not install a global custom dispatcher (`interceptors.retry` + `interceptors.dns`) because that affects every `fetch` in the extension and was deemed overkill for this MVP fix.
- **`OPEN_CODE_USER_AGENT` drift in test harnesses** that stub `vscode.extensions.getExtension`: those fall back to `FALLBACK_USER_AGENT`, which must be bumped manually when the extension's major version changes.

---

## 9. Verification

- `npm run compile` (`tsc -p ./`) — clean, no errors.
- `get_errors` on `src/extension.ts` — no diagnostics.
- Manual test (next session, not in this commit):
  - Throttle network in OS to "very slow" → confirm retry logs appear in Output channel and picker stays populated.
  - Kill network during fetch → confirm `[fetchModels] ... Using cached model list` log and picker stays populated from cache.
  - Trigger "Refresh Models" command with no network → confirm fallback to cache (1h) then bundled.

---

## 9b. Drive-by: Top-level Refresh Models commands (parity fix)

After the initial fix landed, the issue reporter (`@leiyu1980`) replied that they could not find `OpenCode Go: Refresh Models` in the Command Palette. Investigation revealed this was a UX gap, not a bug:

### What was wrong

- `Refresh Models` existed only as an **action inside the `OpenCode Go: Manage Provider` QuickPick** (`src/extension.ts` `manage()`). It was never registered as a top-level command.
- **Zen had no `Manage Provider` command at all** — only `OpenCode Zen: Diagnostics`. So a Zen user (which is the reporter's case: "Zen models flash briefly before disappearing") had zero manual refresh path via the palette.
- The README commands table only listed `Manage Provider` for Go, reinforcing the asymmetry.

The maintainer's first reply had told the reporter to "run `OpenCode Go: Refresh Models` from the Command Palette", which was wrong. The command didn't exist at that name.

### What changed

Three new top-level commands are registered in `activate()` and declared in `package.json` `contributes.commands`:

| Command                         | Behavior                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenCode Go: Refresh Models`   | Skips the Manage Provider QuickPick. Goes straight to a fresh model-list fetch + `changeEmitter.fire()` so VS Code re-resolves the picker. Falls back to `setApiKey()` if no key is stored. |
| `OpenCode Zen: Manage Provider` | Parity with Go. Opens the same QuickPick (Set / Clear / Test / Refresh).                                                                                                                    |
| `OpenCode Zen: Refresh Models`  | Same as the Go refresh command, scoped to Zen.                                                                                                                                              |

Implementation: a new public `refreshModels()` method on `OpenCodeProvider` wraps the private `refreshMetadataAndModels()` + `changeEmitter.fire()` + toast. `manage()`'s "Refresh Models" action now delegates to this method (single source of truth). No change to existing `opencodego.manage` behavior — backward compatible.

### Why this belongs in the same PR

The reporter explicitly expected these commands to exist when verifying the #78 fix. Shipping them together means one release closes the loop: the cache/retry fix keeps the picker populated automatically, and the new commands give users an explicit "force refresh" escape hatch for the cases where the auto behavior isn't enough.

---

## 10. References

- GitHub issue: [#78](https://github.com/ltmoerdani/opencode-copilot-chat/issues/78)
- Related (closed, different root cause): [#51](https://github.com/ltmoerdani/opencode-copilot-chat/issues/51) → PR [#53](https://github.com/ltmoerdani/opencode-copilot-chat/pull/53)
- undici concurrent-load issue: [`nodejs/undici#5450`](https://github.com/nodejs/undici/issues/5450)
- undici `Dispatcher` defaults (`headersTimeout`, `bodyTimeout`): [`Dispatcher.md`](https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md)
- undici built-in interceptors (`retry`, `dns`, `responseError`): [`Interceptors.md`](https://github.com/nodejs/undici/blob/main/docs/docs/api/Interceptors.md)
- Node.js global `fetch` / `AbortSignal.timeout` / `AbortSignal.any`: [`nodejs.org/api/globals`](https://nodejs.org/api/globals.html)
- VS Code 1.129 release notes (agent host): [`code.visualstudio.com/updates/v1_129`](https://code.visualstudio.com/updates/v1_129)
- OpenCode Zen gateway endpoints: [`opencode.ai/docs/zen`](https://opencode.ai/docs/zen/) and [`opencode.ai/docs/go`](https://opencode.ai/docs/go/)
- Prior drift incident (`OPEN_CODE_USER_AGENT`): `docs/issues/17-20260609-project-cleanup-immediate-bugfixes.md`
- Pattern reference (timeout already in use): `refreshOpenCodeModelMetadata()` in `src/extension.ts`
