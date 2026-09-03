import * as vscode from "vscode";
import {
  AGENTS_BYOK_BRIDGE_STATE_KEY,
  AGENT_HOST_BYOK_ENABLED_SETTING,
  AGENT_HOST_BYOK_MINOR_VERSION,
  CONFIG_SECTION,
  EXTENSION_ID,
  SETTING_AGENTS_WINDOW,
  SETTING_AUTO_ENABLE_AGENTS_WINDOW,
  SUPPORT_AGENTS_WINDOW_SETTING,
  SUPPORT_AGENTS_WINDOW_STATE_KEY,
} from "../config";
import { AGENT_GO_VENDOR, AGENT_ZEN_VENDOR, GO_VENDOR, ZEN_VENDOR } from "../providerTypes";
import { providerEnabledSetting } from "../providerEnablement";

/**
 * Whether this VS Code has the modern agent-host BYOK bridge (1.129+).
 *
 * From VS Code 1.129 the Agents window runs in a separate agent host
 * process. Extension-provided BYOK models (isBYOK, no `targetChatSessionType`)
 * are mirrored into agent-host sessions exclusively through the BYOK
 * language-model bridge, which VS Code keeps OFF by default
 * (`chat.agentHost.byokModels.enabled`, experimental). On older versions the
 * extension's own agent-host providers (`targetChatSessionType: "copilotcli"`)
 * are the only path, which is why they stay registered.
 */
function isModernAgentHostVscode(): boolean {
  const [major = 1, minor = 0] = vscode.version.split(".").map(Number);
  return major > 1 || (major === 1 && minor >= AGENT_HOST_BYOK_MINOR_VERSION);
}

/**
 * Ensure the VS Code core settings that make OpenCode Go/Zen models usable in
 * the Agents window are enabled (issue #122):
 *
 * 1. `extensions.supportAgentsWindow.<id>` — the only way a code extension is
 *    allowed to run in the Agents window (sessions window) process. VS Code
 *    disables any extension with a `main` entry there by default, so without
 *    this setting the extension's `languageModelChatProviders` vendors are
 *    not registered in that window: neither the model picker nor the
 *    "+ Add Models" list can show OpenCode Go/Zen.
 * 2. `chat.agentHost.byokModels.enabled` (VS Code 1.129+) — the BYOK
 *    language-model bridge that mirrors extension BYOK models into
 *    agent-host sessions. Off by default and experimental.
 *
 * CONTRACT:
 * - Only writes the settings while the user keeps `opencodego.agentsWindow`
 *   and `opencodego.autoEnableAgentsWindow` on; the settings are merged with
 *   existing user values (never clobbering unrelated entries).
 * - Records in globalState which settings the extension flipped itself, so
 *   {@link revertAgentsWindowSupport} can restore them when the user disables
 *   the Agents feature.
 * - Both settings take effect after a window reload (extension host /
 *   agent host restart) — surface an actionable notification the first time
 *   anything was changed.
 */
export async function ensureAgentsWindowSupport(context: vscode.ExtensionContext): Promise<void> {
  const opencodeCfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  if (!opencodeCfg.get<boolean>(SETTING_AGENTS_WINDOW, true) || !opencodeCfg.get<boolean>(SETTING_AUTO_ENABLE_AGENTS_WINDOW, true)) {
    return;
  }

  let changed = false;
  const extensionCfg = vscode.workspace.getConfiguration("extensions");
  const support = extensionCfg.get<Record<string, boolean>>(SUPPORT_AGENTS_WINDOW_SETTING, {});
  if (!support[EXTENSION_ID]) {
    await extensionCfg.update(SUPPORT_AGENTS_WINDOW_SETTING, { ...support, [EXTENSION_ID]: true }, vscode.ConfigurationTarget.Global);
    await context.globalState.update(SUPPORT_AGENTS_WINDOW_STATE_KEY, true);
    changed = true;
  }

  if (isModernAgentHostVscode()) {
    const agentHostCfg = vscode.workspace.getConfiguration("chat.agentHost");
    if (!agentHostCfg.get<boolean>(AGENT_HOST_BYOK_ENABLED_SETTING, false)) {
      await agentHostCfg.update(AGENT_HOST_BYOK_ENABLED_SETTING, true, vscode.ConfigurationTarget.Global);
      await context.globalState.update(AGENTS_BYOK_BRIDGE_STATE_KEY, true);
      changed = true;
    }
  }

  if (changed) {
    const reload = await vscode.window.showInformationMessage(
      "OpenCode: enabled VS Code's Agents window support so OpenCode Go/Zen models can run in the Agents window. Reload the window for it to take effect.",
      "Reload Now",
    );
    if (reload === "Reload Now") {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }
}

/**
 * Revert the core settings that {@link ensureAgentsWindowSupport} enabled on
 * this machine. By default only settings the extension flipped itself are
 * restored (tracked in globalState) — settings the user configured manually
 * are left untouched.
 *
 * With `force` (issue #213) both settings are reverted even without a
 * globalState marker — for machines where the extension was uninstalled
 * without reverting first and the flipped settings were left behind
 * ("permanently hijacked" Agents window). In force mode a user-set
 * `extensions.supportAgentsWindow` entry for THIS extension id is still
 * removed, but other extensions' entries are never touched; the
 * `chat.agentHost.byokModels.enabled` flag is only set to `false` when no
 * other extension id needs it (it is a single global flag, so a user who
 * intentionally enabled it for another BYOK provider is detected via the
 * marker's absence and the value is left alone unless it matches what we
 * would have written).
 */
export async function revertAgentsWindowSupport(context: vscode.ExtensionContext, options?: { force?: boolean }): Promise<void> {
  const force = options?.force === true;
  const extensionCfg = vscode.workspace.getConfiguration("extensions");
  if (force || context.globalState.get<boolean>(SUPPORT_AGENTS_WINDOW_STATE_KEY)) {
    const support = extensionCfg.get<Record<string, boolean>>(SUPPORT_AGENTS_WINDOW_SETTING, {});
    if (support[EXTENSION_ID]) {
      const next: Record<string, boolean> = Object.fromEntries(Object.entries(support).filter(([id]) => id !== EXTENSION_ID));
      await extensionCfg.update(
        SUPPORT_AGENTS_WINDOW_SETTING,
        Object.keys(next).length > 0 ? next : undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
    await context.globalState.update(SUPPORT_AGENTS_WINDOW_STATE_KEY, undefined);
  }

  if (force || context.globalState.get<boolean>(AGENTS_BYOK_BRIDGE_STATE_KEY)) {
    await vscode.workspace
      .getConfiguration("chat.agentHost")
      .update(AGENT_HOST_BYOK_ENABLED_SETTING, false, vscode.ConfigurationTarget.Global);
    await context.globalState.update(AGENTS_BYOK_BRIDGE_STATE_KEY, undefined);
  }
}

/** Warm the model picker metadata for every enabled vendor (incl. agent variants). */
export async function warmModelPickerMetadata(): Promise<void> {
  const vendors: string[] = [
    ...(vscode.workspace.getConfiguration().get<boolean>(providerEnabledSetting(GO_VENDOR), true) ? [GO_VENDOR] : []),
    ...(vscode.workspace.getConfiguration().get<boolean>(providerEnabledSetting(ZEN_VENDOR), true) ? [ZEN_VENDOR] : []),
  ];
  if (vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_AGENTS_WINDOW, true) && vendors.length > 0) {
    vendors.push(AGENT_GO_VENDOR, AGENT_ZEN_VENDOR);
  }
  await Promise.allSettled(vendors.map((v) => vscode.lm.selectChatModels({ vendor: v })));
}
