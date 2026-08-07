/**
 * Thinking / reasoning configuration for per-model families.
 *
 * CONTRACT:
 * - Pure functions only — no `vscode` import, no side effects.
 * - Extracted from `extension.ts` to enable unit testing without mocking the
 *   VS Code API surface.
 *
 * INVARIANTS:
 * - `buildThinkingPayload` must never emit a field the upstream API rejects.
 *   Each model family has its own contract; see inline comments.
 * - `buildFamilyThinkingSchema` returns a plain JSON-schema-like object. The
 *   caller (`modelConfigurationSchema` in `extension.ts`) wraps it with the
 *   VS Code type annotation.
 */
import type { ResolvedModelMetadata } from "./metadata";

/** Per-family thinking settings stored in the workspace configuration. */
export interface ThinkingSettings {
  deepseek: "off" | "low" | "medium" | "high" | "max";
  glm: "off" | "high" | "max";
  kimi: "on" | "off";
  minimax: "off" | "on";
  openai: "off" | "low" | "medium" | "high" | "xhigh";
  qwen: "auto" | "on" | "off";
  qwenBudget: "auto" | "4096" | "16384" | "32768" | "81920";
  mimo: "off" | "low" | "medium" | "high";
}

/** Detected thinking family for a raw model id. */
export type ThinkingFamily = "deepseek" | "glm" | "kimi" | "minimax" | "openai" | "qwen" | "mimo" | null;

/**
 * Detect which Thinking family a raw model id belongs to. Used both to render
 * the per-model picker submenu (configurationSchema) and to map the user's
 * per-request selection back to the right OpenCode request field.
 */
export function thinkingFamily(modelId: string): ThinkingFamily {
  if (/^deepseek-/i.test(modelId)) return "deepseek";
  if (/^glm-/i.test(modelId)) return "glm";
  if (/^kimi-/i.test(modelId)) return "kimi";
  if (/^minimax-/i.test(modelId)) return "minimax";
  if (/^gpt-/i.test(modelId)) return "openai";
  if (/^qwen3(?:\.|-)/i.test(modelId)) return "qwen";
  if (/^mimo-/i.test(modelId)) return "mimo";
  return null;
}

/**
 * Per-family JSON-Schema describing the native model-picker controls rendered
 * by VS Code 1.120. Accepts optional metadata for dynamic fallback: any model
 * with `reasoning: true` in its resolved metadata gets a generic off/on schema
 * even if no hardcoded family match exists.
 *
 * Returns a plain object; the caller adds the VS Code type annotation.
 */
export function buildFamilyThinkingSchema(
  modelId: string,
  metadata?: ResolvedModelMetadata,
): { properties: Record<string, unknown> } | undefined {
  const family = thinkingFamily(modelId);
  const opts = metadata?.reasoningOptions;

  // --- Priority 1: explicit reasoning_options from models.dev ---
  if (opts && opts.length > 0) {
    // Collect unique effort values across all effort-type options
    const effortValues = opts
      .filter((o) => o.type === "effort" && Array.isArray(o.values) && o.values.length > 0)
      .flatMap((o) => o.values!)
      .filter((v, i, a) => a.indexOf(v) === i);

    // Check if a toggle-type option exists
    const hasToggle = opts.some((o) => o.type === "toggle");

    // Build the enum options:
    // - If toggle exists, "off" is the default (user can toggle off)
    // - If effort values exist, those become additional options
    // - If neither toggle nor effort, but there are options, treat as on/off
    if (hasToggle || effortValues.length > 0) {
      const enumOptions: string[] = [];
      const enumLabels: string[] = [];
      const enumDescriptions: string[] = [];

      // "off" is always the first option when toggle is present
      enumOptions.push("off");
      enumLabels.push("Off");
      enumDescriptions.push("Fastest responses");

      // Toggle-only (no effort values): add "on" for a simple off/on choice
      if (hasToggle && effortValues.length === 0) {
        enumOptions.push("on");
        enumLabels.push("On");
        enumDescriptions.push("Enable reasoning");
      }

      // Add effort levels
      for (const v of effortValues) {
        enumOptions.push(v);
        // Capitalize first letter
        enumLabels.push(v.charAt(0).toUpperCase() + v.slice(1));
        // Generate description
        switch (v) {
          case "low":
            enumDescriptions.push("Faster responses with less reasoning");
            break;
          case "medium":
            enumDescriptions.push("Balanced reasoning and speed");
            break;
          case "high":
            enumDescriptions.push("Greater reasoning depth but slower");
            break;
          case "xhigh":
            enumDescriptions.push("Maximum reasoning depth");
            break;
          case "max":
            enumDescriptions.push("Maximum reasoning effort");
            break;
          default:
            enumDescriptions.push(`Effort: ${v}`);
        }
      }

      if (enumOptions.length > 0) {
        const schema: Record<string, unknown> = {
          type: "string",
          title: "Thinking Effort",
          enum: enumOptions,
          enumItemLabels: enumLabels,
          enumDescriptions,
          default: "off",
          group: "navigation",
        };

        return { properties: { reasoningEffort: schema } };
      }
    }

    // Fallthrough: if options exist but none matched, treat as reasoning enabled
    // (the caller already handles reasoning:true below)
  }

  // --- Priority 2: family-based hardcoded ---
  if (family === "deepseek") {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "low", "medium", "high", "max"],
          enumItemLabels: ["Off", "Low", "Medium", "High", "Max"],
          enumDescriptions: ["Fastest responses", "Minimal reasoning", "Balanced reasoning", "More reasoning", "Maximum reasoning"],
          default: "off",
          group: "navigation",
        },
      },
    };
  }

  if (family === "mimo") {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "low", "medium", "high"],
          enumItemLabels: ["Off", "Low", "Medium", "High"],
          enumDescriptions: ["Fastest responses", "Minimal reasoning", "Balanced reasoning", "Enable reasoning"],
          default: "off",
          group: "navigation",
        },
      },
    };
  }

  // Kimi K2.7-code: thinking cannot be disabled (Moonshot API constraint).
  // Expose a single informational option so users understand the model always
  // reasons, rather than hiding the picker or silently forcing "on".
  if (/^kimi-k2\.7/i.test(modelId)) {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["on"],
          enumItemLabels: ["Always On (K2.7)"],
          enumDescriptions: ["Kimi K2.7-code requires thinking enabled (Moonshot API constraint)"],
          default: "on",
          group: "navigation",
        },
      },
    };
  }

  if (family === "glm") {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "high", "max"],
          enumItemLabels: ["Off", "High", "Max"],
          enumDescriptions: ["Fastest responses", "Greater reasoning depth", "Maximum reasoning effort"],
          default: "off",
          group: "navigation",
        },
      },
    };
  }

  if (family === "openai") {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "low", "medium", "high", "xhigh"],
          enumItemLabels: ["Off", "Low", "Medium", "High", "XHigh"],
          enumDescriptions: [
            "Fastest responses",
            "Faster responses with less reasoning",
            "Balanced reasoning and speed",
            "Greater reasoning depth",
            "Maximum reasoning depth",
          ],
          default: "off",
          group: "navigation",
        },
      },
    };
  }

  if (family === "kimi") {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "on"],
          enumItemLabels: ["Off", "On"],
          enumDescriptions: ["Fastest responses", "Enable thinking"],
          default: "off",
          group: "navigation",
        },
      },
    };
  }

  if (family === "minimax") {
    // OpenCode transform.ts only defines none/thinking for minimax-m3, and
    // the gateway does not expose reasoning_effort levels. On/off only.
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "on"],
          enumItemLabels: ["Off", "On"],
          enumDescriptions: ["Fastest responses", "Enable thinking"],
          default: "off",
          group: "navigation",
        },
      },
    };
  }

  if (family === "qwen") {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "auto", "on"],
          enumItemLabels: ["Off", "Auto", "On"],
          enumDescriptions: ["Fastest responses", "Model decides", "Enable thinking"],
          default: "off",
          group: "navigation",
        },
        thinkingBudget: {
          type: "string",
          title: "Thinking Budget",
          enum: ["auto", "4096", "16384", "32768", "81920"],
          enumItemLabels: ["Auto", "4K", "16K", "32K", "80K"],
          enumDescriptions: ["Provider default", "Small budget", "Medium budget", "Large budget", "Maximum budget"],
          default: "auto",
        },
      },
    };
  }

  // --- Priority 3: dynamic fallback for any reasoning-capable model ---
  if (metadata?.reasoning) {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["off", "on"],
          enumItemLabels: ["Off", "On"],
          enumDescriptions: ["Fastest responses", "Enable reasoning"],
          default: "off",
          group: "navigation",
        },
      },
    };
  }

  return undefined;
}

/**
 * Merge per-request modelConfiguration (from the Copilot Chat submenu) onto
 * the global ThinkingSettings, so the picker selection wins over the workspace
 * default. Only the field for the model's own family is touched.
 */
export function applyRequestThinkingOverride(
  modelId: string,
  base: ThinkingSettings,
  override: Record<string, unknown> | undefined,
): ThinkingSettings {
  if (!override) return base;
  const family = thinkingFamily(modelId);
  if (!family) return base;

  const next: ThinkingSettings = { ...base };
  const reasoningEffort = override.reasoningEffort;
  const thinkingMode = override.thinkingMode;
  const thinkingBudget = override.thinkingBudget;

  if (family === "deepseek" && typeof reasoningEffort === "string") {
    if (["off", "low", "medium", "high", "max"].includes(reasoningEffort)) {
      next.deepseek = reasoningEffort as ThinkingSettings["deepseek"];
    }
  }
  if (family === "glm" && typeof thinkingMode === "string") {
    if (["off", "high", "max"].includes(thinkingMode)) next.glm = thinkingMode as ThinkingSettings["glm"];
  }
  if (family === "glm" && typeof reasoningEffort === "string") {
    if (["off", "high", "max"].includes(reasoningEffort)) next.glm = reasoningEffort as ThinkingSettings["glm"];
  }
  if (family === "kimi" && typeof thinkingMode === "string") {
    if (thinkingMode === "on" || thinkingMode === "off") next.kimi = thinkingMode;
  }
  if (family === "kimi" && typeof reasoningEffort === "string") {
    if (reasoningEffort === "on" || reasoningEffort === "off") next.kimi = reasoningEffort;
  }
  // K2.7-code forces thinking on regardless of picker selection (defensive —
  // the picker schema only exposes "on", but VS Code may cache a stale value).
  if (family === "kimi" && /^kimi-k2\.7/i.test(modelId)) {
    next.kimi = "on";
  }
  if (family === "mimo") {
    if (typeof reasoningEffort === "string" && ["off", "low", "medium", "high"].includes(reasoningEffort)) {
      next.mimo = reasoningEffort as ThinkingSettings["mimo"];
    }
  }
  if (family === "minimax") {
    if (typeof reasoningEffort === "string" && ["off", "on"].includes(reasoningEffort)) {
      next.minimax = reasoningEffort as ThinkingSettings["minimax"];
    }
  }
  if (family === "openai") {
    if (typeof reasoningEffort === "string") {
      const valid = ["off", "low", "medium", "high", "xhigh"];
      if (valid.includes(reasoningEffort)) {
        next.openai = reasoningEffort as ThinkingSettings["openai"];
      }
    }
  }
  if (family === "qwen") {
    if (typeof thinkingMode === "string" && (thinkingMode === "auto" || thinkingMode === "on" || thinkingMode === "off")) {
      next.qwen = thinkingMode;
    }
    if (typeof reasoningEffort === "string" && (reasoningEffort === "auto" || reasoningEffort === "on" || reasoningEffort === "off")) {
      next.qwen = reasoningEffort;
    }
    if (typeof thinkingBudget === "string" && ["auto", "4096", "16384", "32768", "81920"].includes(thinkingBudget)) {
      next.qwenBudget = thinkingBudget as ThinkingSettings["qwenBudget"];
    }
  }
  return next;
}

/**
 * Maps the per-family Thinking settings to the request fields each OpenCode
 * model family expects. Returns an object to spread into the request body.
 * Anything returned here is merged into the OpenAI- or Anthropic-style payload.
 *
 * SPECIAL CASES:
 * - Kimi K2.7-code: always `{ thinking: { type: "enabled", keep: "all" } }`
 *   regardless of user setting (Moonshot API rejects `disabled`).
 */
export function buildThinkingPayload(modelId: string, thinking: ThinkingSettings, hasImageInput = false): Record<string, unknown> {
  // Kimi K2.7-code breaking change: thinking.type only accepts "enabled" —
  // passing "disabled" returns HTTP 400 ("invalid thinking: only type=enabled
  // is allowed for this model"). Thinking is always on for this model.
  // keep:"all" preserves reasoning_content across multi-turn conversations
  // per the Moonshot API spec (default is { type: "enabled", keep: "all" }).
  if (/^kimi-k2\.7/i.test(modelId)) {
    return { thinking: { type: "enabled", keep: "all" } };
  }

  if (/^deepseek-/i.test(modelId)) {
    if (thinking.deepseek === "off") {
      return {};
    }
    return { reasoning_effort: thinking.deepseek };
  }

  // OpenAI GPT 5.x models via Responses API: reasoning is a nested object.
  // Supported values: "none", "minimal", "low", "medium", "high", "xhigh", "max".
  // The OpenCode gateway forwards reasoning.effort to the OpenAI Responses API.
  // Note: VS Code Copilot UI maps "max" → we map to "xhigh" for OpenAI.
  if (/^gpt-/i.test(modelId)) {
    if (thinking.openai === "off") {
      return {};
    }
    return { reasoning: { effort: thinking.openai } };
  }

  if (/^glm-/i.test(modelId)) {
    // GLM (ZhipuAI) uses thinking: { type: "enabled" | "disabled" } format.
    // The gateway's transform.ts variants() returns {} for GLM — no variants
    // are exposed, meaning the gateway doesn't validate or transform GLM
    // thinking parameters. We send through as-is to the upstream API.
    //
    // When the value is a concrete effort level (e.g. "high", "max", or future
    // "low"/"medium"), send reasoning_effort directly — the gateway or upstream
    // API determines support. Only "off" maps to disabled.
    if (thinking.glm === "off") {
      return { thinking: { type: "disabled" } };
    }
    return { reasoning_effort: thinking.glm };
  }

  if (/^kimi-/i.test(modelId)) {
    // Tests confirm the gateway accepts thinking: { type } for Kimi
    return { thinking: { type: thinking.kimi === "on" ? "enabled" : "disabled" } };
  }

  if (/^qwen3(?:\.|-)/i.test(modelId)) {
    if (thinking.qwen === "auto") {
      // Let the model decide; don't send enable_thinking. Budget is only
      // meaningful when thinking is active, so honor it here as well. Vision
      // requests are already token-heavy; keep "auto" truly automatic so the
      // provider can stay under its image quota/token limits.
      if (hasImageInput) {
        return {};
      }
      return thinking.qwenBudget === "auto" ? {} : { thinking_budget: Number(thinking.qwenBudget) };
    }
    if (thinking.qwen === "on") {
      return thinking.qwenBudget === "auto"
        ? { enable_thinking: true }
        : { enable_thinking: true, thinking_budget: Number(thinking.qwenBudget) };
    }
    return { enable_thinking: false };
  }

  if (/^mimo-/i.test(modelId)) {
    // Mimo models use OpenAI-compatible chat-completions with reasoning_content.
    // Supported efforts: low, medium, high (per OpenCode upstream defaults).
    //
    // budget_tokens caps the reasoning token count to prevent infinite thinking
    // loops observed in mimo-v2.5 / mimo-v2.5-pro (issue #36, 2026-07-23).
    // Effort → token budget mapping (conservative caps; tuned for practical tasks):
    //   low    →  8 192  (~2× a typical short CoT)
    //   medium → 16 384  (~4× a typical medium CoT)
    //   high   → 32 768  (~8× a deeper reasoning chain)
    // If the OpenCode gateway rejects budget_tokens (HTTP 400 "extra inputs"),
    // retry.ts drops the field and retries with reasoning_effort alone.
    if (thinking.mimo === "off") {
      return {};
    }
    const mimoBudgetMap: Record<string, number> = {
      low: 8192,
      medium: 16384,
      high: 32768,
    };
    const mimoBudget = mimoBudgetMap[thinking.mimo];
    return {
      reasoning_effort: thinking.mimo,
      ...(mimoBudget !== undefined ? { budget_tokens: mimoBudget } : {}),
    };
  }

  if (/^minimax-/i.test(modelId)) {
    // OpenCode transform.ts maps minimax-m3 to thinking: { type: "disabled"|"adaptive" }
    // (Anthropic-style format, not reasoning_effort). MiniMax models routed through
    // the messages endpoint (m2.*) use standard Anthropic enabled/disabled.
    if (thinking.minimax === "off") {
      return {};
    }
    if (/^minimax-m2\./i.test(modelId)) {
      return { thinking: { type: "enabled" } };
    }
    return { thinking: { type: "adaptive" } };
  }

  return {};
}

/**
 * Translates Qwen thinking settings into Anthropic-native format when Qwen
 * models are routed through the Anthropic messages endpoint. The gateway
 * expects { type: "enabled"|"disabled" } with an optional budget_tokens field,
 * matching the Anthropic thinking API contract.
 */
export function buildQwenAnthropicThinkingPayload(thinking: ThinkingSettings): Record<string, unknown> {
  if (thinking.qwen === "on") {
    const budget = thinking.qwenBudget === "auto" ? undefined : Number(thinking.qwenBudget);
    return {
      thinking: {
        type: "enabled",
        ...(budget !== undefined ? { budget_tokens: budget } : {}),
      },
    };
  }
  if (thinking.qwen === "off") {
    return { thinking: { type: "disabled" } };
  }
  // "auto" — let the provider decide; send no thinking directive.
  return {};
}
