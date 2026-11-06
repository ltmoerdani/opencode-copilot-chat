import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CACHE_RATE_ALERT_DEBOUNCE_MS,
  CACHE_RATE_IDLE_TTL_MS,
  CACHE_RATE_LOW_STREAK_REQUIRED,
  CACHE_RATE_MIN_PROMPT_TOKENS,
  CACHE_RATE_WINDOW_REQUESTS,
  DEFAULT_CACHE_RATE_THRESHOLD,
} from "../config.js";
import { createCacheMonitor, resolveCacheRateThreshold, type CacheSample } from "../usage/cacheMonitor.js";

/** Prompt size above {@link CACHE_RATE_MIN_PROMPT_TOKENS}, i.e. a real turn. */
const PROMPT = 100_000;

/**
 * Build a monitor with an injectable clock and threshold, capturing the
 * notification messages for assertions.
 */
function makeMonitor(threshold: number) {
  const messages: string[] = [];
  let nowMs = 0;
  const monitor = createCacheMonitor(() => threshold, {
    notify: (message) => messages.push(message),
    now: () => nowMs,
  });
  const advance = (ms: number): void => {
    nowMs += ms;
  };
  return { monitor, messages, advance };
}

function sample(overrides: Partial<CacheSample> = {}): CacheSample {
  return {
    promptTokens: PROMPT,
    cachedTokens: 90_000,
    modelId: "qwen3.6-plus",
    timestampMs: 0,
    ...overrides,
  };
}

describe("cacheMonitor", () => {
  // ════════════════════════════════════════════════════════════════════════
  // hitRate math over the rolling window
  // ════════════════════════════════════════════════════════════════════════

  describe("hitRate math", () => {
    it("computes sum(cached) / sum(prompt) over the rolling window", () => {
      const { monitor } = makeMonitor(0.5);
      let ts = 0;
      const record = (prompt: number, cached: number) =>
        monitor.recordCacheSample(sample({ promptTokens: prompt, cachedTokens: cached, timestampMs: ++ts }));
      monitor.recordCacheSample(sample({ promptTokens: PROMPT, cachedTokens: PROMPT, timestampMs: 1 }));
      monitor.recordCacheSample(sample({ promptTokens: PROMPT, cachedTokens: PROMPT / 2, timestampMs: 2 }));
      const result = record(PROMPT, 0);
      // window: 100% + 50% + 0% → cached 150k, prompt 300k → 0.5
      assert.equal(result.hitRate, 0.5);
      assert.equal(result.alerted, false);
    });

    it("keeps only the last CACHE_RATE_WINDOW_REQUESTS samples", () => {
      const { monitor } = makeMonitor(0.5);
      let ts = 0;
      // Fill the window with all-cached requests.
      for (let i = 0; i < CACHE_RATE_WINDOW_REQUESTS; i++) {
        monitor.recordCacheSample(sample({ promptTokens: PROMPT, cachedTokens: PROMPT, timestampMs: ++ts }));
      }
      // Five misses push the five all-cached samples out of the window.
      let result;
      for (let i = 0; i < CACHE_RATE_WINDOW_REQUESTS; i++) {
        result = monitor.recordCacheSample(sample({ promptTokens: PROMPT, cachedTokens: 0, timestampMs: ++ts }));
      }
      // Only the misses remain → hit rate 0.
      assert.equal(result?.hitRate, 0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Silence conditions
  // ════════════════════════════════════════════════════════════════════════

  it("does not alert when the prompt-token sum is 0", () => {
    const { monitor, messages } = makeMonitor(0.5);
    let ts = 0;
    for (let i = 0; i < 2; i++) {
      const result = monitor.recordCacheSample(sample({ promptTokens: 0, cachedTokens: 0, timestampMs: ++ts }));
      assert.equal(result.hitRate, undefined);
      assert.equal(result.alerted, false);
    }
    assert.equal(messages.length, 0);
  });

  it("stays silent while any window sample lacks cachedTokens", () => {
    const { monitor, messages } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 100, timestampMs: 1 }));
    const result = monitor.recordCacheSample(sample({ cachedTokens: undefined, timestampMs: 2 }));
    assert.equal(result.hitRate, undefined);
    assert.equal(result.alerted, false);
    assert.equal(messages.length, 0);
  });

  it("does not alert when only one eligible request is below the threshold", () => {
    const { monitor, messages } = makeMonitor(0.5);
    const result = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    assert.equal(result.alerted, false);
    assert.equal(messages.length, 0);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Context switches and sampling filters
  // ════════════════════════════════════════════════════════════════════════

  it("ignores requests below the sampling threshold", () => {
    const { monitor, messages } = makeMonitor(0.5);
    let ts = 0;
    // A tiny probe reports 0% cached; it must neither enter the window nor
    // break an existing streak.
    for (let i = 0; i < 5; i++) {
      const result = monitor.recordCacheSample(
        sample({ promptTokens: CACHE_RATE_MIN_PROMPT_TOKENS - 1, cachedTokens: 0, timestampMs: ++ts }),
      );
      assert.equal(result.hitRate, undefined);
      assert.equal(result.alerted, false);
    }
    assert.equal(messages.length, 0);
  });

  it("resets the window when the model changes (cold prefix by construction)", () => {
    const { monitor, messages } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 2 }));
    // Model switch: the gateway's session anchor includes the model, so the
    // first request on the new model can never hit the previous prefix.
    const switched = monitor.recordCacheSample(sample({ modelId: "deepseek-v4.1-flash", cachedTokens: 0, timestampMs: 3 }));
    assert.equal(switched.hitRate, undefined);
    assert.equal(switched.alerted, false);
    assert.equal(messages.length, 0);
  });

  it("resets the window when the chat session changes", () => {
    const { monitor, messages } = makeMonitor(0.5);
    const sessionId = "vscode-abc";
    monitor.recordCacheSample(sample({ sessionId, cachedTokens: 0, timestampMs: 1 }));
    monitor.recordCacheSample(sample({ sessionId, cachedTokens: 0, timestampMs: 2 }));
    const switched = monitor.recordCacheSample(sample({ sessionId: "vscode-xyz", cachedTokens: 0, timestampMs: 3 }));
    assert.equal(switched.alerted, false);
    assert.equal(messages.length, 0);
    // The new session's window starts fresh: one low request is not enough.
    const after = monitor.recordCacheSample(sample({ sessionId: "vscode-xyz", cachedTokens: 0, timestampMs: 4 }));
    assert.equal(after.alerted, false);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Expected rebuilds reset the window instead of alerting
  // ════════════════════════════════════════════════════════════════════════

  it("resets the window on a trimmed-history rebuild instead of alerting", () => {
    const { monitor, messages } = makeMonitor(0.5);
    // Two low-rate requests would normally alert.
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    // A history trim is an expected rebuild: reset, no alert.
    const reset = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 2, historyTrimmed: true }));
    assert.equal(reset.hitRate, undefined);
    assert.equal(reset.alerted, false);
    assert.equal(messages.length, 0);
    // The window was reset, so the next low request alone must not alert.
    const after = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 3 }));
    assert.equal(after.alerted, false);
    assert.equal(messages.length, 0);
  });

  it("resets the window after an idle gap longer than the provider cache TTL", () => {
    const { monitor, messages } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    // Idle past the TTL: the cache expired on its own — expected, not a regression.
    const afterIdle = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 + CACHE_RATE_IDLE_TTL_MS + 1 }));
    assert.equal(afterIdle.alerted, false);
    assert.equal(messages.length, 0);
    // Window was reset → the next single low request must not alert either.
    const next = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 2 + CACHE_RATE_IDLE_TTL_MS }));
    assert.equal(next.alerted, false);
    assert.equal(messages.length, 0);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Alerting: low-streak requirement, debounce, message content
  // ════════════════════════════════════════════════════════════════════════

  it("alerts once the low rate holds for CACHE_RATE_LOW_STREAK_REQUIRED requests", () => {
    const { monitor, messages } = makeMonitor(0.5);
    let result;
    for (let i = 0; i < CACHE_RATE_LOW_STREAK_REQUIRED; i++) {
      result = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: i + 1 }));
      assert.equal(result.alerted, i + 1 === CACHE_RATE_LOW_STREAK_REQUIRED);
    }
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes("0%"), "message includes the hit-rate percent");
    assert.ok(messages[0].includes("qwen3.6-plus"), "message names the model");
    assert.ok(messages[0].includes("Compact Conversation"), "message includes the remedy");
    assert.ok(messages[0].includes("start a new session"), "message includes the remedy");
  });

  it("a healthy request breaks the low streak", () => {
    const { monitor, messages } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 })); // streak 1
    // Fully cached: the window rate returns to 50% (not below the threshold).
    const healthy = monitor.recordCacheSample(sample({ cachedTokens: PROMPT, timestampMs: 2 }));
    assert.equal(healthy.hitRate, 0.5);
    assert.equal(healthy.alerted, false);
    // The streak was reset, so a single low request cannot alert.
    const result = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 3 }));
    assert.equal(result.alerted, false);
    assert.equal(messages.length, 0);
  });

  it("debounces: suppresses a second alert within CACHE_RATE_ALERT_DEBOUNCE_MS", () => {
    const { monitor, messages, advance } = makeMonitor(0.5);
    for (let i = 0; i < CACHE_RATE_LOW_STREAK_REQUIRED; i++) {
      monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: i + 1 }));
    }
    assert.equal(messages.length, 1);
    // Still low, still inside the debounce window → no second alert.
    advance(1000);
    const inside = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 10 }));
    assert.equal(inside.alerted, false);
    assert.equal(messages.length, 1);
    // Past the debounce window → alerts again.
    advance(CACHE_RATE_ALERT_DEBOUNCE_MS);
    const outside = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 11 }));
    assert.equal(outside.alerted, true);
    assert.equal(messages.length, 2);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Threshold 0 disables monitoring
  // ════════════════════════════════════════════════════════════════════════

  it("threshold 0 disables monitoring entirely", () => {
    const { monitor, messages } = makeMonitor(0);
    let ts = 0;
    for (let i = 0; i < 10; i++) {
      const result = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: ++ts }));
      assert.equal(result.hitRate, undefined);
      assert.equal(result.alerted, false);
    }
    assert.equal(messages.length, 0);
  });

  // ════════════════════════════════════════════════════════════════════════
  // reset()
  // ════════════════════════════════════════════════════════════════════════

  it("reset() clears the window and the consecutive streak", () => {
    const { monitor, messages } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    monitor.reset();
    const result = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 2 }));
    assert.equal(result.alerted, false);
    assert.equal(messages.length, 0);
  });

  it("turning the switch off clears the window, so re-enabling starts fresh", () => {
    let threshold = 0.5;
    const messages: string[] = [];
    const monitor = createCacheMonitor(() => threshold, {
      notify: (message) => messages.push(message),
      now: () => 0,
    });
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 2 }));
    // Switch off (the setting maps to threshold 0) — the window is dropped.
    threshold = 0;
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 3 }));
    // Switch back on: the first sample must not inherit the pre-switch streak.
    threshold = 0.5;
    const after = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 4 }));
    assert.equal(after.alerted, false);
    assert.equal(messages.length, 0);
  });
});

describe("resolveCacheRateThreshold", () => {
  it("returns 0 when the on/off switch is off", () => {
    assert.equal(resolveCacheRateThreshold(false, 0.5), 0);
    assert.equal(resolveCacheRateThreshold(false, undefined), 0);
  });

  it("keeps the configured fraction when the switch is on", () => {
    assert.equal(resolveCacheRateThreshold(true, 0.7), 0.7);
    assert.equal(resolveCacheRateThreshold(undefined, 0.7), 0.7);
  });

  it("falls back to the default for a missing or non-numeric fraction", () => {
    assert.equal(resolveCacheRateThreshold(true, undefined), DEFAULT_CACHE_RATE_THRESHOLD);
    assert.equal(resolveCacheRateThreshold(true, Number.NaN), DEFAULT_CACHE_RATE_THRESHOLD);
  });

  it("clamps the fraction into 0..1", () => {
    assert.equal(resolveCacheRateThreshold(true, 5), 1);
    assert.equal(resolveCacheRateThreshold(true, -1), 0);
  });
});
