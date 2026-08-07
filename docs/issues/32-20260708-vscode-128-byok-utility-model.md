# Fix: VS Code 1.128 BYOK Utility Model Error

> **Status:** ✅ RESOLVED  
> **Date:** July 8, 2026  
> **Extension version:** 0.3.6  
> **Severity:** High — every background utility task (chat title generation, commit messages, intent detection) broken for all BYOK users after updating VS Code  
> **Root Cause:** VS Code 1.128 introduced `chat.byokUtilityModelDefault` with default value `"none"`, disabling utility models for BYOK extensions that do not explicitly configure one.

---

## Table of Contents

1. [Summary](#1-summary)
2. [Environment](#2-environment)
3. [VS Code 1.128 Breaking Change](#3-vs-code-1128-breaking-change)
4. [Investigation](#4-investigation)
5. [Successful Solution](#5-successful-solution)
6. [Technical Analysis](#6-technical-analysis)
7. [Code Changes](#7-code-changes)
8. [Prevention Recommendations](#8-prevention-recommendations)

---

## 1. Summary

After updating VS Code to **1.128.0** (released July 8, 2026), any user with a BYOK extension as the main chat model sees this error in the chat view:

```
No utility model is configured for 'copilot-utility-small' while the
selected main agent model is BYOK.
```

This error appears because VS Code 1.128 changed the default behavior: when a BYOK model is the main agent, VS Code **no longer falls back** to `copilot-utility-small` (GitHub Copilot's internal lightweight model) for background utility flows. Since our extension does not configure a utility model, VS Code fails with this error every time a background task is triggered (e.g., naming a new chat tab, auto-generating a commit message in Source Control, detecting intent).

The fix is to set `chat.byokUtilityModelDefault = "mainAgent"` in VS Code global settings. The extension does this **automatically** on activation.

> **Note:** The correct enum value is `"mainAgent"` — **not** `"mainModel"`. VS Code silently ignores invalid enum values (falls back to `"none"`), so this distinction is critical. The value was verified by grepping the VS Code 1.128 desktop bundle directly. See [§6 Technical Analysis](#6-technical-analysis).

---

## 2. Environment

| Component      | Version                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| VS Code        | **1.128.0** (stable, July 8, 2026)                                                     |
| OS             | macOS (Darwin arm64)                                                                   |
| Extension      | `ltmoerdani.opencode-copilot-chat` — affected on any version ≤0.3.5 without this patch |
| GitHub Copilot | Signed in (but BYOK model selected as main agent)                                      |

---

## 3. VS Code 1.128 Breaking Change

### New setting: `chat.byokUtilityModelDefault`

VS Code 1.128 introduced a new setting ([release notes](https://code.visualstudio.com/updates/v1_128#_configure-the-default-utility-model-for-byok)):

| Property         | Value                                  |
| ---------------- | -------------------------------------- |
| **Key**          | `chat.byokUtilityModelDefault`         |
| **Type**         | `string`                               |
| **Default**      | `"none"`                               |
| **Valid values** | `"none"` · `"mainAgent"` · `"copilot"` |

**Before 1.128:** When a BYOK model was the main agent, VS Code silently fell back to `copilot-utility-small` for utility tasks (title generation, commit messages, etc.).

**After 1.128:** The default is explicitly `"none"` — no utility model. Unless the user or extension configures one, all background utility tasks fail with the error above.

### Two other related settings (unchanged since earlier VS Code versions)

| Setting                  | Purpose                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.utilityModel`      | Override the model for general utility flows (titles, summaries, Git review). Takes precedence over `byokUtilityModelDefault`.                          |
| `chat.utilitySmallModel` | Override the model for fast lightweight flows (commit messages, rename suggestions, intent detection). Takes precedence over `byokUtilityModelDefault`. |

`chat.byokUtilityModelDefault` is a **blanket fallback** — it activates only when neither of the two explicit settings above is configured.

---

## 4. Investigation

### Root cause confirmation

VS Code 1.128 release notes ([§ Configure the default utility model for BYOK](https://code.visualstudio.com/updates/v1_128#_configure-the-default-utility-model-for-byok)) explicitly state:

> "The default behavior is that no utility models are used with BYOK models as the main agent. Background tasks such as chat title generation and commit message generation do not work unless this option is set."

This confirmed the error is a **platform behavior change**, not a bug in the extension's chat-completion logic.

### Choosing the correct remedy

Three possible remedies:

1. Set `chat.utilitySmallModel` to a specific OpenCode model ID → requires knowing the VS Code-internal model ID format, fragile if the user changes their default model.
2. Set `chat.utilityModel` to a specific OpenCode model ID → same problem.
3. Set `chat.byokUtilityModelDefault = "mainAgent"` → VS Code reuses whatever BYOK model is currently selected as the main agent. **No model ID needed. Robust.**

Option 3 was chosen because it is model-agnostic: it works regardless of which OpenCode model (GLM-5.2, DeepSeek, Qwen, etc.) the user has selected.

### Enum value verified from VS Code binary

The valid enum was extracted directly from the installed VS Code desktop bundle:

```bash
python3 -c "
import re
data = open('/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js','rb').read().decode('utf-8','ignore')
m = re.search(r'byokUtilityModelDefault.{0,800}', data)
if m: print(m.group())
"
```

Output (minified JS, formatted for readability):

```javascript
"chat.byokUtilityModelDefault": {
  type: "string",
  enum: ["none", "mainAgent", "copilot"],
  default: "none"
}
```

**Correct value: `"mainAgent"` (not `"mainModel"`, not `"main-agent"`).**

> This distinction matters because VS Code silently ignores unknown enum values — a wrong value writes to `settings.json` but VS Code falls back to `"none"` at runtime with no error. Always verify enum values from source, not from prose in release notes. See [§6](#6-technical-analysis) for full technical explanation.

### Verification after fix

```bash
python3 -c "
import json, os
path = os.path.expanduser('~/Library/Application Support/Code/User/settings.json')
data = json.loads(open(path).read())
print('chat.byokUtilityModelDefault:', repr(data.get('chat.byokUtilityModelDefault')))
"
# Expected output: chat.byokUtilityModelDefault: 'mainAgent'
```

Error resolved. Background tasks (chat title generation, commit messages, intent detection) work again.

---

## 5. Successful Solution

**Setting:** `chat.byokUtilityModelDefault = "mainAgent"` written to `ConfigurationTarget.Global` (user `settings.json`).

**Behavior:**

- On VS Code 1.128+, the extension checks if any utility model is already explicitly configured (`byokUtilityModelDefault`, `utilitySmallModel`, `utilityModel`).
- If none is configured (or if `byokUtilityModelDefault` is still `"none"`, the default), the extension automatically writes `"mainAgent"`.
- After the write, a one-time toast notification confirms what was changed.
- If the user has already configured any of the three settings to a non-default value, the extension leaves them untouched.

**Effect:** VS Code routes all background utility tasks (title generation, commit messages, intent detection, rename suggestions) to the user's currently-selected OpenCode BYOK model instead of failing.

---

## 6. Technical Analysis

### Why `"mainAgent"` works

`chat.byokUtilityModelDefault = "mainAgent"` tells VS Code's Copilot Chat extension: _"when a BYOK model is selected as main agent and a utility task needs a model, reuse the main agent model."_

This is the correct behavior for a BYOK-only extension like opencode-copilot-chat because:

- The user has already selected an OpenCode model as their main agent.
- Utility tasks (commit messages, etc.) are low-token, fast operations any model handles well.
- No separate model ID needs to be specified — VS Code resolves the model at call time from the current main agent selection.

### Why `"mainModel"` silently fails

VS Code processes configuration settings through a schema validator. When a `string` setting has an `enum` array and the provided value is not in the enum, VS Code:

1. Writes the value to `settings.json` as-is (no write error).
2. At runtime, reads the value and checks it against the enum.
3. If the value is not in the enum, falls back to `default` (`"none"`).
4. Logs nothing to the user.

This is the standard VS Code configuration behavior and is intentional — it prevents settings from becoming invalid after schema changes. But it means **invalid enum values fail silently**, which is why the first attempt appeared to "work" (the setting was written) while the error persisted.

### `isConfigured` guard logic

The function also guards against the VS Code default value `"none"` being treated as "already configured":

```typescript
const isConfigured =
  (byokDefault !== "" && byokDefault !== undefined && byokDefault !== "none") || ...
```

Without the `!== "none"` check, a fresh VS Code install that has never had `byokUtilityModelDefault` set would return `byokDefault = "none"` (the default), which would be incorrectly treated as "user already configured this" and skip the auto-fix.

---

## 7. Code Changes

**File:** `src/extension.ts`

### New function: `checkUtilityModelConfiguration(context)`

Added after `context.subscriptions.push(...)` in `activate()`, before `void warmModelPickerMetadata()`.

```typescript
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
```

### User agent string updated

```typescript
// Before
const OPEN_CODE_USER_AGENT = "opencode-copilot-chat/0.3.2 VSCode";

// After
const OPEN_CODE_USER_AGENT = "opencode-copilot-chat/0.3.5 VSCode";
```

### Call site in `activate()`

```typescript
// Added right after configuration change subscription, before warmModelPickerMetadata()
checkUtilityModelConfiguration(context);

void warmModelPickerMetadata();
```

---

## 8. Prevention Recommendations

### For extension developers targeting BYOK / Language Model Provider API

1. **Never guess enum values from prose documentation.** Always extract them from VS Code source or the installed binary:

   ```bash
   python3 -c "
   import re
   data = open('/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js','rb').read().decode('utf-8','ignore')
   m = re.search(r'SETTING_KEY.{0,600}', data)
   if m: print(m.group())
   "
   ```

2. **Test configuration writes in the Extension Development Host.** Invalid enum values don't throw — you must read back the effective value after writing to confirm VS Code accepted it.

3. **Watch VS Code release notes for BYOK-related changes.** The `chat.*` namespace is actively evolving. Subscribe to [VS Code release notes](https://code.visualstudio.com/updates) and filter for "BYOK", "utility model", and "language model provider".

4. **For any `chat.*` setting you auto-configure, always check the guard logic covers the default value.** VS Code returns the schema `default` (e.g., `"none"`) from `getConfiguration().get()` even if the user has never touched the setting — so `byokDefault !== ""` alone is insufficient as an "already configured" check.

### For users

If you see `"No utility model is configured for 'copilot-utility-small'"` after updating VS Code to 1.128:

1. Ensure the latest extension version is installed.
2. Reload VS Code window (`Cmd+Shift+P` → **Reload Window**).
3. The extension will auto-apply `chat.byokUtilityModelDefault = "mainAgent"` and show a brief toast.

If the error persists, check `settings.json` manually:

```bash
python3 -c "
import json, os
path = os.path.expanduser('~/Library/Application Support/Code/User/settings.json')
data = json.loads(open(path).read())
print(data.get('chat.byokUtilityModelDefault', '(not set)'))
"
```

Expected output: `mainAgent`. If it shows anything else, set it manually in VS Code Settings UI (search `chat.byokUtilityModelDefault`, select **Use main agent model**).
