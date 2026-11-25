/**
 * "Sign in with OpenCode Console" command (#286).
 *
 * OpenCode's official Console flow still issues an API key — there is no
 * third-party OAuth for Go. This command removes the manual steps: it imports
 * the key the OpenCode CLI already saved (with explicit user consent), or
 * opens the Console key page and stores the pasted key in SecretStorage.
 */
import * as vscode from "vscode";
import { secretKeyFor } from "../config";
import { CONSOLE_KEYS_URL, readCliGoApiKey } from "../openCodeConsoleCredential";
import { GO_VENDOR } from "../providerTypes";

async function saveKey(context: vscode.ExtensionContext, key: string): Promise<void> {
  await context.secrets.store(secretKeyFor(GO_VENDOR), key);
  await vscode.commands.executeCommand("opencodego.refreshModels");
  await vscode.window.showInformationMessage("OpenCode Go key saved. The model list is refreshing.");
}

export async function signInWithConsole(context: vscode.ExtensionContext): Promise<void> {
  const cliKey = readCliGoApiKey();
  if (cliKey) {
    const choice = await vscode.window.showInformationMessage(
      "The OpenCode CLI already has an OpenCode Go API key. Import it into VS Code?",
      "Import",
      "Open Console",
      "Cancel",
    );
    if (choice === "Import") {
      await saveKey(context, cliKey);
      return;
    }
    if (choice !== "Open Console") {
      return;
    }
  } else {
    const choice = await vscode.window.showInformationMessage(
      "No OpenCode Go key found in the OpenCode CLI. Create a personal API key in the Console, then paste it here.",
      "Open Console",
      "Cancel",
    );
    if (choice !== "Open Console") {
      return;
    }
  }

  await vscode.env.openExternal(vscode.Uri.parse(CONSOLE_KEYS_URL));
  const pasted = await vscode.window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    prompt: "OpenCode Go API key (oc_sk_...)",
  });
  if (pasted === undefined) {
    return;
  }
  const key = pasted.trim();
  if (!key) {
    await vscode.window.showErrorMessage("No API key entered. Nothing was saved.");
    return;
  }
  await saveKey(context, key);
}
