import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CACHE_RATE_WINDOW_REQUESTS, CACHE_RATE_IDLE_TTL_MS, CACHE_RATE_ALERT_DEBOUNCE_MS } from "../config.js";
import { createCacheMonitor, type CacheSample } from "../usage/cacheMonitor.js";

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
    promptTokens: 1000,
    cachedTokens: 900,
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
      monitor.recordCacheSample(sample({ promptTokens: 100, cachedTokens: 100, timestampMs: 1 }));
      monitor.recordCacheSample(sample({ promptTokens: 100, cachedTokens: 50, timestampMs: 2 }));
      const result = record(100, 0);
      // window: 100/100 + 100/50 + 100/0 → cached 150, prompt 300 → 0.5
      assert.equal(result.hitRate, 0.5);
      assert.equal(result.alerted, false);
    });

    it("keeps only the last CACHE_RATE_WINDOW_REQUESTS samples", () => {
      const { monitor } = makeMonitor(0.5);
      let ts = 0;
      // Fill the window with all-cached requests.
      for (let i = 0; i < CACHE_RATE_WINDOW_REQUESTS; i++) {
        monitor.recordCacheSample(sample({ promptTokens: 100, cachedTokens: 100, timestampMs: ++ts }));
      }
      // Five misses push the five all-cached samples out of the window.
      let result;
      for (let i = 0; i < CACHE_RATE_WINDOW_REQUESTS; i++) {
        result = monitor.recordCacheSample(sample({ promptTokens: 100, cachedTokens: 0, timestampMs: ++ts }));
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
  // Alerting: 2-consecutive requirement, debounce, message content
  // ════════════════════════════════════════════════════════════════════════

  it("alerts on the second consecutive low request with rate percent and remedy", () => {
    const { monitor, messages } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    const result = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 2 }));
    assert.equal(result.alerted, true);
    assert.equal(result.hitRate, 0);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes("0%"), "message includes the hit-rate percent");
    assert.ok(messages[0].includes("Compact Conversation"), "message includes the remedy");
    assert.ok(messages[0].includes("start a new session"), "message includes the remedy");
  });

  it("requires 2 consecutive low requests: a healthy request breaks the streak", () => {
    const { monitor, messages } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    monitor.recordCacheSample(sample({ cachedTokens: 1000, timestampMs: 2 })); // healthy (100%) → resets streak
    const result = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 3 }));
    assert.equal(result.alerted, false);
    assert.equal(messages.length, 0);
  });

  it("debounces: suppresses a second alert within CACHE_RATE_ALERT_DEBOUNCE_MS", () => {
    const { monitor, messages, advance } = makeMonitor(0.5);
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 1 }));
    monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 2 }));
    assert.equal(messages.length, 1);
    // Healthy then low again, still inside the debounce window → no second alert.
    advance(1000);
    monitor.recordCacheSample(sample({ cachedTokens: 100, timestampMs: 3 }));
    const inside = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 4 }));
    assert.equal(inside.alerted, false);
    assert.equal(messages.length, 1);
    // Past the debounce window → alerts again.
    advance(CACHE_RATE_ALERT_DEBOUNCE_MS);
    const outside = monitor.recordCacheSample(sample({ cachedTokens: 0, timestampMs: 5 }));
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
});
