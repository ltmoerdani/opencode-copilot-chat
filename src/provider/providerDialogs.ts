import * as vscode from "vscode";
import { TEST_CONNECTION_TIMEOUT_MS, secretKeyFor } from "../config";
import { getErrorMessage } from "../utils";
import { auxiliarySessionId } from "../request/headers";
import type { ProviderVendor } from "../providerTypes";
import type { ProviderDefinition } from "./definitions";
import { configureUtilityModels, toggleProviderEnabled } from "../commands/providers";

/**
 * Provider management UI flows (gear-icon menu + connection test). Pure with
 * respect to the provider class — all state arrives via {@link DialogDeps}.
 */
export interface DialogDeps {
  context: vscode.ExtensionContext;
  baseVendor: ProviderVendor;
  definition: ProviderDefinition;
  log(message: string): void;
  refreshModels(): Promise<void>;
  showDiagnostics(): Promise<void>;
}

/** Gear-icon quick-pick: test / refresh / utility models / diagnostics / enable. */
export async function manageProvider(deps: DialogDeps): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "Test Connection", action: "test" as const },
      { label: "Refresh Models", action: "refresh" as const },
      { label: "Configure Utility Models", action: "utility" as const },
      { label: "Open Diagnostics", action: "diagnostics" as const },
      // toggleProviderEnabled derives Remove vs Re-add from the current
      // setting and confirms via its own quick-pick (issue #228).
      { label: "Toggle Registration in Language Models…", action: "toggle" as const },
    ],
    {
      title: `Manage ${deps.definition.displayName}`,
      placeHolder: "Choose an action",
    },
  );

  if (!choice) {
    return;
  }

  if (choice.action === "toggle") {
    await toggleProviderEnabled(deps.definition.vendor, deps.definition.displayName);
    return;
  }

  if (choice.action === "test") {
    await testConnection(deps);
    return;
  }

  if (choice.action === "utility") {
    await configureUtilityModels();
    return;
  }

  if (choice.action === "diagnostics") {
    await deps.showDiagnostics();
    return;
  }

  await deps.refreshModels();
}

/** Fire a minimal chat completion at the configured endpoint and report the result. */
export async function testConnection(deps: DialogDeps): Promise<void> {
  const apiKey = await deps.context.secrets.get(secretKeyFor(deps.baseVendor));
  if (!apiKey) {
    vscode.window.showErrorMessage(
      `${deps.definition.displayName}: No API key configured. Add the provider via Manage Language Models ("+ Add Models" → ${deps.definition.displayName}) first.`,
    );
    return;
  }

  const statusBar = vscode.window.setStatusBarMessage(`$(loading~spin) Testing ${deps.definition.displayName} connection...`);
  deps.log(`Testing connection to ${deps.definition.chatCompletionsUrl}`);

  try {
    const response = await fetch(deps.definition.chatCompletionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Gateway enforcement (docs/go): auxiliary requests need a session id.
        "x-opencode-session": auxiliarySessionId(deps.context),
      },
      body: JSON.stringify({
        model: deps.definition.testModelId,
        messages: [{ role: "user", content: "reply with just: ok" }],
        max_tokens: 10,
        stream: false,
      }),
      signal: AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
    });

    const responseText = await response.text();
    deps.log(`Test response (${String(response.status)}): ${responseText}`);

    if (response.ok) {
      vscode.window.showInformationMessage(
        `${deps.definition.displayName}: Connection OK (HTTP ${String(response.status)}). Check Output panel for details.`,
      );
    } else {
      vscode.window.showErrorMessage(
        `${deps.definition.displayName}: Connection failed (HTTP ${String(response.status)}). Check Output panel for details.`,
      );
    }
  } catch (error) {
    const message = getErrorMessage(error);
    deps.log(`Test connection error: ${message}`);
    vscode.window.showErrorMessage(`${deps.definition.displayName}: Connection error - ${message}`);
  } finally {
    statusBar.dispose();
  }
}
