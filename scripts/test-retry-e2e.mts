#!/usr/bin/env node
/**
 * test-retry-e2e.mts — End-to-end retry integration test with mock server.
 *
 * Proves the full retry flow works WITHOUT a real API key:
 * 1. Starts a local HTTP server simulating OpenCode API
 * 2. Server returns 400 for invalid params, 200 for valid params
 * 3. Sends request → gets 400 → analyzeHttp400ForRetry() → retries → gets 200
 *
 * Usage: npx tsx scripts/test-retry-e2e.mts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { analyzeHttp400ForRetry } from "../src/retry.js";

// ---------------------------------------------------------------------------
// Mock OpenCode API server
// ---------------------------------------------------------------------------

function createMockServer() {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const model = parsed.model as string;

        // Kimi K2.5: reject thinking.type "disabled"
        if (model === "kimi-k2.5" && parsed.thinking?.type === "disabled") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid thinking: only type=enabled is allowed for this model" } }));
          return;
        }

        // Kimi K2.7-code: reject temperature != 1
        if (model === "kimi-k2.7-code" && parsed.temperature !== undefined && parsed.temperature !== 1) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid temperature: only 1 is allowed for this model" } }));
          return;
        }

        // DeepSeek: reject invalid reasoning_effort
        if (model === "deepseek-v4-pro" && parsed.reasoning_effort === "invalid_value") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "reasoning_effort must be one of: low, medium, high, max" } }));
          return;
        }

        // MiniMax M2.7: reject thinking.type "disabled"
        if (model === "minimax-m2.7" && parsed.thinking?.type === "disabled") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Extra inputs are not permitted, field: 'thinking'" } }));
          return;
        }

        // GLM-5: reject thinking.type "invalid"
        if (model === "glm-5" && parsed.thinking?.type === "invalid") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid thinking type" } }));
          return;
        }

        // Accept valid requests
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
          }),
        );
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid JSON" } }));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

interface TestCase {
  name: string;
  badBody: Record<string, unknown>;
  expectedPatch: (body: Record<string, unknown>) => Record<string, unknown>;
}

const TEST_CASES: TestCase[] = [
  {
    name: "Kimi K2.5: thinking disabled → patch to enabled",
    badBody: { model: "kimi-k2.5", messages: [{ role: "user", content: "Hi" }], max_tokens: 10, thinking: { type: "disabled" } },
    expectedPatch: (b) => ({ ...b, thinking: { type: "enabled" } }),
  },
  {
    name: "Kimi K2.7-code: temperature 0.2 → remove temperature",
    badBody: {
      model: "kimi-k2.7-code",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 10,
      temperature: 0.2,
      thinking: { type: "enabled", keep: "all" },
    },
    expectedPatch: (b) => {
      const n = { ...b };
      delete n.temperature;
      return n;
    },
  },
  {
    name: "DeepSeek: invalid reasoning_effort → remove it",
    badBody: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "Hi" }], max_tokens: 10, reasoning_effort: "invalid_value" },
    expectedPatch: (b) => {
      const n = { ...b };
      delete n.reasoning_effort;
      return n;
    },
  },
  {
    name: "MiniMax M2.7: thinking disabled → remove thinking field",
    badBody: { model: "minimax-m2.7", messages: [{ role: "user", content: "Hi" }], max_tokens: 10, thinking: { type: "disabled" } },
    expectedPatch: (b) => {
      const n = { ...b };
      delete n.thinking;
      return n;
    },
  },
  {
    name: "GLM-5: thinking invalid → remove thinking",
    badBody: { model: "glm-5", messages: [{ role: "user", content: "Hi" }], max_tokens: 10, thinking: { type: "invalid" } },
    expectedPatch: (b) => {
      const n = { ...b };
      delete n.thinking;
      return n;
    },
  },
  {
    name: "DeepSeek: valid reasoning_effort=high → no 400 (no retry needed)",
    badBody: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "Hi" }], max_tokens: 10, reasoning_effort: "high" },
    expectedPatch: (b) => b,
  },
  {
    name: "Kimi K2.5: thinking enabled → no 400 (no retry needed)",
    badBody: { model: "kimi-k2.5", messages: [{ role: "user", content: "Hi" }], max_tokens: 10, thinking: { type: "enabled" } },
    expectedPatch: (b) => b,
  },
];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function sendRequest(url: string, body: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text };
}

async function runTest(tc: TestCase, baseUrl: string): Promise<boolean> {
  process.stdout.write(`🧪 ${tc.name}\n`);

  // Step 1: Send request
  process.stdout.write(`   Step 1: Send params… `);
  const res = await sendRequest(`${baseUrl}/chat/completions`, tc.badBody);

  if (res.status === 200) {
    console.log(`HTTP 200 ✓ (model accepts — no retry needed)`);
    console.log(`   ✅ PASS\n`);
    return true;
  }

  if (res.status !== 400) {
    console.log(`❌ Expected 400 or 200, got ${res.status}`);
    return false;
  }
  console.log(`HTTP 400 ✓`);

  // Step 2: Analyze error
  process.stdout.write(`   Step 2: analyzeHttp400ForRetry()… `);
  const patch = analyzeHttp400ForRetry(res.body, tc.badBody);
  if (!patch) {
    console.log(`❌ Not recognized as recoverable`);
    return false;
  }
  console.log(`"${patch.reason}" ✓`);

  // Step 3: Verify patch matches expected
  process.stdout.write(`   Step 3: Verify patch… `);
  const expected = tc.expectedPatch(tc.badBody);
  if (JSON.stringify(patch.body) !== JSON.stringify(expected)) {
    console.log(`❌ Patch mismatch`);
    console.log(`     Got:      ${JSON.stringify(patch.body)}`);
    console.log(`     Expected: ${JSON.stringify(expected)}`);
    return false;
  }
  console.log(`✓`);

  // Step 4: Retry with patched body
  process.stdout.write(`   Step 4: Retry with patched body… `);
  const retryRes = await sendRequest(`${baseUrl}/chat/completions`, patch.body!);
  if (retryRes.status !== 200) {
    console.log(`❌ Got ${retryRes.status}: ${retryRes.body.slice(0, 100)}`);
    return false;
  }
  console.log(`HTTP 200 ✓`);
  console.log(`   ✅ PASS\n`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Retry E2E Test — Mock Server");
  console.log("═══════════════════════════════════════════════════════\n");

  const server = createMockServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    console.error("Failed to start mock server");
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`Mock server: ${baseUrl}\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    try {
      const ok = await runTest(tc, baseUrl);
      if (ok) passed++;
      else failed++;
    } catch (err) {
      console.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      failed++;
    }
  }

  server.close();

  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("❌ Some tests failed.");
    process.exit(1);
  }
  console.log("✅ All tests passed. Retry mechanism works end-to-end.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
