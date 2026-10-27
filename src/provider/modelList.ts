import type * as vscode from "vscode";
import {
  MODEL_LIST_CACHE_KEY_PREFIX,
  MODEL_LIST_CACHE_TTL_MS,
  MODEL_LIST_FETCH_MAX_RETRIES,
  MODEL_LIST_FETCH_RETRY_BASE_MS,
  MODEL_LIST_FETCH_TIMEOUT_MS,
} from "../config";
import { getErrorMessage } from "../utils";
import { sleep } from "../utils";
import { getUserAgent, isTransientFetchError, type ModelListEntry, type ModelListResponse, type ProviderDefinition } from "./definitions";
import { auxiliarySessionId } from "../request/headers";
import { resolveBaseVendor } from "../providerTypes";

/**
 * A 401 from the models endpoint means the STORED key was rejected — the
 * endpoint itself is a public catalog (the official docs curl it without
 * auth), so this is a key problem, never a list/gateway problem (issue
 * #269). Matched on the message shape thrown in `fetch()` so the
 * `retry.ts` classification (which parses the same prefix) stays untouched.
 */
function isUnauthorizedModelListError(error: unknown): boolean {
  return getErrorMessage(error).includes("Model list request failed (401)");
}

/**
 * Fetches the live `/models` list with retry/backoff and cancellation support,
 * caching the last successful snapshot in globalState (TTL-guarded) so
 * transient failures fall back to fresh data instead of the bundled list.
 */
export class ModelListFetcher {
  private cached: { ids: string[]; fetchedAt: number } | undefined;
  private readonly cacheKey: string;

  constructor(
    private readonly deps: {
      context: vscode.ExtensionContext;
      definition: ProviderDefinition;
      log(message: string): void;
      replaceLiveModelMetadata(models: ModelListEntry[] | undefined): void;
      filterAvailableModels(modelIds: string[], liveModelIds?: ReadonlySet<string>): Promise<string[]>;
    },
  ) {
    this.cacheKey = `${MODEL_LIST_CACHE_KEY_PREFIX}::${resolveBaseVendor(this.deps.definition.vendor)}`;
  }

  async fetch(apiKey?: string, token?: vscode.CancellationToken): Promise<string[]> {
    if (token?.isCancellationRequested) return this.fallback();

    // ISSUE #222: VS Code polls provideLanguageModelChatInformation every
    // few hundred ms. Consult the fresh cached snapshot BEFORE the live
    // fetch so each poll is local work instead of an upstream
    // `GET /models` round-trip. A stale snapshot falls through to the
    // live fetch + retry path below; `Refresh Models` forces a real
    // refresh by clearing the cache first.
    const cachedFresh = this.loadCached();
    if (cachedFresh) {
      return this.deps.filterAvailableModels(cachedFresh.ids);
    }

    // Explicit Accept + User-Agent make this look like a legitimate API call
    // rather than an anonymous scanner. Some corporate firewalls / SSL
    // inspection proxies (Zscaler, Netskope, Fortinet) drop bare GETs that
    // lack these headers even when the host is allow-listed. Issue #78
    // reporter sits behind a VPN + corporate firewall on Windows 11.
    const headers: Record<string, string> = {
      "User-Agent": getUserAgent(),
      Accept: "application/json",
      // Gateway enforcement: every OpenCode request needs a stable session id
      // (docs/go, 2026-09-07). /models has no conversation — use the
      // persisted per-installation id.
      "x-opencode-session": auxiliarySessionId(this.deps.context),
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MODEL_LIST_FETCH_MAX_RETRIES; attempt++) {
      if (token?.isCancellationRequested) {
        return this.fallback();
      }
      let cancellationLink: { signal: AbortSignal; dispose: () => void } | undefined;
      try {
        // Compose the per-request abort with the caller's cancellation token
        // so either one tears down the in-flight fetch.
        const timeoutSignal = AbortSignal.timeout(MODEL_LIST_FETCH_TIMEOUT_MS);
        cancellationLink = token ? this.signalFromToken(token) : undefined;
        const signal = token && cancellationLink ? AbortSignal.any([timeoutSignal, cancellationLink.signal]) : timeoutSignal;

        const response = await fetch(this.deps.definition.modelsUrl, { headers, signal });
        if (!response.ok) {
          throw new Error(`Model list request failed (${String(response.status)}): ${response.statusText}`);
        }
        const data = (await response.json()) as ModelListResponse;
        this.deps.replaceLiveModelMetadata(data.data);
        const ids = data.data
          ?.map((model) => model.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .filter((id) => this.deps.definition.filterModel?.(id) ?? true);

        // Gateway is source of truth — pass live IDs so stale `deprecated` in
        // models.dev doesn't hide models still served (issue #182).
        const liveIds = ids?.length ? new Set(ids) : undefined;
        const filtered = await this.deps.filterAvailableModels(ids?.length ? ids : this.deps.definition.fallbackModels, liveIds);
        // Persist the successful snapshot for future fallback coverage.
        this.cached = { ids: filtered, fetchedAt: Date.now() };
        void this.deps.context.globalState.update(this.cacheKey, this.cached);
        return filtered;
      } catch (error) {
        cancellationLink?.dispose();
        cancellationLink = undefined;
        lastError = error;
        // 1. If the caller's cancellation token fired, never retry — bail.
        if (token?.isCancellationRequested) {
          return await this.fallback();
        }
        // 2. Classify the error. Timeout (AbortError without token cancel)
        //    and transient network errors are retryable; HTTP 4xx is not.
        const aborted = typeof DOMException === "function" && error instanceof DOMException && error.name === "AbortError";
        const transient = aborted || isTransientFetchError(error);
        // 3. On final attempt or non-transient error, fall through to
        //    cache/bundled fallback below.
        if (!transient || attempt === MODEL_LIST_FETCH_MAX_RETRIES) {
          break;
        }
        const backoff = MODEL_LIST_FETCH_RETRY_BASE_MS * Math.pow(2, attempt);
        this.deps.log(
          `[fetchModels] ${this.deps.definition.displayName}: transient error (attempt ${String(attempt + 1)}/${String(MODEL_LIST_FETCH_MAX_RETRIES + 1)}): ${this.errMsg(error)}. Retrying in ${String(backoff)}ms.`,
        );
        try {
          await sleep(backoff, token);
        } catch {
          // Cancellation during backoff — bail to fallback.
          return await this.fallback();
        }
      } finally {
        cancellationLink?.dispose();
      }
    }

    // Final failure: prefer cached snapshot (still fresh), then bundled list.
    // Issue #269: 401 = the stored key was rejected; the bare "Unauthorized"
    // line reads like a fetch bug, so point at the actual fix. The hint
    // applies to the cached branch below too — same root cause.
    if (isUnauthorizedModelListError(lastError)) {
      this.deps.log(
        `[fetchModels] ${this.deps.definition.displayName}: the stored API key was rejected (401). ` +
          `Update or clear it via "${this.deps.definition.displayName}: Manage Provider" — requests will keep failing until then.`,
      );
    }
    const cached = this.loadCached();
    if (cached) {
      this.deps.log(
        `[fetchModels] ${this.deps.definition.displayName}: ${this.errMsg(lastError)}. Using cached model list (${String(cached.ids.length)} models, fetched ${new Date(cached.fetchedAt).toISOString()}).`,
      );
      return this.deps.filterAvailableModels(cached.ids);
    }
    this.deps.log(
      `[fetchModels] ${this.deps.definition.displayName}: ${this.errMsg(lastError)}. Using bundled model list (${String(this.deps.definition.fallbackModels.length)} models).`,
    );
    return this.deps.filterAvailableModels(this.deps.definition.fallbackModels);
  }

  /** Bundle the cancellation semantics of a VS Code token into an AbortSignal. */
  private signalFromToken(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    let subscription: vscode.Disposable | undefined;
    if (token.isCancellationRequested) {
      controller.abort();
    } else {
      // Already-cancelled tokens still invoke the listener (shortcutEvent),
      // so this single subscription covers the subscribe-time race too.
      subscription = token.onCancellationRequested(() => {
        controller.abort();
      });
    }
    return {
      signal: controller.signal,
      dispose: () => {
        subscription?.dispose();
        subscription = undefined;
      },
    };
  }

  private errMsg(error: unknown): string {
    const message = getErrorMessage(error);
    const cause = (error as { cause?: { code?: string; name?: string; message?: string } } | null | undefined)?.cause;
    return cause?.code ? `${message} [${cause.code}]` : message;
  }

  /**
   * Resolve the model list to use when the fetch path is short-circuited
   * (cancellation, early abort). Prefers a fresh cached snapshot over bundled.
   */
  fallback(): Promise<string[]> {
    const cached = this.loadCached();
    if (cached) {
      return this.deps.filterAvailableModels(cached.ids);
    }
    return this.deps.filterAvailableModels(this.deps.definition.fallbackModels);
  }

  /**
   * Drop the cached snapshot (in-memory + globalState) so the next
   * {@link fetch} performs a real upstream request. Used by the manual
   * `Refresh Models` command, which must bypass the cache-first
   * short-circuit added for issue #222.
   */
  invalidate(): void {
    this.cached = undefined;
    void this.deps.context.globalState.update(this.cacheKey, undefined);
  }

  /**
   * Read the last successful fetch from in-memory cache or globalState.
   * Returns undefined when absent or past {@link MODEL_LIST_CACHE_TTL_MS}.
   */
  private loadCached(): { ids: string[]; fetchedAt: number } | undefined {
    if (this.cached) {
      const fresh = Date.now() - this.cached.fetchedAt < MODEL_LIST_CACHE_TTL_MS;
      if (fresh) return this.cached;
    }
    const stored = this.deps.context.globalState.get<{ ids: string[]; fetchedAt: number }>(this.cacheKey);
    if (stored && Array.isArray(stored.ids) && typeof stored.fetchedAt === "number") {
      const fresh = Date.now() - stored.fetchedAt < MODEL_LIST_CACHE_TTL_MS;
      if (fresh) {
        this.cached = stored;
        return stored;
      }
    }
    return undefined;
  }
}
