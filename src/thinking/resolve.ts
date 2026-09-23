/**
 * Thinking config resolution — the single place that merges all thinking-mode
 * sources into one effective value, with explicit provenance.
 *
 * Priority (highest first):
 *   1. `modelConfiguration`  — live per-model config delivered by VS Code
 *                              (picker submenu / Manage Language Models). This
 *                              is the SINGLE authority for per-model thinking.
 *   2. `workspace`           — `opencodego.thinking.*` settings (default).
 *   3. `default`             — `THINKING_DEFAULTS` baked into the settings.
 *
 * CONTRACT: pure only — no `vscode` import, no side effects. The extension
 * provides the raw sources; this module resolves them.
 */
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ThinkingSettings, ThinkingSource, ResolvedThinking, ThinkingOverride } from "./types";
import { thinkingProviderFor } from "./provider";

export interface ResolveThinkingConfigInput {
  modelId: string;
  metadata?: ResolvedModelMetadata;
  /** Workspace settings (`opencodego.thinking.*`), already defaulted. */
  workspace: ThinkingSettings;
  /** Live per-model config from `options.modelConfiguration` (may be absent). */
  modelConfiguration?: Record<string, unknown>;
}

/** Resolve the effective thinking settings with provenance. */
export function resolveThinkingConfig(input: ResolveThinkingConfigInput): ResolvedThinking {
  const provider = thinkingProviderFor(input.modelId, input.metadata);

  let settings: ThinkingSettings = input.workspace;
  let source: ThinkingSource = "workspace";
  let overrideApplied = false;

  // A delivered modelConfiguration wins over the workspace baseline — but only
  // when it carries a value the user actually chose. VS Code merges our picker
  // schema defaults into the resolved per-model configuration on every request
  // (`resolveModelConfiguration` in chatModelConfigurationLogic.ts merges
  // defaults in every branch), and strips values equal to the schema default
  // when persisting user picks — so a delivered value equal to our schema
  // default can never be a genuine user choice; it is the picker baseline being
  // echoed back (issue #226). Dropping it lets the global `opencodego.thinking.*`
  // setting take effect for models the user never configured per-model.
  const liveOverride = stripSchemaDefaultEcho(
    extractThinkingOverride(input.modelConfiguration),
    schemaDefaultsOf(provider.schema(input.metadata)),
  );
  if (liveOverride) {
    const next = provider.applyOverride(settings, { ...liveOverride });
    overrideApplied = next !== settings;
    settings = next;
    source = "modelConfiguration";
  }

  // Apply model-level constraints (e.g. kimi-k2.7 force-on).
  settings = provider.normalize(settings);

  return { settings, source, overrideApplied };
}

/**
 * Extract per-key defaults from a picker schema (same shape as VS Code's
 * `extractSchemaDefaults`): properties with a declared `default` only.
 */
export function schemaDefaultsOf(schema: { properties: Record<string, unknown> } | undefined): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const properties = Object.entries(schema?.properties ?? {}) as Array<[string, { default?: unknown }]>;
  for (const [key, prop] of properties) {
    if (prop.default !== undefined) {
      defaults[key] = prop.default;
    }
  }
  return defaults;
}

/**
 * Drop override keys whose delivered value equals the family's picker schema
 * default — those are VS Code echoes of the baseline, not user choices (see
 * `resolveThinkingConfig`). Keys with no declared default are kept as-is.
 * Returns undefined when nothing survives.
 */
export function stripSchemaDefaultEcho(
  override: ThinkingOverride | undefined,
  defaults: Record<string, unknown>,
): ThinkingOverride | undefined {
  if (!override) return undefined;
  const kept: ThinkingOverride = {};
  for (const key of ["reasoningEffort", "thinkingMode", "thinkingBudget"] as const) {
    const value = override[key];
    if (value === undefined) continue;
    if (key in defaults && defaults[key] === value) continue;
    kept[key] = value;
  }
  return Object.keys(kept).length ? kept : undefined;
}

/**
 * Extract the thinking-relevant keys from a `modelConfiguration` object.
 * Returns undefined when none of the known keys carry a string value.
 */
export function extractThinkingOverride(modelConfiguration: Record<string, unknown> | undefined): ThinkingOverride | undefined {
  if (!modelConfiguration) return undefined;
  const picked: ThinkingOverride = {};
  for (const key of ["reasoningEffort", "thinkingMode", "thinkingBudget"] as const) {
    const value = modelConfiguration[key];
    if (typeof value === "string") {
      picked[key] = value;
    }
  }
  return Object.keys(picked).length ? picked : undefined;
}
