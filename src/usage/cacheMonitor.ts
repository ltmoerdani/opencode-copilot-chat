/**
 * Prompt-cache hit-rate monitor (issue #232).
 *
 * Cache misses make OpenCode Go requests ~10-50x more expensive and users do
 * not notice until credits are gone. This module owns the per-session rolling
 * window of per-request cache samples and decides when to warn the user.
 *
 * CONTRACT:
 * - Pure module (no `vscode` import) — the warning delivery is injected via
 *   {@link CacheMonitorDeps.notify} so tests can assert without vscode and so
 *   an alert failure can never break the request pipeline.
 * - The threshold arrives through a getter so the config read stays with the
 *   caller (chatPrep) and every sample re-reads the current setting.
 * - Expected rebuilds (a request whose history was just trimmed, one that
 *   follows an idle gap longer than the provider cache TTL, or the first
 *   request after a model/session switch) RESET the window instead of
 *   alerting: a miss we caused ourselves is not a regression.
 * - Requests smaller than {@link CACHE_RATE_MIN_PROMPT_TOKENS} are ignored —
 *   probes and one-shot helpers carry no conversation prefix to cache.
 * - Alerts require the low rate to hold on {@link CACHE_RATE_LOW_STREAK_REQUIRED}
 *   consecutive eligible requests and are debounced to at most one per
 *   {@link CACHE_RATE_ALERT_DEBOUNCE_MS}.
 */
import {
  CACHE_RATE_ALERT_DEBOUNCE_MS,
  CACHE_RATE_IDLE_TTL_MS,
  CACHE_RATE_LOW_STREAK_REQUIRED,
  CACHE_RATE_MIN_PROMPT_TOKENS,
  CACHE_RATE_WINDOW_REQUESTS,
} from "../config";

/** One request's cache usage, recorded from a `TransportRequestSummary`. */
export interface CacheSample {
  promptTokens: number;
  /** `undefined` when the provider did not report cached tokens. */
  cachedTokens: number | undefined;
  modelId: string;
  /**
   * Gateway session id (`x-opencode-session`). A change means a different
   * provider-side prefix, so the first request of the new session is cold by
   * construction. Omitted when the caller has no stable session identity.
   */
  sessionId?: string;
  timestampMs: number;
  /** True when the request history was just trimmed (expected cache rebuild). */
  historyTrimmed?: boolean;
}

/** Injected side effects so this module stays pure and unit-testable. */
export interface CacheMonitorDeps {
  /** Deliver the warning to the user (wrapped in try/catch by the caller too). */
  notify(message: string): void;
  /** Monotonic-ish clock, injectable for deterministic tests. */
  now(): number;
}

/** Outcome of recording one sample. */
export interface CacheMonitorResult {
  /** Window hit rate, or `undefined` when it cannot be computed (silent). */
  hitRate: number | undefined;
  /** Whether a user warning was emitted for this sample. */
  alerted: boolean;
}

/** Per-session monitor instance. */
export interface CacheRateMonitor {
  recordCacheSample(sample: CacheSample): CacheMonitorResult;
  /** Clear all session state (e.g. on session change). */
  reset(): void;
}

interface WindowEntry {
  promptTokens: number;
  cachedTokens: number | undefined;
  timestampMs: number;
}

/**
 * Create a monitor for one chat session.
 *
 * @param getThreshold Alert when the window hit rate falls below this fraction
 *   (0 disables monitoring entirely).
 */
export function createCacheMonitor(getThreshold: () => number, deps: CacheMonitorDeps): CacheRateMonitor {
  let samples: WindowEntry[] = [];
  let lowStreak = 0;
  let lastAlertMs = Number.NEGATIVE_INFINITY;
  let lastContext: { modelId: string; sessionId: string | undefined } | undefined;

  const resetWindow = (): void => {
    samples = [];
    lowStreak = 0;
  };

  const recordCacheSample = (sample: CacheSample): CacheMonitorResult => {
    const threshold = getThreshold();
    if (threshold <= 0) {
      return { hitRate: undefined, alerted: false };
    }

    // Probes and one-shot helpers (context-window checks, title/summary calls)
    // carry no conversation prefix worth caching — sampling them only dilutes
    // the window with requests that can never hit the cache.
    if (sample.promptTokens < CACHE_RATE_MIN_PROMPT_TOKENS) {
      return { hitRate: undefined, alerted: false };
    }

    // A different model or chat session means a different provider-side prefix
    // (the gateway's sticky session id is derived per model), so the first
    // request afterwards is cold by construction. Reset instead of alerting.
    const contextChanged =
      lastContext !== undefined &&
      (sample.modelId !== lastContext.modelId ||
        (sample.sessionId !== undefined && lastContext.sessionId !== undefined && sample.sessionId !== lastContext.sessionId));
    lastContext = { modelId: sample.modelId, sessionId: sample.sessionId };
    if (contextChanged) {
      resetWindow();
      return { hitRate: undefined, alerted: false };
    }

    // Expected rebuild (a miss that is OUR OWN doing): the history was just
    // trimmed, or the request follows an idle gap longer than the provider's
    // cache TTL. Reset the window instead of letting it count as a regression.
    const last = samples.length > 0 ? samples[samples.length - 1] : undefined;
    const idleRebuild = last !== undefined && sample.timestampMs - last.timestampMs > CACHE_RATE_IDLE_TTL_MS;
    if (sample.historyTrimmed || idleRebuild) {
      resetWindow();
      return { hitRate: undefined, alerted: false };
    }

    samples.push({ promptTokens: sample.promptTokens, cachedTokens: sample.cachedTokens, timestampMs: sample.timestampMs });
    if (samples.length > CACHE_RATE_WINDOW_REQUESTS) {
      samples.splice(0, samples.length - CACHE_RATE_WINDOW_REQUESTS);
    }

    let sumPrompt = 0;
    let sumCached = 0;
    let allCachedKnown = true;
    for (const entry of samples) {
      if (entry.cachedTokens === undefined) {
        allCachedKnown = false;
      }
      sumPrompt += entry.promptTokens;
      sumCached += entry.cachedTokens ?? 0;
    }
    // Providers that never report cachedTokens (Zen/free models) stay silent,
    // as does an empty prompt sum — nothing measurable, nothing to alert on.
    if (!allCachedKnown || sumPrompt === 0) {
      return { hitRate: undefined, alerted: false };
    }

    const hitRate = sumCached / sumPrompt;
    lowStreak = hitRate < threshold ? lowStreak + 1 : 0;
    if (lowStreak >= CACHE_RATE_LOW_STREAK_REQUIRED && deps.now() - lastAlertMs >= CACHE_RATE_ALERT_DEBOUNCE_MS) {
      lastAlertMs = deps.now();
      try {
        deps.notify(alertMessage(hitRate, samples.length, sample.modelId));
      } catch {
        // Never break the request pipeline because a warning failed.
      }
      return { hitRate, alerted: true };
    }
    return { hitRate, alerted: false };
  };

  return {
    recordCacheSample,
    reset: resetWindow,
  };
}

/** User-facing warning text, extracted so the copy lives in one place. */
function alertMessage(hitRate: number, windowSize: number, modelId: string): string {
  const percent = Math.round(hitRate * 100);
  return (
    `OpenCode prompt-cache hit rate is low (${String(percent)}% over the last ${String(windowSize)} requests on ${modelId}). ` +
    "Cache misses make requests much more expensive — run 'Compact Conversation' or start a new session to restore the cached prefix."
  );
}
