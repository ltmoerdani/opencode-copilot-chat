/**
 * Central configuration for the extension.
 *
 * Every tunable value / limit / URL / storage key / default lives here so it
 * can be changed in ONE place without hunting through the codebase. Modules
 * import from this file; where an existing module historically exported a
 * constant (and tests or callers rely on it), the module re-exports it:
 *
 *   import { X } from "./config";
 *   export { X } from "./config";
 *
 * CONTRACT: this file must stay dependency-free (no imports) so any module
 * can import from it without creating import cycles.
 */

// ─── Extension identity ──────────────────────────────────────────────────────

/** VS Code extension ID (used for `extensions.supportAgentsWindow.<id>`). */
export const EXTENSION_ID = "ltmoerdani.opencode-copilot-chat";
/** SecretStorage key for the OpenCode Go API key (legacy name preserved). */
export const SECRET_KEY = "opencodego.apiKey";
/** SecretStorage key for the OpenCode Zen API key (per-vendor, so Go and Zen
 * never overwrite each other's key). */
export const ZEN_SECRET_KEY = "opencodezen.apiKey";
/** Resolve the SecretStorage key for a provider vendor. */
export function secretKeyFor(vendor: "opencodego" | "opencodezen"): string {
  return vendor === "opencodezen" ? ZEN_SECRET_KEY : SECRET_KEY;
}
/** Client name sent in the `x-opencode-client` header. */
export const OPEN_CODE_CLIENT = "vscode-copilot-chat";
/** Fallback only — overridden at runtime from packageJSON.version. */
export const FALLBACK_USER_AGENT = "opencode-copilot-chat/0.6.0 VSCode";
/** Configuration section under which all extension settings live. */
export const CONFIG_SECTION = "opencodego";

// ─── Configuration setting keys ──────────────────────────────────────────────

export const SETTING_ENABLED = "enabled";
export const SETTING_FREE_ONLY = "freeOnly";
export const SETTING_AGENTS_WINDOW = "agentsWindow";
export const SETTING_AUTO_ENABLE_AGENTS_WINDOW = "autoEnableAgentsWindow";
export const SETTING_SHOW_USAGE_STATUS_BAR = "showUsageStatusBar";
export const SETTING_SHOW_PROVIDER_PREFIX = "showProviderPrefix";
export const SETTING_TEMPERATURE = "temperature";
export const SETTING_MAX_TOKENS = "maxTokens";
export const SETTING_MAX_INPUT_TOKENS = "maxInputTokens";
export const SETTING_DEBUG_REASONING = "debugReasoning";
/** Base URL setting key for the provider's OpenAI-compatible API. */
export const SETTING_API_BASE_URL = "apiBaseUrl";
export const SETTING_REQUEST_TIMEOUT_SECONDS = "requestTimeoutSeconds";
export const SETTING_STREAM_IDLE_TIMEOUT_SECONDS = "streamIdleTimeoutSeconds";
export const SETTING_STRIP_THINK_TAGS = "stripThinkTags";
export const SETTING_VISION_PROXY_WHOLE_CONVERSATION = "visionProxyWholeConversation";
export const SETTING_THINKING = "thinking";
export const SETTING_THINKING_DEEPSEEK = "thinking.deepseek";
export const SETTING_THINKING_GLM = "thinking.glm";
export const SETTING_THINKING_KIMI = "thinking.kimi";
export const SETTING_THINKING_MINIMAX = "thinking.minimax";
export const SETTING_THINKING_OPENAI = "thinking.openai";
export const SETTING_THINKING_QWEN = "thinking.qwen";
export const SETTING_THINKING_QWEN_BUDGET = "thinking.qwenBudget";
export const SETTING_THINKING_MIMO = "thinking.mimo";
export const SETTING_THINKING_MUSE = "thinking.muse";

// ─── Inline completions (issue #49) ─────────────────────────────────────────

export const INLINE_SUGGESTIONS_SETTING = "inlineSuggestions";
export const INLINE_SUGGESTIONS_MODEL_SETTING = "inlineSuggestionsModel";
/** Opt-in: also offer completions inside the Copilot Chat prompt box. */
export const SETTING_INLINE_SUGGESTIONS_CHAT_INPUT = "inlineSuggestionsChatInput";
export const DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT = false;
export const INLINE_DEBOUNCE_MS_SETTING = "inlineSuggestionsDebounceMs";
export const INLINE_TIMEOUT_MS_SETTING = "inlineSuggestionsTimeoutMs";
export const INLINE_MAX_TOKENS_SETTING = "inlineSuggestionsMaxTokens";
export const INLINE_PREFIX_LINES_SETTING = "inlineSuggestionsPrefixLines";
export const INLINE_SUFFIX_CHARS_SETTING = "inlineSuggestionsSuffixChars";
export const DEFAULT_INLINE_MODEL = "qwen3.5-plus";
export const DEFAULT_INLINE_DEBOUNCE_MS = 300;
export const DEFAULT_INLINE_TIMEOUT_MS = 3_000;
export const DEFAULT_INLINE_MAX_TOKENS = 128;
export const DEFAULT_INLINE_PREFIX_LINES = 10;
export const DEFAULT_INLINE_SUFFIX_CHARS = 300;

// ─── Request timeouts (ms) ───────────────────────────────────────────────────

export const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = DEFAULT_REQUEST_TIMEOUT_MS / 1000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_SECONDS = DEFAULT_STREAM_IDLE_TIMEOUT_MS / 1000;
/** Hard ceiling for a single model-list fetch (issue #78). */
export const MODEL_LIST_FETCH_TIMEOUT_MS = 15_000;
/** Hard timeout for the models.dev metadata refresh. */
export const MODEL_METADATA_FETCH_TIMEOUT_MS = 10_000;
/** Hard timeout for a single server-usage fetch. */
export const GO_USAGE_FETCH_TIMEOUT_MS = 10_000;
/** Timeout for the "Test Connection" probe request. */
export const TEST_CONNECTION_TIMEOUT_MS = 30_000;
/** Per-request timeout for the inline completion engine. */
export const COMPLETION_REQUEST_TIMEOUT_MS = 3_000;

// ─── Model-list fetch resilience (issue #78) ─────────────────────────────────

/** Max retry attempts for transient network failures during model-list fetch. */
export const MODEL_LIST_FETCH_MAX_RETRIES = 3;
/** Base delay for exponential backoff (500ms, 1s, 2s). */
export const MODEL_LIST_FETCH_RETRY_BASE_MS = 500;
/** TTL for the last successful model-list snapshot cached in globalState. */
export const MODEL_LIST_CACHE_TTL_MS = 60 * 60 * 1000;
/** globalState key suffix per vendor; full key = `${base}::<vendor>`. */
export const MODEL_LIST_CACHE_KEY_PREFIX = "opencode.modelListCache.v1";

// ─── Model metadata (models.dev) ─────────────────────────────────────────────

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODEL_METADATA_REVISION = "session-2026-05-21-b";
export const MODEL_METADATA_CACHE_KEY = "opencode.modelMetadataCache.v5";
export const MODEL_METADATA_CACHE_TTL_MS = 1 * 60 * 60 * 1000;
export const DEFAULT_MODEL_CONTEXT_WINDOW = 262144;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 65536;

// ─── Provider API endpoints ─────────────────────────────────────────────────

/** Default OpenCode Go API base URL; can be overridden in VS Code settings. */
export const DEFAULT_GO_API_BASE_URL = "https://opencode.ai/zen/go/v1";
/** Default OpenCode Zen API base URL; can be overridden in VS Code settings. */
export const DEFAULT_ZEN_API_BASE_URL = "https://opencode.ai/zen/v1";

/** Normalize a configured API base URL, falling back when it is malformed. */
export function normalizeApiBaseUrl(value: string, fallback: string): string {
  const candidate = value.trim();
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
      return fallback;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

/** Append one API route to a normalized or user-supplied base URL. */
export function appendApiPath(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`;
}

// ─── Output budget / token-estimate margins ──────────────────────────────────

/** Reserve for UI rendering so the advertised output never claims the full window. */
export const UI_OUTPUT_TOKEN_RESERVE = 8192;
export const MIN_TOKEN_ESTIMATE_SAFETY_MARGIN = 64;
export const TOKEN_ESTIMATE_SAFETY_RATIO = 0.12;
export const CONTEXT_RETRY_MIN_SAFETY_TOKENS = 256;
export const CONTEXT_RETRY_SAFETY_RATIO = 0.001;

// ─── Token-count overheads ───────────────────────────────────────────────────

export const MESSAGE_TOKEN_OVERHEAD = 4;
export const MESSAGE_NAME_TOKEN_OVERHEAD = 1;
export const TOOL_CALL_TOKEN_OVERHEAD = 10;
export const TOOL_RESULT_TOKEN_OVERHEAD = 6;
export const IMAGE_TOKEN_ESTIMATE = 1024;

// ─── Image payload limits ────────────────────────────────────────────────────

/** Max raw bytes for a single image embedded in a tool result (issue #38). */
export const MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000;
/** Max images kept in conversation history before older ones are placeholder-replaced. */
export const MAX_HISTORY_IMAGES_KEPT = 2;
/**
 * Tokens reserved below the model's input context window when trimming old
 * conversation history. Keeps the trimmed payload safely under the limit so the
 * upstream never rejects an oversized request (HTTP 400 / empty "No response").
 */
export const HISTORY_TRIM_SAFETY_MARGIN_TOKENS = 2048;
/**
 * Fraction of the model's input context window the trimmed history is allowed
 * to occupy. The upstream rejects (HTTP 400/503) or returns an empty stream
 * once the request approaches the full window, so we stay safely below it.
 * The reporter observed failures starting at ~70% context, so this is the
 * ceiling; {@link MAX_REQUEST_PAYLOAD_BYTES} is the hard byte backstop.
 */
export const HISTORY_TRIM_TARGET_RATIO = 0.7;
/**
 * Hard ceiling on the serialized request payload (bytes). Even after token
 * trimming, a single oversized turn or an inaccurate token estimate can still
 * produce a payload the gateway rejects — the reporter hit a 503 at ~783 KB —
 * so we drop the oldest messages until the wire payload is under this size.
 * This is the reliable guarantee: it bounds the actual bytes sent upstream
 * regardless of how the token heuristic estimates the history.
 */
export const MAX_REQUEST_PAYLOAD_BYTES = 512 * 1024;
/** Bytes per token used to scale the history byte cap with the context window. */
export const HISTORY_BYTES_PER_TOKEN = 4.5;
/** Hard ceiling (base64 chars) for a normalized image attachment. */
export const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;
/** Dimension cap for normalized images. */
export const MAX_IMAGE_WIDTH = 2_000;
export const MAX_IMAGE_HEIGHT = 2_000;

// ─── Go usage tracking ───────────────────────────────────────────────────────

/** OpenCode Go subscription limits in USD (https://opencode.ai/docs/go). */
export const GO_LIMITS = {
  session: 12, // $12 per rolling 5-hour window
  weekly: 30, // $30 per week (Mon–Mon UTC)
  monthly: 60, // $60 per month (anchor-based)
} as const;
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const GO_USAGE_API_URL = "https://opencode.ai/zen/go/v1/usage";
/** How long a successful server-usage snapshot is reused before refetching. */
export const GO_USAGE_SYNC_TTL_MS = 60_000;
export const GO_USAGE_LOG_KEY = "opencodego.usageLog.v1";
/** Persisted copy of the last successful server-usage snapshot (startup fast-path). */
export const GO_SERVER_USAGE_KEY = "opencodego.serverUsage.v1";
export const GO_USAGE_BASELINE_KEY = "opencodego.usageBaseline.v1";
export const GO_EVER_TRACKED_KEY = "opencodego.everTracked.v1";
export const GO_SESSION_COSTS_KEY = "opencodego.sessionCosts.v1";
export const GO_MAX_LOG_ENTRIES = 2000;
export const GO_SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const GO_MAX_SESSIONS = 50;

// ─── Usage display options ────────────────────────────────────────────────────

/**
 * Source of the Today/Yesterday device-local rows:
 * - "auto"      — merge the OpenCode CLI history (cost + tokens + requests)
 *                 with the extension's own tracked requests (best accuracy).
 * - "cli"       — OpenCode CLI history only (extension-tracked requests omitted).
 * - "extension" — the extension's tracked requests only (CLI history ignored).
 */
export type UsageTodayYesterdaySource = "auto" | "cli" | "extension";
export const SETTING_USAGE_TODAY_YESTERDAY_SOURCE = "usageTodayYesterdaySource";
export const DEFAULT_USAGE_TODAY_YESTERDAY_SOURCE: UsageTodayYesterdaySource = "auto";
/** Show the all-time usage row for the current workspace (from OpenCode CLI history). */
export const SETTING_USAGE_CODEBASE_ROW = "usageCodebaseRow";
export const DEFAULT_USAGE_CODEBASE_ROW = true;
/** Codebase window in days; 0 = forever (all history). */
export const SETTING_USAGE_CODEBASE_WINDOW_DAYS = "usageCodebaseWindowDays";
export const DEFAULT_USAGE_CODEBASE_WINDOW_DAYS = 0;
/** Show the server-accurate 5-hour rolling session meter in detailed views. */
export const SETTING_USAGE_ROLLING_SESSION_METER = "usageRollingSessionMeter";
export const DEFAULT_USAGE_ROLLING_SESSION_METER = true;
/** Day boundary used for the Today/Yesterday rows. */
export const SETTING_USAGE_DAY_BOUNDARY = "usageDayBoundary";
export const DEFAULT_USAGE_DAY_BOUNDARY = "utc";
/** How often the usage status bar / panel refresh in the background (seconds). */
export const SETTING_USAGE_REFRESH_INTERVAL_SECONDS = "usageRefreshIntervalSeconds";
export const DEFAULT_USAGE_REFRESH_INTERVAL_SECONDS = 60;
/** How many days the usage panel charts cover (0 = lifetime). */
export const SETTING_USAGE_CHART_DAYS = "usageChartDays";
export const DEFAULT_USAGE_CHART_DAYS = 0;
/** globalState key for the per-day chat-completion usage counters. */
export const COMPLETION_USAGE_KEY = "opencodego.completionUsage.v1";
/** How many days of completion history are retained. */
export const COMPLETION_USAGE_MAX_DAYS = 370;

// ─── Usage profiles (issue #63) ──────────────────────────────────────────────

export const PROFILES_REGISTRY_KEY = "opencodego.profiles.v1";
export const ACTIVE_PROFILE_KEY = "opencodego.activeProfile.v1";
/** Set once the user explicitly picks a profile — auto-resolution must not override it. */
export const ACTIVE_PROFILE_EXPLICIT_KEY = "opencodego.activeProfileExplicit.v1";
export const MIGRATED_KEY = "opencodego.migratedTo.v1";
export const LEGACY_SECRET_KEY = SECRET_KEY;
export const LEGACY_FINGERPRINT = "legacy";

// ─── Diagnostics / caches ────────────────────────────────────────────────────

/** How long the context-window hook waits after creating the probe participant. */
export const CONTEXT_HOOK_PROBE_DELAY_MS = 150;

export const RECENT_TRANSPORT_SUMMARY_LIMIT = 25;
export const RECENT_TRANSPORT_SUMMARY_STORAGE_PREFIX = "opencode.recentTransportSummaries";
/** Cap on the per-tool-call reasoning content cache. */
export const REASONING_CACHE_LIMIT = 500;
/** Cap on the vision-proxy image description cache. */
export const IMAGE_DESCRIPTION_CACHE_LIMIT = 200;

// ─── Agents window support (issue #122) ──────────────────────────────────────

export const AGENT_HOST_BYOK_ENABLED_SETTING = "byokModels.enabled";
export const SUPPORT_AGENTS_WINDOW_SETTING = "supportAgentsWindow";
/** How many VS Code minor versions old the agent-host BYOK bridge goes back to. */
export const AGENT_HOST_BYOK_MINOR_VERSION = 129;
export const AGENTS_BYOK_BRIDGE_STATE_KEY = "opencode.agentsByokBridge.v1";
export const SUPPORT_AGENTS_WINDOW_STATE_KEY = "opencode.supportAgentsWindow.v1";

// ─── Vision proxy (issue #74) ────────────────────────────────────────────────

export const VISION_PROXY_MODEL_ID_KEY = "opencodego.visionProxyModelId";
export const VISION_PROXY_PROMPT_KEY = "opencodego.visionProxyPrompt";
export const DEFAULT_VISION_PROXY_PROMPT =
  "Describe this image in detail so a text-only model can understand what it shows. " +
  "Include all visible text, layout, colors, objects, and context.";

// ─── Transient 5xx retry (retry.ts) ──────────────────────────────────────────

export const TRANSIENT_5XX_MAX_RETRIES = 2;
export const TRANSIENT_5XX_RETRY_BASE_MS = 1000;
export const TRANSIENT_5XX_RETRY_JITTER_MS = 250;

// ─── Transient network (fetch) retry for chat requests (engine.ts) ───────────
// Mirrors the model-list fetch resilience (issue #78): a `fetch()` that *throws*
// (undici `TypeError: fetch failed` — ECONNRESET / EAI_AGAIN / UND_ERR_CONNECT_TIMEOUT
// under concurrent load, nodejs/undici#5450) is retried with exponential backoff
// so a transient socket race doesn't surface as a hard "Sorry, your request failed".

export const TRANSIENT_FETCH_MAX_RETRIES = 3;
export const TRANSIENT_FETCH_RETRY_BASE_MS = 500;
export const TRANSIENT_FETCH_RETRY_JITTER_MS = 250;

// ─── Model classification ────────────────────────────────────────────────────

/** Zen free-model IDs that do not end in `-free`. */
export const FREE_ZEN_MODEL_IDS = new Set(["big-pickle"]);
/**
 * Models removed upstream — always filtered from the picker.
 * `deepseek-v4-flash-free` / `laguna-s-2.1-free`: gone from the Zen gateway
 * ("Upstream request failed: Model is unavailable", issue #204 / PR #205).
 */
export const KNOWN_UNAVAILABLE_MODEL_IDS = new Set([
  "ring-2.6-1t",
  "ring-2.6-1t-free",
  "trinity-large-preview-free",
  "deepseek-v4-flash-free",
  "laguna-s-2.1-free",
]);

/**
 * Models that live on the OpenCode Zen gateway but with constrained GPU
 * capacity. They were re-enabled after a brief shutdown ("Qwen 3.6 Plus —
 * free, again. Round 2. We found more GPUs.") so they are NOT deprecated, but
 * agentic workloads can still hit 5xx during bursts. Surfaced so users know
 * to retry or fall back to another free model.
 */
export const CAPACITY_LIMITED_MODEL_NOTES: Record<string, string> = {
  "qwen3.6-plus-free":
    "Free relaunch with limited GPU capacity. Stable for short prompts; bursty traffic or very large tool catalogs may return 5xx - retry or fall back to 'deepseek-v4-flash-free' / 'big-pickle'. Paid 'qwen3.6-plus' has no quota.",
};

// ─── Per-family thinking defaults (see thinking.ts for the schema) ───────────

export const THINKING_DEFAULTS = {
  deepseek: "off",
  glm: "off",
  kimi: "off",
  minimax: "off",
  openai: "off",
  qwen: "off",
  qwenBudget: "auto",
  mimo: "off",
  muse: "off",
} as const;
