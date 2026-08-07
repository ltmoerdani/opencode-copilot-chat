#!/usr/bin/env node
/**
 * validate-models.mts — Comprehensive model parameter validation suite.
 *
 * Reuses the EXACT same logic as the extension:
 * - buildThinkingPayload() from thinking.ts
 * - resolveModelRouting() from routing.ts
 * - buildOpenCodeGatewayAuthHeaders() from openCodeAuth.ts
 *
 * For EACH model, tests ALL thinking/reasoning parameter combinations against
 * the live OpenCode API to verify what actually works.
 *
 * Usage:
 *   npx tsx scripts/validate-models.mts --api-key YOUR_KEY
 *   OPENCODE_API_KEY=... npx tsx scripts/validate-models.mts
 */

import { parseArgs } from "node:util";
import { buildThinkingPayload, type ThinkingSettings } from "../src/thinking.js";
import { resolveModelRouting } from "../src/routing.js";
import { buildOpenCodeGatewayAuthHeaders } from "../src/openCodeAuth.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    "api-key": { type: "string" },
    go: { type: "boolean", default: true },
    "zen-free": { type: "boolean", default: true },
    "zen-paid": { type: "boolean", default: false },
    families: { type: "string" },
    models: { type: "string" },
    "skip-models": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    timeout: { type: "string", default: "30000" },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

if (args.help) {
  console.log(`
Usage: npx tsx scripts/validate-models.mts [options]

Examples:
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY
  npx tsx scripts/validate-models.mts --api-key YOUR_KEY --families deepseek,kimi
  npx tsx scripts/validate-models.mts --dry-run
`);
  process.exit(0);
}

const API_KEY = args["api-key"] ?? process.env.OPENCODE_API_KEY;
const GO_BASE = process.env.OPENCODE_GO_URL ?? "https://opencode.ai/zen/go/v1";
const ZEN_BASE = process.env.OPENCODE_ZEN_URL ?? "https://opencode.ai/zen/v1";
const MODELS_DEV_URL = "https://models.dev/api.json";
const TIMEOUT_MS = Number(args.timeout) || 30000;

const INCLUDE_GO = args.go !== false;
const INCLUDE_ZEN_FREE = args["zen-free"] !== false;
const INCLUDE_ZEN_PAID = args["zen-paid"] === true;
const FAMILIES_FILTER = args.families?.split(",").map((f) => f.trim().toLowerCase());
const MODELS_FILTER = args.models?.split(",").map((m) => m.trim());
const SKIP_MODELS = new Set(args["skip-models"]?.split(",").map((m) => m.trim()) ?? []);
const DRY_RUN = args["dry-run"] === true;
const OUTPUT_JSON = args.json === true;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelInfo {
  id: string;
  vendor: "go" | "zen";
  family: string;
  reasoning: boolean;
  reasoningOptions?: Array<{ type?: string; values?: string[] }>;
  temperature: boolean;
}

interface ParamTest {
  name: string;
  settings: Partial<ThinkingSettings>;
  hasImageInput?: boolean;
}

interface TestResult {
  model: string;
  vendor: string;
  family: string;
  param: string;
  status: "✅" | "❌" | "⏭️";
  httpStatus: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Family detection
// ---------------------------------------------------------------------------

function detectFamily(id: string): string {
  if (/^gpt-/i.test(id)) return "gpt";
  if (/^claude-/i.test(id)) return "claude";
  if (/^gemini-/i.test(id)) return "gemini";
  if (/^qwen/i.test(id)) return "qwen";
  if (/^deepseek-/i.test(id)) return "deepseek";
  if (/^kimi-/i.test(id)) return "kimi";
  if (/^glm-/i.test(id)) return "glm";
  if (/^minimax-/i.test(id)) return "minimax";
  if (/^mimo-/i.test(id)) return "mimo";
  if (/^big-pickle$/i.test(id)) return "mystery";
  if (/^nemotron-/i.test(id)) return "nemotron";
  if (/^north-/i.test(id)) return "north";
  if (/^grok-/i.test(id)) return "grok";
  return "other";
}

// ---------------------------------------------------------------------------
// Build test parameters using extension's buildThinkingPayload
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: ThinkingSettings = {
  deepseek: "off",
  glm: "off",
  kimi: "off",
  minimax: "off",
  qwen: "off",
  qwenBudget: "auto",
  mimo: "off",
};

function buildThinkingTests(model: ModelInfo): ParamTest[] {
  const id = model.id;
  const tests: ParamTest[] = [];

  // Temperature tests
  if (model.temperature !== false) {
    tests.push({ name: "temp=0.2", settings: {} });
  }
  tests.push({ name: "no-temp", settings: {} });

  if (!model.reasoning) return tests;

  // Kimi K2.7: always on
  if (/^kimi-k2\.7/i.test(id)) {
    tests.push({ name: "thinking=enabled,keep=all", settings: { kimi: "on" } });
    tests.push({ name: "thinking=disabled (should-fail)", settings: { kimi: "off" } });
  }
  // Kimi K2.6/K2.5: on/off
  else if (/^kimi-/i.test(id)) {
    tests.push({ name: "thinking=enabled", settings: { kimi: "on" } });
    tests.push({ name: "thinking=disabled", settings: { kimi: "off" } });
  }
  // DeepSeek: reasoning_effort values
  else if (/^deepseek-/i.test(id)) {
    for (const effort of ["low", "medium", "high", "max"] as const) {
      tests.push({ name: `reasoning_effort=${effort}`, settings: { deepseek: effort } });
    }
    tests.push({ name: "no-reasoning (off)", settings: { deepseek: "off" } });
  }
  // GLM: thinking type with effort values (GLM 5.2: high/max, older: enabled)
  else if (/^glm-/i.test(id)) {
    tests.push({ name: "thinking=high", settings: { glm: "high" } });
    tests.push({ name: "thinking=max", settings: { glm: "max" } });
    tests.push({ name: "thinking=disabled", settings: { glm: "off" } });
  }
  // Qwen: enable_thinking + budget
  else if (/^qwen/i.test(id)) {
    tests.push({ name: "enable_thinking=true", settings: { qwen: "on" } });
    tests.push({ name: "enable_thinking=false", settings: { qwen: "off" } });
    tests.push({ name: "enable_thinking=true,budget=4096", settings: { qwen: "on", qwenBudget: "4096" } });
    tests.push({ name: "enable_thinking=true,budget=32768", settings: { qwen: "on", qwenBudget: "32768" } });
    tests.push({ name: "auto (no enable_thinking)", settings: { qwen: "auto" } });
  }
  // MiMo: reasoning_effort
  else if (/^mimo-/i.test(id)) {
    for (const effort of ["low", "medium", "high"] as const) {
      tests.push({ name: `reasoning_effort=${effort}`, settings: { mimo: effort } });
    }
    tests.push({ name: "no-reasoning (off)", settings: { mimo: "off" } });
  }
  // MiniMax M2.*: thinking type (Anthropic format)
  else if (/^minimax-m2\./i.test(id)) {
    tests.push({ name: "thinking=enabled", settings: { minimax: "on" } });
    tests.push({ name: "thinking=disabled", settings: { minimax: "off" } });
  }
  // MiniMax M3: thinking adaptive
  else if (/^minimax-m3/i.test(id)) {
    tests.push({ name: "thinking=adaptive", settings: { minimax: "on" } });
    tests.push({ name: "thinking=disabled", settings: { minimax: "off" } });
  }

  return tests;
}

// ---------------------------------------------------------------------------
// API call using extension's routing + auth
// ---------------------------------------------------------------------------

async function testParameter(model: ModelInfo, test: ParamTest): Promise<TestResult> {
  // Build the provider definition matching what the extension uses
  const provider =
    model.vendor === "go"
      ? {
          chatCompletionsUrl: `${GO_BASE}/chat/completions`,
          messagesUrl: `${GO_BASE}/messages`,
          responsesUrl: `${GO_BASE}/responses`,
          modelsUrl: `${GO_BASE}/models`,
          vendor: "opencodego" as const,
        }
      : {
          chatCompletionsUrl: `${ZEN_BASE}/chat/completions`,
          messagesUrl: `${ZEN_BASE}/messages`,
          responsesUrl: `${ZEN_BASE}/responses`,
          modelsUrl: `${ZEN_BASE}/models`,
          vendor: "opencodezen" as const,
        };

  // Use extension's routing to determine endpoint
  const routing = resolveModelRouting(model.id, provider);

  // Use extension's auth headers
  const authHeaders = buildOpenCodeGatewayAuthHeaders(routing.endpointKind, API_KEY!);

  // Build thinking payload using extension's buildThinkingPayload
  const thinking: ThinkingSettings = { ...DEFAULT_SETTINGS, ...test.settings };
  const thinkingPayload = buildThinkingPayload(model.id, thinking, test.hasImageInput);

  // Build the full request body exactly as the extension would
  const body: Record<string, unknown> = {
    model: model.id,
    messages: [{ role: "user", content: "Say OK" }],
    max_tokens: 10,
    ...thinkingPayload,
  };

  // Add temperature unless model doesn't support it
  if (test.name !== "no-temp" && model.temperature !== false) {
    body.temperature = 0.2;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(routing.endpointUrl, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const errorBody = response.ok ? undefined : await response.text();

    return {
      model: model.id,
      vendor: model.vendor,
      family: model.family,
      param: test.name,
      status: response.ok ? "✅" : "❌",
      httpStatus: response.status,
      error: errorBody?.slice(0, 150),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        model: model.id,
        vendor: model.vendor,
        family: model.family,
        param: test.name,
        status: "❌",
        httpStatus: 0,
        error: "Timeout",
      };
    }
    return {
      model: model.id,
      vendor: model.vendor,
      family: model.family,
      param: test.name,
      status: "❌",
      httpStatus: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Model fetching from models.dev
// ---------------------------------------------------------------------------

interface ModelsDevResponse {
  [provider: string]: {
    models: Record<
      string,
      {
        status?: string;
        reasoning?: boolean;
        reasoning_options?: Array<{ type?: string; values?: string[] }>;
        temperature?: boolean;
      }
    >;
  };
}

async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) throw new Error(`models.dev: ${response.status}`);
  const data = (await response.json()) as ModelsDevResponse;
  const models: ModelInfo[] = [];

  const goProvider = data["opencode-go"];
  if (goProvider?.models && INCLUDE_GO) {
    for (const [id, info] of Object.entries(goProvider.models)) {
      if (SKIP_MODELS.has(id) || info.status === "deprecated") continue;
      if (MODELS_FILTER && !MODELS_FILTER.includes(id)) continue;
      const family = detectFamily(id);
      if (FAMILIES_FILTER && !FAMILIES_FILTER.includes(family)) continue;
      models.push({
        id,
        vendor: "go",
        family,
        reasoning: info.reasoning ?? false,
        reasoningOptions: info.reasoning_options,
        temperature: info.temperature !== false,
      });
    }
  }

  const zenProvider = data["opencode"];
  if (zenProvider?.models && (INCLUDE_ZEN_FREE || INCLUDE_ZEN_PAID)) {
    const goModelIds = new Set(goProvider?.models ? Object.keys(goProvider.models) : []);
    for (const [id, info] of Object.entries(zenProvider.models)) {
      if (SKIP_MODELS.has(id) || info.status === "deprecated") continue;
      if (MODELS_FILTER && !MODELS_FILTER.includes(id)) continue;
      const family = detectFamily(id);
      if (FAMILIES_FILTER && !FAMILIES_FILTER.includes(family)) continue;
      const isFree = id.endsWith("-free") || id === "big-pickle";
      if (!INCLUDE_ZEN_PAID && !isFree) continue;
      if (!INCLUDE_ZEN_FREE && isFree) continue;
      if (goModelIds.has(id)) continue;
      models.push({
        id,
        vendor: "zen",
        family,
        reasoning: info.reasoning ?? false,
        reasoningOptions: info.reasoning_options,
        temperature: info.temperature !== false,
      });
    }
  }

  return models;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatReport(results: TestResult[], models: ModelInfo[]): string {
  const lines: string[] = [];
  lines.push("# Model Parameter Validation Report");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Models: ${models.length} | Tests: ${results.length}`);
  lines.push("");

  const byFamily = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byFamily.has(r.family)) byFamily.set(r.family, []);
    byFamily.get(r.family)!.push(r);
  }

  lines.push("## Summary by Family");
  lines.push("");
  lines.push("| Family | Models | Tests | ✅ Pass | ❌ Fail | Notes |");
  lines.push("|--------|--------|-------|---------|---------|-------|");

  for (const [family, familyResults] of [...byFamily.entries()].sort()) {
    const modelCount = new Set(familyResults.map((r) => r.model)).size;
    const pass = familyResults.filter((r) => r.status === "✅").length;
    const fail = familyResults.filter((r) => r.status === "❌").length;
    const failModels = [...new Set(familyResults.filter((r) => r.status === "❌").map((r) => r.model))];
    lines.push(
      `| ${family} | ${modelCount} | ${familyResults.length} | ${pass} | ${fail} | ${failModels.length > 0 ? failModels.join(", ") : "—"} |`,
    );
  }
  lines.push("");

  const failures = results.filter((r) => r.status === "❌");
  if (failures.length > 0) {
    lines.push("## ❌ Failures");
    lines.push("");
    lines.push("| Model | Vendor | Parameter | HTTP | Error |");
    lines.push("|-------|--------|-----------|------|-------|");
    for (const r of failures) {
      lines.push(`| ${r.model} | ${r.vendor} | ${r.param} | ${r.httpStatus} | ${(r.error ?? "").slice(0, 80)} |`);
    }
    lines.push("");
  }

  lines.push("## Per-Model Results");
  lines.push("");

  const byModel = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }

  for (const [modelId, modelResults] of [...byModel.entries()].sort()) {
    const model = models.find((m) => m.id === modelId);
    const pass = modelResults.filter((r) => r.status === "✅").length;
    const fail = modelResults.filter((r) => r.status === "❌").length;
    lines.push(`### ${modelId} (${model?.vendor}/${model?.family}) — ${pass}✅ ${fail}❌`);
    lines.push("");
    for (const r of modelResults) {
      const err = r.error ? ` — ${r.error.slice(0, 60)}` : "";
      lines.push(`- ${r.status} \`${r.param}\` (HTTP ${r.httpStatus})${err}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error("🔍 Model Parameter Validation Suite (using extension logic)\n");

  if (!API_KEY && !DRY_RUN) {
    console.error("❌ API key required for live testing. Use --api-key or set OPENCODE_API_KEY.");
    console.error("   Use --dry-run to see the test plan without an API key.");
    process.exit(1);
  }

  console.error("📡 Fetching models from models.dev…");
  const models = await fetchModels();
  console.error(`   Found ${models.length} models.\n`);

  if (models.length === 0) {
    console.error("No models to test.");
    process.exit(1);
  }

  const results: TestResult[] = [];
  let testCount = 0;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const tests = buildThinkingTests(model);

    process.stderr.write(`[${i + 1}/${models.length}] ${model.vendor}/${model.id} (${tests.length} params)… `);

    if (DRY_RUN) {
      const summaries = tests.map((t) => {
        const thinking: ThinkingSettings = { ...DEFAULT_SETTINGS, ...t.settings };
        const payload = buildThinkingPayload(model.id, thinking, t.hasImageInput);
        const fields = Object.keys(payload).filter((k) => k !== "model");
        return `${t.name} → ${fields.length > 0 ? JSON.stringify(payload) : "(no thinking params)"}`;
      });
      console.log(`  ${model.id}:\n    ${summaries.join("\n    ")}`);
      continue;
    }

    let pass = 0;
    let fail = 0;
    for (const test of tests) {
      const result = await testParameter(model, test);
      results.push(result);
      testCount++;
      if (result.status === "✅") pass++;
      else fail++;
      await new Promise((r) => setTimeout(r, 300));
    }

    console.error(fail === 0 ? `✅ ${pass}/${pass}` : `❌ ${fail} failed`);
  }

  if (DRY_RUN) process.exit(0);

  if (OUTPUT_JSON) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatReport(results, models));
  }

  const failures = results.filter((r) => r.status === "❌");
  console.error(`\n📊 Total: ${testCount} tests, ${testCount - failures.length} passed, ${failures.length} failed`);

  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
