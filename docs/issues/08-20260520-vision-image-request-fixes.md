**Status:** ✅ Solved

# Vision Image Requests — Attachment Capability, Encoding, Qwen Budget, and v0.1.5 Release

**Topic:** vision / image-input / provider / qwen / models / packaging / release  
**Updated:** 2026-05-20  
**Tags:** #vision #image-input #provider #qwen #models #vscode #packaging #thinking #release  
**Supersedes:** —

---

## Overview

This document records the full **2026-05-20 Asia/Jakarta** debugging and release-preparation session for image attachments in VS Code Copilot Chat when using OpenCode models.

The session had four separate findings:

1. Image requests initially failed inside the extension before reaching OpenCode because image bytes were encoded with a spread call that overflowed the JavaScript call stack.
2. After the encoding fix, requests reached OpenCode successfully, but `qwen3.5-plus` vision requests could still fail with provider-side Alibaba `429 insufficient_quota` when the request also forced a large Qwen `thinking_budget`.
3. `glm-5`, `glm-5.1`, MiniMax M2, and some MiMo Pro rows were incorrectly advertised to VS Code as `Vision` even though OpenCode metadata did not support image attachments for those model IDs.
4. Local test packages briefly used `0.1.6` and `0.1.7` while validating fixes, but the final marketplace release line was consolidated back into `0.1.5`.

All implementation fixes were compiled, locally packaged/installed for manual testing, consolidated into `0.1.5`, and merged from `develop` into `main` with a no-fast-forward merge.

This document is intentionally backdated to the original session date, **2026-05-20**, even though it was later organized during documentation cleanup.

---

## Session Timeline

### 1. 2026-05-20 — User Reported Vision Request Stack Overflow

**User symptom:**

When a model with vision support was used with an image attachment, Copilot Chat failed with:

```text
Sorry, your request failed. Please try again.
Reason: Maximum call stack size exceeded
```

The stack trace pointed to the installed extension bundle:

```text
convertMessage (.../.vscode/extensions/ltmoerdani.opencode-copilot-chat-0.1.4/out/extension.js:830:40)
OpenCodeProvider.provideLanguageModelChatResponse (.../out/extension.js:415:56)
```

**Initial code search:**

```bash
rg -n "convertMessage|provideLanguageModelChatResponse|vision|image|LanguageModelChat" -S .
rg --files
git status --short
```

**Finding:**

`convertMessage()` handled `vscode.LanguageModelDataPart` image input by converting bytes with:

```ts
btoa(String.fromCodePoint(...part.data));
```

This spreads every image byte as a separate function argument. For sufficiently large image attachments, JavaScript exceeds the maximum call stack / argument limit before the request can be sent to OpenCode.

**Status:** ✅ Solved in the `0.1.5` local build.

---

### 2. 2026-05-20 — Image Encoding Fix Implemented

**Fix:**

Replace the spread-based byte conversion with a `Buffer` conversion:

```ts
function dataPartToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
```

`convertMessage()` then uses:

```ts
const base64 = dataPartToBase64(part.data);
```

The outgoing content shape remained the same:

```ts
{
  type: "image_url",
  image_url: { url: `data:${part.mimeType};base64,${base64}` }
}
```

Only the encoding mechanism changed.

**Files changed:**

| File               | Change                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| `src/extension.ts` | Added `dataPartToBase64()` and used it for image `LanguageModelDataPart` conversion |
| `out/extension.js` | Rebuilt compiled extension output through TypeScript                                |

**Verification:**

```bash
npm run compile
rg -n "dataPartToBase64|String.fromCodePoint\\(\\.\\.\\.part\\.data\\)|image_url" src/extension.ts out/extension.js
```

**Result:**

The TypeScript compile passed, and the old `String.fromCodePoint(...part.data)` path was removed from the source and compiled output.

---

### 3. 2026-05-20 — Version `0.1.5` Packaged and Installed

**Version bump:**

```bash
npm version 0.1.5 --no-git-tag-version
```

**Changelog entry:**

`CHANGELOG.md` received a `0.1.5` entry:

```text
Fixed vision requests with image attachments failing before upload due to stack overflow while encoding image bytes.
```

**Packaging issue encountered:**

Running `npm run package` with Node `18.18.0` failed inside `vsce` dependencies:

```text
TypeError: (0 , j.tracingChannel) is not a function
Node.js v18.18.0
```

**Root cause:**

The installed `vsce` dependency chain used a newer `diagnostics_channel.tracingChannel` API that was unavailable in Node `18.18.0`.

**Resolution:**

Use a newer locally installed Node runtime for packaging. In this session, Homebrew Node `23.1.0` was available through `/opt/homebrew/opt/node`:

```bash
PATH=/opt/homebrew/opt/node/bin:$PATH npm run package
```

**Install command:**

The `code` CLI was not on the shell `PATH`, so the VS Code application bundle CLI was used directly:

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.1.5.vsix \
  --force
```

**Verification:**

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --list-extensions --show-versions | rg 'ltmoerdani\\.opencode-copilot-chat'
```

Expected installed version:

```text
ltmoerdani.opencode-copilot-chat@0.1.5
```

**Status:** ✅ `0.1.5` was packaged and installed for manual retest.

---

### 4. 2026-05-20 — Retest Reached Provider, Then Hit Alibaba Quota

After installing `0.1.5`, the user tested image input again. The failure changed from local stack overflow to an upstream provider response:

```text
[request] url=https://opencode.ai/zen/go/v1/chat/completions payloadBytes=117999
[http] 429 Too Many Requests content-type=application/json
```

The provider returned:

```json
{
  "error": {
    "message": "Error from provider (Alibaba): You exceeded your current quota, please check your plan and billing details.",
    "type": "insufficient_quota",
    "code": "insufficient_quota"
  }
}
```

**Important conclusion:**

The image encoding fix worked. The request now reached OpenCode and the Alibaba-backed provider. The remaining failure was not a stack overflow or request conversion bug; it was provider-side quota/token pressure.

**Observed request context:**

| Field                 | Value                         |
| --------------------- | ----------------------------- |
| Model                 | `qwen3.5-plus`                |
| Endpoint              | `/chat/completions`           |
| Image payload size    | about 118-121 KB JSON payload |
| Qwen thinking mode    | `auto`                        |
| Qwen thinking budget  | `16384`                       |
| Sent thinking payload | `{"thinking_budget":16384}`   |

Some retries returned `200 OK` and streamed tool calls, while later image/tool-history turns returned `429`. This indicated provider capacity/quota pressure rather than a deterministic local serialization crash.

---

### 5. 2026-05-20 — Qwen Vision Thinking Budget Mitigation

**Problem:**

For Qwen models, `thinking.qwen = "auto"` with `thinking.qwenBudget = "16384"` produced:

```json
{
  "thinking_budget": 16384
}
```

For text-only requests this can be useful, but image requests are already token-heavy. Sending a large thinking budget with a vision payload increases the chance of provider-side quota or token-limit failures.

**Fix:**

Add request-level image detection:

```ts
function messagesHaveImages(messages: readonly ApiMessage[]): boolean {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
}
```

Pass `hasImageInput` into `buildThinkingPayload()`:

```ts
const hasImageInput = messagesHaveImages(apiMessages);
const thinkingPayload = buildThinkingPayload(rawModelId, settings.thinking, hasImageInput);
```

When Qwen Thinking is `auto` and the request contains image input, keep `auto` truly automatic:

```ts
if (thinking.qwen === "auto") {
  if (hasImageInput) {
    return {};
  }
  return thinking.qwenBudget === "auto" ? {} : { thinking_budget: Number(thinking.qwenBudget) };
}
```

**Logging improvement:**

The request log now records whether the request contains image input:

```text
images=yes
```

For the fixed Qwen vision auto case, the expected log shape is:

```text
images=yes ... thinkingPayload={}
```

instead of:

```text
thinkingPayload={"thinking_budget":16384}
```

**Status:** ✅ Solved in the `0.1.6` local build.

---

### 6. 2026-05-20 — Version `0.1.6` Packaged and Installed

**Version bump:**

`package.json` and `package-lock.json` were temporarily bumped to `0.1.6` for local validation.

**Changelog entry:**

`CHANGELOG.md` received a `0.1.6` entry:

```text
Avoid forcing Qwen thinking_budget on vision requests when Thinking is set to Auto, reducing image request token pressure from Alibaba-backed models.
```

**Package and install:**

```bash
PATH=/opt/homebrew/opt/node/bin:$PATH npm run package

"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.1.6.vsix \
  --force
```

**Verification:**

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --list-extensions --show-versions | rg 'ltmoerdani\\.opencode-copilot-chat'
```

Expected installed version:

```text
ltmoerdani.opencode-copilot-chat@0.1.6
```

**Manual retest instruction:**

Reload the VS Code window before testing, then retry the same image request and check for:

```text
images=yes ... thinkingPayload={}
```

---

### 7. 2026-05-20 — GLM Report: `images=yes` but Model Could Not See Attachments

**User symptom:**

The user tested `glm-5` with a screenshot/image attachment. The request log showed image input:

```text
Request: model=opencodego:glm-5::naming-2026-05-17-a rawModel=glm-5 endpoint=chat-completions messages=4 images=yes ...
payloadBytes=606802
```

The provider returned `200 OK`, but the model answered as if no attachment existed:

```text
Maaf, tapi bagian <attachments> masih kosong — gambar belum berhasil terlampir.
```

**Initial conclusion:**

This was not another local upload failure. The payload contained an image (`images=yes`, large JSON payload), but the selected model did not actually support image input.

**Verification against metadata:**

`models.dev` metadata was queried for OpenCode model capabilities. For `glm-5` and `glm-5.1`, the OpenCode metadata showed:

```json
{
  "attachment": false,
  "modalities": {
    "input": ["text"]
  }
}
```

**Root cause:**

`VISION_CAPABLE_MODELS` incorrectly included:

```ts
"glm-5.1",
"glm-5",
```

That made VS Code advertise a `Vision` capability for GLM rows even though OpenCode marked both models as text-only. Copilot could therefore accept image attachments, but the model could not inspect them.

**Fix:**

Remove GLM from `VISION_CAPABLE_MODELS`.

**Status:** ✅ Solved.

---

### 8. 2026-05-20 — Full Attachment Capability Audit

After the GLM finding, the user requested a full audit of every model that was still advertised as `Vision`.

**Audit command shape:**

```bash
node - <<'NODE'
fetch('https://models.dev/api.json')
  .then(r => r.json())
  .then(j => {
    const ids = [
      'deepseek-v4-flash','deepseek-v4-pro','hy3-preview','glm-5','glm-5.1',
      'kimi-k2.5','kimi-k2.6','mimo-v2-omni','mimo-v2-pro','mimo-v2.5','mimo-v2.5-pro',
      'minimax-m2.5','minimax-m2.7','qwen3.5-plus','qwen3.6-plus',
      'big-pickle','deepseek-v4-flash-free','minimax-m2.5-free','nemotron-3-super-free','qwen3.6-plus-free'
    ];
    // Print provider attachment and modalities for each model ID.
  })
NODE
```

**Capability rule used for VS Code `Vision`:**

A model should be advertised as image-capable only when the relevant OpenCode provider metadata has both:

1. `attachment: true`
2. `modalities.input` containing `"image"`

**Models kept as `Vision`:**

| Model               | Reason                                                      |
| ------------------- | ----------------------------------------------------------- |
| `kimi-k2.5`         | OpenCode Go metadata supports image attachment              |
| `kimi-k2.6`         | OpenCode Go metadata supports image attachment              |
| `mimo-v2.5`         | OpenCode Go metadata supports image attachment              |
| `mimo-v2-omni`      | OpenCode Go metadata supports image attachment              |
| `qwen3.5-plus`      | OpenCode Go metadata supports image attachment              |
| `qwen3.6-plus`      | OpenCode Go/OpenCode Zen metadata supports image attachment |
| `qwen3.6-plus-free` | OpenCode Zen metadata supports image attachment             |

**Models removed from `Vision`:**

| Model               | Metadata finding                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `glm-5`             | `attachment: false`, input only `text`                                                        |
| `glm-5.1`           | `attachment: false`, input only `text`                                                        |
| `minimax-m2.5`      | OpenCode metadata `attachment: false`, input only `text`                                      |
| `minimax-m2.7`      | OpenCode metadata `attachment: false`, input only `text`                                      |
| `minimax-m2.5-free` | OpenCode Zen metadata `attachment: false`, input only `text`                                  |
| `mimo-v2-pro`       | OpenCode Go reported `attachment: true` but input modality only `text`; not valid image input |
| `mimo-v2.5-pro`     | OpenCode Go reported `attachment: true` but input modality only `text`; not valid image input |

**Final `VISION_CAPABLE_MODELS`:**

```ts
const VISION_CAPABLE_MODELS = new Set([
  "kimi-k2.6",
  "kimi-k2.5",
  "mimo-v2.5",
  "mimo-v2-omni",
  "qwen3.6-plus",
  "qwen3.6-plus-free",
  "qwen3.5-plus",
]);
```

**Cache bust:**

The model metadata revision was bumped so VS Code would treat the provider model registrations as new metadata:

```ts
const MODEL_METADATA_REVISION = "visionfix-2026-05-20-a";
```

**Status:** ✅ Solved.

---

### 9. 2026-05-20 — Why the Language Models View Did Not Update Immediately

After the source fix and compile, the user reloaded VS Code but still saw old `Vision` badges in the Language Models view.

**Finding:**

The compiled bundle in the repo had been updated, but the installed VS Code extension was still using the previously installed VSIX. A TypeScript compile alone does not update an installed VS Code extension.

**Checks used:**

```bash
rg -n "visionfix-2026-05-20-a|naming-2026-05-17-a|VISION_CAPABLE_MODELS" out src package.json
stat -f '%Sm %N' out/extension.js src/extension.ts
```

**Result:**

`out/extension.js` contained the new `VISION_CAPABLE_MODELS` set, but the active VS Code instance still needed an installed VSIX refresh and extension host reload.

**Status:** ✅ Diagnosed.

---

### 10. 2026-05-20 — Local Package/Install Validation and Node Version Issue

The user asked whether the build had actually been installed locally. It had only been compiled, so a VSIX package/install pass was performed.

**First packaging failure:**

```bash
npm run package
```

failed under Node `18.18.0`:

```text
TypeError: (0 , j.tracingChannel) is not a function
Node.js v18.18.0
```

**Root cause:**

The installed `vsce` dependency chain required a newer `diagnostics_channel.tracingChannel` API than Node `18.18.0` provided.

**Available local runtime:**

```bash
/opt/homebrew/opt/node -> ../Cellar/node/23.1.0_1
```

**Successful package command:**

```bash
PATH=/opt/homebrew/opt/node/bin:$PATH npm run package
```

**VS Code app bundle CLI:**

`code`, `code-insiders`, and `cursor` were not on the shell `PATH`, so the VS Code app bundle CLI was used:

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.1.6.vsix \
  --force
```

The extension was installed and verified:

```text
ltmoerdani.opencode-copilot-chat@0.1.6
```

Because the package version was still the same as the earlier local validation build, a temporary `0.1.7` package was then created to force a clearer local update:

```bash
PATH=/opt/homebrew/opt/node/bin:$PATH npm run package
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.1.7.vsix \
  --force
```

**Installed extension verification:**

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --locate-extension ltmoerdani.opencode-copilot-chat
```

Expected path:

```text
/Users/ltmoerdani/.vscode/extensions/ltmoerdani.opencode-copilot-chat-0.1.7
```

The installed `out/extension.js` was checked and contained:

```text
MODEL_METADATA_REVISION = "visionfix-2026-05-20-a"
```

and the cleaned `VISION_CAPABLE_MODELS` set.

**Status:** ✅ Local install verified.

---

### 11. 2026-05-20 — Final Marketplace Release Consolidated Back to `0.1.5`

After manual testing confirmed the behavior, the user requested that all updates be folded into version `0.1.5` for marketplace publishing.

**Version consolidation:**

`package.json` and `package-lock.json` were reset to:

```json
"version": "0.1.5"
```

**Changelog consolidation:**

Temporary `0.1.6` and `0.1.7` changelog sections were removed. The final `0.1.5` section contains all three vision-related fixes:

```text
- Fixed vision requests with image attachments failing before upload due to stack overflow while encoding image bytes.
- Avoid forcing Qwen thinking_budget on vision requests when Thinking is set to Auto, reducing image request token pressure from Alibaba-backed models.
- Stopped advertising image input support for models that do not support image attachments in OpenCode metadata: glm-5, glm-5.1, minimax-m2.5, minimax-m2.7, minimax-m2.5-free, mimo-v2-pro, and mimo-v2.5-pro.
```

**Compile verification:**

```bash
npm run compile
```

Expected output:

```text
> opencode-copilot-chat@0.1.5 compile
> tsc -p ./
```

**Compiled output verification:**

```bash
rg -n "\"version\": \"0.1.5\"|visionfix-2026-05-20-a|const VISION_CAPABLE_MODELS|dataPartToBase64|messagesHaveImages|thinking_budget" \
  package.json package-lock.json src/extension.ts out/extension.js CHANGELOG.md
```

**Result:** ✅ Source, lockfile, changelog, and compiled output were aligned to `0.1.5`.

---

### 12. 2026-05-20 — Changelog Entry Restored After Accidental Deletion

The user later deleted the `0.1.5` changelog entry and requested restoration.

**Finding:**

`CHANGELOG.md` had `Unreleased` followed immediately by `0.1.4`; the `0.1.5` section was missing.

**Fix:**

The `0.1.5` section was restored after `Unreleased` with the three consolidated fixes listed above.

**Verification:**

```bash
sed -n '1,24p' CHANGELOG.md
```

**Status:** ✅ Restored.

---

### 13. 2026-05-20 — No-FF Merge from `develop` to `main`

After the release-line work was complete, the user requested a no-fast-forward merge from `develop` to `main`.

**Pre-merge state:**

```text
## develop...origin/develop
```

`develop` contained:

```text
d0032ed feat: update version to 0.1.5; fix vision request handling and improve image input support
```

**Merge command:**

```bash
git checkout main
git merge --no-ff develop -m "Merge branch 'develop' into main"
```

**Merge result:**

```text
Merge made by the 'ort' strategy.
 CHANGELOG.md      |  8 ++++++++
 package-lock.json |  4 ++--
 package.json      |  2 +-
 src/extension.ts  | 42 ++++++++++++++++++++++++++----------------
```

**Final git state:**

```text
## main...origin/main [ahead 2]
```

Merge commit:

```text
66c8f5d Merge branch 'develop' into main
```

**Status:** ✅ Merged locally. Not pushed during the session.

---

## Root Cause Summary

| Issue                                                                | Root Cause                                                                                                                     | Fix                                                                                 | Status       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------ |
| Local stack overflow before request upload                           | `String.fromCodePoint(...part.data)` spread all image bytes as function arguments                                              | Use `Buffer.from(data).toString("base64")`                                          | ✅ Solved    |
| Provider `429 insufficient_quota` after encoding fix                 | Vision payload plus forced Qwen `thinking_budget=16384` increased provider token/quota pressure                                | Suppress Qwen `thinking_budget` for image requests when Thinking mode is `auto`     | ✅ Mitigated |
| GLM accepted image payloads but could not inspect them               | Extension advertised `glm-5` / `glm-5.1` as vision-capable despite OpenCode metadata `attachment: false` and input only `text` | Remove GLM from `VISION_CAPABLE_MODELS`                                             | ✅ Solved    |
| Some MiniMax/MiMo Pro rows incorrectly showed `Vision`               | Metadata either had `attachment: false` or no `"image"` input modality                                                         | Keep `Vision` only when OpenCode metadata supports image attachment and image input | ✅ Solved    |
| VS Code Language Models view still showed old badges after compile   | Installed VSIX/extension host still used old provider registration                                                             | Package/install VSIX and reload VS Code; bump model metadata revision               | ✅ Solved    |
| `vsce package` failed locally                                        | Node `18.18.0` lacked `diagnostics_channel.tracingChannel` used by dependency chain                                            | Package with newer local Homebrew Node `23.1.0`                                     | ✅ Solved    |
| `code` CLI unavailable in shell PATH                                 | VS Code CLI command was not installed into PATH                                                                                | Invoke app-bundled CLI directly                                                     | ✅ Solved    |
| Temporary validation versions did not match desired marketplace line | Local testing used `0.1.6` and `0.1.7` while the user wanted the marketplace update as `0.1.5`                                 | Consolidate package/lock/changelog back to `0.1.5` and recompile                    | ✅ Solved    |

---

## Files Changed

| File                                                    | Purpose                                                                                                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                                      | Image byte encoding fix, image-input detection, Qwen vision auto-thinking budget mitigation, request log image marker, corrected `VISION_CAPABLE_MODELS`, metadata revision cache bust |
| `package.json`                                          | Final marketplace version consolidated to `0.1.5`                                                                                                                                      |
| `package-lock.json`                                     | Final root lockfile version consolidated to `0.1.5`                                                                                                                                    |
| `CHANGELOG.md`                                          | Final `0.1.5` release notes contain all image/vision fixes                                                                                                                             |
| `out/extension.js`                                      | Compiled bundle rebuilt for VSIX packaging                                                                                                                                             |
| `docs/issues/08-20260520-vision-image-request-fixes.md` | Backdated session record for the complete image/vision fix and release workflow                                                                                                        |
| `docs/devlog.md`                                        | Work-context log updated with the final status                                                                                                                                         |

The behavior remains visible in `src/extension.ts` through `dataPartToBase64()`, `messagesHaveImages()`, `buildThinkingPayload(..., hasImageInput)`, and the cleaned `VISION_CAPABLE_MODELS` set.

---

## Verification Commands

Commands used during the session:

```bash
npm run compile
PATH=/opt/homebrew/opt/node/bin:$PATH npm run package
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension opencode-copilot-chat-0.1.7.vsix --force
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --list-extensions --show-versions | rg 'ltmoerdani\\.opencode-copilot-chat'
rg -n "dataPartToBase64|messagesHaveImages|buildThinkingPayload|thinking_budget|VISION_CAPABLE_MODELS|visionfix-2026-05-20-a" src/extension.ts out/extension.js
rg -n "\"version\": \"0.1.5\"" package.json package-lock.json
git checkout main
git merge --no-ff develop -m "Merge branch 'develop' into main"
```

Expected results:

| Check                      | Expected                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Compile                    | Passes                                                                                            |
| VSIX package               | Local validation VSIX is created successfully with newer Node                                     |
| Installed extension        | Local validation install shows the expected extension version                                     |
| Final release metadata     | `package.json` and `package-lock.json` show `0.1.5`                                               |
| Stack overflow             | No longer occurs for image byte conversion                                                        |
| Qwen image + auto thinking | Logs `images=yes` and omits `thinking_budget`                                                     |
| Vision capability list     | Only Kimi K2.5/K2.6, MiMo V2.5/Omni, Qwen3.5/3.6 Plus, and Qwen3.6 Plus Free show image support   |
| Merge                      | `main` contains a no-fast-forward merge from `develop` and is ahead of `origin/main` until pushed |

---

## Follow-Up Guidance

If image requests still fail after these fixes:

1. Check whether the output log shows `images=yes`.
2. Check whether `thinkingPayload={}` for Qwen Thinking `auto`.
3. Confirm the selected model is still in `VISION_CAPABLE_MODELS`.
4. If the model is GLM, MiniMax M2, MiMo V2 Pro, or MiMo V2.5 Pro, do not expect image inspection from this extension because the model is no longer advertised as image-capable.
5. If the error remains `429 insufficient_quota`, treat it as provider/account/model quota rather than a local image encoding bug.
6. Try a smaller image, a non-Qwen vision-capable model, or Qwen Thinking `off`.
7. Keep the stack overflow fix separate from provider quota analysis; the first is local serialization, the second is upstream capacity.

---

## Security Notes

- No API keys or credentials were recorded.
- Provider request IDs and error bodies are safe to keep for debugging.
- The documented payload sizes are byte counts only, not request bodies.
