import * as vscode from "vscode";
import {
  CONFIG_SECTION,
  DEFAULT_VISION_PROXY_PROMPT,
  HISTORY_TRIM_SAFETY_MARGIN_TOKENS,
  HISTORY_TRIM_TARGET_RATIO,
  MAX_HISTORY_IMAGES_KEPT,
  SETTING_VISION_PROXY_WHOLE_CONVERSATION,
  VISION_PROXY_MODEL_ID_KEY,
  VISION_PROXY_PROMPT_KEY,
  secretKeyFor,
} from "../config";
import type { ConfiguredLanguageModelResponseOptions } from "./definitions";
import type { TransportRequestSummary } from "../core/transport";
import { resolveModelRouting } from "../core/routing";
import { extractThinkingOverride, resolveThinkingConfig, thinkingProviderFor } from "../thinking";
import { getErrorMessage } from "../utils";
import type { CachedModelMetadataSnapshot, ResolvedModelMetadata } from "../models/metadata";
import { resolveResponseApiKey } from "../apiKeyResolution";
import { convertMessage, normalizeMessages, trimOldImagesFromHistoryInPlace } from "./messages";
import { historyByteCapForBudget, trimOldMessagesToFitContext } from "./historyTrim";
import {
  getConfiguredApiKey,
  getRequestModelConfiguration,
  getSettings,
  isVisionProxyEnabled,
  modelLimits,
  resolveRawModelId,
} from "./settings";
import { messagesHaveImages } from "../request/builders";
import { buildOpenCodeRequestHeaders } from "../request/headers";
import type { ApiMessage, ApiSettings, OpenAiContentPart } from "../request/types";
import { proxyVision } from "./visionProxy";
import { estimateCost } from "../usage/pricing";
import {
  activeProfileFingerprint,
  ensureProfileForApiKey,
  refreshGoUsageStatusBar,
  syncTrackerUsage,
  updateUsageStatusBar,
} from "../usage/dashboard";
import { GO_VENDOR, type ProviderVendor } from "../providerTypes";
import type { OpenCodeModel, ProviderDefinition } from "./definitions";
import type { TransportSummaryLog } from "./transportLog";

/**
 * Everything the chat-response dispatch needs, resolved once per request:
 * message conversion, vision proxy, history trimming, budgets, thinking
 * payload and headers. Pure with respect to the provider class — all state
 * arrives via {@link ChatPrepDeps}.
 */
export interface ChatPrepDeps {
  context: vscode.ExtensionContext;
  baseVendor: ProviderVendor;
  definition: ProviderDefinition;
  transportLog: TransportSummaryLog;
  log(message: string): void;
  getMetadataSnapshot(): Promise<CachedModelMetadataSnapshot>;
  resolveModelMetadata(modelId: string, snapshot: CachedModelMetadataSnapshot): ResolvedModelMetadata;
  reasoningContentByToolCallId: Map<string, string>;
  apiKeysByModelId: Map<string, string>;
}

export async function prepareChatRequest(
  deps: ChatPrepDeps,
  model: OpenCodeModel,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  token: vscode.CancellationToken,
): Promise<{
  apiKey: string;
  rawModelId: string;
  apiMessages: ReturnType<typeof normalizeMessages>;
  settings: ApiSettings;
  requestOverride: ReturnType<typeof getRequestModelConfiguration>;
  resolvedThinking: ReturnType<typeof resolveThinkingConfig>;
  metadata: ResolvedModelMetadata;
  routing: ReturnType<typeof resolveModelRouting>;
  promptTokens: number;
  limits: ReturnType<typeof modelLimits>;
  thinkingPayload: unknown;
  requestHeaders: Record<string, string>;
  outputChannel: vscode.OutputChannel;
  onTransportSummary: (summary: TransportRequestSummary) => void;
}> {
  // VS Code can invoke a cached selected model immediately after the
  // extension host restarts, before model discovery repopulates the in-memory
  // ID map. Keep SecretStorage as the cold-start fallback for that request.
  const apiKey = resolveResponseApiKey(
    getConfiguredApiKey(options as ConfiguredLanguageModelResponseOptions),
    deps.apiKeysByModelId.get(model.id),
    await deps.context.secrets.get(secretKeyFor(deps.baseVendor)),
  );

  if (!apiKey) {
    throw new Error(
      `${deps.definition.displayName} API key is required. Use the ${deps.definition.displayName} gear icon in Language Models to configure it, then reload the window.`,
    );
  }

  const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
  const convertedMessages = await Promise.all(
    messages.map((message) => convertMessage(message, deps.reasoningContentByToolCallId, rawModelId)),
  );
  const normalizedImageCount = convertedMessages.map((result) => result.normalizedImageCount).reduce((total, count) => total + count, 0);
  if (normalizedImageCount > 0) {
    deps.log(`[vision] Normalized ${String(normalizedImageCount)} image attachment(s) to provider-safe dimensions/encoding.`);
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
  const metadataSnapshot = await deps.getMetadataSnapshot();
  const metadata = deps.resolveModelMetadata(rawModelId, metadataSnapshot);
  const routing = resolveModelRouting(rawModelId, deps.definition);

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
  const visionProxyModelId = isVisionProxyEnabled() ? deps.context.globalState.get<string>(VISION_PROXY_MODEL_ID_KEY, "") || "" : "";
  if (hasImageInput && !actuallySupportsVision && visionProxyModelId) {
    const visionProxyPrompt = deps.context.globalState.get<string>(VISION_PROXY_PROMPT_KEY, "") || DEFAULT_VISION_PROXY_PROMPT;
    // When `opencodego.visionProxyWholeConversation` is on, describe the whole
    // conversation instead of only the message with a new image, so descriptions
    // keep conversation context (at the cost of more tokens).
    const describeWholeConversation = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>(SETTING_VISION_PROXY_WHOLE_CONVERSATION, false);
    let imagesHandled = false;
    try {
      deps.log(`[vision-proxy] Forwarding images to ${visionProxyModelId}${describeWholeConversation ? " (whole conversation)" : ""}`);
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
        deps.log(
          `[vision-proxy] Replaced images using vision proxy model (${String(cacheHits)} from cache, ${String(cacheMisses)} newly described)`,
        );
      }
    } catch (err) {
      deps.log(`[vision-proxy] Error: ${getErrorMessage(err)}`);
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
      deps.log(`[vision-proxy] Stripped images (proxy unavailable), prevented 400`);
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
    deps.log(
      `[history-trim] Replaced ${String(trimmedCount)} old image(s) with placeholder text to bound payload (kept most recent ${String(MAX_HISTORY_IMAGES_KEPT)}).`,
    );
  }

  // Bound the text conversation history to the model's input context window.
  // Long multi-turn conversations (or repeated turns without Compact
  // Conversation) can exceed the context limit, causing the upstream to reject
  // the oversized request (HTTP 400/503) or return an empty stream — surfaced
  // by VS Code as "No response came" / "Sorry, no response was returned" — and
  // a huge payload also makes the upstream hang (10-minute request timeout)
  // and slows the extension session. Drop the oldest messages (preserving the
  // anchor and the current prompt, never splitting a tool-call group) until
  // the payload fits BOTH the input token budget AND a hard byte ceiling.
  const effectiveContextWindow = contextSizeOverride ?? metadata.contextWindow;
  const outputReserve = Math.min(metadata.maxOutputTokens, effectiveContextWindow);
  // Stay safely below the window: the upstream rejects near the full limit
  // (the reporter saw failures at ~70% context), so cap at a target ratio and
  // also leave room for the output reserve + a fixed safety margin.
  const ratioBudget = Math.floor(effectiveContextWindow * HISTORY_TRIM_TARGET_RATIO);
  const maxBudget = Math.max(1, effectiveContextWindow - outputReserve - HISTORY_TRIM_SAFETY_MARGIN_TOKENS);
  const inputBudget = Math.min(ratioBudget, maxBudget);
  const historyMaxBytes = historyByteCapForBudget(inputBudget);
  const historyTrim = trimOldMessagesToFitContext(apiMessages, inputBudget, historyMaxBytes, options.tools);
  if (historyTrim.removed > 0) {
    deps.log(
      `[history-trim] Dropped ${String(historyTrim.removed)} old message(s) to fit context window (budget=${String(inputBudget)} tokens, maxBytes=${String(historyMaxBytes)}); estimated payload now ~${String(historyTrim.finalTokens)} tokens / ${String(historyTrim.finalBytes)} bytes.`,
    );
  }

  // Use the estimate computed during trimming (no second full re-estimation)
  // so the output budget reflects the payload that is actually sent upstream.
  const promptTokens = historyTrim.finalTokens;
  const limits = modelLimits(metadata, settings, contextSizeOverride, promptTokens);

  const thinkingPayload = thinkingProviderFor(rawModelId).buildPayload(settings.thinking, {
    hasImageInput: hasImageInput && metadata.supportsVision,
    endpoint: routing.endpointKind === "messages" ? "messages" : routing.endpointKind === "responses" ? "responses" : "chat",
  });
  const requestHeaders = buildOpenCodeRequestHeaders(messages, options, rawModelId);
  try {
    const crypto = await import("crypto");
    const prefixAnchor = apiMessages
      .slice(0, 3)
      .map((m) => `${m.role}:${JSON.stringify(m.content).slice(0, 2048)}`)
      .join("\n");
    const toolNames = [...(options.tools ?? [])]
      .map((t) => (t as { name: string }).name)
      .sort()
      .join(",");
    const prefixHash = crypto
      .createHash("sha256")
      .update(prefixAnchor + "|" + toolNames, "utf8")
      .digest("hex")
      .slice(0, 12);
    deps.log(`[prefix-hash] ${prefixHash} messages=${String(apiMessages.length)} tools=${String(options.tools?.length ?? 0)}`);
  } catch {
    /* best-effort */
  }
  const outputChannel = vscode.window.createOutputChannel("OpenCode");
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

    deps.transportLog.record(summary, routing.endpointKind, metadata.source, options.requestInitiator);
    updateUsageStatusBar(deps.definition.displayName, rawModelId, summary);
    if (deps.baseVendor === GO_VENDOR) {
      const tracker = ensureProfileForApiKey(apiKey);
      deps.log(
        `[go-usage] Recording profile=${activeProfileFingerprint}: model=${summary.modelId} promptTokens=${prompt} completionTokens=${completion} cachedTokens=${cached}`,
      );
      tracker.record(summary, metadata.cost);
      refreshGoUsageStatusBar();
      deps.log(`[go-usage] After record profile=${activeProfileFingerprint}: entries=${tracker.getSummary().today.requests}`);
      // Re-sync the server-accurate account meters (TTL-guarded, uses the
      // exact key this request ran under — covers BYOK group keys too).
      void syncTrackerUsage(tracker, apiKey);
    }
  };

  deps.log(
    `Request: initiator=${options.requestInitiator} model=${model.id} rawModel=${rawModelId} endpoint=${routing.endpointKind} metadataSource=${metadata.source} messages=${String(apiMessages.length)} promptEstimate=${String(promptTokens)} maxOutputTokens=${String(limits.maxOutputTokens)} session=${requestHeaders["x-opencode-session"]} request=${requestHeaders["x-opencode-request"]} modelConfiguration=${JSON.stringify(extractThinkingOverride(requestOverride))} thinkingSource=${resolvedThinking.source} thinking=${JSON.stringify(settings.thinking)} thinkingPayload=${JSON.stringify(thinkingPayload)}`,
  );
  if (settings.debugReasoning) {
    deps.log("Reasoning debug is enabled. Provider reasoning_content will be written to this output channel when available.");
  }
  return {
    apiKey,
    rawModelId,
    apiMessages,
    settings,
    requestOverride,
    resolvedThinking,
    metadata,
    routing,
    promptTokens,
    limits,
    thinkingPayload,
    requestHeaders,
    outputChannel,
    onTransportSummary,
  };
}
