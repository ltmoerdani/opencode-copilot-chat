#!/usr/bin/env node
/**
 * test-retry-e2e.ts — End-to-end retry integration test with mock server.
 *
 * Proves the full retry flow works WITHOUT a real API key:
 * 1. Starts a local HTTP server simulating OpenCode API
 * 2. Server returns 400 for invalid params, 200 for valid params
 * 3. Sends request → gets 400 → analyzeHttp400ForRetry() → retries → gets 200
 *
 * Usage: npx tsx scripts/test-retry-e2e.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { analyzeHttp400ForRetry } from "../src/retry.js";

// ---------------------------------------------------------------------------
// Mock OpenCode API server
// ---------------------------------------------------------------------------

interface MockRequestBody {
  model?: unknown;
  thinking?: { type?: unknown };
  temperature?: unknown;
  reasoning_effort?: unknown;
  messages?: unknown;
}

/** JSON.parse returns `any`; shape it into a minimal, typed view of the body. */
function parseMockBody(body: string): MockRequestBody {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  return parsed;
}

function createMockServer() {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const parsed = parseMockBody(body);
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

        // DeepSeek V4.1 Flash thinking mode (issue #239): 400 when reasoning
        // is still enabled OR any assistant history message carries a
        // reasoning_content echo — mirrors the upstream validator that
        // demands prior-turn reasoning be passed back.
        if (model === "deepseek-v4.1-flash") {
          const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
          const hasEcho = messages.some(
            (m: unknown) =>
              typeof m === "object" &&
              m !== null &&
              (m as { role?: unknown; reasoning_content?: unknown }).role === "assistant" &&
              (m as { reasoning_content?: unknown }).reasoning_content !== undefined,
          );
          if (parsed.reasoning_effort !== undefined || hasEcho) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  param: null,
                  type: "invalid_request_error",
                  code: "invalid_request_error",
                  message:
                    "Upstream request failed: [invalid_request_error] The `reasoning_content` in the thinking mode must be passed back to the API.",
                },
              }),
            );
            return;
          }
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
  {
    // Issue #239: reasoning lost from history while thinking is still on.
    // The upstream 400s demanding the echo back; the patch strips the echo
    // AND reasoning_effort so the request is self-contained again.
    name: "DeepSeek V4.1 Flash: reasoning echo missing → strip echo + effort",
    badBody: {
      model: "deepseek-v4.1-flash",
      max_tokens: 10,
      reasoning_effort: "low",
      messages: [
        { role: "user", content: "do a task" },
        { role: "assistant", content: "working", reasoning_content: "lost chain of thought", tool_calls: [] },
        { role: "tool", tool_call_id: "call_1", content: "tool output" },
      ],
    },
    expectedPatch: (b) => {
      const messages = (b.messages as Array<Record<string, unknown>>).map((m) =>
        m.role === "assistant" ? { ...m, reasoning_content: undefined } : m,
      );
      return { ...b, messages, reasoning_effort: undefined };
    },
  },
  {
    name: "DeepSeek V4.1 Flash: no echo + no effort → 200 (healthy request)",
    badBody: {
      model: "deepseek-v4.1-flash",
      max_tokens: 10,
      messages: [
        { role: "user", content: "do a task" },
        { role: "assistant", content: "working" },
      ],
    },
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
    console.log(`❌ Expected 400 or 200, got ${String(res.status)}`);
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
  const retryBody = patch.body;
  if (!retryBody) {
    console.log(`❌ Patch produced no body`);
    return false;
  }
  const retryRes = await sendRequest(`${baseUrl}/chat/completions`, retryBody);
  if (retryRes.status !== 200) {
    console.log(`❌ Got ${String(retryRes.status)}: ${retryRes.body.slice(0, 100)}`);
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
  const baseUrl = `http://127.0.0.1:${String(addr.port)}`;
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
  console.log(`  Results: ${String(passed)} passed, ${String(failed)} failed`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("❌ Some tests failed.");
    process.exit(1);
  }
  console.log("✅ All tests passed. Retry mechanism works end-to-end.");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
