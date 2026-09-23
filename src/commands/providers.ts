import * as vscode from "vscode";
import { SETTING_ENABLED } from "../config";
import { resolveBaseVendor, type AllProviderVendor } from "../providerTypes";

/** Open the Settings UI filtered to the utility-model config keys. */
export async function configureUtilityModels(): Promise<void> {
  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "@id:chat.byokUtilityModelDefault @id:chat.utilityModel @id:chat.utilitySmallModel",
  );
}

/**
 * Remove / re-add a provider (`opencodego` / `opencodezen`) from the Language
 * Models list. Disabling removes the provider from the list and every model
 * picker — the provider's vendor contribution is gated by the same `when`
 * clause (`config.<vendor>.enabled`) and its runtime registration is skipped.
 * Previously configured BYOK groups and API keys are kept, so re-enabling
 * restores the provider exactly as it was.
 *
 * NOT a blind toggle: the desired action is derived from the current setting
 * and offered as a quick-pick, so invoking the command repeatedly can never
 * leave the provider in an unexpected state (issue #228).
 *
 * Provider registration happens at startup, so a window reload is required
 * for the change to take effect.
 */
export async function toggleProviderEnabled(vendor: AllProviderVendor, displayName: string): Promise<void> {
  // Resolve agent variants (opencodego-agent / opencodezen-agent) to their
  // base vendor BEFORE touching configuration — the provider `when` clause
  // and the settings schema only know `opencodego.enabled` /
  // `opencodezen.enabled`. Writing the agent variant's own section (e.g.
  // `opencodezen-agent.enabled`) produces a key nothing reads, leaving the
  // provider permanently removed while settings look "enabled" (issue #228).
  const baseVendor = resolveBaseVendor(vendor);
  const cfg = vscode.workspace.getConfiguration(baseVendor);
  const currentlyEnabled = cfg.get<boolean>(SETTING_ENABLED, true);

  const action = await vscode.window.showQuickPick(
    currentlyEnabled
      ? [
          {
            label: `$(remove) Remove ${displayName} from Language Models`,
            detail: "Provider settings and API key are kept. Requires a window reload.",
            disable: true,
          },
        ]
      : [
          {
            label: `$(add) Re-add ${displayName} to Language Models`,
            detail: "Restores the provider with its existing settings and API key. Requires a window reload.",
            disable: false,
          },
        ],
    { title: `${displayName}: Manage Provider Registration`, placeHolder: "Choose an action (Esc to cancel)" },
  );
  if (!action) {
    return;
  }

  await cfg.update("enabled", action.disable, vscode.ConfigurationTarget.Global);

  const reload = await vscode.window.showInformationMessage(
    action.disable
      ? `${displayName} removed from Language Models. Reload the window for it to disappear from the model picker and the manage list. Your API key and group settings are kept.`
      : `${displayName} re-enabled. Reload the window for the provider to appear in Language Models again.`,
    "Reload Now",
  );
  if (reload === "Reload Now") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}
