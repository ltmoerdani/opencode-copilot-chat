import * as vscode from "vscode";
import { OpenCodeRequestError } from "./errors";
import {
  MODEL_METADATA_CACHE_KEY,
  MODEL_METADATA_REVISION,
  MODELS_DEV_API_URL,
  bundledModelMetadataSnapshot,
  getContextSizeOptionsForModel,
  hasExplicitModelLimits,
  isFreshModelMetadata,
  normalizeLiveModelMetadata,
  normalizeModelsDevSnapshot,
  resolveModelMetadata,
  toEffectiveModelId,
  VISION_CAPABLE_MODELS,
  type BaseModelLimits,
  type CachedModelMetadataSnapshot,
  type ModelMetadataFields,
  type ModelsDevResponse,
  type ResolvedModelMetadata,
} from "./metadata";
import { resolveModelRouting } from "./routing";
import {
  buildFamilyThinkingSchema,
  buildQwenAnthropicThinkingPayload,
  buildThinkingPayload,
  applyRequestThinkingOverride,
  thinkingFamily,
  type ThinkingSettings,
} from "./thinking";
import { buildOpenCodeGatewayAuthHeaders } from "./openCodeAuth";
import {
  streamAnthropicMessages as runStreamAnthropicMessages,
  streamChatCompletions as runStreamChatCompletions,
  streamGoogleGenerateContent as runStreamGoogleGenerateContent,
  streamResponsesApi as runStreamResponsesApi,
  type TransportRequestSummary,
} from "./streaming";
import {
  GO_VENDOR,
  ZEN_VENDOR,
  AGENT_GO_VENDOR,
  AGENT_ZEN_VENDOR,
  resolveBaseVendor,
  type AllProviderVendor,
  type ProviderVendor,
} from "./providerTypes";
import { isInternalDataPart } from "./chatParts";
import { getImageDataUrlBase64Bytes, MAX_IMAGE_BASE64_BYTES, normalizeImageDataUrl } from "./imageNormalizer";
import { providerModelDisplayName } from "./modelNames";

import { formatCacheHitRatio, formatUsageStatusBarText, formatUsageStatusBarTooltip, type UsageSnapshot } from "./usage";
import {
  GoUsageTracker,
  GO_LIMITS,
  formatGoUsageStatusBarText,
  buildUsageQuickPickItems,
  estimateCost,
  type UsageBaselineTargets,
} from "./goUsageTracker";
import {
  LEGACY_FINGERPRINT,
  keyFingerprint,
  readActiveProfile,
  readProfiles,
  writeActiveProfile,
  writeProfiles,
  readActiveProfiles,
  readMigratedTo,
  writeMigratedTo,
  findProfile,
  renameProfile,
  nonLegacyCount,
  type UsageProfile,
} from "./usageProfile";

const SECRET_KEY = "opencodego.apiKey";
const RECENT_TRANSPORT_SUMMARY_LIMIT = 25;
const RECENT_TRANSPORT_SUMMARY_STORAGE_PREFIX = "opencode.recentTransportSummaries";

let usageStatusBarItem: vscode.StatusBarItem | undefined;
let goUsageStatusBarItem: vscode.StatusBarItem | undefined;
/** Singleton tracker — the first/legacy account. Used for backward compat until first migration. */
let goUsageTracker: GoUsageTracker | undefined;
/** Per-profile trackers indexed by key fingerprint. */
const goUsageTrackers: Map<string, GoUsageTracker> = new Map();
let usageWebviewPanel: vscode.WebviewPanel | undefined;

let profilesCache: UsageProfile[] = [];
let activeProfileFingerprint: string = LEGACY_FINGERPRINT;

/** Look up (or create) the GoUsageTracker for a given key fingerprint. */
function getOrCreateTracker(fingerprint: string): GoUsageTracker {
  // The singleton tracker does not have a storage suffix
  if (fingerprint === LEGACY_FINGERPRINT && goUsageTracker) return goUsageTracker;
  let tracker = goUsageTrackers.get(fingerprint);
  if (tracker) return tracker;
  tracker = new GoUsageTracker(
    _extensionContext!,
    (msg) => _usageLogChannel!.appendLine(`[${new Date().toISOString()}] [${fingerprint}] ${msg}`),
    (modelId) => modelMetadataSnapshot?.providers[GO_VENDOR]?.[modelId]?.cost,
    fingerprint,
  );
  goUsageTrackers.set(fingerprint, tracker);
  return tracker;
}

/** Return the tracker for the currently active profile. */
function activeGoUsageTracker(): GoUsageTracker | undefined {
  if (activeProfileFingerprint === LEGACY_FINGERPRINT) return goUsageTracker;
  return goUsageTrackers.get(activeProfileFingerprint);
}

/** Switch the active profile and refresh the UI. */
async function setActiveProfile(fingerprint: string): Promise<void> {
  activeProfileFingerprint = fingerprint;
  await writeActiveProfile(_extensionContext!, fingerprint);
  refreshGoUsageStatusBar();
  updateWebviewContent();
}

/**
 * Ensure a profile exists in the in-memory cache for the given API key.
 * This is called both from provideLanguageModelChatInformation (at startup,
 * when VS Code resolves all providers) and from onTransportSummary (when
 * a request completes). The first call creates the profile; subsequent
 * calls are no-ops. Persistence is fire-and-forget.
 */
function ensureProfileSync(apiKey: string): void {
  const fp = keyFingerprint(apiKey);
  const tracker = getOrCreateTracker(fp);

  if (!findProfile(profilesCache, fp)) {
    const nextNumber = nonLegacyCount(profilesCache) + 1;
    profilesCache.push({
      fingerprint: fp,
      label: `Profile ${nextNumber}`,
      lastSeenAt: Date.now(),
    });
    writeProfiles(_extensionContext!, profilesCache);
  }

  // One-time migration from singleton
  if (!readMigratedTo(_extensionContext!)) {
    if (goUsageTracker && fp !== LEGACY_FINGERPRINT) {
      tracker.migrateFromSingleton();
    }
    writeMigratedTo(_extensionContext!, fp);
    profilesCache = readProfiles(_extensionContext!);
  }

  // Update active profile to this one
  activeProfileFingerprint = fp;
  writeActiveProfile(_extensionContext!, fp);
}

/**
 * Same as ensureProfileSync, but also refreshes the UI.
 * Called from onTransportSummary during request recording.
 */
function ensureProfileForApiKey(apiKey: string, _displayName: string): GoUsageTracker {
  ensureProfileSync(apiKey);
  return getOrCreateTracker(keyFingerprint(apiKey));
}

let _extensionContext: vscode.ExtensionContext;
let _usageLogChannel: vscode.OutputChannel;

interface ProviderDefinition {
  vendor: AllProviderVendor;
  displayName: string;
  modelNamePrefix: string;
  modelsUrl: string;
  chatCompletionsUrl: string;
  messagesUrl: string;
  responsesUrl?: string;
  testModelId: string;
  fallbackModels: string[];
  filterModel?: (modelId: string) => boolean;
  /** When true, this provider only serves agent-host models (targetChatSessionType=copilotcli). */
  isAgentVariant?: boolean;
  /** The vendor key for the main (non-agent) provider definition this variant mirrors. */
  baseVendor?: typeof GO_VENDOR | typeof ZEN_VENDOR;
}

type ModelEndpointKind = "chat-completions" | "messages" | "responses" | "google";

const FREE_ZEN_MODEL_IDS = new Set(["big-pickle"]);
const KNOWN_UNAVAILABLE_MODEL_IDS = new Set(["ring-2.6-1t", "ring-2.6-1t-free", "trinity-large-preview-free"]);
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const OPEN_CODE_CLIENT = "vscode-copilot-chat";
/** Fallback only — overridden at runtime by {@link getUserAgent} from packageJSON. */
const FALLBACK_USER_AGENT = "opencode-copilot-chat/0.4.1 VSCode";

/**
 * Hard ceiling for a single model-list fetch (connect + headers + body).
 *
 * Without this, undici's default `headersTimeout` (300s) can leave the picker
 * stuck for up to 5 minutes on a hung TCP connection (issue #78).
 */
const MODEL_LIST_FETCH_TIMEOUT_MS = 15_000;
/** Max retry attempts for transient network failures during model-list fetch. */
const MODEL_LIST_FETCH_MAX_RETRIES = 3;
/** Base delay for exponential backoff (500ms, 1s, 2s). */
const MODEL_LIST_FETCH_RETRY_BASE_MS = 500;
/** TTL for the last successful model-list snapshot cached in globalState. */
const MODEL_LIST_CACHE_TTL_MS = 60 * 60 * 1000;
/** globalState key suffix per vendor; full key = `${base}::<vendor>`. */
const MODEL_LIST_CACHE_KEY_PREFIX = "opencode.modelListCache.v1";

let cachedUserAgent: string | undefined;

/**
 * Build the User-Agent string from the extension's declared version.
 *
 * CONTRACT:
 * - Reads `context.extension.packageJSON.version` once, caches the result.
 * - Falls back to {@link FALLBACK_USER_AGENT} when version is unavailable
 *   (e.g. tests that construct a stub context).
 * - Avoids the drift that previously hardcoded a version literal here
 *   (issue #78: header reported `0.3.6` while package.json was `0.4.1`).
 */
function getUserAgent(): string {
  if (cachedUserAgent) return cachedUserAgent;
  const version = vscode.extensions.getExtension("ltmoerdani.opencode-copilot-chat")?.packageJSON?.version;
  cachedUserAgent = typeof version === "string" && version ? `opencode-copilot-chat/${version} VSCode` : FALLBACK_USER_AGENT;
  return cachedUserAgent;
}

/**
 * Classify a fetch error as transient (worth retrying) vs. permanent.
 *
 * RULES:
 * - Network-layer errors (DNS, TCP reset, connect timeout, socket errors)
 *   are transient — undici exposes the real code via `error.cause`.
 * - HTTP 4xx (except 408/429) is permanent — retrying won't help.
 * - HTTP 408/429/5xx is transient — gateway/rate-limit style failures.
 *   These arrive via the "Model list request failed (NNN): ..." message
 *   that `fetchModels()` throws on a non-2xx response.
 * - AbortError from a CancellationToken is NEVER retried.
 */
function isTransientFetchError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const cause = (error as { cause?: { code?: string; name?: string } } | undefined)?.cause;
  const code = cause?.code ?? (error as { code?: string } | undefined)?.code;
  const name = cause?.name ?? (error as { name?: string } | undefined)?.name;
  // undici network error codes
  if (code && /^E(AI_AGAIN|CONNRESET|CONNREFUSED|CONNABORTED|TIMEDOUT|HOSTUNREACH|NETUNREACH|PROTO|PIPE)$/.test(code)) {
    return true;
  }
  if (name && /^UND_ERR_(CONNECT_TIMEOUT|SOCKET|REQUEST_TIMEOUT)$/.test(name)) {
    return true;
  }
  // TypeError: fetch failed (the generic wrapper undici throws) — always retry;
  // if the cause turns out to be non-transient, the inner check above handles it.
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) return true;
  // Extract HTTP status from either an explicit `.status` field or the
  // "Model list request failed (NNN): ..." message pattern.
  const explicitStatus = (error as { status?: number } | undefined)?.status;
  const msg = error instanceof Error ? error.message : String(error);
  const msgMatch = msg.match(/\((\d{3})\)/);
  const httpStatus = typeof explicitStatus === "number" ? explicitStatus : msgMatch ? Number(msgMatch[1]) : undefined;
  if (typeof httpStatus === "number") {
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return true;
    return false;
  }
  return false;
}

/**
 * Promise-based delay that rejects with AbortError if the token fires.
 *
 * Used to back off between model-list fetch retries without leaking
 * CancellationToken subscriptions.
 */
function sleep(ms: number, token?: vscode.CancellationToken): Promise<void> {
  if (token?.isCancellationRequested) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    let sub: vscode.Disposable | undefined;
    const timer = setTimeout(() => {
      sub?.dispose();
      resolve();
    }, ms);
    if (token) {
      sub = token.onCancellationRequested(() => {
        clearTimeout(timer);
        sub?.dispose();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }
  });
}

/** Create an agent-variant provider definition that inherits URLs, models, and filters from a base. */
function providerVariant(
  base: ProviderDefinition,
  agentVendor: typeof AGENT_GO_VENDOR | typeof AGENT_ZEN_VENDOR,
  displayName: string,
): ProviderDefinition {
  return {
    vendor: agentVendor,
    displayName,
    modelNamePrefix: base.modelNamePrefix,
    modelsUrl: base.modelsUrl,
    chatCompletionsUrl: base.chatCompletionsUrl,
    messagesUrl: base.messagesUrl,
    responsesUrl: base.responsesUrl,
    testModelId: base.testModelId,
    fallbackModels: base.fallbackModels,
    filterModel: base.filterModel,
  };
}

const PROVIDERS: Record<ProviderDefinition["vendor"], ProviderDefinition> = (() => {
  const go: ProviderDefinition = {
    vendor: GO_VENDOR,
    displayName: "OpenCode Go",
    modelNamePrefix: "OpenCode Go",
    modelsUrl: "https://opencode.ai/zen/go/v1/models",
    chatCompletionsUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    messagesUrl: "https://opencode.ai/zen/go/v1/messages",
    responsesUrl: "https://opencode.ai/zen/go/v1/responses",
    testModelId: "deepseek-v4-flash",
    fallbackModels: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "glm-5.1",
      "glm-5",
      "hy3-preview",
      "kimi-k2.6",
      "kimi-k2.5",
      "mimo-v2-omni",
      "mimo-v2-pro",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "minimax-m2.7",
      "minimax-m2.5",
      "qwen3.7-max",
      "qwen3.6-plus",
      "qwen3.5-plus",
      "gpt-5.6-luna",
    ],
  };
  const zen: ProviderDefinition = {
    vendor: ZEN_VENDOR,
    displayName: "OpenCode Zen",
    modelNamePrefix: "OpenCode Zen",
    modelsUrl: "https://opencode.ai/zen/v1/models",
    chatCompletionsUrl: "https://opencode.ai/zen/v1/chat/completions",
    messagesUrl: "https://opencode.ai/zen/v1/messages",
    responsesUrl: "https://opencode.ai/zen/v1/responses",
    testModelId: "deepseek-v4-flash-free",
    fallbackModels: [
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-opus-4-1",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4",
      "claude-haiku-4-5",
      "deepseek-v4-flash-free",
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "gemini-3-flash",
      "glm-5.1",
      "glm-5",
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5",
      "gpt-5-codex",
      "gpt-5-nano",
      "grok-build-0.1",
      "kimi-k2.6",
      "kimi-k2.5",
      "minimax-m2.7",
      "minimax-m2.5",
      "minimax-m2.5-free",
      "nemotron-3-super-free",
      "qwen3.6-plus",
      "qwen3.6-plus-free",
      "qwen3.5-plus",
      "big-pickle",
    ],
    filterModel: (modelId) =>
      vscode.workspace.getConfiguration("opencodego").get("freeOnly", true)
        ? modelId.endsWith("-free") || FREE_ZEN_MODEL_IDS.has(modelId)
        : true,
  };
  return {
    [GO_VENDOR]: go,
    [ZEN_VENDOR]: zen,
    [AGENT_GO_VENDOR]: { ...providerVariant(go, AGENT_GO_VENDOR, "OpenCode Go (Agents)"), isAgentVariant: true, baseVendor: GO_VENDOR },
    [AGENT_ZEN_VENDOR]: {
      ...providerVariant(zen, AGENT_ZEN_VENDOR, "OpenCode Zen (Agents)"),
      isAgentVariant: true,
      baseVendor: ZEN_VENDOR,
    },
  };
})();

type ApiRole = "user" | "assistant" | "tool";

interface OpenCodeModel extends vscode.LanguageModelChatInformation {
  endpointKind: ModelEndpointKind;
  provider: ProviderDefinition;
  rawModelId?: string;
  isUserSelectable?: boolean;
  configurationSchema?: vscode.LanguageModelConfigurationSchema;
}

interface ModelListEntry {
  id?: string;
  owned_by?: string;
  status?: string;
  deprecated?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  context_window?: number;
  contextWindow?: number;
  max_output_tokens?: number;
  maxOutputTokens?: number;
  attachment?: boolean;
  image_input?: boolean;
  imageInput?: boolean;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

interface ModelListResponse {
  data?: ModelListEntry[];
}

interface ApiMessage {
  role: ApiRole;
  content: string | null | OpenAiContentPart[];
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ConvertedMessageResult {
  messages: ApiMessage[];
  normalizedImageCount: number;
}

/**
 * Reasoning effort levels per model family, sourced from the upstream
 * OpenCode provider transform (anomalyco/opencode, packages/opencode/src/provider/transform.ts):
 *
 *   WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
 *   OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"]
 *
 * For @ai-sdk/openai-compatible (Mimo, and most models routed through
 * chat-completions): the default is WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"].
 * DeepSeek V4 on openai-compatible additionally adds "max" → ["low", "medium", "high", "max"].
 */
interface ApiSettings {
  temperature: number;
  maxOutputTokensOverride: number;
  maxInputTokensOverride: number;
  debugReasoning: boolean;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  thinking: ThinkingSettings;
  stripThinkTags: "never" | "auto" | "always";
}

interface LanguageModelConfiguration {
  apiKey?: unknown;
}

type ConfiguredLanguageModelInfoOptions = vscode.PrepareLanguageModelChatModelOptions & {
  configuration?: LanguageModelConfiguration;
};

type ConfiguredLanguageModelResponseOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  configuration?: LanguageModelConfiguration;
};

interface ModelLimits extends BaseModelLimits {
  advertisedContextWindow: number;
  advertisedMaxInputTokens: number;
  advertisedMaxOutputTokens: number;
}

// Copilot surfaces combine input/output metadata differently across views.
// Reserve a modest UI output budget, while requests still use the real model max.
const UI_OUTPUT_TOKEN_RESERVE = 8192;
/**
 * Minimum output budget (in tokens) to prevent safeOutputBudget from collapsing
 * to 1 when estimateTokenCount overestimates the prompt size. Ensures the model
 * can still generate a meaningful response even with conservative estimation.
 */
const MIN_OUTPUT_BUDGET = 4096;
const MESSAGE_TOKEN_OVERHEAD = 4;
const MESSAGE_NAME_TOKEN_OVERHEAD = 1;
const TOOL_CALL_TOKEN_OVERHEAD = 10;
const TOOL_RESULT_TOKEN_OVERHEAD = 6;
const IMAGE_TOKEN_ESTIMATE = 1024;
/**
 * Hard upper limit (in bytes of raw image data) for a single image embedded
 * in a tool result. MCP screenshots from chrome-devtools-mcp / playwright-mcp
 * are typically 50–300 KB; anything above 1 MB is almost always an oversized
 * raw capture that bloats the request payload (each image becomes a base64
 * data URI ≈ 1.33× its byte size) and triggers upstream 400 "Upstream request
 * failed" rejections from OpenCode Go. Larger images are replaced with a
 * placeholder text part so the model still knows an image was returned.
 */
const MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000;

/**
 * Maximum number of image attachments (top-level + tool-result combined) to
 * keep in conversation history before older ones are replaced with a
 * placeholder text note.
 *
 * Rationale (evidence-based, issue #38 follow-up):
 *   - Doc `docs/issues/34-20260720-mcp-tool-result-image-dropped.md` line 264+
 *     documents a 4.6 MB payload causing `400 Upstream request failed` on
 *     `mimo-v2.5` after 8 MCP screenshots accumulated in history (~1-2 MB each
 *     → base64 ~1.33× → 4.6 MB total JSON body).
 *   - VS Code Copilot Chat is *supposed* to trim conversation history based on
 *     `advertisedMaxInputTokens`, but our local estimator under-counts base64
 *     image data (`IMAGE_TOKEN_ESTIMATE = 1024` per image, vs the realistic
 *     ~80K tokens/MB). This means VS Code never sees the true payload weight
 *     and forwards a multi-MB request that the OpenCode Go gateway rejects.
 *   - Keeping the most recent 2 images preserves the immediate agentic context
 *     (the model needs to compare current vs. previous screenshot in most MCP
 *     workflows) while bounding the cumulative payload to a safe ceiling.
 *   - OpenAI and Anthropic vision models auto-resize each image to a patch
 *     budget (1568-2576 px) upstream, so old screenshots lose most of their
 *     pixel value once a newer one arrives — the model rarely benefits from
 *     keeping more than 2 in flight.
 *
 * Older images are replaced with a short placeholder text note so the model
 * still knows a screenshot existed at that point in the conversation (useful
 * for understanding agent-loop context) without incurring the payload cost.
 */
const MAX_HISTORY_IMAGES_KEPT = 2;

type CopilotCompatibleCapabilities = vscode.LanguageModelChatCapabilities & {
  supportsToolCalling: boolean;
  supportsImageToText: boolean;
};

// Models live on the OpenCode Zen gateway but with constrained GPU capacity.
// They were re-enabled by the OpenCode team after a brief shutdown
// ("Qwen 3.6 Plus — free, again. Round 2. We found more GPUs.") so they are
// NOT deprecated, but agentic workloads with long histories or large tool
// catalogs can still hit 5xx during traffic bursts. Surface this so users know
// to retry or fall back to another free model if the request fails.
const CAPACITY_LIMITED_MODEL_NOTES: Record<string, string> = {
  "qwen3.6-plus-free":
    "Free relaunch with limited GPU capacity. Stable for short prompts; bursty traffic or very large tool catalogs may return 5xx - retry or fall back to 'deepseek-v4-flash-free' / 'big-pickle'. Paid 'qwen3.6-plus' has no quota.",
};

let modelMetadataSnapshot: CachedModelMetadataSnapshot | undefined;
let modelMetadataRefreshPromise: Promise<CachedModelMetadataSnapshot> | undefined;

interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

interface AnthropicCacheControl {
  type: "ephemeral";
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicImageSourceUrl {
  type: "url";
  url: string;
}

interface AnthropicImageSourceBase64 {
  type: "base64";
  media_type: string;
  data: string;
}

type AnthropicImageSource = AnthropicImageSourceUrl | AnthropicImageSourceBase64;

interface AnthropicImageBlock {
  type: "image";
  source: AnthropicImageSource;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  // Anthropic tool_result.content may be either a plain string or a list of
  // content blocks (text + image) per the Messages API spec. We support the
  // array form so MCP tool results that include images (e.g. screenshots) are
  // forwarded to vision-capable Anthropic models instead of being dropped.
  content: string | AnthropicContentBlock[];
  cache_control?: AnthropicCacheControl;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicRequestMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

interface RecentTransportSummary extends TransportRequestSummary {
  recordedAt: string;
  endpointKind: string;
  metadataSource: string;
  requestInitiator?: string;
}

export function activate(context: vscode.ExtensionContext) {
  const goUsageLogChannel = vscode.window.createOutputChannel("OpenCode Go Usage");
  context.subscriptions.push(goUsageLogChannel);
  goUsageTracker = new GoUsageTracker(
    context,
    (msg) => {
      goUsageLogChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
    },
    (modelId) => {
      return modelMetadataSnapshot?.providers[GO_VENDOR]?.[modelId]?.cost;
    },
  );
  _extensionContext = context;
  _usageLogChannel = goUsageLogChannel;
  profilesCache = readProfiles(context);
  activeProfileFingerprint = readActiveProfile(context);

  // Eagerly load the tracker for the active profile so the status bar
  // has data to display immediately, even before the first request.
  if (activeProfileFingerprint !== LEGACY_FINGERPRINT) {
    getOrCreateTracker(activeProfileFingerprint);
  }

  ensureUsageStatusBar(context);
  ensureGoUsageStatusBar(context);
  const goProvider = new OpenCodeProvider(context, PROVIDERS[GO_VENDOR]);
  const zenProvider = new OpenCodeProvider(context, PROVIDERS[ZEN_VENDOR]);
  const modelInfoProviders: OpenCodeProvider[] = [goProvider, zenProvider];

  const subscriptions: vscode.Disposable[] = [
    vscode.lm.registerLanguageModelChatProvider(GO_VENDOR, goProvider),
    vscode.lm.registerLanguageModelChatProvider(ZEN_VENDOR, zenProvider),
    vscode.commands.registerCommand("opencodego.manage", () => goProvider.manage()),
    vscode.commands.registerCommand("opencodego.diagnostics", () => goProvider.showDiagnostics()),
    vscode.commands.registerCommand("opencodego.setApiKey", () => goProvider.setApiKey()),
    vscode.commands.registerCommand("opencodego.refreshModels", () => goProvider.refreshModels()),
    vscode.commands.registerCommand("opencodezen.diagnostics", () => zenProvider.showDiagnostics()),
    vscode.commands.registerCommand("opencodezen.manage", () => zenProvider.manage()),
    vscode.commands.registerCommand("opencodezen.refreshModels", () => zenProvider.refreshModels()),
    vscode.commands.registerCommand("opencodego.modelPickerDiagnostics", () => showModelPickerDiagnostics()),
    vscode.commands.registerCommand("opencodego.setThinkingEffort", () => showThinkingEffortPicker()),
    vscode.commands.registerCommand("opencodego.showUsageDetails", () => showUsageWebview(context)),
    vscode.commands.registerCommand("opencodego.setUsageTargets", async () => {
      const tracker = activeGoUsageTracker();
      if (!tracker) return;
      const targets = await showUsageTargetEditor(tracker);
      if (targets) {
        tracker.setManualSpentTargets(targets);
        refreshGoUsageStatusBar();
        vscode.window.showInformationMessage("OpenCode Go usage targets updated.");
      }
    }),
    vscode.commands.registerCommand("opencodego.showUsageQuickPick", async () => {
      const tracker = activeGoUsageTracker();
      if (!tracker) return;
      const summary = tracker.getSummary();
      const items = buildUsageQuickPickItems(summary);

      const sessionCost = tracker.getCurrentSessionCost();
      if (sessionCost && sessionCost.cost > 0) {
        const totalTokens = sessionCost.promptTokens + sessionCost.completionTokens;
        const sessionItem: vscode.QuickPickItem = {
          label: `$(comment) Latest Session (est)`,
          description: `$${sessionCost.cost.toFixed(4)}`,
          detail: `${tokens(totalTokens)} tokens · ${sessionCost.requests} requests`,
          alwaysShow: true,
        };
        const dailyIdx = items.findIndex((i) => i.kind === vscode.QuickPickItemKind.Separator && i.label === "Daily Summary");
        if (dailyIdx >= 0) {
          items.splice(dailyIdx + 1, 0, sessionItem);
        } else {
          items.push(sessionItem);
        }
      }

      // Profile switching section — visible when 2+ profiles exist.
      // Lists ALL profiles; the active one is marked and serves as
      // a no-op picker label while others are clickable switches.
      if (profilesCache.length > 1) {
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
        for (const p of profilesCache) {
          if (p.fingerprint === activeProfileFingerprint) {
            items.push({
              label: `$(check) ${p.label} (active)`,
              _fp: p.fingerprint,
              _action: "none",
            } as vscode.QuickPickItem & { _fp?: string; _action?: string });
          } else {
            items.push({
              label: `       Switch to ${p.label}`,
              _fp: p.fingerprint,
              _action: "switchProfile",
            } as vscode.QuickPickItem & { _fp?: string; _action?: string });
          }
        }
        items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
      }

      const separator: vscode.QuickPickItem = { label: "", kind: vscode.QuickPickItemKind.Separator };
      const setTargetItem: vscode.QuickPickItem & { _action?: string } = {
        label: "$(edit) Set spent targets…",
        _action: "setUsageTargets",
      };
      const panelItem: vscode.QuickPickItem & { _action?: string } = {
        label: "$(graph) Open full usage panel",
        _action: "showUsageDetails",
      };
      items.push(separator, setTargetItem, panelItem);
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "OpenCode Go — Current Usage",
        title: "Usage Summary",
      });
      if (!picked || !("_action" in picked)) return;
      const action = (picked as { _action: string })._action;
      if (action === "setUsageTargets") {
        vscode.commands.executeCommand("opencodego.setUsageTargets");
      } else if (action === "showUsageDetails") {
        vscode.commands.executeCommand("opencodego.showUsageDetails");
      } else if (action === "switchProfile" && "_fp" in picked) {
        setActiveProfile((picked as { _fp: string })._fp);
      }
    }),
    vscode.commands.registerCommand("opencodego.renameActiveProfile", async () => {
      const active = findProfile(profilesCache, activeProfileFingerprint);
      if (!active) {
        vscode.window.showInformationMessage("No active profile to rename.");
        return;
      }
      const newLabel = await vscode.window.showInputBox({
        title: "Rename Go Profile",
        prompt: `Current label: ${active.label}`,
        value: active.label,
        placeHolder: "e.g. OpenCode Go (Works)",
      });
      if (!newLabel || !newLabel.trim()) return;
      await renameProfile(_extensionContext, activeProfileFingerprint, newLabel);
      profilesCache = readProfiles(_extensionContext);
      refreshGoUsageStatusBar();
      updateWebviewContent();
      vscode.window.showInformationMessage(`Profile renamed to "${newLabel}".`);
    }),
    vscode.commands.registerCommand("opencodego.deleteProfile", async () => {
      const profiles = readActiveProfiles(_extensionContext);
      if (profiles.length === 0) {
        vscode.window.showInformationMessage("No profiles to delete.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        profiles.map((p) => ({
          label: p.label,
          description: `fingerprint: ${p.fingerprint}`,
          _fp: p.fingerprint,
        })),
        { placeHolder: "Select a profile to delete" },
      );
      if (!picked || !("_fp" in picked)) return;
      const fp = (picked as { _fp: string })._fp;
      const profile = findProfile(profiles, fp);
      if (!profile) return;
      const confirm = await vscode.window.showWarningMessage(
        `Permanently delete profile "${profile.label}"? Its usage history will be removed. This cannot be undone.`,
        { modal: true },
        "Delete",
      );
      if (confirm !== "Delete") return;

      goUsageTrackers.delete(fp);
      const ctx = _extensionContext;
      ctx.globalState.update(`opencodego.usageLog.v1.${fp}`, []);
      ctx.globalState.update(`opencodego.usageBaseline.v1.${fp}`, {});
      ctx.globalState.update(`opencodego.sessionCosts.v1.${fp}`, []);

      const remaining = readProfiles(ctx).filter((p) => p.fingerprint !== fp);
      await writeProfiles(ctx, remaining);
      profilesCache = remaining;

      if (activeProfileFingerprint === fp) {
        activeProfileFingerprint = LEGACY_FINGERPRINT;
        await writeActiveProfile(ctx, LEGACY_FINGERPRINT);
      }

      refreshGoUsageStatusBar();
      updateWebviewContent();
      vscode.window.showInformationMessage(`Profile "${profile.label}" deleted.`);
    }),
    vscode.commands.registerCommand("opencodego.configureVisionProxy", async () => {
      await showVisionProxyPicker(context);
      // The proxy model changed — refresh capabilities so VS Code stops
      // stripping images from non-vision models when the proxy is on.
      goProvider.notifyModelInfoChanged();
      zenProvider.notifyModelInfoChanged();
    }),
  ];

  // Agent-host providers for the Copilot Agents window (opt-in via config).
  const enableAgents = vscode.workspace.getConfiguration("opencodego").get<boolean>("agentsWindow", true);
  if (enableAgents) {
    const agentGoProvider = new OpenCodeProvider(context, PROVIDERS[AGENT_GO_VENDOR]);
    const agentZenProvider = new OpenCodeProvider(context, PROVIDERS[AGENT_ZEN_VENDOR]);
    modelInfoProviders.push(agentGoProvider, agentZenProvider);
    subscriptions.push(
      vscode.lm.registerLanguageModelChatProvider(AGENT_GO_VENDOR, agentGoProvider),
      vscode.lm.registerLanguageModelChatProvider(AGENT_ZEN_VENDOR, agentZenProvider),
    );
  }

  context.subscriptions.push(...subscriptions);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("opencodego.showUsageStatusBar")) {
        resetUsageStatusBar();
      }
      if (event.affectsConfiguration("opencodego.showProviderPrefix")) {
        for (const provider of modelInfoProviders) {
          provider.notifyModelInfoChanged();
        }
      }
    }),
  );

  checkUtilityModelConfiguration(context);

  void warmModelPickerMetadata();
}

/**
 * VS Code 1.128 introduced `chat.byokUtilityModelDefault` with a default of "none",
 * which breaks all background utility tasks (title generation, commit messages, intent
 * detection) for BYOK users. This function auto-configures it to "mainAgent" on first
 * activation so background tasks continue to work seamlessly.
 *
 * RULES:
 * - Only runs on VS Code 1.128+.
 * - Skips if any utility model setting is already explicitly configured.
 * - Uses a one-time globalState flag to avoid showing the notification on every activation.
 * - Valid enum (from VS Code 1.128 desktop bundle): "none" | "mainAgent" | "copilot".
 */
function checkUtilityModelConfiguration(context: vscode.ExtensionContext): void {
  const [major, minor] = vscode.version.split(".").map(Number);
  if (major < 1 || (major === 1 && minor < 128)) return;

  const chat = vscode.workspace.getConfiguration("chat");
  const byokDefault = chat.get<string>("byokUtilityModelDefault", "");
  const utilitySmall = chat.get<string>("utilitySmallModel", "");
  const utilityGeneral = chat.get<string>("utilityModel", "");

  // Treat VS Code's schema default values as "not configured"
  const isConfigured =
    (byokDefault !== "" && byokDefault !== undefined && byokDefault !== "none") ||
    (utilitySmall !== "" && utilitySmall !== undefined && utilitySmall !== "Default") ||
    (utilityGeneral !== "" && utilityGeneral !== undefined && utilityGeneral !== "Default");
  if (isConfigured) return;

  void chat.update("byokUtilityModelDefault", "mainAgent", vscode.ConfigurationTarget.Global).then(() => {
    const NOTICE_KEY = "opencode.utilityModelAutoFixed.v1128";
    if (context.globalState.get<boolean>(NOTICE_KEY)) return;
    void context.globalState.update(NOTICE_KEY, true);
    void vscode.window.showInformationMessage(
      "OpenCode: Automatically fixed VS Code 1.128 utility model setting. " +
        "Background tasks (chat titles, commit messages) now use your OpenCode model.",
    );
  });
}

async function warmModelPickerMetadata(): Promise<void> {
  const vendors: string[] = [GO_VENDOR, ZEN_VENDOR];
  if (vscode.workspace.getConfiguration("opencodego").get<boolean>("agentsWindow", true)) {
    vendors.push(AGENT_GO_VENDOR, AGENT_ZEN_VENDOR);
  }
  await Promise.allSettled(vendors.map((v) => vscode.lm.selectChatModels({ vendor: v })));
}

async function showModelPickerDiagnostics(): Promise<void> {
  const vendors: string[] = [GO_VENDOR, ZEN_VENDOR, "copilot"];
  if (vscode.workspace.getConfiguration("opencodego").get<boolean>("agentsWindow", true)) {
    vendors.splice(2, 0, AGENT_GO_VENDOR, AGENT_ZEN_VENDOR);
  }
  const sections: string[] = [];

  for (const vendor of vendors) {
    const models = await vscode.lm.selectChatModels({ vendor });
    sections.push(`## vendor: ${vendor}`, "", `models: ${models.length}`, "");
    for (const model of models) {
      const internalModel = model as unknown as { configurationSchema?: unknown; detail?: unknown };
      const schema = internalModel.configurationSchema;
      sections.push(
        `### ${model.name}`,
        "",
        `- id: \`${model.id}\``,
        `- family: \`${model.family}\``,
        `- version: \`${model.version}\``,
        `- vendor: \`${model.vendor}\``,
        `- detail: \`${typeof internalModel.detail === "string" ? internalModel.detail : ""}\``,
        `- schema:`,
        "```json",
        JSON.stringify(schema ?? null, null, 2),
        "```",
        "",
      );
    }
  }

  const doc = await vscode.workspace.openTextDocument({
    content: ["# OpenCode Model Picker Diagnostics", "", ...sections].join("\n"),
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

async function showThinkingEffortPicker(): Promise<void> {
  const families: { label: string; key: keyof ThinkingSettings; options: string[] }[] = [
    { label: "DeepSeek (deepseek-v4-*)", key: "deepseek", options: ["off", "low", "medium", "high", "max"] },
    { label: "GLM (glm-5, glm-5.1, glm-5.2)", key: "glm", options: ["off", "high", "max"] },
    { label: "Kimi (kimi-k2.*)", key: "kimi", options: ["on", "off"] },
    { label: "Mimo (mimo-v2.*)", key: "mimo", options: ["off", "low", "medium", "high"] },
    { label: "MiniMax (minimax-m*)", key: "minimax", options: ["off", "on"] },
    { label: "OpenAI GPT (gpt-*)", key: "openai", options: ["off", "low", "medium", "high", "xhigh"] },
    { label: "Qwen (qwen3.*)", key: "qwen", options: ["auto", "on", "off"] },
    { label: "Qwen Thinking Budget", key: "qwenBudget", options: ["auto", "4096", "16384", "32768", "81920"] },
  ];
  const settings = getSettings().thinking;
  const family = await vscode.window.showQuickPick(
    families.map((f) => ({ label: f.label, description: `current: ${settings[f.key]}`, family: f })),
    { placeHolder: "Pick a model family to configure Thinking" },
  );
  if (!family) return;
  const choice = await vscode.window.showQuickPick(family.family.options, {
    placeHolder: `Set ${family.family.label} → Thinking value`,
  });
  if (!choice) return;
  const cfg = vscode.workspace.getConfiguration("opencodego.thinking");
  await cfg.update(family.family.key, choice, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`OpenCode Thinking — ${family.family.label}: ${choice}`);
}

export async function deactivate(): Promise<void> {
  // no-op: experimental context indicator hooks removed in 0.1.8
}

function ensureUsageStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  if (!usageStatusBarItem) {
    usageStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    context.subscriptions.push(usageStatusBarItem);
  }

  resetUsageStatusBar();
  return usageStatusBarItem;
}

function shouldShowUsageStatusBar(): boolean {
  return vscode.workspace.getConfiguration("opencodego").get("showUsageStatusBar", true);
}

function resetUsageStatusBar(): void {
  if (!usageStatusBarItem) {
    return;
  }

  if (!shouldShowUsageStatusBar()) {
    usageStatusBarItem.hide();
    return;
  }

  usageStatusBarItem.text = "OpenCode";
  usageStatusBarItem.tooltip = "OpenCode usage summary";
  usageStatusBarItem.show();
}

function updateUsageStatusBar(providerDisplayName: string, modelId: string, summary: TransportRequestSummary): void {
  if (!usageStatusBarItem) {
    return;
  }

  if (!shouldShowUsageStatusBar()) {
    usageStatusBarItem.hide();
    return;
  }

  const usage: UsageSnapshot = {
    promptTokens: summary.promptTokens,
    completionTokens: summary.completionTokens,
    totalTokens: summary.totalTokens,
    cachedTokens: summary.cachedTokens,
    finishReason: summary.finishReason,
  };
  const text = formatUsageStatusBarText(providerDisplayName, usage);

  usageStatusBarItem.text = text ?? providerDisplayName;
  usageStatusBarItem.tooltip = formatUsageStatusBarTooltip(providerDisplayName, modelId, usage);
  usageStatusBarItem.show();
}

function ensureGoUsageStatusBar(context: vscode.ExtensionContext): void {
  if (goUsageStatusBarItem) return;
  goUsageStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 94);
  goUsageStatusBarItem.command = "opencodego.showUsageQuickPick";
  context.subscriptions.push(goUsageStatusBarItem);
  refreshGoUsageStatusBar();
}

function refreshGoUsageStatusBar(): void {
  if (!goUsageStatusBarItem) return;
  const tracker = activeGoUsageTracker();
  if (!tracker) {
    goUsageStatusBarItem.text = "OpenCode Go";
    goUsageStatusBarItem.tooltip = new vscode.MarkdownString("");
    goUsageStatusBarItem.show();
    return;
  }
  const s = tracker.getSummary();
  const activeProfile = findProfile(profilesCache, activeProfileFingerprint);
  const baseText = formatGoUsageStatusBarText(s);
  goUsageStatusBarItem.text = activeProfile && profilesCache.length > 1 ? `${baseText} [${activeProfile.label}]` : baseText;
  goUsageStatusBarItem.tooltip = buildUsageTooltip(s, tracker.getCurrentSessionCost());
  goUsageStatusBarItem.show();
  updateWebviewContent();
}

function showUsageWebview(context: vscode.ExtensionContext): void {
  if (usageWebviewPanel) {
    usageWebviewPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  usageWebviewPanel = vscode.window.createWebviewPanel("opencodego.usageWebview", "OpenCode Usage Summary", vscode.ViewColumn.Beside, {
    enableScripts: false,
    retainContextWhenHidden: true,
  });

  usageWebviewPanel.onDidDispose(
    () => {
      usageWebviewPanel = undefined;
    },
    null,
    context.subscriptions,
  );

  updateWebviewContent();
}

function updateWebviewContent(): void {
  if (!usageWebviewPanel || !goUsageTracker) return;
  const tracker = activeGoUsageTracker();
  if (!tracker) {
    usageWebviewPanel.webview.html = `<html><body><p>No active tracker</p></body></html>`;
    return;
  }
  const s = tracker.getSummary();
  const sc = tracker.getCurrentSessionCost();
  const activeProfile = findProfile(profilesCache, activeProfileFingerprint);
  const profileLabel = activeProfile?.label ?? "OpenCode Go";

  usageWebviewPanel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OpenCode Usage Summary — ${escapeSvg(profileLabel)}</title>
      <style>
        body {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          height: 100vh;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .container {
          width: 100%;
          max-width: 560px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
        }
        svg {
          width: 100%;
          height: auto;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          background-color: #1e1e1e;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${buildUsageTooltipSvg(s, sc)}
      </div>
    </body>
    </html>
  `;
}

function buildUsageTooltip(
  s: ReturnType<GoUsageTracker["getSummary"]>,
  sessionCost?: { cost: number; requests: number; promptTokens: number; completionTokens: number },
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;

  const commands = ["opencodego.setUsageTargets"];
  if (nonLegacyCount(profilesCache) > 0) {
    commands.push("opencodego.renameActiveProfile");
  }
  (md as unknown as { supportedCommands: string[] }).supportedCommands = commands;

  md.appendMarkdown(`<img alt="Go usage summary" src="${usageTooltipSvgDataUri(s, sessionCost)}" width="420">`);
  md.appendMarkdown("\n\n[$(pencil) Set spent targets](command:opencodego.setUsageTargets)");
  if (nonLegacyCount(profilesCache) > 0) {
    md.appendMarkdown(" \u00B7 [$(pencil) Rename](command:opencodego.renameActiveProfile)");
  }
  return md;
}

/**
 * Show input boxes for the user to manually set Go usage targets.
 * Returns UsageBaselineTargets if the user completed the flow, or undefined if cancelled.
 */
/** Parse a user-entered currency value. Accepts comma or dot as decimal separator.
 *  Returns NaN if the string contains non-numeric characters beyond the decimal separator. */
function parseCurrencyInput(value: string): number {
  // Allow only digits, one comma or dot, and optional leading minus
  if (!/^-?\d+[.,]?\d*$/.test(value)) return NaN;
  return parseFloat(value.replace(",", "."));
}

async function showUsageTargetEditor(tracker: GoUsageTracker): Promise<UsageBaselineTargets | undefined> {
  const summary = tracker.getSummary();

  // Ask for session spent (pre-filled with current tracked value)
  const sessionStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Session Spent",
    prompt: `Total spent in the 5-hour rolling window (limit: $${GO_LIMITS.session}).`,
    placeHolder: "e.g. 3.50",
    value: summary.session.spent.toFixed(2),
    validateInput: (value: string) => {
      const n = parseCurrencyInput(value);
      if (isNaN(n) || n < 0) return "Enter a valid number using digits and . or , as decimal separator (e.g. 3.50).";
      if (n > GO_LIMITS.session) return `Session limit is $${GO_LIMITS.session}. Enter a value between 0 and ${GO_LIMITS.session}.`;
      return undefined;
    },
  });
  if (sessionStr === undefined) return undefined;

  // Ask for weekly spent (pre-filled)
  const weeklyStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Weekly Spent",
    prompt: `Total spent this week Mon–Mon UTC (limit: $${GO_LIMITS.weekly}).`,
    placeHolder: "e.g. 12.00",
    value: summary.weekly.spent.toFixed(2),
    validateInput: (value: string) => {
      const n = parseCurrencyInput(value);
      if (isNaN(n) || n < 0) return "Enter a valid number using digits and . or , as decimal separator (e.g. 12.00).";
      if (n > GO_LIMITS.weekly) return `Weekly limit is $${GO_LIMITS.weekly}. Enter a value between 0 and ${GO_LIMITS.weekly}.`;
      return undefined;
    },
  });
  if (weeklyStr === undefined) return undefined;

  // Ask for monthly spent (pre-filled)
  const monthlyStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Monthly Spent",
    prompt: `Total spent this month (limit: $${GO_LIMITS.monthly}).`,
    placeHolder: "e.g. 25.00",
    value: summary.monthly.spent.toFixed(2),
    validateInput: (value: string) => {
      const n = parseCurrencyInput(value);
      if (isNaN(n) || n < 0) return "Enter a valid number using digits and . or , as decimal separator (e.g. 25.00).";
      if (n > GO_LIMITS.monthly) return `Monthly limit is $${GO_LIMITS.monthly}. Enter a value between 0 and ${GO_LIMITS.monthly}.`;
      return undefined;
    },
  });
  if (monthlyStr === undefined) return undefined;

  // Ask for monthly reset day (1-31) — pre-filled
  const monthlyDayStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Monthly Reset Day",
    prompt: "Day of month when monthly usage resets (1-31). Press Enter to keep current.",
    placeHolder: "e.g. 10",
    value: summary.monthly.resetsAt.getUTCDate().toString(),
    validateInput: (value: string) => {
      if (!value) return undefined;
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 31) return "Enter a day between 1 and 31.";
      return undefined;
    },
  });
  if (monthlyDayStr === undefined) return undefined;

  // Ask for monthly reset hour (0-23 UTC) — pre-filled
  const monthlyHourStr = await vscode.window.showInputBox({
    title: "OpenCode Go — Monthly Reset Hour",
    prompt: "Hour (UTC, 0-23) when monthly usage resets. Press Enter to keep current.",
    placeHolder: "e.g. 0",
    value: summary.monthly.resetsAt.getUTCHours().toString(),
    validateInput: (value: string) => {
      if (!value) return undefined;
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 0 || n > 23) return "Enter an hour between 0 and 23 (UTC).";
      return undefined;
    },
  });
  if (monthlyHourStr === undefined) return undefined;

  const monthlyAnchorDay = monthlyDayStr ? parseInt(monthlyDayStr, 10) : undefined;
  const monthlyAnchorHour = monthlyHourStr ? parseInt(monthlyHourStr, 10) : undefined;

  return {
    session: parseCurrencyInput(sessionStr),
    weekly: parseCurrencyInput(weeklyStr),
    monthly: parseCurrencyInput(monthlyStr),
    monthlyAnchorDay,
    monthlyAnchorHour,
  };
}

type _UsageSummary = ReturnType<GoUsageTracker["getSummary"]>;

function usageTooltipSvgDataUri(
  s: _UsageSummary,
  sc?: { cost: number; requests: number; promptTokens: number; completionTokens: number },
): string {
  const svg = buildUsageTooltipSvg(s, sc);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildUsageTooltipSvg(
  s: _UsageSummary,
  sc?: { cost: number; requests: number; promptTokens: number; completionTokens: number },
  profileLabel?: string,
): string {
  const hasSession = sc && sc.cost > 0;
  // Session label is longer ("Session (est):") so widen the card and shift
  // the cost column right when session data is present.
  const cx = hasSession ? 120 : 80; // cost value column
  const width = hasSession ? 440 : 420;
  const height = s.hasData ? (hasSession ? 310 : 286) : 78;
  const bg = "#1e1e1e";
  const fg = "#d4d4d4";
  const muted = "#a6a6a6";
  const track = "#3c3c3c";
  const accent = "#73c991";
  const line = "#333333";
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const svgTitle = escapeSvg(profileLabel ? `${profileLabel} - Usage` : "OpenCode Go - Usage");
  const noDataMsg = s.hasData ? null : nonLegacyCount(profilesCache) > 0 ? "No data yet for this profile." : "No usage data yet.";

  const text = (value: string, x: number, y: number, size: number, weight = 400, color = fg, anchor: "start" | "end" = "start"): string =>
    `<text x="${x}" y="${y}" fill="${color}" font-family="${font}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeSvg(value)}</text>`;

  const bar = (pct: number, x: number, y: number, barWidth: number): string => {
    const clamped = Math.min(Math.max(pct, 0), 100);
    const fillWidth = Math.max(0, Math.round((clamped / 100) * barWidth));
    return [
      `<rect x="${x}" y="${y}" width="${barWidth}" height="5" rx="2.5" fill="${track}"/>`,
      fillWidth > 0 ? `<rect x="${x}" y="${y}" width="${fillWidth}" height="5" rx="2.5" fill="${accent}"/>` : "",
    ].join("");
  };

  const period = (label: string, p: _UsageSummary["session"], y: number): string =>
    [
      text(label, 14, y, 14, 700),
      text(`Resets in ${rel(p.resetsAt)}`, 410, y, 12, 400, muted, "end"),
      bar(p.percent, 14, y + 12, 340),
      text(`${p.percent.toFixed(1)}%`, 410, y + 19, 14, 700, fg, "end"),
      text(`${usd(p.spent)} / ${usd(p.limit)} used`, 14, y + 34, 13, 400, fg),
    ].join("");

  if (!s.hasData) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="4" fill="${bg}"/>
${text(svgTitle, 14, 26, 16, 700)}
${text(noDataMsg ?? "No usage data yet. Send a chat message to start tracking.", 14, 50, 12, 400, muted)}
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="4" fill="${bg}"/>
${text(svgTitle, 14, 26, 16, 700)}
${period("Session (5h rolling)", s.session, 54)}
${period("Weekly", s.weekly, 116)}
${period("Monthly", s.monthly, 178)}
<line x1="14" y1="224" x2="416" y2="224" stroke="${line}" stroke-width="1"/>
${
  hasSession
    ? [
        text("Session (est):", 14, 250, 13, 400, muted),
        text(`$${sc!.cost.toFixed(4)}`, cx, 250, 13, 700),
        text("Requests:", 200, 250, 13, 400, muted),
        text(String(sc!.requests), 280, 250, 13, 700),
        text("Tokens:", 320, 250, 13, 400, muted),
        text(tokens(sc!.promptTokens + sc!.completionTokens), 400, 250, 13, 700),
      ].join("")
    : ""
}
${text("Today:", 14, hasSession ? 274 : 256, 13, 400, muted)}
${text(usd(s.today.cost), cx, hasSession ? 274 : 256, 13, 700)}
${text("Requests:", 200, hasSession ? 274 : 256, 13, 400, muted)}
${text(String(s.today.requests), 280, hasSession ? 274 : 256, 13, 700)}
${text("Tokens:", 320, hasSession ? 274 : 256, 13, 400, muted)}
${text(tokens(s.today.tokens), 400, hasSession ? 274 : 256, 13, 700)}
${
  s.yesterday.requests > 0
    ? [
        text("Yesterday:", 14, hasSession ? 298 : 278, 13, 400, muted),
        text(usd(s.yesterday.cost), cx, hasSession ? 298 : 278, 13, 700),
        text("Requests:", 200, hasSession ? 298 : 278, 13, 400, muted),
        text(String(s.yesterday.requests), 280, hasSession ? 298 : 278, 13, 700),
        text("Tokens:", 320, hasSession ? 298 : 278, 13, 400, muted),
        text(tokens(s.yesterday.tokens), 400, hasSession ? 298 : 278, 13, 700),
      ].join("")
    : ""
}
</svg>`;
}

function escapeSvg(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function usd(v: number): string {
  return `$${v.toFixed(2)}`;
}
function tokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toString();
}
function rel(date: Date): string {
  const min = Math.max(0, Math.floor((date.getTime() - Date.now()) / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60),
    m = min % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24),
    rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

class OpenCodeProvider implements vscode.LanguageModelChatProvider<OpenCodeModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  /** Trigger a model information refresh (e.g. after visionModel setting changes). */
  notifyModelInfoChanged(): void {
    this.changeEmitter.fire();
  }
  private readonly apiKeysByModelId = new Map<string, string>();

  /**
   * globalState key tracking whether this vendor has a configured BYOK group
   * (issue #106). Set when a configured-group call is served; read by the
   * groupless call to decide whether to stay silent. Scoped per vendor so an
   * `opencodego` group does not affect `opencodezen`.
   */
  private get byokGroupStateKey(): string {
    return `opencode.byokGroup.v1.${this.definition.vendor}`;
  }

  private async hasByokGroupConfigured(): Promise<boolean> {
    return this.context.globalState.get<boolean>(this.byokGroupStateKey, false);
  }

  private async markByokGroupConfigured(): Promise<void> {
    await this.context.globalState.update(this.byokGroupStateKey, true);
  }

  private async clearByokGroupConfigured(): Promise<void> {
    await this.context.globalState.update(this.byokGroupStateKey, undefined);
  }
  /** Capped to prevent unbounded growth across long sessions. */
  private readonly reasoningContentByToolCallId = new Map<string, string>();
  private static readonly REASONING_CACHE_LIMIT = 500;
  private readonly liveModelMetadataById = new Map<string, ModelMetadataFields>();
  private readonly recentTransportSummaries: RecentTransportSummary[] = [];
  private outputChannel: vscode.OutputChannel | undefined;

  /**
   * Cached snapshot of the most recent successful model-list fetch for this
   * provider's base vendor. Persisted to globalState so it survives window
   * reloads and can cover transient network failures at startup (issue #78).
   */
  private cachedModelList: { ids: string[]; fetchedAt: number } | undefined;

  /** globalState key for {@link cachedModelList}, scoped to this provider's vendor. */
  private get modelListCacheKey(): string {
    return `${MODEL_LIST_CACHE_KEY_PREFIX}::${this.baseVendor}`;
  }

  /** Resolves agent-host variants to their base vendor for metadata/routing. */
  private get baseVendor(): ProviderVendor {
    return resolveBaseVendor(this.definition.vendor);
  }

  /** Store reasoning content with a cap to prevent unbounded memory growth. */
  private storeReasoningContent(toolCallIds: string[], reasoningContent: string): void {
    for (const toolCallId of toolCallIds) {
      this.reasoningContentByToolCallId.set(toolCallId, reasoningContent);
    }
    // Evict oldest entries if the cache exceeds the limit.
    if (this.reasoningContentByToolCallId.size > OpenCodeProvider.REASONING_CACHE_LIMIT) {
      const excess = this.reasoningContentByToolCallId.size - OpenCodeProvider.REASONING_CACHE_LIMIT;
      const keys = this.reasoningContentByToolCallId.keys();
      for (let i = 0; i < excess; i++) {
        const key = keys.next().value;
        if (key) this.reasoningContentByToolCallId.delete(key);
      }
    }
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly definition: ProviderDefinition,
  ) {
    this.restoreRecentTransportSummaries();
  }

  private getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("OpenCode");
      this.context.subscriptions.push(this.outputChannel);
    }
    return this.outputChannel;
  }

  private log(message: string): void {
    this.getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private async getMetadataSnapshot(): Promise<CachedModelMetadataSnapshot> {
    return getOpenCodeModelMetadata(this.context, this.getOutputChannel());
  }

  private resolveModelMetadata(modelId: string, snapshot: CachedModelMetadataSnapshot): ResolvedModelMetadata {
    return resolveModelMetadata(modelId, this.baseVendor, snapshot, this.liveModelMetadataById);
  }

  private replaceLiveModelMetadata(entries: ModelListEntry[] | undefined): void {
    this.liveModelMetadataById.clear();
    for (const entry of entries ?? []) {
      if (typeof entry.id !== "string" || !entry.id) {
        continue;
      }
      const metadata = normalizeLiveModelMetadata(entry);
      if (metadata) {
        this.liveModelMetadataById.set(entry.id, metadata);
      }
    }
  }

  private recentTransportSummariesStorageKey(): string {
    return `${RECENT_TRANSPORT_SUMMARY_STORAGE_PREFIX}.${this.definition.vendor}`;
  }

  private restoreRecentTransportSummaries(): void {
    const stored = this.context.globalState.get<RecentTransportSummary[]>(this.recentTransportSummariesStorageKey(), []);

    if (!Array.isArray(stored) || !stored.length) {
      return;
    }

    this.recentTransportSummaries.push(...stored.slice(-RECENT_TRANSPORT_SUMMARY_LIMIT));
  }

  private persistRecentTransportSummaries(): void {
    void this.context.globalState.update(this.recentTransportSummariesStorageKey(), this.recentTransportSummaries);
  }

  private recordTransportSummary(
    summary: TransportRequestSummary,
    endpointKind: string,
    metadataSource: string,
    requestInitiator: unknown,
  ): void {
    const initiator =
      typeof requestInitiator === "string"
        ? requestInitiator
        : requestInitiator === undefined || requestInitiator === null
          ? undefined
          : String(requestInitiator);

    this.recentTransportSummaries.push({
      ...summary,
      recordedAt: new Date().toISOString(),
      endpointKind,
      metadataSource,
      ...(initiator ? { requestInitiator: initiator } : {}),
    });

    if (this.recentTransportSummaries.length > RECENT_TRANSPORT_SUMMARY_LIMIT) {
      this.recentTransportSummaries.splice(0, this.recentTransportSummaries.length - RECENT_TRANSPORT_SUMMARY_LIMIT);
    }

    this.persistRecentTransportSummaries();
  }

  private recentTransportDiagnosticsLines(): string[] {
    if (!this.recentTransportSummaries.length) {
      return ["No requests recorded in this extension host yet.", ""];
    }

    return this.recentTransportSummaries
      .slice()
      .reverse()
      .flatMap((summary, index) => {
        const status = summary.status ?? summary.abortedReason ?? "n/a";
        const cacheHitRatio = formatCacheHitRatio({
          promptTokens: summary.promptTokens,
          cachedTokens: summary.cachedTokens,
        });
        const lines = [
          `### ${index + 1}. ${summary.modelId}`,
          "",
          `- time: ${summary.recordedAt}`,
          `- endpoint: ${summary.endpointKind}`,
          `- initiator: ${summary.requestInitiator ?? "unknown"}`,
          `- metadataSource: ${summary.metadataSource}`,
          `- status: ${status}`,
          `- durationMs: ${summary.durationMs}`,
          `- ttfbMs: ${summary.ttfbMs ?? "n/a"}`,
          `- totalBytes: ${summary.totalBytes}`,
          `- totalEvents: ${summary.totalEvents}`,
          `- tokens: prompt=${summary.promptTokens ?? "n/a"}, completion=${summary.completionTokens ?? "n/a"}, total=${summary.totalTokens ?? "n/a"}, cached=${summary.cachedTokens ?? "n/a"}`,
          `- cacheHitRatio: ${cacheHitRatio ?? "n/a"}`,
          `- finishReason: ${summary.finishReason ?? "n/a"}`,
          `- requestId: ${summary.requestId ?? "n/a"}`,
          `- sessionId: ${summary.sessionId ?? "n/a"}`,
          `- url: ${summary.url}`,
        ];

        if (summary.rateLimitSummary) {
          lines.push(`- rateLimit: ${summary.rateLimitSummary}`);
        }
        if (summary.errorMessage) {
          lines.push(`- error: ${summary.errorMessage}`);
        }

        lines.push("");
        return lines;
      });
  }

  private async refreshMetadataAndModels(): Promise<void> {
    await clearOpenCodeModelMetadataCache(this.context);
    // Pass the stored API key so the gateway sees the authenticated
    // (per-key) model list, not the anonymous default.
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    await this.fetchModels(apiKey);
  }

  /**
   * Public entry point for the `OpenCode <Vendor>: Refresh Models` commands.
   *
   * CONTRACT:
   * - Skips the Manage Provider QuickPick and goes straight to a fetch.
   * - Reuses {@link refreshMetadataAndModels}, fires the change emitter so
   *   VS Code re-resolves the picker, and surfaces an informational toast.
   * - On missing API key, falls back to {@link setApiKey} (same as Manage).
   *
   * Background: this was added after issue #78 revealed that "Refresh Models"
   * was only reachable as a sub-item inside `OpenCode Go: Manage Provider`
   * (and Zen had no manual refresh path at all). The top-level command matches
   * what users naturally type in the Command Palette.
   */
  async refreshModels(): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      await this.setApiKey();
      return;
    }
    await this.refreshMetadataAndModels();
    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`${this.definition.displayName} models refreshed.`);
  }

  async manage(): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);

    if (!apiKey) {
      await this.setApiKey();
      return;
    }

    const choice = await vscode.window.showQuickPick(
      [
        { label: "Set API Key", action: "set" as const },
        { label: "Clear API Key", action: "clear" as const },
        { label: "Test Connection", action: "test" as const },
        { label: "Refresh Models", action: "refresh" as const },
      ],
      {
        title: `Manage ${this.definition.displayName}`,
        placeHolder: "Choose an action",
      },
    );

    if (!choice) {
      return;
    }

    if (choice.action === "set") {
      await this.setApiKey();
      return;
    }

    if (choice.action === "clear") {
      await this.context.secrets.delete(SECRET_KEY);
      // Reset the BYOK-group flag (issue #106) so the extension's own
      // secret-storage flow takes over again. If the user still has a group
      // configured in VS Code's Manage Models panel, the next picker
      // resolution will re-mark the flag and re-store the group key — to
      // fully remove the key, clear it from the Manage Models panel too.
      await this.clearByokGroupConfigured();
      this.changeEmitter.fire();
      vscode.window.showInformationMessage("OpenCode Go API key cleared. If you also set it via Manage Models, remove it there too.");
      return;
    }

    if (choice.action === "test") {
      await this.testConnection();
      return;
    }

    await this.refreshModels();
  }

  async testConnection(): Promise<void> {
    const apiKey = await this.context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      vscode.window.showErrorMessage(`${this.definition.displayName}: No API key set. Use 'Set API Key' first.`);
      return;
    }

    const statusBar = vscode.window.setStatusBarMessage(`$(loading~spin) Testing ${this.definition.displayName} connection...`);
    this.log(`Testing connection to ${this.definition.chatCompletionsUrl}`);

    try {
      const response = await fetch(this.definition.chatCompletionsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.definition.testModelId,
          messages: [{ role: "user", content: "reply with just: ok" }],
          max_tokens: 10,
          stream: false,
        }),
      });

      const responseText = await response.text();
      statusBar.dispose();
      this.log(`Test response (${response.status}): ${responseText}`);

      if (response.ok) {
        vscode.window.showInformationMessage(
          `${this.definition.displayName}: Connection OK (HTTP ${response.status}). Check Output panel for details.`,
        );
      } else {
        vscode.window.showErrorMessage(
          `${this.definition.displayName}: Connection failed (HTTP ${response.status}). Check Output panel for details.`,
        );
      }
    } catch (error) {
      statusBar.dispose();
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Test connection error: ${message}`);
      vscode.window.showErrorMessage(`${this.definition.displayName}: Connection error - ${message}`);
    }
  }

  async setApiKey(): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
      title: "OpenCode Go API Key",
      prompt: "Paste your OpenCode Go API key. It will be stored securely in VS Code SecretStorage.",
      password: true,
      ignoreFocusOut: true,
    });

    if (!apiKey) {
      return;
    }

    await this.context.secrets.store(SECRET_KEY, apiKey.trim());
    this.changeEmitter.fire();
    vscode.window.showInformationMessage("OpenCode Go API key saved.");
  }

  async showDiagnostics(): Promise<void> {
    const models = await vscode.lm.selectChatModels({ vendor: this.definition.vendor });
    const metadataSnapshot = await this.getMetadataSnapshot();
    const lines = models.map((model) => {
      const rawModelId = resolveRawModelId(model.id);
      const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
      const limits = modelLimits(metadata);
      return [
        `- ${rawModelId}`,
        `  rawModelId: ${rawModelId}`,
        `  name: ${model.name}`,
        `  family: ${model.family}`,
        `  vendor: ${model.vendor}`,
        `  version: ${model.version}`,
        `  maxInputTokens: ${model.maxInputTokens}`,
        `  advertisedMaxOutputTokens: ${limits.advertisedMaxOutputTokens}`,
        `  advertisedContextWindow: ${limits.advertisedContextWindow}`,
        `  apiMaxOutputTokens: ${limits.maxOutputTokens}`,
        `  metadataSource: ${metadata.source}`,
        `  supportsVision: ${metadata.supportsVision}`,
        `  status: ${metadata.status ?? "active"}`,
        `  thinkingFamily: ${thinkingFamily(rawModelId) ?? "none"}`,
        `  configurationSchema: ${JSON.stringify((model as unknown as { configurationSchema?: unknown }).configurationSchema ?? null)}`,
        ...(hasExplicitModelLimits(rawModelId, this.baseVendor) ? [] : ["  limits: using bundled fallback"]),
      ].join("\n");
    });

    const content = [
      `# ${this.definition.displayName} Diagnostics`,
      "",
      "## Recent Requests",
      "",
      ...this.recentTransportDiagnosticsLines(),
      `## Models`,
      "",
      `Models visible through vscode.lm.selectChatModels({ vendor: "${this.definition.vendor}" }): ${models.length}`,
      "",
      ...lines,
    ].join("\n");

    const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<OpenCodeModel[]> {
    const opts = options as ConfiguredLanguageModelInfoOptions & { group?: string };

    // 1. Try BYOK configuration first (VS Code may supply the API key directly).
    let apiKey = getConfiguredApiKey(opts);

    // A call that carries a BYOK key is a configured-group call. Record that
    // the vendor is configured natively, so the groupless call stays silent
    // (issue #106, see step 2 below).
    if (apiKey) {
      await this.markByokGroupConfigured();
    }

    // 2. Fall back to the extension's own secret storage when BYOK did not
    //    provide a usable key. This supports users who stored their key via
    //    the extension's `Set API Key` command instead of VS Code's native
    //    Manage Models / BYOK flow.
    //
    //    CONTRACT: Per vscode.proposed.chatProvider.d.ts, `options.configuration`
    //    is only present when the provider declared a `configurationSchema` in
    //    package.json AND the user has configured a BYOK group. When the user
    //    stored the key via the extension command only, VS Code passes
    //    `configuration=undefined` — this is NOT a "still resolving" state
    //    that will be retried with a BYOK key, it means no BYOK group exists.
    //    Therefore we must consult secret storage unconditionally.
    //
    //    This mirrors the reference implementation in Copilot's own
    //    `AbstractLanguageModelChatProvider.provideLanguageModelChatInformation`,
    //    which always falls back to its own storage when `configuration.apiKey`
    //    is absent (see microsoft/vscode `extensions/copilot/src/extension/byok/
    //    vscode-node/abstractLanguageModelChatProvider.ts`).
    //
    //    See issue #86: non-agent `opencodezen` returned 0 models when the key
    //    was set via the extension command, because the previous guard
    //    `isAgentVariant || options.configuration` skipped the fallback for
    //    non-agent providers with `configuration=undefined`.
    //
    //    ISSUE #106: VS Code calls this method once WITHOUT a group (the
    //    groupless call, `configuration` undefined) and then once per configured
    //    group. It namespaces model identifiers by group (`toModelIdentifier`:
    //    `<vendor>/<group>/<id>` vs `<vendor>/<id>`), so a secrets-backed set
    //    returned on the groupless call is kept ALONGSIDE the group's set and
    //    every model is listed twice. When a BYOK group has been observed (flag
    //    set above), the group call(s) are authoritative — return [] here so the
    //    groupless call does not emit a duplicate set.
    if (!apiKey) {
      if (await this.hasByokGroupConfigured()) {
        return [];
      }
      apiKey = await this.context.secrets.get(SECRET_KEY);
    }

    if (!apiKey) {
      return [];
    }

    // When a non-agent provider resolves its API key, persist it so that
    // agent-variant providers (which have no BYOK entry) can inherit it
    // from the extension's secret storage.
    if (!this.definition.isAgentVariant) {
      const existing = await this.context.secrets.get(SECRET_KEY);
      if (existing !== apiKey) {
        await this.context.secrets.store(SECRET_KEY, apiKey);
      }
    }

    if (token.isCancellationRequested) {
      return [];
    }

    // Create profile for this API key before fetching models, so the
    // profile is always registered in both the in-memory cache and
    // globalState, regardless of whether a request has been recorded.
    if (this.baseVendor === GO_VENDOR) {
      ensureProfileSync(apiKey);
    }

    const models = await this.fetchModels(apiKey, token);
    if (models.length === 0) {
      return [];
    }

    const settings = getSettings();
    const metadataSnapshot = await this.getMetadataSnapshot();
    const showProviderPrefix = vscode.workspace.getConfiguration("opencodego").get<boolean>("showProviderPrefix", true);

    // CONTRACT: VS Code calls provideLanguageModelChatInformation frequently
    // (every ~300ms during UI refresh). Per-model logging produces thousands
    // of log lines per minute and obscures real signal. We accumulate a
    // single summary line per invocation instead of one line per model.
    let registeredCount = 0;
    let firstModelId = "";
    let lastModelId = "";

    const results = models.flatMap((modelId) => {
      const metadata = this.resolveModelMetadata(modelId, metadataSnapshot);
      const routing = resolveModelRouting(modelId, this.definition);
      const effectiveModelId = toEffectiveModelId(modelId, this.definition.vendor);
      // Add the key fingerprint to the model ID so two Manage Language
      // Models entries with the same vendor produce distinct model IDs,
      // preventing the apiKeysByModelId map from overwriting keys
      // (fixes issue #63).
      const fp = keyFingerprint(apiKey);
      const fpEffectiveModelId = `${effectiveModelId}::${fp}`;
      const agentHostModelId = `${fpEffectiveModelId}::agent-host`;
      const limits = modelLimits(metadata, settings);
      this.apiKeysByModelId.set(modelId, apiKey);
      this.apiKeysByModelId.set(fpEffectiveModelId, apiKey);
      this.apiKeysByModelId.set(agentHostModelId, apiKey);

      const capacityNote = CAPACITY_LIMITED_MODEL_NOTES[modelId];
      const modalityBadges = formatModalityBadges(metadata);
      const baseDetail = this.baseVendor === ZEN_VENDOR && isFreeZenModel(modelId) ? "Free" : this.definition.displayName;
      const baseTooltip = `${this.definition.displayName} model: ${modelId}`;
      const configurationSchema = modelConfigurationSchema(modelId, metadata);

      const sharedFields: Omit<OpenCodeModel, "id" | "targetChatSessionType"> = {
        rawModelId: modelId,
        name: providerModelDisplayName(this.definition.modelNamePrefix, modelId, showProviderPrefix),
        family: `${this.definition.isAgentVariant && this.definition.baseVendor ? this.definition.baseVendor : this.definition.vendor}-${modelId}-${MODEL_METADATA_REVISION}`,
        // Include effective limits in version so VS Code invalidates stale
        // picker metadata after limit changes (eg. 2M -> 262K corrections).
        version: `1.2.0-${MODEL_METADATA_REVISION}-${limits.contextWindow}-${limits.maxOutputTokens}`,
        detail: capacityNote ? `${baseDetail} • Limited capacity` : modalityBadges ? `${baseDetail} • ${modalityBadges}` : baseDetail,
        tooltip: capacityNote ? `${baseTooltip}\n\n${capacityNote}` : modalityBadges ? `${baseTooltip}\n\n${modalityBadges}` : baseTooltip,
        isUserSelectable: true,
        maxInputTokens: limits.advertisedMaxInputTokens,
        maxOutputTokens: limits.advertisedMaxOutputTokens,
        capabilities: modelCapabilities(metadata),
        endpointKind: routing.endpointKind,
        provider: this.definition,
        // Pricing fields (VS Code languageModelPricing proposal)
        ...modelPricingFields(modelId, this.baseVendor, metadata),
        // Inline so Copilot Chat picks up the Thinking submenu directly
        // (parity with zelosleone/Opencode-Go-For-Copilot pattern).
        ...(configurationSchema ? { configurationSchema } : {}),
      };

      if (this.definition.isAgentVariant) {
        // Agent-host variant — only returned by agent providers.
        // targetChatSessionType must match the `type` declared in the
        // Copilot extension's chatSessions contribution:
        //   { "type": "copilotcli", "requiresCustomModels": true, ... }
        const agentHostInfo: OpenCodeModel = {
          ...sharedFields,
          id: agentHostModelId,
          targetChatSessionType: "copilotcli",
        };

        registeredCount += 1;
        if (!firstModelId) firstModelId = agentHostInfo.id;
        lastModelId = agentHostInfo.id;
        return [agentHostInfo];
      }

      // General variant — no targetChatSessionType → visible in Chat view
      const info: OpenCodeModel = { ...sharedFields, id: fpEffectiveModelId };

      registeredCount += 1;
      if (!firstModelId) firstModelId = info.id;
      lastModelId = info.id;
      return [info];
    });

    // Single summary log line per invocation — includes count + first/last
    // model ID so we can still debug registration issues without flooding
    // the Output channel when VS Code refreshes model info frequently.
    if (registeredCount > 0) {
      this.log(
        `Models registered: count=${registeredCount} provider=${this.definition.vendor}` +
          ` first=${firstModelId} last=${lastModelId}` +
          (this.definition.isAgentVariant ? " (agents)" : ""),
      );
    }

    return results;
  }

  async provideLanguageModelChatResponse(
    model: OpenCodeModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = getConfiguredApiKey(options as ConfiguredLanguageModelResponseOptions) ?? this.apiKeysByModelId.get(model.id);

    if (!apiKey) {
      throw new Error(
        `${this.definition.displayName} API key is required. Use the ${this.definition.displayName} gear icon in Language Models to configure it, then reload the window.`,
      );
    }

    const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
    const convertedMessages = await Promise.all(
      messages.map((message) => convertMessage(message, this.reasoningContentByToolCallId, rawModelId)),
    );
    const apiMessages = normalizeMessages(convertedMessages.flatMap((result) => result.messages));
    const normalizedImageCount = convertedMessages.map((result) => result.normalizedImageCount).reduce((total, count) => total + count, 0);
    if (normalizedImageCount > 0) {
      this.log(`[vision] Normalized ${normalizedImageCount} image attachment(s) to provider-safe dimensions/encoding.`);
    }
    const baseSettings = getSettings();
    // Apply per-request Thinking selection (from Copilot Chat submenu) on top
    // of the workspace default. The override only affects the current model
    // family; other families remain at their global defaults.
    const requestOverride = getRequestModelConfiguration(options);
    const settings: ApiSettings = {
      ...baseSettings,
      thinking: applyRequestThinkingOverride(rawModelId, baseSettings.thinking, requestOverride),
    };
    // Extract the context-size tier selected by the user (if any)
    const contextSizeOverride = typeof requestOverride?.contextSize === "number" ? requestOverride.contextSize : undefined;
    const metadataSnapshot = await this.getMetadataSnapshot();
    const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
    const routing = resolveModelRouting(rawModelId, this.definition);

    // Estimate prompt tokens to cap output budget and prevent context overflow.
    // The server counts tokens differently from our local estimate, so this
    // is a conservative approximation — the actual output budget may be
    // slightly smaller or larger, but it prevents hard 400 rejections.
    const promptTokens = estimateTokenCount(JSON.stringify(apiMessages));
    const limits = modelLimits(metadata, settings, contextSizeOverride, promptTokens);
    const hasImageInput = messagesHaveImages(apiMessages);
    const actuallySupportsVision = metadata.supportsVision; // cached before capabilities override

    // Vision proxy: when a text-only model receives images, relay them
    // through a configured vision-capable Copilot model, then replace
    // the image parts with the text description.
    const visionProxyModelId = isVisionProxyEnabled() ? this.context.globalState.get<string>(VISION_PROXY_MODEL_ID_KEY, "") || "" : "";
    if (hasImageInput && !actuallySupportsVision && visionProxyModelId) {
      const visionProxyPrompt = this.context.globalState.get<string>(VISION_PROXY_PROMPT_KEY, "") || DEFAULT_VISION_PROXY_PROMPT;
      let imagesHandled = false;
      try {
        this.log(`[vision-proxy] Forwarding images to ${visionProxyModelId}`);
        const description = await proxyVision(messages, visionProxyModelId, visionProxyPrompt, token);
        if (description) {
          for (let i = 0; i < apiMessages.length; i++) {
            const msg = apiMessages[i];
            if (!Array.isArray(msg.content)) continue;
            if (msg.content.some((p) => p.type === "image_url")) {
              const textParts = msg.content
                .filter((p): p is OpenAiContentPart & { text: string } => p.type === "text" && typeof p.text === "string")
                .map((p) => p.text);
              msg.content = [{ type: "text", text: `[Image described by vision proxy]: ${description}` }];
              if (textParts.length > 0) {
                msg.content.push({ type: "text", text: textParts.join("\n") });
              }
              imagesHandled = true;
            }
          }
          this.log(`[vision-proxy] Replaced images using vision proxy model`);
        }
      } catch (err) {
        this.log(`[vision-proxy] Error: ${err instanceof Error ? err.message : String(err)}`);
      }

      // If the proxy didn't handle the images (error, empty response, or
      // model not found), strip them anyway so the non-vision model
      // doesn't receive image data it can't process (fixes 400 errors).
      if (!imagesHandled) {
        for (let i = 0; i < apiMessages.length; i++) {
          const msg = apiMessages[i];
          if (!Array.isArray(msg.content)) continue;
          if (msg.content.some((p) => p.type === "image_url")) {
            const textParts = msg.content
              .filter((p): p is OpenAiContentPart & { text: string } => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text);
            msg.content = [{ type: "text", text: "[Image unavailable — vision proxy unavailable]" }];
            if (textParts.length > 0) {
              msg.content.push({ type: "text", text: textParts.join("\n") });
            }
          }
        }
        this.log(`[vision-proxy] Stripped images (proxy unavailable), prevented 400`);
      }
    }

    // Trim old images from conversation history to bound cumulative payload
    // weight. MCP screenshot loops (chrome-devtools-mcp, playwright-mcp) can
    // accumulate multi-MB base64 data URIs in history and trigger upstream
    // `400 Upstream request failed` rejections from OpenCode Go (issue #38
    // follow-up, documented in docs/issues/34 line 264+). Only the most recent
    // MAX_HISTORY_IMAGES_KEPT images are kept; older ones are replaced with a
    // short placeholder text note so the model retains conversation structure
    // without incurring the payload cost.
    //
    // Applied AFTER vision proxy so proxy-replaced text descriptions (already
    // small) are preserved, and applied BEFORE promptTokens estimation so the
    // output budget reflects the trimmed payload.
    const trimmedCount = trimOldImagesFromHistoryInPlace(apiMessages);
    if (trimmedCount > 0) {
      this.log(
        `[history-trim] Replaced ${trimmedCount} old image(s) with placeholder text to bound payload (kept most recent ${MAX_HISTORY_IMAGES_KEPT}).`,
      );
    }

    const thinkingPayload = buildThinkingPayload(rawModelId, settings.thinking, hasImageInput && metadata.supportsVision);
    const requestHeaders = buildOpenCodeRequestHeaders(messages, options, rawModelId);
    const outputChannel = this.getOutputChannel();
    const onTransportSummary = (summary: TransportRequestSummary) => {
      // Compute credits for VS Code session cost (1 credit = $0.01).
      // VS Code reads usage.copilotCredits from the LanguageModelDataPart
      // to accumulate session cost. We mutate the summary object directly
      // so emitSummary includes it in the usage data parts.
      // Use the same estimateCost() helper as goUsageTracker.record() to
      // guarantee cost and credits stay in sync.
      const prompt = summary.promptTokens ?? 0;
      const completion = summary.completionTokens ?? 0;
      const cached = summary.cachedTokens ?? 0;
      const cost = estimateCost(summary.modelId, prompt, completion, cached, metadata.cost);
      summary.copilotCredits = cost * 100;

      this.recordTransportSummary(summary, routing.endpointKind, metadata.source, options.requestInitiator);
      updateUsageStatusBar(this.definition.displayName, rawModelId, summary);
      if (this.baseVendor === GO_VENDOR) {
        const tracker = ensureProfileForApiKey(apiKey, this.definition.displayName);
        if (tracker) {
          this.log(
            `[go-usage] Recording profile=${activeProfileFingerprint}: model=${summary.modelId} promptTokens=${prompt} completionTokens=${completion} cachedTokens=${cached}`,
          );
          tracker.record(summary, metadata.cost);
          refreshGoUsageStatusBar();
          this.log(`[go-usage] After record profile=${activeProfileFingerprint}: entries=${tracker.getSummary().today.requests}`);
        }
      }
    };

    this.log(
      `Request: initiator=${options.requestInitiator} model=${model.id} rawModel=${rawModelId} endpoint=${routing.endpointKind} metadataSource=${metadata.source} messages=${apiMessages.length} session=${requestHeaders["x-opencode-session"]} request=${requestHeaders["x-opencode-request"]} modelConfiguration=${JSON.stringify(pickThinkingModelConfiguration(requestOverride))} thinking=${JSON.stringify(settings.thinking)} thinkingPayload=${JSON.stringify(thinkingPayload)}`,
    );
    if (settings.debugReasoning) {
      this.log("Reasoning debug is enabled. Provider reasoning_content will be written to this output channel when available.");
    }

    try {
      const contextWindowOutputBuffer = limits.advertisedMaxOutputTokens;

      if (routing.endpointKind === "messages") {
        await runStreamAnthropicMessages({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildAnthropicMessagesRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          authHeaders: buildOpenCodeGatewayAuthHeaders("messages", apiKey),
          capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
        });
        return;
      }

      if (routing.endpointKind === "responses") {
        await runStreamResponsesApi({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildResponsesRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
          authHeaders: buildOpenCodeGatewayAuthHeaders("responses", apiKey),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          onReasoningContent: (toolCallIds, reasoningContent) => {
            this.storeReasoningContent(toolCallIds, reasoningContent);
          },
        });
        this.log(`Request completed: model=${model.id}`);
        return;
      }

      if (routing.endpointKind === "google") {
        await runStreamGoogleGenerateContent({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildGoogleGenerateContentBody(apiMessages, options, settings, limits),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          authHeaders: buildOpenCodeGatewayAuthHeaders("google", apiKey),
          capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          onReasoningContent: (toolCallIds, reasoningContent) => {
            this.storeReasoningContent(toolCallIds, reasoningContent);
          },
        });
        return;
      }

      await runStreamChatCompletions({
        url: routing.endpointUrl,
        providerDisplayName: this.definition.displayName,
        apiKey,
        modelId: rawModelId,
        body: buildChatCompletionsRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
        authHeaders: buildOpenCodeGatewayAuthHeaders("chat-completions", apiKey),
        requestHeaders,
        progress,
        token,
        output: outputChannel,
        debugReasoning: settings.debugReasoning,
        requestTimeoutMs: settings.requestTimeoutMs,
        streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
        contextWindowOutputBuffer,
        capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
        onTransportSummary,
        stripThinkTags: settings.stripThinkTags,
        onReasoningContent: (toolCallIds, reasoningContent) => {
          this.storeReasoningContent(toolCallIds, reasoningContent);
        },
      });
      this.log(`Request completed: model=${model.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`ERROR model=${model.id}: ${message}`);
      if (error instanceof OpenCodeRequestError) {
        vscode.window.showErrorMessage(error.userMessage);
      }
      throw error;
    }
  }

  async provideTokenCount(
    _model: OpenCodeModel,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return typeof text === "string" ? estimateTokenCount(text) : estimateChatMessageTokenCount(text);
  }

  /**
   * Fetch the live model list from the OpenCode gateway.
   *
   * CONTRACT:
   * - Resilient to transient network failures (DNS, TCP reset, connect
   *   timeout, 5xx, 429): retries up to {@link MODEL_LIST_FETCH_MAX_RETRIES}
   *   times with exponential backoff. See {@link isTransientFetchError}.
   * - Hard timeout of {@link MODEL_LIST_FETCH_TIMEOUT_MS} per attempt —
   *   undici's default 300s `headersTimeout` is far too long for the picker
   *   (issue #78: picker appeared stuck for minutes on hung TCP).
   * - Sends `User-Agent` ({@link getUserAgent}) so strict gateways don't
   *   silently drop the request.
   * - On final failure, prefers the last successful snapshot (cached in
   *   globalState, TTL {@link MODEL_LIST_CACHE_TTL_MS}) over the bundled
   *   `fallbackModels`, so transient failures don't make the picker "flash
   *   then disappear" when VS Code 1.129's agent host re-resolves frequently.
   * - Respects the VS Code CancellationToken: bails early on abort, never
   *   retries an aborted request.
   */
  private async fetchModels(apiKey?: string, token?: vscode.CancellationToken): Promise<string[]> {
    if (token?.isCancellationRequested) return this.fallbackModelList();

    // Explicit Accept + User-Agent make this look like a legitimate API call
    // rather than an anonymous scanner. Some corporate firewalls / SSL
    // inspection proxies (Zscaler, Netskope, Fortinet) drop bare GETs that
    // lack these headers even when the host is allow-listed. Issue #78
    // reporter sits behind a VPN + corporate firewall on Windows 11.
    const headers: Record<string, string> = {
      "User-Agent": getUserAgent(),
      Accept: "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MODEL_LIST_FETCH_MAX_RETRIES; attempt++) {
      if (token?.isCancellationRequested) {
        return this.fallbackModelList();
      }
      try {
        // Compose the per-request abort with the caller's cancellation token
        // so either one tears down the in-flight fetch.
        const timeoutSignal = AbortSignal.timeout(MODEL_LIST_FETCH_TIMEOUT_MS);
        const signal = token ? AbortSignal.any([timeoutSignal, this.signalFromToken(token)]) : timeoutSignal;

        const response = await fetch(this.definition.modelsUrl, { headers, signal });
        if (!response.ok) {
          throw new Error(`Model list request failed (${response.status}): ${response.statusText}`);
        }
        const data = (await response.json()) as ModelListResponse;
        this.replaceLiveModelMetadata(data.data);
        const ids = data.data
          ?.map((model) => model.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .filter((id) => this.definition.filterModel?.(id) ?? true);

        const resolved = this.filterAvailableModels(ids?.length ? ids : this.definition.fallbackModels);
        const filtered = await resolved;
        // Persist the successful snapshot for future fallback coverage.
        this.cachedModelList = { ids: filtered, fetchedAt: Date.now() };
        void this.context.globalState.update(this.modelListCacheKey, this.cachedModelList);
        return filtered;
      } catch (error) {
        lastError = error;
        // 1. If the caller's cancellation token fired, never retry — bail.
        if (token?.isCancellationRequested) {
          return this.fallbackModelList();
        }
        // 2. Classify the error. Timeout (AbortError without token cancel)
        //    and transient network errors are retryable; HTTP 4xx is not.
        const aborted = error instanceof DOMException && error.name === "AbortError";
        const transient = aborted || isTransientFetchError(error);
        // 3. On final attempt or non-transient error, fall through to
        //    cache/bundled fallback below.
        if (!transient || attempt === MODEL_LIST_FETCH_MAX_RETRIES) {
          break;
        }
        const backoff = MODEL_LIST_FETCH_RETRY_BASE_MS * Math.pow(2, attempt);
        this.log(
          `[fetchModels] ${this.definition.displayName}: transient error (attempt ${attempt + 1}/${MODEL_LIST_FETCH_MAX_RETRIES + 1}): ${this.errMsg(error)}. Retrying in ${backoff}ms.`,
        );
        try {
          await sleep(backoff, token);
        } catch {
          // Cancellation during backoff — bail to fallback.
          return this.fallbackModelList();
        }
      }
    }

    // Final failure: prefer cached snapshot (still fresh), then bundled list.
    const cached = this.loadCachedModelList();
    if (cached) {
      this.log(
        `[fetchModels] ${this.definition.displayName}: ${this.errMsg(lastError)}. Using cached model list (${cached.ids.length} models, fetched ${new Date(cached.fetchedAt).toISOString()}).`,
      );
      return this.filterAvailableModels(cached.ids);
    }
    this.log(
      `[fetchModels] ${this.definition.displayName}: ${this.errMsg(lastError)}. Using bundled model list (${this.definition.fallbackModels.length} models).`,
    );
    return this.filterAvailableModels(this.definition.fallbackModels);
  }

  /** Bundle the cancellation semantics of a VS Code token into an AbortSignal. */
  private signalFromToken(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    if (token.isCancellationRequested) {
      controller.abort();
    } else {
      const sub = token.onCancellationRequested(() => {
        controller.abort();
        sub.dispose();
      });
    }
    return controller.signal;
  }

  private errMsg(error: unknown): string {
    if (error instanceof Error) {
      const cause = (error as { cause?: { code?: string; name?: string; message?: string } }).cause;
      return cause?.code ? `${error.message} [${cause.code}]` : error.message;
    }
    return String(error);
  }

  /**
   * Resolve the model list to use when the fetch path is short-circuited
   * (cancellation, early abort). Prefers a fresh cached snapshot over bundled.
   */
  private fallbackModelList(): Promise<string[]> {
    const cached = this.loadCachedModelList();
    if (cached) {
      return this.filterAvailableModels(cached.ids);
    }
    return this.filterAvailableModels(this.definition.fallbackModels);
  }

  /**
   * Read the last successful fetch from in-memory cache or globalState.
   * Returns undefined when absent or past {@link MODEL_LIST_CACHE_TTL_MS}.
   */
  private loadCachedModelList(): { ids: string[]; fetchedAt: number } | undefined {
    if (this.cachedModelList) {
      const fresh = Date.now() - this.cachedModelList.fetchedAt < MODEL_LIST_CACHE_TTL_MS;
      if (fresh) return this.cachedModelList;
    }
    const stored = this.context.globalState.get<{ ids: string[]; fetchedAt: number }>(this.modelListCacheKey);
    if (stored && Array.isArray(stored.ids) && typeof stored.fetchedAt === "number") {
      const fresh = Date.now() - stored.fetchedAt < MODEL_LIST_CACHE_TTL_MS;
      if (fresh) {
        this.cachedModelList = stored;
        return stored;
      }
    }
    return undefined;
  }

  private async filterAvailableModels(modelIds: string[]): Promise<string[]> {
    const uniqueModelIds = [...new Set(modelIds)];

    try {
      const metadataSnapshot = await this.getMetadataSnapshot();
      const filteredModelIds = uniqueModelIds.filter(
        (modelId) => !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId) && !shouldHideDeprecatedModel(modelId, this.baseVendor, metadataSnapshot),
      );

      const removedModelIds = uniqueModelIds.filter((modelId) => !filteredModelIds.includes(modelId));
      if (removedModelIds.length) {
        this.log(`Filtered unavailable/deprecated models: ${removedModelIds.join(", ")}`);
      }

      return filteredModelIds;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Could not fetch model status metadata from models.dev. Applying local unavailable model filter only. ${message}`);
      return uniqueModelIds.filter((modelId) => !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId));
    }
  }
}

function getConfiguredApiKey(options?: { configuration?: LanguageModelConfiguration }): string | undefined {
  const configuredApiKey = options?.configuration?.apiKey;
  return typeof configuredApiKey === "string" && configuredApiKey.trim() ? configuredApiKey.trim() : undefined;
}

async function clearOpenCodeModelMetadataCache(context: vscode.ExtensionContext): Promise<void> {
  modelMetadataSnapshot = undefined;
  modelMetadataRefreshPromise = undefined;
  await context.globalState.update(MODEL_METADATA_CACHE_KEY, undefined);
}

async function getOpenCodeModelMetadata(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
): Promise<CachedModelMetadataSnapshot> {
  const cached = modelMetadataSnapshot ?? context.globalState.get<CachedModelMetadataSnapshot>(MODEL_METADATA_CACHE_KEY);
  if (cached) {
    modelMetadataSnapshot = cached;
    if (isFreshModelMetadata(cached)) {
      return cached;
    }
    void refreshOpenCodeModelMetadata(context, output);
    return cached;
  }

  return refreshOpenCodeModelMetadata(context, output);
}

async function refreshOpenCodeModelMetadata(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
): Promise<CachedModelMetadataSnapshot> {
  if (modelMetadataRefreshPromise) {
    return modelMetadataRefreshPromise;
  }

  modelMetadataRefreshPromise = (async () => {
    const response = await fetch(MODELS_DEV_API_URL, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`models.dev request failed (${response.status}): ${response.statusText}`);
    }

    const data = (await response.json()) as ModelsDevResponse;
    const snapshot = normalizeModelsDevSnapshot(data);
    modelMetadataSnapshot = snapshot;
    await context.globalState.update(MODEL_METADATA_CACHE_KEY, snapshot);
    output?.appendLine(
      `[metadata] refreshed models.dev cache go=${Object.keys(snapshot.providers[GO_VENDOR]).length} zen=${Object.keys(snapshot.providers[ZEN_VENDOR]).length}`,
    );
    return snapshot;
  })()
    .catch((error) => {
      const cached = modelMetadataSnapshot ?? context.globalState.get<CachedModelMetadataSnapshot>(MODEL_METADATA_CACHE_KEY);
      if (cached) {
        const message = error instanceof Error ? error.message : String(error);
        output?.appendLine(`[metadata] refresh failed, using cached snapshot: ${message}`);
        modelMetadataSnapshot = cached;
        return cached;
      }

      const message = error instanceof Error ? error.message : String(error);
      const fallback = bundledModelMetadataSnapshot();
      output?.appendLine(`[metadata] refresh failed, using bundled snapshot: ${message}`);
      modelMetadataSnapshot = fallback;
      return fallback;
    })
    .finally(() => {
      modelMetadataRefreshPromise = undefined;
    });

  return modelMetadataRefreshPromise;
}

function buildChatCompletionsRequestBody(
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  metadata: ResolvedModelMetadata,
  limits: ModelLimits,
): Record<string, unknown> {
  const tools = mapOpenAiTools(options.tools);
  const thinkingPayload = buildThinkingPayload(modelId, settings.thinking, messagesHaveImages(messages));

  return {
    model: modelId,
    messages,
    // Only send temperature if the model supports it (not deprecated)
    ...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
    max_tokens: limits.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
    ...thinkingPayload,
    ...(tools.length ? { tools, tool_choice: toolChoice(options.toolMode) } : {}),
  };
}

function buildAnthropicMessagesRequestBody(
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  metadata: ResolvedModelMetadata,
  limits: ModelLimits,
): Record<string, unknown> {
  const tools = mapAnthropicTools(options.tools);
  const rawThinkingPayload = buildThinkingPayload(modelId, settings.thinking, messagesHaveImages(messages));
  // Qwen models routed to the Anthropic messages endpoint need thinking in
  // Anthropic-native format ({ type: "enabled"|"disabled" }) rather than the
  // Qwen-native enable_thinking boolean. If the payload contains
  // enable_thinking, translate it; otherwise pass through as-is.
  const thinkingPayload =
    /^qwen3(?:\.|-)/i.test(modelId) && ("enable_thinking" in rawThinkingPayload || "thinking_budget" in rawThinkingPayload)
      ? buildQwenAnthropicThinkingPayload(settings.thinking)
      : rawThinkingPayload;
  const anthropicMessages = buildAnthropicMessages(messages);

  return {
    model: modelId,
    // Only send temperature if the model supports it (not deprecated)
    ...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
    max_tokens: limits.maxOutputTokens,
    stream: true,
    messages: anthropicMessages,
    ...thinkingPayload,
    ...(tools.length ? { tools, tool_choice: anthropicToolChoice(options.toolMode) } : {}),
  };
}

function buildAnthropicMessages(messages: ApiMessage[]): AnthropicRequestMessage[] {
  let cacheControlCount = 0;
  const nextCacheControl = (): { cache_control?: AnthropicCacheControl } => {
    cacheControlCount += 1;
    return cacheControlCount <= 4 ? { cache_control: { type: "ephemeral" } } : {};
  };

  const anthropicMessages: AnthropicRequestMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const userBlocks = anthropicUserBlocks(message.content, nextCacheControl);
      if (userBlocks.length) {
        anthropicMessages.push({ role: "user", content: userBlocks });
      }
      continue;
    }

    if (message.role === "assistant") {
      const assistantBlocks = anthropicAssistantBlocks(message, nextCacheControl);
      if (assistantBlocks.length) {
        anthropicMessages.push({ role: "assistant", content: assistantBlocks });
      }
      continue;
    }

    if (message.role === "tool" && message.tool_call_id) {
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id,
            content: anthropicToolResultContent(message.content, nextCacheControl),
            ...nextCacheControl(),
          },
        ],
      });
    }
  }

  if (!anthropicMessages.length) {
    anthropicMessages.push({
      role: "user",
      content: [{ type: "text", text: "Continue the conversation.", ...nextCacheControl() }],
    });
  }

  return anthropicMessages;
}

function anthropicUserBlocks(
  content: ApiMessage["content"],
  nextCacheControl: () => { cache_control?: AnthropicCacheControl },
): AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content, ...nextCacheControl() }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      blocks.push({ type: "text", text: part.text, ...nextCacheControl() });
      continue;
    }

    if (part.type === "image_url") {
      const source = anthropicImageSource(part);
      if (source) {
        blocks.push({ type: "image", source, ...nextCacheControl() });
      }
    }
  }

  return blocks;
}

// RULES: Anthropic tool_result.content accepts either a plain string or a
// list of content blocks. We use the string form when the message has no
// images (the common case, smaller payload), and fall back to the array form
// (text + image blocks) only when an image_url part is present. This keeps
// text-only tool results byte-for-byte identical to the previous behavior
// while enabling vision-capable Anthropic models to consume MCP screenshots.
function anthropicToolResultContent(
  content: ApiMessage["content"],
  nextCacheControl: () => { cache_control?: AnthropicCacheControl },
): string | AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const hasImage = content.some((part) => part.type === "image_url" && part.image_url?.url);
  if (!hasImage) {
    return joinedTextContent(content, "\n");
  }

  return anthropicUserBlocks(content, nextCacheControl);
}

function anthropicAssistantBlocks(
  message: ApiMessage,
  nextCacheControl: () => { cache_control?: AnthropicCacheControl },
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];

  const text = joinedTextContent(message.content);
  if (text) {
    blocks.push({ type: "text", text, ...nextCacheControl() });
  }

  for (const toolCall of message.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: toolCall.id || `toolu_${Math.random().toString(36).slice(2)}`,
      name: toolCall.function.name,
      input: anthropicToolCallInput(toolCall.function.arguments),
      ...nextCacheControl(),
    });
  }

  return blocks;
}

function anthropicToolCallInput(argumentsText: string): unknown {
  if (!argumentsText.trim()) {
    return {};
  }

  try {
    return JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
}

function anthropicImageSource(part: OpenAiContentPart): AnthropicImageSource | undefined {
  if (part.type !== "image_url") {
    return undefined;
  }

  const url = part.image_url?.url;
  if (typeof url !== "string" || !url) {
    return undefined;
  }

  const match = /^data:([^;]+);base64,(.*)$/i.exec(url);
  if (match) {
    return {
      type: "base64",
      media_type: match[1],
      data: match[2],
    };
  }

  return { type: "url", url };
}

function mapResponsesTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): Array<Record<string, unknown>> {
  return (tools ?? []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: sanitizeToolSchema(tool.inputSchema),
  }));
}

function buildResponsesRequestBody(
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  metadata: ResolvedModelMetadata,
  limits: ModelLimits,
): Record<string, unknown> {
  const input = messages.flatMap((message) => responsesInputItemsFromMessage(message));
  const tools = mapResponsesTools(options.tools);
  const thinkingPayload = buildThinkingPayload(modelId, settings.thinking, messagesHaveImages(messages));

  return {
    model: modelId,
    input,
    max_output_tokens: limits.maxOutputTokens,
    // Only send temperature if the model supports it (not deprecated)
    ...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
    stream: true,
    ...thinkingPayload,
    ...(tools.length ? { tools, tool_choice: toolChoice(options.toolMode) } : {}),
    text: { verbosity: modelId === "gpt-5-codex" ? "medium" : "low" },
  };
}

function responsesInputItemsFromMessage(message: ApiMessage): Array<Record<string, unknown>> {
  if (message.role === "user") {
    const content = responsesUserContent(message.content);
    return content.length ? [{ role: "user", content }] : [];
  }

  if (message.role === "assistant") {
    const items: Array<Record<string, unknown>> = [];
    const text = responsesAssistantText(message.content);
    if (text) {
      items.push({ role: "assistant", content: [{ type: "output_text", text }] });
    }

    for (const toolCall of message.tool_calls ?? []) {
      items.push({
        type: "function_call",
        id: toolCall.id,
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      });
    }

    return items;
  }

  if (message.role === "tool") {
    // The Responses API's function_call_output.output field expects a string.
    // Tool results that carry images (e.g. MCP screenshots) cannot be
    // represented natively here, so we degrade to the joined text payload.
    // Vision-capable OpenAI/Anthropic/Google transports handle images in tool
    // results natively via their respective request builders.
    const output = typeof message.content === "string" ? message.content : responsesToolOutput(message.content);
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id ?? `tool-${Date.now()}`,
        output,
      },
    ];
  }

  return [];
}

function responsesUserContent(content: ApiMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content ? [{ type: "input_text", text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part): Array<Record<string, unknown>> => {
    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "input_text", text: part.text }];
    }

    if (part.type === "image_url" && part.image_url?.url) {
      return [{ type: "input_image", image_url: { url: part.image_url.url } }];
    }

    return [];
  });
}

function responsesAssistantText(content: ApiMessage["content"]): string {
  return joinedTextContent(content);
}

// RULES: Responses API function_call_output.output is a plain string and does
// not support inline image content blocks. To preserve tool result context
// for vision-capable models that would otherwise lose the image entirely, we
// keep any text parts joined with newlines and append a short note when an
// image was present. The note is intentionally brief (not a data URI) so it
// doesn't bloat the payload; the model is told the image was omitted.
function responsesToolOutput(content: ApiMessage["content"]): string {
  if (!Array.isArray(content)) {
    return JSON.stringify(content ?? "");
  }

  const text = joinedTextContent(content, "\n");
  const hasImage = content.some((part) => part.type === "image_url" && part.image_url?.url);
  if (!hasImage) {
    return text || "";
  }

  return [text, "[Image attachment omitted — Responses API does not support images in tool output]"].filter(Boolean).join("\n\n");
}

function joinedTextContent(content: ApiMessage["content"], separator = ""): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part): part is OpenAiContentPart & { text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(separator);
}

function buildGoogleGenerateContentBody(
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  limits: ModelLimits,
): Record<string, unknown> {
  const tools = mapGoogleTools(options.tools);

  return {
    contents: googleContentsFromMessages(messages),
    generationConfig: {
      maxOutputTokens: limits.maxOutputTokens,
      temperature: settings.temperature,
    },
    ...(tools.length ? { tools: [{ functionDeclarations: tools }], toolConfig: googleToolConfig(options.toolMode) } : {}),
  };
}

function mapGoogleTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): Array<Record<string, unknown>> {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: sanitizeToolSchema(tool.inputSchema),
  }));
}

function googleToolConfig(mode: vscode.LanguageModelChatToolMode): Record<string, unknown> {
  return {
    functionCallingConfig: {
      mode: mode === vscode.LanguageModelChatToolMode.Required ? "ANY" : "AUTO",
    },
  };
}

function googleContentsFromMessages(messages: ApiMessage[]): Array<Record<string, unknown>> {
  const toolNamesById = new Map<string, string>();
  const contents: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "user") {
      const parts = googleUserParts(message.content);
      if (parts.length) {
        contents.push({ role: "user", parts });
      }
      continue;
    }

    if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
        parts.push({ text: message.reasoning_content, thought: true });
      }
      const text = responsesAssistantText(message.content);
      if (text) {
        parts.push({ text });
      }
      for (const toolCall of message.tool_calls ?? []) {
        const args = parseToolInput(toolCall.function.arguments);
        parts.push({ functionCall: { name: toolCall.function.name, args } });
        toolNamesById.set(toolCall.id, toolCall.function.name);
      }
      if (parts.length) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (message.role === "tool" && message.tool_call_id) {
      const name = toolNamesById.get(message.tool_call_id) ?? "tool";
      const response = googleFunctionResponseContent(message.content, name);
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: response,
          },
        ],
      });
    }
  }

  return contents;
}

function googleUserParts(content: ApiMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content ? [{ text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part): Array<Record<string, unknown>> => {
    if (part.type === "text" && typeof part.text === "string") {
      return [{ text: part.text }];
    }

    if (part.type === "image_url" && part.image_url?.url) {
      const inlineData = dataUrlToInlineData(part.image_url.url);
      return inlineData ? [{ inlineData }] : [];
    }

    return [];
  });
}

function dataUrlToInlineData(url: string): { mimeType: string; data: string } | undefined {
  const match = /^data:(.+?);base64,(.+)$/i.exec(url);
  if (!match) {
    return undefined;
  }
  return {
    mimeType: match[1],
    data: match[2],
  };
}

// RULES: Gemini's functionResponse.response is a flexible object. The plain
// form is `{ name, content }` where content is a JSON string (text-only tool
// results). When the tool result carries an image (e.g. MCP screenshot), we
// extend it with `parts` containing both the text and an inlineData block so
// vision-capable Gemini models can see the image. The `content` field is kept
// for backwards compatibility with providers that ignore the `parts` field.
function googleFunctionResponseContent(
  content: ApiMessage["content"],
  name: string,
): { name: string; content: string; parts?: Array<Record<string, unknown>> } {
  if (typeof content === "string") {
    return { name, content };
  }

  if (!Array.isArray(content)) {
    return { name, content: JSON.stringify(content ?? "") };
  }

  const text = joinedTextContent(content, "\n");
  const hasImage = content.some((part) => part.type === "image_url" && part.image_url?.url);
  if (!hasImage) {
    return { name, content: text };
  }

  const parts: Array<Record<string, unknown>> = [];
  if (text) {
    parts.push({ text });
  }
  for (const part of content) {
    if (part.type === "image_url" && part.image_url?.url) {
      const inlineData = dataUrlToInlineData(part.image_url.url);
      if (inlineData) {
        parts.push({ inlineData });
      }
    }
  }

  return { name, content: text, parts };
}

function parseToolInput(value: string): object {
  if (!value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// The official OpenCode client sends these headers on every request. The Zen
// gateway reads x-opencode-session first, then converts that sticky identifier
// into provider-specific affinity headers such as x-session-affinity upstream.
//
// VS Code's provider API does not currently expose a guaranteed public session
// identifier everywhere, so we first probe a few known internal fields and then
// fall back to a stable hash of the first messages in the conversation. That
// preserves sticky routing and cache affinity without depending on hidden state.
function buildOpenCodeRequestHeaders(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  modelId: string,
): Record<string, string> {
  const sessionId = cleanHeaderValue(
    findStringOption(options, [
      "sessionId",
      "sessionID",
      "chatSessionId",
      "chatSessionID",
      "conversationId",
      "conversationID",
      "threadId",
      "threadID",
      "session.id",
      "chatSession.id",
    ]) ?? `vscode-${stableHash(conversationAnchor(messages, modelId))}`,
  );
  const requestId = cleanHeaderValue(
    findStringOption(options, ["requestId", "requestID", "messageId", "messageID"]) ??
      `req-${stableHash(`${Date.now()}-${Math.random()}-${sessionId}-${modelId}`)}`,
  );

  return {
    "x-opencode-session": sessionId,
    "x-opencode-request": requestId,
    "x-opencode-client": OPEN_CODE_CLIENT,
    "User-Agent": getUserAgent(),
  };
}

function findStringOption(options: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(options, path.split("."));
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function conversationAnchor(messages: readonly vscode.LanguageModelChatRequestMessage[], modelId: string): string {
  const anchorMessages = messages.slice(0, 3).map((message) => `${message.role}:${messageText(message).slice(0, 2048)}`);
  return anchorMessages.length ? anchorMessages.join("\n") : modelId;
}

function cleanHeaderValue(value: string): string {
  const cleaned = value.replace(/[\r\n]/g, " ").trim();
  return cleaned ? cleaned.slice(0, 256) : "unknown";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function mapOpenAiTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): OpenAiToolDefinition[] {
  return (tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeToolSchema(tool.inputSchema),
    },
  }));
}

function mapAnthropicTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): AnthropicToolDefinition[] {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: sanitizeToolSchema(tool.inputSchema),
  }));
}

function sanitizeToolSchema(schema: unknown): object {
  const root = isRecord(schema) ? schema : { type: "object", properties: {} };
  const sanitized = sanitizeJsonSchemaNode(root, root, new Set());
  if (!isRecord(sanitized)) {
    return { type: "object", properties: {} };
  }

  return {
    type: sanitized.type === "object" ? "object" : "object",
    properties: isRecord(sanitized.properties) ? sanitized.properties : {},
    ...(Array.isArray(sanitized.required) ? { required: sanitized.required } : {}),
  };
}

function sanitizeJsonSchemaNode(value: unknown, root: Record<string, unknown>, seenRefs: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchemaNode(item, root, seenRefs));
  }

  if (!isRecord(value)) {
    return value;
  }

  const ref = typeof value.$ref === "string" ? value.$ref : undefined;
  if (ref?.startsWith("#/") && !seenRefs.has(ref)) {
    const target = resolveJsonPointer(root, ref);
    if (target !== undefined) {
      const nextSeenRefs = new Set(seenRefs);
      nextSeenRefs.add(ref);
      const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
      const resolved = sanitizeJsonSchemaNode(target, root, nextSeenRefs);
      return isRecord(resolved)
        ? sanitizeJsonSchemaNode({ ...resolved, ...siblings }, root, nextSeenRefs)
        : sanitizeJsonSchemaNode(siblings, root, nextSeenRefs);
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema" || key === "$id" || key === "$ref" || key === "$defs" || key === "definitions") {
      continue;
    }

    if (key === "properties" && isRecord(child)) {
      result.properties = Object.fromEntries(
        Object.entries(child).map(([propertyName, propertySchema]) => [
          propertyName,
          sanitizeJsonSchemaNode(propertySchema, root, seenRefs),
        ]),
      );
      continue;
    }

    if (key === "items" || key === "additionalProperties") {
      result[key] = sanitizeJsonSchemaNode(child, root, seenRefs);
      continue;
    }

    if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(child)) {
      result[key] = child.map((item) => sanitizeJsonSchemaNode(item, root, seenRefs));
      continue;
    }

    if (["type", "description", "enum", "required", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].includes(key)) {
      result[key] = child;
    }
  }

  return result;
}

function resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
  return pointer
    .slice(2)
    .split("/")
    .reduce<unknown>((current, segment) => {
      if (!isRecord(current)) {
        return undefined;
      }
      return current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
    }, root);
}

function toolChoice(mode: vscode.LanguageModelChatToolMode): "auto" | "required" {
  return mode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
}

function anthropicToolChoice(mode: vscode.LanguageModelChatToolMode): { type: "auto" | "any" } {
  return { type: mode === vscode.LanguageModelChatToolMode.Required ? "any" : "auto" };
}

async function convertMessage(
  message: vscode.LanguageModelChatRequestMessage,
  reasoningContentByToolCallId: ReadonlyMap<string, string>,
  rawModelId?: string,
): Promise<ConvertedMessageResult> {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const textParts: string[] = [];
  const imageParts: OpenAiContentPart[] = [];
  const toolCalls: OpenAiToolCall[] = [];
  const toolResults: ApiMessage[] = [];
  let normalizedImageCount = 0;

  const normalizeImagePart = async (part: vscode.LanguageModelDataPart): Promise<string> => {
    const originalUrl = `data:${part.mimeType};base64,${dataPartToBase64(part.data)}`;
    const normalizedUrl = await normalizeImageDataUrl(originalUrl);
    if (normalizedUrl !== originalUrl) {
      normalizedImageCount += 1;
    }
    return normalizedUrl;
  };

  const finish = (messages: ApiMessage[]): ConvertedMessageResult => ({
    messages,
    normalizedImageCount,
  });

  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: part.callId,
        type: "function",
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input ?? {}),
        },
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelToolResultPart) {
      // CONTRACT: A LanguageModelToolResultPart.content is unknown[] and may
      // contain nested LanguageModelDataPart instances with image MIME types.
      // This happens when MCP tools (e.g. chrome-devtools-mcp screenshots)
      // return images. Previously we only ran partToText() which silently
      // dropped image DataParts (returned "" via the catch-all fallback),
      // so vision-capable models saw an empty tool result. We now serialize
      // nested images into OpenAiContentPart image_url parts and emit a
      // multimodal array on the tool message when any image is present.
      //
      // SIZE GUARD: Images larger than MAX_TOOL_RESULT_IMAGE_BYTES are
      // replaced with a placeholder text part. This prevents a single
      // oversized MCP screenshot from producing multi-MB payloads that
      // trigger upstream 400 errors when the conversation history grows.
      // Fallback for any non-text, non-image DataPart stays as plain text.
      const toolTextParts: string[] = [];
      const toolImageParts: OpenAiContentPart[] = [];
      for (const resultPart of part.content) {
        if (
          resultPart instanceof vscode.LanguageModelDataPart &&
          resultPart.mimeType.startsWith("image/") &&
          !isInternalDataPart(resultPart)
        ) {
          if (resultPart.data.byteLength > MAX_TOOL_RESULT_IMAGE_BYTES) {
            toolTextParts.push(
              `[Image attachment omitted: ${resultPart.data.byteLength} bytes exceeds the ${MAX_TOOL_RESULT_IMAGE_BYTES}-byte limit for tool results. Ask the tool to produce a smaller screenshot or save it to a file.]`,
            );
            continue;
          }
          const imageUrl = await normalizeImagePart(resultPart);
          toolImageParts.push({
            type: "image_url",
            image_url: { url: imageUrl },
          });
          continue;
        }

        const text = partToText(resultPart);
        if (text) {
          toolTextParts.push(text);
        }
      }

      let toolContent: string | OpenAiContentPart[];
      if (toolImageParts.length > 0) {
        // PROVIDER QUIRK: Xiaomi MiMo (and GLM-5.2) reject list-type tool
        // message content with HTTP 400 "text is not set" (upstream issue
        // anomalyco/opencode#32613). MiMo accepts multimodal content in
        // user/assistant messages but strictly requires `role: "tool"`
        // messages to have a plain string content. The OpenCode Go gateway
        // passes list-type content through unchanged, so we must flatten it
        // client-side for MiMo.
        //
        // For MiMo: emit a plain string — join text parts, and replace each
        // image with a short placeholder note (the model cannot see tool
        // images on MiMo upstream anyway, so we lose nothing and gain a
        // working request). For other providers: keep the multimodal array
        // (Kimi, GLM-5.1, MiniMax, Qwen all accept list-type tool content).
        const isMimoModel = rawModelId !== undefined && /^mimo-/i.test(rawModelId);
        if (isMimoModel) {
          const flattened: string[] = [...toolTextParts];
          for (let i = 0; i < toolImageParts.length; i++) {
            flattened.push(
              `[Tool returned an image attachment, but the MiMo upstream provider does not accept images in tool messages. Image ${i + 1} of ${toolImageParts.length} was dropped to keep the request valid.]`,
            );
          }
          toolContent = flattened.join("\n");
        } else {
          const multimodal: OpenAiContentPart[] = [];
          const joinedText = toolTextParts.join("\n");
          if (joinedText) {
            multimodal.push({ type: "text", text: joinedText });
          }
          multimodal.push(...toolImageParts);
          toolContent = multimodal;
        }
      } else {
        toolContent = toolTextParts.join("\n");
      }

      toolResults.push({
        role: "tool",
        tool_call_id: part.callId,
        content: toolContent,
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      // Normalize before the final payload guard. The previous raw-byte guard
      // ran first and dropped images that could have been resized or compressed
      // into a provider-safe representation.
      const imageUrl = await normalizeImagePart(part);
      const base64Bytes = getImageDataUrlBase64Bytes(imageUrl);
      if (base64Bytes === undefined || base64Bytes > MAX_IMAGE_BASE64_BYTES) {
        textParts.push(
          `[Image attachment omitted: normalized payload exceeds the ` +
            `${Math.floor(MAX_IMAGE_BASE64_BYTES / (1024 * 1024))} MB base64 limit. ` +
            `Resize or compress the image and re-attach it.]`,
        );
        continue;
      }
      imageParts.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
      continue;
    }

    if (part instanceof vscode.LanguageModelDataPart && isInternalDataPart(part)) {
      continue;
    }

    const text = partToText(part);
    if (text) {
      textParts.push(text);
    }
  }

  // Build content: use multimodal array if images present, otherwise plain string
  const hasImages = imageParts.length > 0;
  const textContent = textParts.join("\n");

  let content: string | null | OpenAiContentPart[] = textContent;
  if (hasImages) {
    const multimodal: OpenAiContentPart[] = [];
    if (textContent) {
      multimodal.push({ type: "text", text: textContent });
    }
    multimodal.push(...imageParts);
    content = multimodal;
  }

  if (role === "assistant" && toolCalls.length) {
    // CONTRACT: reasoning_content injection into tool_call assistant messages
    // is gated by model family. MiMo upstream (Xiaomi) uses a strict Pydantic-
    // style validator that rejects assistant tool_call messages carrying a
    // `reasoning_content` field with HTTP 400 `Upstream request failed`, once
    // the conversation history contains tool_calls with reasoning echo. This
    // mirrors the DeepSeek V4 issue (#36354 upstream) and was verified in this
    // extension's logs (issue #38, 2026-07-25): MiMo succeeds until the first
    // tool_call turn with reasoning_content, then every subsequent turn 400s.
    //
    // For MiMo we omit reasoning_content in the echoed assistant tool_call
    // history. The current live response still surfaces reasoning_content to
    // the user via the thinking panel — only the *history echo* is dropped.
    // Other families (DeepSeek, Kimi, GLM, Qwen, MiniMax) tolerate the echo
    // and keep it for cross-turn reasoning continuity.
    const shouldOmitReasoningEcho = rawModelId !== undefined && /^mimo-/i.test(rawModelId);
    return finish([
      {
        role,
        content: typeof content === "string" ? content || null : content,
        reasoning_content: shouldOmitReasoningEcho ? undefined : reasoningForToolCalls(toolCalls, reasoningContentByToolCallId),
        tool_calls: toolCalls,
      },
    ]);
  }

  if (toolResults.length) {
    return finish(content ? [{ role, content }, ...toolResults] : toolResults);
  }

  return finish([{ role, content }]);
}

function dataPartToBase64(data: Uint8Array): string {
  let output = "";

  for (let index = 0; index < data.length; index += 3) {
    const first = data[index] ?? 0;
    const second = data[index + 1] ?? 0;
    const third = data[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;

    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += index + 1 < data.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : "=";
    output += index + 2 < data.length ? BASE64_ALPHABET[chunk & 63] : "=";
  }

  return output;
}

function reasoningForToolCalls(toolCalls: OpenAiToolCall[], reasoningContentByToolCallId: ReadonlyMap<string, string>): string | undefined {
  const reasoning = toolCalls
    .map((toolCall) => reasoningContentByToolCallId.get(toolCall.id))
    .filter((value): value is string => Boolean(value?.trim()));

  return reasoning.length ? reasoning.join("\n") : undefined;
}

function messageText(message: vscode.LanguageModelChatRequestMessage): string {
  return message.content.map(partToText).filter(Boolean).join("\n");
}

function estimateChatMessageTokenCount(message: vscode.LanguageModelChatRequestMessage): number {
  const role = typeof message.role === "string" ? message.role : String(message.role);
  const name = typeof message.name === "string" ? message.name : "";
  const contentTokens = message.content.map(partToTokenCount).reduce((total, count) => total + count, 0);

  return (
    MESSAGE_TOKEN_OVERHEAD + estimateTokenCount(role) + (name ? MESSAGE_NAME_TOKEN_OVERHEAD + estimateTokenCount(name) : 0) + contentTokens
  );
}

function partToTokenCount(part: vscode.LanguageModelInputPart | unknown): number {
  if (part instanceof vscode.LanguageModelTextPart) {
    return estimateTokenCount(part.value);
  }

  if (part instanceof vscode.LanguageModelToolResultPart) {
    const contentTokens = part.content.map(partToTokenCount).reduce((total, count) => total + count, 0);
    return TOOL_RESULT_TOKEN_OVERHEAD + estimateTokenCount(part.callId) + contentTokens;
  }

  if (part instanceof vscode.LanguageModelToolCallPart) {
    return (
      TOOL_CALL_TOKEN_OVERHEAD + estimateTokenCount(part.callId) + estimateTokenCount(part.name) + estimateStructuredTokenCount(part.input)
    );
  }

  if (part instanceof vscode.LanguageModelDataPart) {
    return isInternalDataPart(part) ? 0 : estimateDataPartTokenCount(part);
  }

  if (typeof part === "string") {
    return estimateTokenCount(part);
  }

  if (isRecord(part)) {
    return estimateStructuredTokenCount(part);
  }

  return 0;
}

function estimateStructuredTokenCount(value: unknown): number {
  try {
    return estimateTokenCount(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function estimateDataPartTokenCount(part: vscode.LanguageModelDataPart): number {
  if (part.mimeType.startsWith("image/")) {
    return IMAGE_TOKEN_ESTIMATE;
  }

  if (part.mimeType.startsWith("text/") || part.mimeType === "application/json") {
    return estimateTokenCount(new TextDecoder().decode(part.data));
  }

  return Math.max(1, Math.ceil(part.data.byteLength / 4));
}

function partToText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value;
  }

  if (part instanceof vscode.LanguageModelToolResultPart) {
    return part.content.map(partToText).filter(Boolean).join("\n");
  }

  if (part instanceof vscode.LanguageModelToolCallPart) {
    return `[Tool call: ${part.name} ${JSON.stringify(part.input)}]`;
  }

  if (part instanceof vscode.LanguageModelDataPart && isInternalDataPart(part)) {
    return "";
  }

  if (typeof part === "string") {
    return part;
  }

  return "";
}

function normalizeMessages(messages: ApiMessage[]): ApiMessage[] {
  const normalized: ApiMessage[] = [];

  for (const message of messages) {
    if (!hasMessagePayload(message)) {
      continue;
    }

    const previous = normalized.at(-1);
    const prevContent = previous?.content;
    const msgContent = message.content;
    const prevIsString = typeof prevContent === "string";
    const msgIsString = typeof msgContent === "string";
    const prevHasToolCalls = !!(previous?.tool_calls?.length || previous?.tool_call_id);
    const msgHasToolCalls = !!(message.tool_calls?.length || message.tool_call_id);

    if (
      previous?.role === message.role &&
      message.role !== "tool" &&
      prevIsString &&
      msgIsString &&
      !prevHasToolCalls &&
      !msgHasToolCalls
    ) {
      previous.content = `${prevContent ?? ""}\n\n${msgContent ?? ""}`.trim();
    } else {
      normalized.push({ ...message });
    }
  }

  if (normalized[0]?.role === "assistant") {
    normalized.unshift({
      role: "user",
      content: "Continue the conversation based on the prior assistant message.",
    });
  }

  return normalized.length ? normalized : [{ role: "user", content: "" }];
}

function messagesHaveImages(messages: readonly ApiMessage[]): boolean {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
}

/**
 * Replace image content parts in older messages with a placeholder text note
 * in place, keeping only the most recent `MAX_HISTORY_IMAGES_KEPT` images in
 * the conversation. This bounds the cumulative payload weight when MCP
 * screenshot loops (chrome-devtools-mcp, playwright-mcp) accumulate base64
 * data URIs in history and trigger upstream `400 Upstream request failed`
 * rejections from OpenCode Go.
 *
 * CONTRACT:
 *   - Iterates messages from newest to oldest, counting `image_url` parts.
 *   - Once `MAX_HISTORY_IMAGES_KEPT` images have been seen, every subsequent
 *     (older) image part is replaced in place with a placeholder text note.
 *   - Non-image content parts (text, tool_calls, tool_call_id) are preserved
 *     unchanged — the conversation structure stays intact.
 *   - The placeholder replaces the image part in the same message's content
 *     array; the array shape is preserved so downstream transport builders
 *     still see a valid multimodal structure.
 *   - Mutates the input array's message `content` fields in place (safe: the
 *     caller `provideLanguageModelChatResponse` does not reuse the original
 *     array after this point).
 *
 * INVARIANTS:
 *   - Total `image_url` parts remaining in the array after the call ≤
 *     `MAX_HISTORY_IMAGES_KEPT`.
 *   - Every original image position is either preserved or replaced with a
 *     placeholder text part — no message is silently dropped.
 *
 * @param messages ApiMessage[] from convertMessage() — must be in chronological
 *                 order (oldest first, newest last), as produced by
 *                 `messages.flatMap(convertMessage)`. Mutated in place.
 * @returns Number of image parts that were replaced with a placeholder (for
 *          diagnostic logging). Returns 0 when no trimming was needed.
 */
function trimOldImagesFromHistoryInPlace(messages: ApiMessage[]): number {
  // Count total images to decide whether trimming is needed. Cheap pass that
  // skips allocation and mutation for the common case (short conversations,
  // 0-2 images).
  let totalImages = 0;
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "image_url") totalImages++;
    }
  }
  if (totalImages <= MAX_HISTORY_IMAGES_KEPT) {
    return 0;
  }

  // Walk newest -> oldest, allowing the first MAX_HISTORY_IMAGES_KEPT images
  // to pass through and replacing every older image with a placeholder note.
  let imagesKept = 0;
  let replacedCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!Array.isArray(msg.content)) continue;
    const hasImage = msg.content.some((p) => p.type === "image_url");
    if (!hasImage) continue;
    // Build a new content array, replacing image parts once the budget is spent.
    // We rebuild the array rather than splice-in-place because the original
    // parts array may be shared with the caller's view.
    const newContent: OpenAiContentPart[] = [];
    for (const part of msg.content) {
      if (part.type === "image_url") {
        if (imagesKept < MAX_HISTORY_IMAGES_KEPT) {
          newContent.push(part);
          imagesKept++;
        } else {
          newContent.push({
            type: "text",
            text: "[Earlier screenshot omitted from history to keep request payload under gateway limit. The latest screenshots above are preserved.]",
          });
          replacedCount++;
        }
      } else {
        newContent.push(part);
      }
    }
    msg.content = newContent;
  }
  return replacedCount;
}

function hasMessagePayload(message: ApiMessage): boolean {
  if (message.tool_calls?.length || message.tool_call_id) {
    return true;
  }

  if (typeof message.content === "string") {
    return message.content.trim().length > 0;
  }

  if (Array.isArray(message.content)) {
    return message.content.length > 0;
  }

  return false;
}

// Detect which Thinking family a raw model id belongs to. Used both to render
// the per-model picker submenu (configurationSchema) and to map the user's
// per-request selection back to the right OpenCode request field.
// Per-family JSON-Schema describing the native model-picker controls rendered
// by VS Code 1.120. Keep the primary property name aligned with VS Code's
// BYOK reasoning control so builds with narrower assumptions still recognize it.
// Accepts optional metadata for dynamic fallback: any model with
// `reasoning: true` in its resolved metadata gets a generic off/on schema
// even if no hardcoded family match exists.
function modelConfigurationSchema(modelId: string, metadata?: ResolvedModelMetadata): vscode.LanguageModelConfigurationSchema | undefined {
  const properties: Record<string, unknown> = {};

  // --- Thinking / Reasoning Effort ---
  // Priority 1: if models.dev provides explicit reasoning_options, use those.
  // Priority 2: fall back to family-based hardcoded values.
  // Priority 3: dynamic fallback for any model with reasoning: true.
  const builtinSchema = buildFamilyThinkingSchema(modelId, metadata);

  if (builtinSchema) {
    Object.assign(properties, builtinSchema.properties);
  }

  // --- Context Size (tiered pricing) ---
  const contextSizeOptions = metadata ? getContextSizeOptionsForModel(modelId, metadata.cost, metadata.contextWindow) : undefined;
  if (contextSizeOptions && contextSizeOptions.length > 0) {
    properties.contextSize = {
      type: "number",
      title: "Context Size",
      enum: contextSizeOptions.map((o) => o.value),
      enumItemLabels: contextSizeOptions.map((o) => o.label),
      enumDescriptions: contextSizeOptions.map((o) => o.description),
      default: contextSizeOptions.find((o) => o.isDefault)?.value ?? contextSizeOptions[0].value,
      group: "tokens",
    };
  }

  if (Object.keys(properties).length === 0) {
    return undefined;
  }

  return { type: "object", properties: properties as vscode.LanguageModelConfigurationSchema["properties"] };
}

/**
 * Build the thinking-effort portion of the configuration schema.
 * Delegated to `./thinking.ts` (pure, testable).
 */

// All thinking helpers (buildFamilyThinkingSchema, applyRequestThinkingOverride,
// buildThinkingPayload, buildQwenAnthropicThinkingPayload, thinkingFamily) are
// imported from ./thinking.ts at the top of this file.

function getRequestModelConfiguration(options: vscode.ProvideLanguageModelChatResponseOptions): Record<string, unknown> | undefined {
  // The field is `modelConfiguration` in the current proposed API; older
  // builds shipped it under `configuration` alongside the auth config. Accept
  // both shapes defensively so the picker keeps working across VS Code
  // versions.
  const opts = options as vscode.ProvideLanguageModelChatResponseOptions & {
    modelConfiguration?: Record<string, unknown>;
    configuration?: Record<string, unknown>;
  };
  return opts.modelConfiguration ?? opts.configuration;
}

function pickThinkingModelConfiguration(override: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!override) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of ["reasoningEffort", "thinkingMode", "thinkingBudget"]) {
    const value = override[key];
    if (typeof value === "string") {
      picked[key] = value;
    }
  }
  return Object.keys(picked).length ? picked : undefined;
}

function getSettings(): ApiSettings {
  const config = vscode.workspace.getConfiguration("opencodego");

  return {
    temperature: config.get("temperature", 0.2),
    maxOutputTokensOverride: config.get("maxTokens", 0),
    maxInputTokensOverride: config.get("maxInputTokens", 0),
    debugReasoning: config.get("debugReasoning", false),
    requestTimeoutMs: Math.max(config.get("requestTimeoutSeconds", DEFAULT_REQUEST_TIMEOUT_MS / 1000), 1) * 1000,
    streamIdleTimeoutMs: Math.max(config.get("streamIdleTimeoutSeconds", DEFAULT_STREAM_IDLE_TIMEOUT_MS / 1000), 1) * 1000,
    thinking: {
      deepseek: config.get<ThinkingSettings["deepseek"]>("thinking.deepseek", "off"),
      glm: config.get<ThinkingSettings["glm"]>("thinking.glm", "off"),
      kimi: config.get<ThinkingSettings["kimi"]>("thinking.kimi", "off"),
      minimax: config.get<ThinkingSettings["minimax"]>("thinking.minimax", "off"),
      openai: config.get<ThinkingSettings["openai"]>("thinking.openai", "off"),
      qwen: config.get<ThinkingSettings["qwen"]>("thinking.qwen", "off"),
      qwenBudget: config.get<ThinkingSettings["qwenBudget"]>("thinking.qwenBudget", "auto"),
      mimo: config.get<ThinkingSettings["mimo"]>("thinking.mimo", "off"),
    },
    stripThinkTags: config.get<ApiSettings["stripThinkTags"]>("stripThinkTags", "auto"),
  };
}

// buildThinkingPayload and buildQwenAnthropicThinkingPayload are imported from
// ./thinking.ts (pure, testable).

function modelLimits(
  metadata: ResolvedModelMetadata,
  settings = getSettings(),
  contextSizeOverride?: number,
  promptTokens?: number,
): ModelLimits {
  const baseContextWindow = positiveOverride(settings.maxInputTokensOverride) ?? metadata.contextWindow;
  // If the user selected a specific context size tier, cap the window to that
  const contextWindow = contextSizeOverride !== undefined ? Math.min(baseContextWindow, contextSizeOverride) : baseContextWindow;
  const maxOutputTokens = positiveOverride(settings.maxOutputTokensOverride) ?? metadata.maxOutputTokens;
  // Cap output so that prompt + output never exceeds the context window.
  // When promptTokens is known (from message normalization), use the actual
  // count; otherwise fall back to a conservative 80% reserve for the prompt.
  // The safety margin compensates for estimateTokenCount() underestimating
  // by 0-2%, which on large prompts (~130K) can push the payload over the
  // context window limit and cause a 400.
  const TOKEN_ESTIMATE_SAFETY_MARGIN = 64;
  const promptReserve = (promptTokens ?? Math.floor(contextWindow * 0.8)) + TOKEN_ESTIMATE_SAFETY_MARGIN;
  const safeOutputBudget = Math.max(MIN_OUTPUT_BUDGET, contextWindow - promptReserve);
  const apiMaxOutputTokens = Math.min(maxOutputTokens, safeOutputBudget);
  // advertisedContextWindow = actual model context window (not inflated).
  // Adding apiMaxOutputTokens here inflates the value above the real limit,
  // which causes VS Code to round up and display "2M" instead of "1M" for a
  // 1M-context model, and worse: VS Code may try to send payloads larger than
  // the model's actual total context window.
  const advertisedContextWindow = contextWindow;
  const advertisedMaxOutputTokens = Math.max(1, Math.min(apiMaxOutputTokens, UI_OUTPUT_TOKEN_RESERVE));

  return {
    contextWindow,
    maxOutputTokens: apiMaxOutputTokens,
    advertisedContextWindow,
    advertisedMaxInputTokens: Math.max(1, advertisedContextWindow - advertisedMaxOutputTokens),
    advertisedMaxOutputTokens,
  };
}

function estimateTokenCount(value: string): number {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  // Standard heuristic: 1 token ≈ 4 characters (OpenAI rule of thumb).
  // For CJK text, each character is roughly 1-2 tokens, so we add the
  // CJK character count as an additional buffer.
  //
  // NOTE: We intentionally do NOT use a word-count-based heuristic here.
  // JSON-serialized messages contain many structural characters ({, }, ", :, ,)
  // that inflate word counts by 3-5×, causing safeOutputBudget to collapse to 1
  // (see issue #83). The charEstimate-based approach naturally overestimates
  // for JSON (higher char/token ratio), which is the safe direction — we prefer
  // a conservative output budget over context overflow 400 errors.
  const cjkCharacters = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const charEstimate = Math.ceil(normalized.length / 4);

  // Add 10% buffer for code-heavy text where char/token ratio is lower
  // (more tokens per character, e.g. identifiers, operators).
  const codeBuffer = Math.ceil(charEstimate * 0.1);

  return Math.max(1, Math.ceil(charEstimate + codeBuffer + cjkCharacters));
}

function positiveOverride(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function modelCapabilities(metadata: ResolvedModelMetadata): CopilotCompatibleCapabilities {
  // When a vision proxy model is configured (non-empty ID in globalState),
  // report imageInput: true for ALL models so VS Code does not strip image
  // parts before they reach our provider. The vision proxy interceptor
  // forwards images to the configured model transparently.
  const supportsVision = metadata.supportsVision || isVisionProxyEnabled();

  return {
    imageInput: supportsVision,
    toolCalling: true,
    supportsImageToText: supportsVision,
    supportsToolCalling: true,
  };
}

function formatModalityBadges(metadata: ResolvedModelMetadata): string {
  const badges: string[] = [];
  if (metadata.supportsVision) {
    badges.push("Image");
  }
  if (metadata.supportsPdf) {
    badges.push("PDF");
  }
  if (metadata.supportsVideo) {
    badges.push("Video");
  }
  if (metadata.supportsAudio && !metadata.supportsVideo && !metadata.supportsPdf) {
    badges.push("Audio");
  }
  if (metadata.supportsAudio && (metadata.supportsVideo || metadata.supportsPdf)) {
    badges.push("Audio");
  }
  return badges.join(" · ");
}

function shouldHideDeprecatedModel(modelId: string, vendor: ProviderDefinition["vendor"], snapshot: CachedModelMetadataSnapshot): boolean {
  if (resolveBaseVendor(vendor) !== ZEN_VENDOR) {
    return false;
  }
  return snapshot.providers[ZEN_VENDOR]?.[modelId]?.status === "deprecated";
}

function resolveRawModelId(modelId: string): string {
  const [base] = modelId.split("::");
  const prefixes = [`${GO_VENDOR}:`, `${ZEN_VENDOR}:`, `${AGENT_GO_VENDOR}:`, `${AGENT_ZEN_VENDOR}:`];
  for (const prefix of prefixes) {
    if (base.startsWith(prefix)) {
      return base.slice(prefix.length);
    }
  }
  return base;
}

function isFreeZenModel(modelId: string): boolean {
  return modelId.endsWith("-free") || FREE_ZEN_MODEL_IDS.has(modelId);
}

function isFreeModel(modelId: string): boolean {
  return FREE_ZEN_MODEL_IDS.has(modelId) || modelId.endsWith("-free");
}

/**
 * Vision proxy: relay image messages through a vision-capable Copilot model
 * and return the text description. This lets text-only models "see" images
 * transparently (issue #74).
 */
async function proxyVision(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  visionModelId: string,
  visionPrompt: string,
  token: vscode.CancellationToken,
): Promise<string | undefined> {
  // Find the vision model by trying several matching strategies:
  // 1. Exact id match (full internal model id)
  // 2. Vendor:id partial (e.g. "opencodego:mimo-v2.5")
  // 3. Name or id substring (e.g. "mimo-v2.5" or "Mimo V2.5")
  // Filter out agent-host variants — they use a different transport and
  // don't have vision support. Prefer non-agent models.
  const nonAgent = (models: readonly vscode.LanguageModelChat[]) => models.filter((m) => !m.id.includes("-agent:"));

  let visionModels = nonAgent(await vscode.lm.selectChatModels({ id: visionModelId }));
  if (!visionModels || visionModels.length === 0) {
    // Try matching by name substring across all providers
    const allVisible = nonAgent(await vscode.lm.selectChatModels({}));
    visionModels = allVisible.filter(
      (m) =>
        m.id.toLowerCase().includes(visionModelId.toLowerCase()) ||
        m.name.toLowerCase().includes(visionModelId.toLowerCase()) ||
        m.family.toLowerCase().includes(visionModelId.toLowerCase()),
    );
  }
  if (!visionModels || visionModels.length === 0) {
    throw new Error(`Vision model "${visionModelId}" not found. ` + `Run "OpenCode Go: Configure Vision Proxy" to see available models.`);
  }

  // All models that matched are candidates. `selectChatModels` returns
  // `LanguageModelChat` which does not expose capabilities in the stable
  // API, so we just use the first match. Most vision models handle image
  // input gracefully — models without vision will report the error.
  const model = visionModels[0];

  // Build a request preserving images and text from the original messages
  const requestMessages: vscode.LanguageModelChatMessage[] = [];
  for (const msg of messages) {
    const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [];
    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
        parts.push(part);
      } else if (part instanceof vscode.LanguageModelTextPart) {
        parts.push(part);
      } else if (typeof part === "object" && part !== null && "value" in part) {
        parts.push(new vscode.LanguageModelTextPart(String(part.value)));
      }
    }
    if (parts.length > 0) {
      requestMessages.push(
        new vscode.LanguageModelChatMessage(
          msg.role === vscode.LanguageModelChatMessageRole.Assistant
            ? vscode.LanguageModelChatMessageRole.Assistant
            : vscode.LanguageModelChatMessageRole.User,
          parts,
        ),
      );
    }
  }

  // Append the vision prompt
  if (visionPrompt) {
    requestMessages.push(vscode.LanguageModelChatMessage.User(visionPrompt));
  }

  const response = await model.sendRequest(requestMessages, {}, token);
  let fullDescription = "";
  for await (const part of response.text) {
    fullDescription += part;
  }
  return fullDescription.length > 0 ? fullDescription : undefined;
}

// ---------------------------------------------------------------------------
// Vision proxy — globalState storage keys & defaults
// ---------------------------------------------------------------------------

const VISION_PROXY_MODEL_ID_KEY = "opencodego.visionProxyModelId";
const VISION_PROXY_PROMPT_KEY = "opencodego.visionProxyPrompt";
const DEFAULT_VISION_PROXY_PROMPT =
  "Describe this image in detail so a text-only model can understand what it shows. " +
  "Include all visible text, layout, colors, objects, and context.";

/**
 * True when a vision proxy model has been configured (non-empty model ID
 * stored in globalState via the "OpenCode Go: Configure Vision Proxy" command).
 */
function isVisionProxyEnabled(): boolean {
  return (_extensionContext?.globalState.get<string>(VISION_PROXY_MODEL_ID_KEY, "") ?? "").length > 0;
}

/**
 * QuickPick to configure vision proxy model and prompt.
 * Clean list of model names (no ugly IDs), with "None" to disable
 * and "Customize prompt..." to edit the description instruction.
 * Saves to globalState; toggles the visionProxy boolean accordingly.
 */
async function showVisionProxyPicker(context: vscode.ExtensionContext): Promise<void> {
  const currentModelId = context.globalState.get<string>(VISION_PROXY_MODEL_ID_KEY, "");
  const currentPrompt = context.globalState.get<string>(VISION_PROXY_PROMPT_KEY, "") || DEFAULT_VISION_PROXY_PROMPT;

  // --- Build the set of vision-capable model IDs ---
  const visionCapableIds = new Set<string>();
  const snapshot = modelMetadataSnapshot;
  if (snapshot) {
    for (const vendor of [GO_VENDOR, ZEN_VENDOR] as const) {
      const provider = snapshot.providers[vendor];
      if (!provider) continue;
      for (const [id, meta] of Object.entries(provider)) {
        if (meta.supportsVision) visionCapableIds.add(`${vendor}:${id}`);
      }
    }
  }
  for (const family of VISION_CAPABLE_MODELS) {
    visionCapableIds.add(`copilot:${family}`);
  }

  // --- Build QuickPick items from available models ---
  const allModels = (await vscode.lm.selectChatModels({})).filter((m) => !m.id.includes("-agent:"));

  const modelItems = allModels
    .map((m) => {
      const rawId = resolveRawModelId(m.id);
      const vendor = resolveVendorFromId(m.id);
      const lookupId = `${vendor}:${rawId}`;
      const fromLookup = visionCapableIds.has(lookupId);
      const fromName = [...visionCapableIds].some((id) => m.id.includes(id.replace(/^(opencodego|opencodezen|copilot):/, "")));
      const supportsVision = fromLookup || fromName;
      return {
        label: m.name,
        description: supportsVision ? "$(eye)" : "",
        detail: supportsVision ? (m.id === currentModelId ? "currently configured" : "vision-capable") : "",
        picked: m.id === currentModelId,
        _id: m.id,
        _kind: "model" as const,
        _supportsVision: supportsVision,
      };
    })
    .filter((m) => m._supportsVision);

  if (modelItems.length === 0) {
    vscode.window.showInformationMessage(
      "No vision-capable models found. Make sure you have a Copilot Chat provider with vision models installed.",
    );
    return;
  }

  modelItems.sort((a, b) => {
    if (a._id === currentModelId) return -1;
    if (b._id === currentModelId) return 1;
    return a.label.localeCompare(b.label);
  });

  const items: Array<{
    label: string;
    description?: string;
    detail?: string;
    picked?: boolean;
    _id?: string;
    _kind: "none" | "prompt" | "model" | "separator";
    _supportsVision?: boolean;
    kind?: vscode.QuickPickItemKind;
  }> = [
    { label: "$(circle-slash) None (disable)", detail: currentModelId ? "" : "currently selected", picked: !currentModelId, _kind: "none" },
    { label: "", kind: vscode.QuickPickItemKind.Separator, _kind: "separator" },
    {
      label: "$(edit) Customize description prompt...",
      description: "$(info) Sets how the vision model describes images",
      _kind: "prompt",
    },
    { label: "", kind: vscode.QuickPickItemKind.Separator, _kind: "separator" },
    ...modelItems,
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Pick a model, customize the prompt, or disable",
    title: "OpenCode Go — Vision Proxy",
    matchOnDescription: true,
  });

  if (!picked || !("_kind" in picked)) return;

  // --- "Customize prompt..." ---
  if (picked._kind === "prompt") {
    const newPrompt = await vscode.window.showInputBox({
      title: "Vision Proxy — Description Prompt",
      prompt: "Prompt sent to the vision model to describe the image.",
      value: currentPrompt,
      placeHolder: DEFAULT_VISION_PROXY_PROMPT,
      validateInput: (value: string) => (value.trim() ? undefined : "Prompt cannot be empty."),
    });
    if (newPrompt === undefined) return; // cancelled
    await context.globalState.update(VISION_PROXY_PROMPT_KEY, newPrompt.trim());
    vscode.window.showInformationMessage("Vision proxy prompt updated.");
    return;
  }

  // --- "None" ---
  if (picked._kind === "none") {
    await context.globalState.update(VISION_PROXY_MODEL_ID_KEY, "");
    vscode.window.showInformationMessage("Vision proxy disabled.");
    return;
  }

  // --- Model selected ---
  if (!picked._id) return;
  await context.globalState.update(VISION_PROXY_MODEL_ID_KEY, picked._id);
  vscode.window.showInformationMessage(`Vision proxy set to: ${picked.label}`);
}

/** Best-effort vendor resolution from a model ID. */
function resolveVendorFromId(modelId: string): AllProviderVendor {
  if (modelId.startsWith(`${AGENT_GO_VENDOR}:`)) return AGENT_GO_VENDOR;
  if (modelId.startsWith(`${AGENT_ZEN_VENDOR}:`)) return AGENT_ZEN_VENDOR;
  if (modelId.startsWith(`${ZEN_VENDOR}:`)) return ZEN_VENDOR;
  return GO_VENDOR;
}

/**
 * Returns pricing fields for VS Code's language model pricing proposal
 * (`vscode.proposed.languageModelPricing`).
 *
 * Cost data from models.dev is in USD; VS Code expects AI Credits
 * (1 credit = $0.01 USD). We convert by multiplying by 100 so the
 * pricing table shows values comparable to Copilot's own models.
 *
 * The `pricing` string matches the format used by the Copilot extension's
 * `formatPricingLabel` (`In: $X · Out: $Y /1M tokens`) so the picker hover
 * reads consistently across providers.
 */
function modelPricingFields(
  modelId: string,
  vendor: ProviderDefinition["vendor"],
  metadata: ResolvedModelMetadata,
): {
  pricing?: string;
  priceCategory?: string;
  inputCost?: number;
  outputCost?: number;
  cacheCost?: number;
} {
  const free = isFreeModel(modelId);

  if (free) {
    return { pricing: "Free", priceCategory: "low" };
  }

  const cost = metadata.cost;
  if (cost) {
    const inputCredits = Math.round(cost.input * 100);
    const outputCredits = Math.round(cost.output * 100);
    const cacheCredits = cost.cache_read !== undefined ? Math.round(cost.cache_read * 100) : undefined;

    const fmt = (v: number) => `$${v.toFixed(v < 0.1 ? 2 : 1)}`;
    return {
      pricing: `In: ${fmt(cost.input)} · Out: ${fmt(cost.output)} /1M tokens`,
      priceCategory: costCategory(cost),
      inputCost: inputCredits,
      outputCost: outputCredits,
      ...(cacheCredits !== undefined ? { cacheCost: cacheCredits } : {}),
    };
  }

  // No models.dev cost data: fall back to a neutral label so the picker
  // shows something instead of pretending we know the price.
  return {
    pricing: `${vendor === GO_VENDOR ? "Go" : "Zen"} subscription`,
  };
}

/**
 * Maps per-million-token USD cost to the four-tier `priceCategory` labels
 * (`low` / `medium` / `high` / `very_high`) that VS Code's language model
 * picker renders as a visual cost indicator.
 *
 * VS Code's own `getPriceCategoryLabel` (chatModelPicker.ts) just translates
 * the string but does not assign thresholds - the Copilot extension uses
 * billing multipliers and a weighted 3:1 input:output blend to mirror the
 * user's billing mix. We follow the same 3:1 weighting here so our category
 * lines up with what the user sees for the official Copilot models:
 *
 * - low       : qwen3.5-plus, deepseek-v4-flash-free, mimo-v2-flash-free
 * - medium    : kimi-k2.6, gemini-3-flash, claude-haiku-4-5, gpt-5,
 *               gpt-5.2, gpt-5.4, claude-sonnet-4-6
 * - high      : claude-opus-4-5, claude-opus-4-7, gpt-5.5
 * - very_high : gpt-5.4-pro, gpt-5.5-pro, claude-opus-4-1
 *
 * Free models (`cost.input == 0 && cost.output == 0`) are reported as `low`
 * because that is the bucket VS Code uses for "Free" entries in the picker.
 */
function costCategory(cost: { input: number; output: number }): string {
  if (cost.input <= 0 && cost.output <= 0) {
    return "low";
  }
  // Mirrors Copilot's 3:1 input:output blend (input tokens are usually the
  // larger share of a request, so they get more weight than raw sum).
  const weighted = cost.input * 3 + cost.output;
  if (weighted <= 2) return "low";
  if (weighted <= 25) return "medium";
  if (weighted <= 50) return "high";
  return "very_high";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
