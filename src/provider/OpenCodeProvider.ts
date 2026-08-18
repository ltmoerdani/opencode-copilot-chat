import * as vscode from "vscode";
import { OpenCodeRequestError } from "../errors";
import {
  hasExplicitModelLimits,
  isFreeModel,
  normalizeLiveModelMetadata,
  resolveModelMetadata,
  toEffectiveModelId,
  type CachedModelMetadataSnapshot,
  type ModelMetadataFields,
  type ResolvedModelMetadata,
} from "../models/metadata";
import { resolveModelRouting } from "../core/routing";
import { lookupModelRegistryEntry } from "../core/registry";
import { extractThinkingOverride, resolveThinkingConfig, thinkingFamily, thinkingProviderFor } from "../thinking";
import { buildOpenCodeGatewayAuthHeaders } from "../openCodeAuth";
import { streamAnthropicMessages as runStreamAnthropicMessages } from "../transports/anthropic";
import { streamChatCompletions as runStreamChatCompletions } from "../transports/chatCompletions";
import { streamGoogleGenerateContent as runStreamGoogleGenerateContent } from "../transports/google";
import { streamResponsesApi as runStreamResponsesApi } from "../transports/responses";
import type { TransportRequestSummary } from "../core/transport";
import { GO_VENDOR, ZEN_VENDOR, resolveBaseVendor, type ProviderVendor } from "../providerTypes";
import { providerEnabledSetting } from "../providerEnablement";
import { configureUtilityModels, toggleProviderEnabled } from "../commands/providers";
import { providerModelDisplayName } from "../models/modelNames";
import {
  ConfiguredLanguageModelInfoOptions,
  ConfiguredLanguageModelResponseOptions,
  ModelListEntry,
  ModelListResponse,
  OpenCodeModel,
  ProviderDefinition,
  getUserAgent,
  isTransientFetchError,
} from "./definitions";
import {
  buildAnthropicMessagesRequestBody,
  buildChatCompletionsRequestBody,
  buildGoogleGenerateContentBody,
  buildResponsesRequestBody,
  messagesHaveImages,
} from "../request/builders";
import type { ApiMessage, ApiSettings, OpenAiContentPart } from "../request/types";
import { runtimeDiagnosticsLines } from "../runtimeDiagnostics";
import { estimatePromptTokenCount, estimateTokenCount } from "../tokenEstimate";
import {
  CAPACITY_LIMITED_MODEL_NOTES,
  CONFIG_SECTION,
  DEFAULT_VISION_PROXY_PROMPT,
  KNOWN_UNAVAILABLE_MODEL_IDS,
  MODEL_LIST_CACHE_KEY_PREFIX,
  MODEL_LIST_CACHE_TTL_MS,
  MODEL_LIST_FETCH_MAX_RETRIES,
  MODEL_LIST_FETCH_RETRY_BASE_MS,
  MODEL_LIST_FETCH_TIMEOUT_MS,
  MODEL_METADATA_REVISION,
  MAX_HISTORY_IMAGES_KEPT,
  DEFAULT_GO_API_BASE_URL,
  DEFAULT_ZEN_API_BASE_URL,
  SETTING_API_BASE_URL,
  appendApiPath,
  normalizeApiBaseUrl,
  RECENT_TRANSPORT_SUMMARY_LIMIT,
  RECENT_TRANSPORT_SUMMARY_STORAGE_PREFIX,
  SETTING_SHOW_PROVIDER_PREFIX,
  SETTING_VISION_PROXY_WHOLE_CONVERSATION,
  TEST_CONNECTION_TIMEOUT_MS,
  VISION_PROXY_MODEL_ID_KEY,
  VISION_PROXY_PROMPT_KEY,
  secretKeyFor,
} from "../config";
import {
  activeProfileFingerprint,
  ensureProfileForApiKey,
  ensureProfileSync,
  refreshGoUsageStatusBar,
  syncTrackerUsage,
  updateUsageStatusBar,
} from "../usage/dashboard";
import { formatCacheHitRatio } from "../usage/usage";
import { estimateCost } from "../usage/pricing";
import { resolveResponseApiKey } from "../apiKeyResolution";
import { clearOpenCodeModelMetadataCache, getOpenCodeModelMetadata } from "../models/metadataFetcher";
import { convertMessage, normalizeMessages, trimOldImagesFromHistoryInPlace } from "./messages";
import { estimateChatMessageTokenCount } from "./tokens";
import {
  formatModalityBadges,
  getConfiguredApiKey,
  getRequestModelConfiguration,
  getSettings,
  isVisionProxyEnabled,
  modelCapabilities,
  modelConfigurationSchema,
  modelLimits,
  resolveRawModelId,
  shouldHideDeprecatedModel,
} from "./settings";
import { proxyVision } from "./visionProxy";
import { modelPricingFields } from "../models/pricing";
import { buildOpenCodeRequestHeaders, stringifyInitiator } from "../request/headers";
import { getErrorMessage, sleep } from "../utils";

interface RecentTransportSummary extends TransportRequestSummary {
  recordedAt: string;
  endpointKind: string;
  metadataSource: string;
  requestInitiator?: string;
}

export class OpenCodeProvider implements vscode.LanguageModelChatProvider<OpenCodeModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  /** Trigger a model information refresh (e.g. after visionModel setting changes). */
  notifyModelInfoChanged(): void {
    this.changeEmitter.fire();
  }
  private readonly apiKeysByModelId = new Map<string, string>();

  private get apiBaseUrl(): string {
    const fallback = this.baseVendor === GO_VENDOR ? DEFAULT_GO_API_BASE_URL : DEFAULT_ZEN_API_BASE_URL;
    const configured = vscode.workspace.getConfiguration(this.baseVendor).get<string>(SETTING_API_BASE_URL, fallback);
    return normalizeApiBaseUrl(configured, fallback);
  }

  private get endpointDefinition(): ProviderDefinition {
    const baseUrl = this.apiBaseUrl;
    return {
      ...this.definition,
      modelsUrl: appendApiPath(baseUrl, "models"),
      chatCompletionsUrl: appendApiPath(baseUrl, "chat/completions"),
      messagesUrl: appendApiPath(baseUrl, "messages"),
      ...(this.definition.responsesUrl ? { responsesUrl: appendApiPath(baseUrl, "responses") } : {}),
    };
  }

  /**
   * globalState key tracking whether this vendor has a configured BYOK group
   * (issue #106). Set when a configured-group call is served; read by the
   * groupless call to decide whether to stay silent. Scoped per vendor so an
   * `opencodego` group does not affect `opencodezen`.
   */
  private get byokGroupStateKey(): string {
    return `opencode.byokGroup.v1.${this.definition.vendor}`;
  }

  private hasByokGroupConfigured(): boolean {
    return this.context.globalState.get<boolean>(this.byokGroupStateKey, false);
  }

  private async markByokGroupConfigured(): Promise<void> {
    await this.context.globalState.update(this.byokGroupStateKey, true);
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
    // requestInitiator is an arbitrary value from the transport layer. Only
    // stringify it when it is a primitive; objects are JSON-serialized and
    // nullish values are dropped so diagnostics never show "[object Object]".
    const initiator = stringifyInitiator(requestInitiator);

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
          `### ${String(index + 1)}. ${summary.modelId}`,
          "",
          `- time: ${summary.recordedAt}`,
          `- endpoint: ${summary.endpointKind}`,
          `- initiator: ${summary.requestInitiator ?? "unknown"}`,
          `- metadataSource: ${summary.metadataSource}`,
          `- status: ${String(status)}`,
          `- durationMs: ${String(summary.durationMs)}`,
          `- ttfbMs: ${String(summary.ttfbMs ?? "n/a")}`,
          `- totalBytes: ${String(summary.totalBytes)}`,
          `- totalEvents: ${String(summary.totalEvents)}`,
          `- tokens: prompt=${String(summary.promptTokens ?? "n/a")}, completion=${String(summary.completionTokens ?? "n/a")}, total=${String(summary.totalTokens ?? "n/a")}, cached=${String(summary.cachedTokens ?? "n/a")}`,
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
    const apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    await this.fetchModels(apiKey);
  }

  /**
   * Public entry point for the `OpenCode <Vendor>: Refresh Models` commands.
   *
   * CONTRACT:
   * - Skips the Manage Provider QuickPick and goes straight to a fetch.
   * - Reuses {@link refreshMetadataAndModels}, fires the change emitter so
   *   VS Code re-resolves the picker, and surfaces an informational toast.
   * - On missing API key, points the user at the BYOK flow instead of
   *   prompting for a key (API keys are configured via Manage Language
   *   Models / "+ Add Models" only).
   *
   * Background: this was added after issue #78 revealed that "Refresh Models"
   * was only reachable as a sub-item inside `OpenCode Go: Manage Provider`
   * (and Zen had no manual refresh path at all). The top-level command matches
   * what users naturally type in the Command Palette.
   */
  async refreshModels(): Promise<void> {
    const apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    if (!apiKey) {
      vscode.window.showErrorMessage(
        `${this.definition.displayName}: No API key configured. Add the provider via Manage Language Models ("+ Add Models" → ${this.definition.displayName}) first.`,
      );
      return;
    }
    await this.refreshMetadataAndModels();
    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`${this.definition.displayName} models refreshed.`);
  }

  async setApiKey(): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
      title: `${this.definition.displayName} API Key`,
      prompt: `Paste your ${this.definition.displayName} API key. It will be stored securely in VS Code SecretStorage.`,
      password: true,
      ignoreFocusOut: true,
    });
    const normalizedApiKey = apiKey?.trim();
    if (!normalizedApiKey) {
      return;
    }

    await this.context.secrets.store(secretKeyFor(this.baseVendor), normalizedApiKey);

    // Register a profile for the new key so multi-account usage tracking
    // picks it up immediately, instead of waiting for the first request to
    // be recorded. Mirrors the guard in provideLanguageModelChatInformation.
    if (this.baseVendor === GO_VENDOR) {
      ensureProfileSync(normalizedApiKey);
    }

    await this.refreshMetadataAndModels();
    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`${this.definition.displayName} API key saved.`);
  }

  async manage(): Promise<void> {
    // Read via the base-vendor full key so agent variants (opencodego-agent,
    // opencodezen-agent) follow the same switch as the vendor they mirror.
    const providerEnabled = vscode.workspace.getConfiguration().get<boolean>(providerEnabledSetting(this.definition.vendor), true);
    const choice = await vscode.window.showQuickPick(
      [
        { label: "Test Connection", action: "test" as const },
        { label: "Refresh Models", action: "refresh" as const },
        { label: "Configure Utility Models", action: "utility" as const },
        { label: "Open Diagnostics", action: "diagnostics" as const },
        ...(providerEnabled
          ? [{ label: "Remove from Language Models", action: "remove" as const }]
          : [{ label: "Re-add to Language Models", action: "remove" as const }]),
      ],
      {
        title: `Manage ${this.definition.displayName}`,
        placeHolder: "Choose an action",
      },
    );

    if (!choice) {
      return;
    }

    if (choice.action === "remove") {
      await toggleProviderEnabled(this.definition.vendor, this.definition.displayName);
      return;
    }

    if (choice.action === "test") {
      await this.testConnection();
      return;
    }

    if (choice.action === "utility") {
      await configureUtilityModels();
      return;
    }

    if (choice.action === "diagnostics") {
      await this.showDiagnostics();
      return;
    }

    await this.refreshModels();
  }

  async testConnection(): Promise<void> {
    const apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    if (!apiKey) {
      vscode.window.showErrorMessage(
        `${this.definition.displayName}: No API key configured. Add the provider via Manage Language Models ("+ Add Models" → ${this.definition.displayName}) first.`,
      );
      return;
    }

    const statusBar = vscode.window.setStatusBarMessage(`$(loading~spin) Testing ${this.definition.displayName} connection...`);
    const definition = this.endpointDefinition;
    this.log(`Testing connection to ${definition.chatCompletionsUrl}`);

    try {
      const response = await fetch(definition.chatCompletionsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: definition.testModelId,
          messages: [{ role: "user", content: "reply with just: ok" }],
          max_tokens: 10,
          stream: false,
        }),
        signal: AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
      });

      const responseText = await response.text();
      this.log(`Test response (${String(response.status)}): ${responseText}`);

      if (response.ok) {
        vscode.window.showInformationMessage(
          `${this.definition.displayName}: Connection OK (HTTP ${String(response.status)}). Check Output panel for details.`,
        );
      } else {
        vscode.window.showErrorMessage(
          `${this.definition.displayName}: Connection failed (HTTP ${String(response.status)}). Check Output panel for details.`,
        );
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.log(`Test connection error: ${message}`);
      vscode.window.showErrorMessage(`${this.definition.displayName}: Connection error - ${message}`);
    } finally {
      statusBar.dispose();
    }
  }

  async showDiagnostics(): Promise<void> {
    let models: readonly vscode.LanguageModelChat[] = [];
    let modelSelectionError: string | undefined;
    try {
      models = await vscode.lm.selectChatModels({ vendor: this.definition.vendor });
    } catch (error) {
      modelSelectionError = getErrorMessage(error);
    }

    const hasStoredApiKey = Boolean(await this.context.secrets.get(secretKeyFor(this.baseVendor)));
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
        `  maxInputTokens: ${String(model.maxInputTokens)}`,
        `  advertisedMaxOutputTokens: ${String(limits.advertisedMaxOutputTokens)}`,
        `  advertisedContextWindow: ${String(limits.advertisedContextWindow)}`,
        `  apiMaxOutputTokens: ${String(limits.maxOutputTokens)}`,
        `  metadataSource: ${metadata.source}`,
        `  supportsVision: ${String(metadata.supportsVision)}`,
        `  status: ${metadata.status ?? "active"}`,
        `  thinkingFamily: ${thinkingFamily(rawModelId) ?? "none"}`,
        `  configurationSchema: ${JSON.stringify((model as unknown as { configurationSchema?: unknown }).configurationSchema ?? null)}`,
        ...(hasExplicitModelLimits(rawModelId, this.baseVendor) ? [] : ["  limits: using bundled fallback"]),
      ].join("\n");
    });

    const content = [
      `# ${this.definition.displayName} Diagnostics`,
      "",
      "## Runtime",
      "",
      ...runtimeDiagnosticsLines(this.context),
      `- credentialInSecretStorage: ${String(hasStoredApiKey)}`,
      `- modelSelectionError: ${modelSelectionError ?? "none"}`,
      "",
      "## Recent Requests",
      "",
      ...this.recentTransportDiagnosticsLines(),
      `## Models`,
      "",
      `Models visible through vscode.lm.selectChatModels({ vendor: "${this.definition.vendor}" }): ${String(models.length)}`,
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
    } else if (opts.configuration !== undefined) {
      // A group call with a non-undefined configuration that carries no API
      // key is a per-model configuration group (only `settings`, no key —
      // e.g. a `reasoningEffort` picked in the model picker). VS Code
      // resolves its configuration to `{}` here. The groupless call already
      // served the models via SecretStorage, so serving them again would
      // duplicate every model (issue #131). The per-model settings still
      // apply at request time via `modelConfiguration`.
      return [];
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
      if (this.hasByokGroupConfigured()) {
        return [];
      }
      apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    }

    if (!apiKey) {
      return [];
    }

    // When a non-agent provider resolves its API key, persist it so that
    // agent-variant providers (which have no BYOK entry) can inherit it
    // from the extension's secret storage.
    if (!this.definition.isAgentVariant) {
      const existing = await this.context.secrets.get(secretKeyFor(this.baseVendor));
      if (existing !== apiKey) {
        await this.context.secrets.store(secretKeyFor(this.baseVendor), apiKey);
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
    const showProviderPrefix = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_SHOW_PROVIDER_PREFIX, true);

    // CONTRACT: VS Code calls provideLanguageModelChatInformation frequently
    // (every ~300ms during UI refresh). Per-model logging produces thousands
    // of log lines per minute and obscures real signal. We accumulate a
    // single summary line per invocation instead of one line per model.
    let registeredCount = 0;
    let firstModelId = "";
    let lastModelId = "";

    const results = models.flatMap((modelId) => {
      const metadata = this.resolveModelMetadata(modelId, metadataSnapshot);
      const routing = resolveModelRouting(modelId, this.endpointDefinition);
      const effectiveModelId = toEffectiveModelId(modelId, this.definition.vendor);
      // Stable model ID — deliberately NO key fingerprint. VS Code's per-model
      // configuration (chatLanguageModels.json) is keyed by this ID; keeping it
      // stable is what makes per-model thinking settings survive restarts and
      // key-source changes (the old `::<fp>` suffix made them go stale and
      // reset — see issue #131). Multi-key resolution relies on the BYOK
      // group's configuration.apiKey; apiKeysByModelId is only a fallback for
      // the SecretStorage path.
      const agentHostModelId = `${effectiveModelId}::agent-host`;
      const limits = modelLimits(metadata, settings);
      this.apiKeysByModelId.set(modelId, apiKey);
      this.apiKeysByModelId.set(effectiveModelId, apiKey);
      this.apiKeysByModelId.set(agentHostModelId, apiKey);

      const capacityNote = CAPACITY_LIMITED_MODEL_NOTES[modelId];
      const modalityBadges = formatModalityBadges(metadata);
      const baseDetail = this.baseVendor === ZEN_VENDOR && isFreeModel(modelId) ? "Free" : this.definition.displayName;
      const baseTooltip = `${this.definition.displayName} model: ${modelId}`;
      const configurationSchema = modelConfigurationSchema(modelId, metadata);

      const sharedFields: Omit<OpenCodeModel, "id" | "targetChatSessionType"> = {
        rawModelId: modelId,
        name: providerModelDisplayName(this.definition.modelNamePrefix, modelId, showProviderPrefix),
        // A stable real family name (e.g. "deepseek", "gpt") so VS Code's
        // family-based model selection/grouping works — a per-model unique
        // string previously broke `modelFamily` routing and sticky grouping.
        family: lookupModelRegistryEntry(modelId).family,
        // Include effective limits in version so VS Code invalidates stale
        // picker metadata after limit changes (eg. 2M -> 262K corrections).
        version: `1.2.0-${MODEL_METADATA_REVISION}-${String(limits.contextWindow)}-${String(limits.maxOutputTokens)}`,
        detail: capacityNote ? `${baseDetail} • Limited capacity` : modalityBadges ? `${baseDetail} • ${modalityBadges}` : baseDetail,
        tooltip: capacityNote ? `${baseTooltip}\n\n${capacityNote}` : modalityBadges ? `${baseTooltip}\n\n${modalityBadges}` : baseTooltip,
        isUserSelectable: true,
        isBYOK: true,
        maxInputTokens: limits.advertisedMaxInputTokens,
        maxOutputTokens: limits.advertisedMaxOutputTokens,
        capabilities: modelCapabilities(metadata),
        endpointKind: routing.endpointKind,
        provider: this.definition,
        ...(capacityNote ? { warningText: { capacity: capacityNote } } : {}),
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
      const info: OpenCodeModel = { ...sharedFields, id: effectiveModelId };

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
        `Models registered: count=${String(registeredCount)} provider=${this.definition.vendor}` +
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
    // VS Code can invoke a cached selected model immediately after the
    // extension host restarts, before model discovery repopulates the in-memory
    // ID map. Keep SecretStorage as the cold-start fallback for that request.
    const apiKey = resolveResponseApiKey(
      getConfiguredApiKey(options as ConfiguredLanguageModelResponseOptions),
      this.apiKeysByModelId.get(model.id),
      await this.context.secrets.get(secretKeyFor(this.baseVendor)),
    );

    if (!apiKey) {
      throw new Error(
        `${this.definition.displayName} API key is required. Use the ${this.definition.displayName} gear icon in Language Models to configure it, then reload the window.`,
      );
    }

    const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
    const convertedMessages = await Promise.all(
      messages.map((message) => convertMessage(message, this.reasoningContentByToolCallId, rawModelId)),
    );
    const normalizedImageCount = convertedMessages.map((result) => result.normalizedImageCount).reduce((total, count) => total + count, 0);
    if (normalizedImageCount > 0) {
      this.log(`[vision] Normalized ${String(normalizedImageCount)} image attachment(s) to provider-safe dimensions/encoding.`);
    }

    // Flatten the converted messages, tracking which original message produced
    // each apiMessage. The vision proxy returns per-message descriptions keyed
    // by the original message index, so this mapping lets us apply the correct
    // description to the right apiMessage (convertMessage can emit several
    // messages per input — e.g. tool results — which shifts indices).
    const flatMessages: ApiMessage[] = [];
    const flatSourceIndex: number[] = [];
    for (let i = 0; i < convertedMessages.length; i++) {
      for (const msg of convertedMessages[i].messages) {
        flatMessages.push(msg);
        flatSourceIndex.push(i);
      }
    }

    const baseSettings = getSettings();
    const requestOverride = getRequestModelConfiguration(options);
    // Resolve the effective thinking config: VS Code's per-model configuration
    // (options.modelConfiguration, chatLanguageModels.json) is the SINGLE
    // authority for per-model thinking; the workspace setting is the default;
    // THINKING_DEFAULTS is the final fallback. No extension-side persisted
    // shadow state (removed — it fought the VS Code authority and could pin a
    // stale non-off value over the user's Off).
    const resolvedThinking = resolveThinkingConfig({
      modelId: rawModelId,
      workspace: baseSettings.thinking,
      modelConfiguration: requestOverride,
    });
    const settings: ApiSettings = {
      ...baseSettings,
      thinking: resolvedThinking.settings,
    };
    // Extract the context-size tier selected by the user (if any)
    const contextSizeOverride = typeof requestOverride?.contextSize === "number" ? requestOverride.contextSize : undefined;
    const metadataSnapshot = await this.getMetadataSnapshot();
    const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
    const routing = resolveModelRouting(rawModelId, this.endpointDefinition);

    // `hasImageInput` is computed from the flattened (pre-normalize) messages:
    // normalization never creates or drops image parts, so this matches the
    // previous `messagesHaveImages(apiMessages)` result.
    const hasImageInput = messagesHaveImages(flatMessages);
    const actuallySupportsVision = metadata.supportsVision; // cached before capabilities override

    // Vision proxy: when a text-only model receives images, relay them
    // through a configured vision-capable Copilot model, then replace
    // the image parts with the text description. Descriptions are cached
    // per image (`imageDescriptionCache`), so already-described images are
    // reused on future turns without calling the vision model again.
    const visionProxyModelId = isVisionProxyEnabled() ? this.context.globalState.get<string>(VISION_PROXY_MODEL_ID_KEY, "") || "" : "";
    if (hasImageInput && !actuallySupportsVision && visionProxyModelId) {
      const visionProxyPrompt = this.context.globalState.get<string>(VISION_PROXY_PROMPT_KEY, "") || DEFAULT_VISION_PROXY_PROMPT;
      // When `opencodego.visionProxyWholeConversation` is on, describe the whole
      // conversation instead of only the message with a new image, so descriptions
      // keep conversation context (at the cost of more tokens).
      const describeWholeConversation = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>(SETTING_VISION_PROXY_WHOLE_CONVERSATION, false);
      let imagesHandled = false;
      try {
        this.log(`[vision-proxy] Forwarding images to ${visionProxyModelId}${describeWholeConversation ? " (whole conversation)" : ""}`);
        const { descriptions, cacheHits, cacheMisses } = await proxyVision(
          messages,
          visionProxyModelId,
          visionProxyPrompt,
          describeWholeConversation,
          token,
        );
        if (descriptions.size > 0) {
          const fallbackDescription = descriptions.values().next().value ?? "";
          for (let i = 0; i < flatMessages.length; i++) {
            const msg = flatMessages[i];
            if (!Array.isArray(msg.content)) continue;
            if (!msg.content.some((p) => p.type === "image_url")) continue;
            const textParts = msg.content
              .filter((p): p is OpenAiContentPart & { text: string } => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text);
            // Tool-result images are not described by the proxy, so they fall
            // back to the first available description (matching the previous
            // single-description behavior).
            const description = descriptions.get(flatSourceIndex[i]) ?? fallbackDescription;
            msg.content = [{ type: "text", text: `[Image described by vision proxy]: ${description}` }];
            if (textParts.length > 0) {
              msg.content.push({ type: "text", text: textParts.join("\n") });
            }
            imagesHandled = true;
          }
          this.log(
            `[vision-proxy] Replaced images using vision proxy model (${String(cacheHits)} from cache, ${String(cacheMisses)} newly described)`,
          );
        }
      } catch (err) {
        this.log(`[vision-proxy] Error: ${getErrorMessage(err)}`);
      }

      // If the proxy didn't handle the images (error, empty response, or
      // model not found), strip them anyway so the non-vision model
      // doesn't receive image data it can't process (fixes 400 errors).
      if (!imagesHandled) {
        for (const msg of flatMessages) {
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

    const apiMessages = normalizeMessages(flatMessages);

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
        `[history-trim] Replaced ${String(trimmedCount)} old image(s) with placeholder text to bound payload (kept most recent ${String(MAX_HISTORY_IMAGES_KEPT)}).`,
      );
    }

    // Estimate after vision proxying and history trimming so the output budget
    // reflects the payload that is actually sent upstream.
    const promptTokens = estimatePromptTokenCount(apiMessages, options.tools);
    const limits = modelLimits(metadata, settings, contextSizeOverride, promptTokens);

    const thinkingPayload = thinkingProviderFor(rawModelId).buildPayload(settings.thinking, {
      hasImageInput: hasImageInput && metadata.supportsVision,
      endpoint: routing.endpointKind === "messages" ? "messages" : routing.endpointKind === "responses" ? "responses" : "chat",
    });
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
        const tracker = ensureProfileForApiKey(apiKey);
        this.log(
          `[go-usage] Recording profile=${activeProfileFingerprint}: model=${summary.modelId} promptTokens=${prompt} completionTokens=${completion} cachedTokens=${cached}`,
        );
        tracker.record(summary, metadata.cost);
        refreshGoUsageStatusBar();
        this.log(`[go-usage] After record profile=${activeProfileFingerprint}: entries=${tracker.getSummary().today.requests}`);
        // Re-sync the server-accurate account meters (TTL-guarded, uses the
        // exact key this request ran under — covers BYOK group keys too).
        void syncTrackerUsage(tracker, apiKey);
      }
    };

    this.log(
      `Request: initiator=${options.requestInitiator} model=${model.id} rawModel=${rawModelId} endpoint=${routing.endpointKind} metadataSource=${metadata.source} messages=${String(apiMessages.length)} promptEstimate=${String(promptTokens)} maxOutputTokens=${String(limits.maxOutputTokens)} session=${requestHeaders["x-opencode-session"]} request=${requestHeaders["x-opencode-request"]} modelConfiguration=${JSON.stringify(extractThinkingOverride(requestOverride))} thinkingSource=${resolvedThinking.source} thinking=${JSON.stringify(settings.thinking)} thinkingPayload=${JSON.stringify(thinkingPayload)}`,
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
        this.log(`Request completed: model=${model.id}`);
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
        treatReasoningAsContent: thinkingProviderFor(rawModelId).treatReasoningAsContent(routing.endpointUrl, settings.thinking),
        onReasoningContent: (toolCallIds, reasoningContent) => {
          this.storeReasoningContent(toolCallIds, reasoningContent);
        },
      });
      this.log(`Request completed: model=${model.id}`);
    } catch (error) {
      const message = getErrorMessage(error);
      this.log(`ERROR model=${model.id}: ${message}`);
      if (error instanceof OpenCodeRequestError) {
        vscode.window.showErrorMessage(error.userMessage);
      }
      throw error;
    }
  }

  provideTokenCount(
    _model: OpenCodeModel,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return Promise.resolve(typeof text === "string" ? estimateTokenCount(text) : estimateChatMessageTokenCount(text));
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
      let cancellationLink: { signal: AbortSignal; dispose: () => void } | undefined;
      try {
        // Compose the per-request abort with the caller's cancellation token
        // so either one tears down the in-flight fetch.
        const timeoutSignal = AbortSignal.timeout(MODEL_LIST_FETCH_TIMEOUT_MS);
        cancellationLink = token ? this.signalFromToken(token) : undefined;
        const signal = token && cancellationLink ? AbortSignal.any([timeoutSignal, cancellationLink.signal]) : timeoutSignal;

        const response = await fetch(this.endpointDefinition.modelsUrl, { headers, signal });
        if (!response.ok) {
          throw new Error(`Model list request failed (${String(response.status)}): ${response.statusText}`);
        }
        const data = (await response.json()) as ModelListResponse;
        this.replaceLiveModelMetadata(data.data);
        const ids = data.data
          ?.map((model) => model.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .filter((id) => this.definition.filterModel?.(id) ?? true);

        const filtered = await this.filterAvailableModels(ids?.length ? ids : this.definition.fallbackModels);
        // Persist the successful snapshot for future fallback coverage.
        this.cachedModelList = { ids: filtered, fetchedAt: Date.now() };
        void this.context.globalState.update(this.modelListCacheKey, this.cachedModelList);
        return filtered;
      } catch (error) {
        cancellationLink?.dispose();
        cancellationLink = undefined;
        lastError = error;
        // 1. If the caller's cancellation token fired, never retry — bail.
        if (token?.isCancellationRequested) {
          return await this.fallbackModelList();
        }
        // 2. Classify the error. Timeout (AbortError without token cancel)
        //    and transient network errors are retryable; HTTP 4xx is not.
        const aborted = typeof DOMException === "function" && error instanceof DOMException && error.name === "AbortError";
        const transient = aborted || isTransientFetchError(error);
        // 3. On final attempt or non-transient error, fall through to
        //    cache/bundled fallback below.
        if (!transient || attempt === MODEL_LIST_FETCH_MAX_RETRIES) {
          break;
        }
        const backoff = MODEL_LIST_FETCH_RETRY_BASE_MS * Math.pow(2, attempt);
        this.log(
          `[fetchModels] ${this.definition.displayName}: transient error (attempt ${String(attempt + 1)}/${String(MODEL_LIST_FETCH_MAX_RETRIES + 1)}): ${this.errMsg(error)}. Retrying in ${String(backoff)}ms.`,
        );
        try {
          await sleep(backoff, token);
        } catch {
          // Cancellation during backoff — bail to fallback.
          return await this.fallbackModelList();
        }
      } finally {
        cancellationLink?.dispose();
      }
    }

    // Final failure: prefer cached snapshot (still fresh), then bundled list.
    const cached = this.loadCachedModelList();
    if (cached) {
      this.log(
        `[fetchModels] ${this.definition.displayName}: ${this.errMsg(lastError)}. Using cached model list (${String(cached.ids.length)} models, fetched ${new Date(cached.fetchedAt).toISOString()}).`,
      );
      return this.filterAvailableModels(cached.ids);
    }
    this.log(
      `[fetchModels] ${this.definition.displayName}: ${this.errMsg(lastError)}. Using bundled model list (${String(this.definition.fallbackModels.length)} models).`,
    );
    return this.filterAvailableModels(this.definition.fallbackModels);
  }

  /** Bundle the cancellation semantics of a VS Code token into an AbortSignal. */
  private signalFromToken(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    let subscription: vscode.Disposable | undefined;
    if (token.isCancellationRequested) {
      controller.abort();
    } else {
      // Already-cancelled tokens still invoke the listener (shortcutEvent),
      // so this single subscription covers the subscribe-time race too.
      subscription = token.onCancellationRequested(() => {
        controller.abort();
      });
    }
    return {
      signal: controller.signal,
      dispose: () => {
        subscription?.dispose();
        subscription = undefined;
      },
    };
  }

  private errMsg(error: unknown): string {
    const message = getErrorMessage(error);
    const cause = (error as { cause?: { code?: string; name?: string; message?: string } } | null | undefined)?.cause;
    return cause?.code ? `${message} [${cause.code}]` : message;
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
        (modelId) =>
          !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId) &&
          !shouldHideDeprecatedModel(modelId, this.baseVendor, metadataSnapshot) &&
          (this.definition.filterModel?.(modelId) ?? true),
      );

      const removedModelIds = uniqueModelIds.filter((modelId) => !filteredModelIds.includes(modelId));
      if (removedModelIds.length) {
        this.log(`Filtered unavailable/deprecated models: ${removedModelIds.join(", ")}`);
      }

      return filteredModelIds;
    } catch (error) {
      const message = getErrorMessage(error);
      this.log(`Could not fetch model status metadata from models.dev. Applying local unavailable model filter only. ${message}`);
      return uniqueModelIds.filter(
        (modelId) => !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId) && (this.definition.filterModel?.(modelId) ?? true),
      );
    }
  }
}
