import * as vscode from "vscode";
import { registerInlineCompletions } from "./autocomplete";
import { ensureAgentsWindowSupport, revertAgentsWindowSupport, warmModelPickerMetadata } from "./commands/agentsWindow";
import { showModelPickerDiagnostics } from "./commands/diagnostics";
import { showThinkingEffortPicker } from "./commands/thinkingPicker";
import { configureUtilityModels, toggleProviderEnabled } from "./commands/providers";
import {
  ACTIVE_PROFILE_EXPLICIT_KEY,
  CONFIG_SECTION,
  DEFAULT_USAGE_CHART_DAYS,
  GO_EVER_TRACKED_KEY,
  GO_SERVER_USAGE_KEY,
  SETTING_AGENTS_WINDOW,
  SETTING_AUTO_ENABLE_AGENTS_WINDOW,
  SETTING_SHOW_PROVIDER_PREFIX,
  SETTING_SHOW_USAGE_STATUS_BAR,
  SETTING_USAGE_CHART_DAYS,
  secretKeyFor,
} from "./config";
import { GoUsageTracker } from "./usage/tracker";
import { buildUsageQuickPickItems } from "./usage/formatting";
import { PROVIDERS } from "./provider/definitions";
import { OpenCodeProvider } from "./provider/OpenCodeProvider";
import { getModelMetadataSnapshot } from "./models/metadataFetcher";
import { GO_VENDOR, ZEN_VENDOR, AGENT_GO_VENDOR, AGENT_ZEN_VENDOR } from "./providerTypes";
import { providerEnabledSetting } from "./providerEnablement";
import { showVisionProxyPicker } from "./provider/visionProxy";
import { formatCount, formatTokenCount, formatUsd } from "./utils";
import {
  LEGACY_FINGERPRINT,
  findProfile,
  keyFingerprint,
  readActiveProfile,
  readActiveProfiles,
  readProfiles,
  renameProfile,
  writeActiveProfile,
  writeProfiles,
} from "./usage/usageProfile";
import {
  USAGE_DISPLAY_SETTING_KEYS,
  _extensionContext,
  activeGoUsageTracker,
  activeProfileFingerprint,
  ensureGoUsageStatusBar,
  ensureUsageStatusBar,
  extensionContext,
  getOrCreateTracker,
  goUsageTrackers,
  profileApiKeys,
  profilesCache,
  refreshGoUsageStatusBar,
  resetUsageStatusBar,
  setActiveProfile,
  setActiveProfileFingerprint,
  setExtensionContext,
  setGoUsageTracker,
  setProfilesCache,
  setUsageChartWindowDays,
  setUsageLogChannel,
  showUsageTargetEditor,
  showUsageWebview,
  startUsageRefreshLoop,
  syncTrackerUsage,
  updateWebviewContent,
  usageCodebaseRowVisible,
  usageRollingMeterVisible,
  usageTrackerOptions,
} from "./usage/dashboard";

/**
 * Hard upper limit (in bytes of raw image data) for a single image embedded
 * in a tool result. MCP screenshots from chrome-devtools-mcp / playwright-mcp
 * are typically 50–300 KB; anything above 1 MB is almost always an oversized
 * raw capture that bloats the request payload (each image becomes a base64
 * data URI ≈ 1.33× its byte size) and triggers upstream 400 "Upstream request
 * failed" rejections from OpenCode Go. Larger images are replaced with a
 * placeholder text part so the model still knows an image was returned.
 */

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

export function activate(context: vscode.ExtensionContext) {
  const goUsageLogChannel = vscode.window.createOutputChannel("OpenCode Go Usage");
  context.subscriptions.push(goUsageLogChannel);
  setGoUsageTracker(
    new GoUsageTracker(
      context,
      (msg) => {
        goUsageLogChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
      },
      (modelId) => {
        return getModelMetadataSnapshot()?.providers[GO_VENDOR]?.[modelId]?.cost;
      },
      "",
      usageTrackerOptions(),
    ),
  );
  setExtensionContext(context);
  setUsageLogChannel(goUsageLogChannel);
  setProfilesCache(readProfiles(context));
  setActiveProfileFingerprint(readActiveProfile(context));

  // Eagerly load the tracker for the active profile so the status bar
  // has data to display immediately, even before the first request.
  if (activeProfileFingerprint !== LEGACY_FINGERPRINT) {
    getOrCreateTracker(activeProfileFingerprint);
  }

  ensureUsageStatusBar(context);
  ensureGoUsageStatusBar(context);
  // Startup diagnostic: report whether the CLI history is readable so any
  // silent zero-usage state is immediately visible in the usage output
  // channel (the tracker also logs the exact failure reason on error).
  {
    const startupTracker = activeGoUsageTracker();
    if (startupTracker) {
      const startupSummary = startupTracker.getSummary();
      goUsageLogChannel.appendLine(
        `[go-usage] CLI history available: ${String(startupSummary.sqliteAvailable)} — ` +
          `today=${String(startupSummary.today.requests)} req, codebase=${String(startupSummary.codebase.requests)} req`,
      );
    }
  }
  // Pull the server-accurate account meters once at startup (TTL-guarded).
  void (async () => {
    const apiKey = await context.secrets.get(secretKeyFor(GO_VENDOR));
    if (!apiKey) return;
    await syncTrackerUsage(getOrCreateTracker(keyFingerprint(apiKey)), apiKey);
  })();
  // Read from the root configuration with the FULL setting key: section-scoped
  // reads (getConfiguration("opencodego")) resolve keys relative to the
  // section, which would misread the Zen flag as opencodego.opencodezen.enabled.
  const goProviderEnabled = vscode.workspace.getConfiguration().get<boolean>(providerEnabledSetting(GO_VENDOR), true);
  const zenProviderEnabled = vscode.workspace.getConfiguration().get<boolean>(providerEnabledSetting(ZEN_VENDOR), true);
  const goProvider = new OpenCodeProvider(context, PROVIDERS[GO_VENDOR]);
  const zenProvider = new OpenCodeProvider(context, PROVIDERS[ZEN_VENDOR]);
  const modelInfoProviders: OpenCodeProvider[] = [goProvider, zenProvider];

  const subscriptions: vscode.Disposable[] = [
    // Register the chat providers only while the matching `opencodego.enabled`
    // / `opencodezen.enabled` setting is on, so a disabled provider disappears
    // from the Language Models list and every model picker (its vendor
    // contribution carries the same `when` clause). The provider instances are
    // still created so the management commands keep working for re-enabling.
    ...(goProviderEnabled ? [vscode.lm.registerLanguageModelChatProvider(GO_VENDOR, goProvider)] : []),
    ...(zenProviderEnabled ? [vscode.lm.registerLanguageModelChatProvider(ZEN_VENDOR, zenProvider)] : []),
    vscode.commands.registerCommand("opencodego.manage", () => goProvider.manage()),
    vscode.commands.registerCommand("opencodego.setApiKey", () => goProvider.setApiKey()),
    vscode.commands.registerCommand("opencodego.diagnostics", () => goProvider.showDiagnostics()),
    vscode.commands.registerCommand("opencodego.refreshModels", () => goProvider.refreshModels()),
    vscode.commands.registerCommand("opencodego.toggleProvider", () => toggleProviderEnabled(GO_VENDOR, "OpenCode Go")),
    vscode.commands.registerCommand("opencodego.configureUtilityModels", () => configureUtilityModels()),
    vscode.commands.registerCommand("opencodezen.diagnostics", () => zenProvider.showDiagnostics()),
    vscode.commands.registerCommand("opencodezen.manage", () => zenProvider.manage()),
    vscode.commands.registerCommand("opencodezen.setApiKey", () => zenProvider.setApiKey()),
    vscode.commands.registerCommand("opencodezen.refreshModels", () => zenProvider.refreshModels()),
    vscode.commands.registerCommand("opencodezen.toggleProvider", () => toggleProviderEnabled(ZEN_VENDOR, "OpenCode Zen")),
    vscode.commands.registerCommand("opencodego.modelPickerDiagnostics", () => showModelPickerDiagnostics()),
    vscode.commands.registerCommand("opencodego.setThinkingEffort", () => showThinkingEffortPicker()),
    vscode.commands.registerCommand("opencodego.showUsageDetails", () => {
      showUsageWebview(context);
    }),
    vscode.commands.registerCommand("opencodego.refreshUsage", () => {
      refreshGoUsageStatusBar();
    }),
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
      const items = buildUsageQuickPickItems(summary, tracker.hasServerUsage, usageRollingMeterVisible());

      // All-time usage in the current workspace (from the OpenCode CLI
      // history) — replaces the old "Latest Session (est)" estimate row.
      if (usageCodebaseRowVisible()) {
        const codebaseItem: vscode.QuickPickItem = {
          label: "$(repo) Codebase",
          description: formatUsd(summary.codebase.cost),
          detail: `${formatTokenCount(summary.codebase.tokens)} tokens · ${formatCount(summary.codebase.requests)} requests`,
          alwaysShow: true,
        };
        const dailyIdx = items.findIndex((i) => i.kind === vscode.QuickPickItemKind.Separator && i.label === "Daily Summary");
        if (dailyIdx >= 0) {
          items.splice(dailyIdx + 1, 0, codebaseItem);
        } else {
          items.push(codebaseItem);
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
      } else if (action === "openConsole") {
        void vscode.env.openExternal(vscode.Uri.parse("https://opencode.ai"));
      } else if (action === "switchProfile" && "_fp" in picked) {
        void setActiveProfile((picked as { _fp: string })._fp);
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
      await renameProfile(extensionContext(), activeProfileFingerprint, newLabel);
      setProfilesCache(readProfiles(extensionContext()));
      refreshGoUsageStatusBar();
      updateWebviewContent();
      vscode.window.showInformationMessage(`Profile renamed to "${newLabel}".`);
    }),
    vscode.commands.registerCommand("opencodego.deleteProfile", async () => {
      const profiles = readActiveProfiles(extensionContext());
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
      const ctx = extensionContext();
      ctx.globalState.update(`opencodego.usageLog.v1.${fp}`, []);
      ctx.globalState.update(`opencodego.usageBaseline.v1.${fp}`, {});
      ctx.globalState.update(`opencodego.sessionCosts.v1.${fp}`, []);
      // Also clear the per-profile server snapshot + ever-tracked flags so a
      // re-added profile (same key) doesn't resurrect stale meters/state.
      ctx.globalState.update(`${GO_SERVER_USAGE_KEY}.${fp}`, undefined);
      ctx.globalState.update(`${GO_EVER_TRACKED_KEY}.${fp}`, undefined);

      const remaining = readProfiles(ctx).filter((p) => p.fingerprint !== fp);
      await writeProfiles(ctx, remaining);
      setProfilesCache(remaining);

      if (activeProfileFingerprint === fp) {
        setActiveProfileFingerprint(LEGACY_FINGERPRINT);
        await writeActiveProfile(ctx, LEGACY_FINGERPRINT);
        // The user's explicit choice was deleted — clear the flag so auto-
        // selection resumes for the remaining profiles.
        await ctx.globalState.update(ACTIVE_PROFILE_EXPLICIT_KEY, undefined);
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
  const enableAgents = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_AGENTS_WINDOW, true);
  if (enableAgents && (goProviderEnabled || zenProviderEnabled)) {
    const agentGoProvider = new OpenCodeProvider(context, PROVIDERS[AGENT_GO_VENDOR]);
    const agentZenProvider = new OpenCodeProvider(context, PROVIDERS[AGENT_ZEN_VENDOR]);
    modelInfoProviders.push(agentGoProvider, agentZenProvider);
    subscriptions.push(
      ...(goProviderEnabled ? [vscode.lm.registerLanguageModelChatProvider(AGENT_GO_VENDOR, agentGoProvider)] : []),
      ...(zenProviderEnabled ? [vscode.lm.registerLanguageModelChatProvider(AGENT_ZEN_VENDOR, agentZenProvider)] : []),
    );
    // On VS Code 1.129+ the Agents window runs in the agent host process,
    // where extension BYOK models are only reachable through VS Code's BYOK
    // language-model bridge — which is off by default. Make sure it is on so
    // OpenCode models actually show up there (issue #122).
    void ensureAgentsWindowSupport(context);
  }

  context.subscriptions.push(...subscriptions);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING_SHOW_USAGE_STATUS_BAR}`)) {
        resetUsageStatusBar();
      }
      if (event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING_SHOW_PROVIDER_PREFIX}`)) {
        for (const provider of modelInfoProviders) {
          provider.notifyModelInfoChanged();
        }
      }
      if (
        event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING_AGENTS_WINDOW}`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING_AUTO_ENABLE_AGENTS_WINDOW}`)
      ) {
        const agentsWindowEnabled = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_AGENTS_WINDOW, true);
        const autoEnabled = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_AUTO_ENABLE_AGENTS_WINDOW, true);
        if (agentsWindowEnabled && autoEnabled) {
          void ensureAgentsWindowSupport(context);
        } else {
          // Revert the core settings we auto-enabled when either the feature
          // is turned off OR auto-configuration is disabled — otherwise a
          // user who only disables `autoEnableAgentsWindow` is left with the
          // extension's settings permanently flipped in their global config.
          void revertAgentsWindowSupport(context);
        }
      }
      // Any usage-display setting change repaints the status bar / panel
      // immediately (no waiting for the next request or refresh tick).
      if (USAGE_DISPLAY_SETTING_KEYS.some((key) => event.affectsConfiguration(`${CONFIG_SECTION}.${key}`))) {
        if (event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING_USAGE_CHART_DAYS}`)) {
          setUsageChartWindowDays(
            vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>(SETTING_USAGE_CHART_DAYS, DEFAULT_USAGE_CHART_DAYS),
          );
        }
        refreshGoUsageStatusBar();
        updateWebviewContent();
      }
    }),
  );

  startUsageRefreshLoop(context);

  void warmModelPickerMetadata();

  // Experimental inline code suggestions (issue #49). Opt-in via
  // `opencodego.inlineSuggestions`; the provider reads the config live.
  registerInlineCompletions(context, {
    chatCompletionsUrl: PROVIDERS[GO_VENDOR].chatCompletionsUrl,
    // Same resolution order as the chat path: the active profile's own key
    // first (covers multi-profile / BYOK-group setups), then the secret.
    resolveApiKey: async () => profileApiKeys.get(activeProfileFingerprint) ?? _extensionContext?.secrets.get(secretKeyFor(GO_VENDOR)),
  });
}
export async function deactivate(): Promise<void> {
  // no-op: experimental context indicator hooks removed in 0.1.8
}
