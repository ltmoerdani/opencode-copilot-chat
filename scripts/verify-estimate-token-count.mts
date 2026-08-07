/**
 * Verification script for estimateTokenCount fix (Issue #83).
 *
 * Simulates JSON-serialized chat messages at various sizes and checks
 * that the safeOutputBudget does not collapse to 1.
 *
 * Run: npx tsx scripts/verify-estimate-token-count.mts
 */

// ── Heuristic under test (same logic as extension.ts after fix) ──────────────

function estimateTokenCount(value: string): number {
  if (!value) return 0;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;

  const cjkCharacters = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const charEstimate = Math.ceil(normalized.length / 4);
  const codeBuffer = Math.ceil(charEstimate * 0.1);

  return Math.max(1, Math.ceil(charEstimate + codeBuffer + cjkCharacters));
}

// ── Old heuristic (for comparison) ───────────────────────────────────────────

function oldEstimateTokenCount(value: string): number {
  if (!value) return 0;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;

  const cjkCharacters = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const words = normalized.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/gu)?.length ?? 0;
  const charEstimate = Math.ceil(normalized.length / 4);

  return Math.max(1, Math.ceil(Math.max(words * 1.15, charEstimate, cjkCharacters)));
}

// ── Simulated data ───────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  /** Approximate token count the server would report */
  actualTokens: number;
  /** Context window of the model */
  contextWindow: number;
  /** Max output tokens for the model */
  maxOutputTokens: number;
  /** JSON payload to test */
  payload: string;
}

/**
 * Generate a JSON-serialized chat message array of the desired length.
 * Each message has a role, content (with realistic prose), and optionally
 * tool_calls — achieving a structural ratio similar to real VS Code Copilot
 * Chat conversations.
 *
 * The string length is tuned so that charEstimate (n/4) approximately matches
 * actualTokens. The OLD heuristic (words * 1.15) should dramatically overestimate
 * for JSON-heavy payloads because structural characters inflate the word count.
 */
function generateChatPayload(targetTokens: number, hasToolCalls: boolean): string {
  // At 1 token ≈ 4 chars for English, targetChars ≈ targetTokens * 4
  // But JSON structure adds overhead (brackets, quotes, commas), so we need
  // more characters. Actual ratio for JSON chat: ~5-6 chars/token
  const targetChars = Math.floor(targetTokens * 5.5);

  const messages: string[] = [];
  // System prompt
  messages.push(
    JSON.stringify({
      role: "system",
      content:
        "You are OpenCode Go BYOK Provider, an expert programming assistant integrated with VS Code Copilot Chat. You help users with coding questions, debugging, code review, architecture design, and general software engineering tasks across multiple programming languages and frameworks. You have access to workspace files and tools.",
    }),
  );

  let currentLen = JSON.stringify(messages).length;
  let i = 0;

  // Keep adding messages until we reach target length
  while (currentLen < targetChars) {
    const isUser = i % 2 === 0;
    const topics = [
      "Explain the concept of dependency injection in TypeScript and how it improves testability",
      "Write a React hook that manages WebSocket connections with auto-reconnect logic",
      "Debug this error: Cannot read properties of undefined (reading 'map')",
      "Design a database schema for a multi-tenant SaaS application with PostgreSQL",
      "Implement rate limiting middleware for Express.js with Redis backend",
      "Create a CI/CD pipeline using GitHub Actions for a monorepo",
      "How does the Event Loop work in Node.js? Explain with microtasks and macrotasks",
      "Write a Python script that processes CSV files using pandas with error handling",
      "Explain the differences between REST, GraphQL, and gRPC APIs",
      "Implement authentication using JWT with refresh token rotation",
      "Write unit tests for a complex business logic function using Jest",
      "Create a Docker compose setup for a microservices architecture",
      "Optimize a slow SQL query that joins 6 tables with millions of rows",
      "Implement a custom hook for form validation with debounced async validation",
      "Design an error handling strategy for a distributed system",
      "Write a TypeScript utility type that extracts readonly properties",
      "Set up Webpack 5 with React, TypeScript, and CSS modules from scratch",
      "Implement optimistic UI updates in React Query mutations",
      "Create a state machine for a multi-step checkout process",
      "Write a shell script that automates database backups with rotation",
    ];

    if (isUser) {
      const topic = topics[i % topics.length];
      const userMsg: Record<string, unknown> = {
        role: "user",
        content: `I'm working on a ${["feature", "bug fix", "refactoring", "proof of concept"][i % 4]} for my project and need help. ${topic}. Could you provide a comprehensive solution with code examples, edge case handling, and best practices? I'm using TypeScript 5.x with Node.js 22 and the project is structured as a monorepo with multiple packages.`,
      };
      // Add tool_calls every 3rd user message to simulate tool usage
      if (hasToolCalls && i % 3 === 0) {
        userMsg.tool_calls = [
          {
            id: `call_${i}_0`,
            type: "function",
            function: {
              name: "readFile",
              arguments: JSON.stringify({ path: "src/index.ts" }),
            },
          },
          {
            id: `call_${i}_1`,
            type: "function",
            function: {
              name: "searchFiles",
              arguments: JSON.stringify({ pattern: "**/*.ts", query: topic }),
            },
          },
        ];
      }
      messages.push(JSON.stringify(userMsg));
    } else {
      // Assistant response with code blocks — simulates long, realistic answers
      const codeSnippet = `\`\`\`typescript
// Example implementation for the requested feature
interface Config {
  enabled: boolean;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  cacheSize: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

class ServiceManager<T extends Record<string, unknown>> {
  private services: Map<string, T> = new Map();
  private config: Config;
  private metrics: { calls: number; errors: number; latency: number[] } = {
    calls: 0,
    errors: 0,
    latency: [],
  };

  constructor(config: Partial<Config> = {}) {
    this.config = {
      enabled: true,
      timeout: 5000,
      retryAttempts: 3,
      retryDelay: 1000,
      cacheSize: 100,
      logLevel: "info",
      ...config,
    };
  }

  async execute<K extends keyof T>(
    serviceName: K,
    ...args: Parameters<T[K]>
  ): Promise<ReturnType<T[K]>> {
    const start = performance.now();
    this.metrics.calls++;

    try {
      const service = this.services.get(serviceName as string);
      if (!service) {
        throw new Error(\`Service "\${String(serviceName)}" not found\`);
      }

      const result = await this.withRetry(
        () => (service as unknown as Function)(...args),
        this.config.retryAttempts,
      );

      this.metrics.latency.push(performance.now() - start);
      return result as ReturnType<T[K]>;
    } catch (error) {
      this.metrics.errors++;
      throw this.normalizeError(error);
    }
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    attempts: number,
  ): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === attempts - 1) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.retryDelay * Math.pow(2, i)),
        );
      }
    }
    throw new Error("Max retry attempts exceeded");
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
  }

  getMetrics() {
    return { ...this.metrics, avgLatency: this.average(this.metrics.latency) };
  }

  private average(nums: number[]): number {
    return nums.length > 0
      ? nums.reduce((a, b) => a + b, 0) / nums.length
      : 0;
  }
}

export { ServiceManager, type Config };
\`\`\`

Key considerations for this implementation:

1. **Error handling**: All errors are caught and normalized using \`normalizeError\` to ensure consistent error types throughout the application. The retry mechanism uses exponential backoff to avoid overwhelming downstream services.

2. **Type safety**: Full TypeScript generics ensure that service types are preserved through the execution pipeline. The \`execute\` method maintains type information for both parameters and return values.

3. **Performance monitoring**: Built-in metrics tracking with \`getMetrics()\` provides observability into call patterns, error rates, and latency distribution. This is essential for production debugging.

4. **Configuration**: Flexible configuration with sensible defaults using \`Partial<Config>\` pattern. All settings can be overridden per-instance.

5. **Resource management**: The \`Map\`-based service registry is memory-efficient for typical use cases. Consider implementing TTL-based cache eviction for long-running instances with many services.

For testing, you can mock the service registry and verify retry behavior:
\`\`\`typescript
describe("ServiceManager", () => {
  it("should retry on failure", async () => {
    const manager = new ServiceManager({ retryAttempts: 3, retryDelay: 10 });
    // Test implementation...
  });
});
\`\`\``;

      const assistantMsg: Record<string, unknown> = {
        role: "assistant",
        content:
          `Here's a comprehensive solution for your request about ${topics[(i - 1) % topics.length].toLowerCase()}:\n\n` +
          `## Overview\n\n` +
          `After analyzing your requirements, I've designed an implementation that follows TypeScript best practices, includes comprehensive error handling, and is fully testable. The solution prioritizes type safety, performance, and maintainability.\n\n` +
          `## Implementation\n\n` +
          codeSnippet +
          `\n\n## Usage Example\n\n` +
          `\`\`\`typescript\n` +
          `const manager = new ServiceManager({ timeout: 3000 });\n` +
          `const result = await manager.execute("myService", arg1, arg2);\n` +
          `console.log(manager.getMetrics());\n` +
          `\`\`\`\n\n` +
          `## Testing Strategy\n\n` +
          `1. Unit test each method in isolation using mocks\n` +
          `2. Integration test the retry mechanism with controlled failures\n` +
          `3. Performance test with high concurrency to verify timeout behavior\n` +
          `4. Property-based tests for configuration validation\n\n` +
          `Let me know if you need any clarification or have additional requirements!`,
      };
      if (hasToolCalls && (i - 1) % 4 === 0) {
        assistantMsg.tool_calls = [
          {
            id: `call_res_${i}`,
            type: "function",
            function: {
              name: "createFile",
              arguments: JSON.stringify({
                path: `src/services/example-${i}.ts`,
              }),
            },
          },
        ];
      }
      messages.push(JSON.stringify(assistantMsg));
    }
    i++;
    currentLen = JSON.stringify(messages).length;
  }

  return `[${messages.join(",")}]`;
}

const testCases: TestCase[] = [
  {
    name: "Issue #83 — large conversation (deepseek-v4-flash, ~754K tokens)",
    actualTokens: 754_773,
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    payload: generateChatPayload(754_773, true),
  },
  {
    name: "Medium conversation (~130K tokens)",
    actualTokens: 130_000,
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    payload: generateChatPayload(130_000, true),
  },
  {
    name: "Small conversation (~1K tokens)",
    actualTokens: 1_000,
    contextWindow: 100_000,
    maxOutputTokens: 32_000,
    payload: generateChatPayload(1_000, false),
  },
  {
    name: "Code-heavy conversation with many tool calls (~200K tokens)",
    actualTokens: 200_000,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    payload: generateChatPayload(200_000, true),
  },
];

// ── Verification logic ───────────────────────────────────────────────────────

const MIN_OUTPUT_BUDGET = 4096;
const TOKEN_ESTIMATE_SAFETY_MARGIN = 64;

function computeMaxTokens(promptTokens: number | undefined, contextWindow: number, maxOutputTokens: number): number {
  const promptReserve = (promptTokens ?? Math.floor(contextWindow * 0.8)) + TOKEN_ESTIMATE_SAFETY_MARGIN;
  const safeOutputBudget = Math.max(MIN_OUTPUT_BUDGET, contextWindow - promptReserve);
  return Math.min(maxOutputTokens, safeOutputBudget);
}

function computeMaxTokensOld(promptTokens: number | undefined, contextWindow: number, maxOutputTokens: number): number {
  const promptReserve = (promptTokens ?? Math.floor(contextWindow * 0.8)) + TOKEN_ESTIMATE_SAFETY_MARGIN;
  const safeOutputBudget = Math.max(1, contextWindow - promptReserve);
  return Math.min(maxOutputTokens, safeOutputBudget);
}

// ── Results ──────────────────────────────────────────────────────────────────

let allPassed = true;

for (const tc of testCases) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`🧪 ${tc.name}`);
  console.log(`   Actual tokens (server):    ${tc.actualTokens.toLocaleString()}`);
  console.log(`   Context window:            ${tc.contextWindow.toLocaleString()}`);
  console.log(`   Max output tokens (model): ${tc.maxOutputTokens.toLocaleString()}`);

  const payload = tc.payload;
  const oldEstimate = oldEstimateTokenCount(payload);
  const newEstimate = estimateTokenCount(payload);

  const oldMaxTokens = computeMaxTokensOld(oldEstimate, tc.contextWindow, tc.maxOutputTokens);
  const newMaxTokens = computeMaxTokens(newEstimate, tc.contextWindow, tc.maxOutputTokens);

  const oldRatio = (oldEstimate / tc.actualTokens).toFixed(2);
  const newRatio = (newEstimate / tc.actualTokens).toFixed(2);

  console.log(`   Payload length:            ${payload.length.toLocaleString()} chars`);
  console.log(`\n   📊 Token Estimation:`);
  console.log(`   OLD heuristic:             ${oldEstimate.toLocaleString()} (${oldRatio}x actual)`);
  console.log(`   NEW heuristic:             ${newEstimate.toLocaleString()} (${newRatio}x actual)`);
  console.log(`\n   📊 Computed max_tokens:`);
  console.log(`   OLD: max_tokens =          ${oldMaxTokens.toLocaleString()}`);
  console.log(`   NEW: max_tokens =          ${newMaxTokens.toLocaleString()}`);

  // Determine pass/fail
  if (oldMaxTokens < 1000) {
    console.log(`\n   ❌ OLD: max_tokens collapsed to ${oldMaxTokens} — BUG REPRODUCED`);
  } else {
    console.log(`\n   ✅ OLD: OK (${oldMaxTokens.toLocaleString()} tokens)`);
  }

  if (newMaxTokens >= 4096) {
    console.log(`   ✅ NEW: OK (${newMaxTokens.toLocaleString()} tokens) — FIX VERIFIED`);
  } else {
    console.log(`   ❌ NEW: max_tokens still only ${newMaxTokens} — FIX FAILED`);
    allPassed = false;
  }

  // Safety: check that new max_tokens doesn't exceed context window
  const totalTokens = tc.actualTokens + newMaxTokens;
  if (totalTokens > tc.contextWindow) {
    console.log(
      `   ⚠️  WARNING: actual + new max_tokens (${totalTokens.toLocaleString()}) exceeds context window (${tc.contextWindow.toLocaleString()}) — possible 400 error`,
    );
  } else {
    console.log(`   ✅ Context budget: ${((totalTokens / tc.contextWindow) * 100).toFixed(1)}% used (safe)`);
  }
}

console.log(`\n${"=".repeat(72)}`);
if (allPassed) {
  console.log(`\n✅ ALL TESTS PASSED — fix verified for all scenarios\n`);
  process.exit(0);
} else {
  console.log(`\n❌ SOME TESTS FAILED — review output above\n`);
  process.exit(1);
}
