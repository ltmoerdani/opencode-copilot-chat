<div align="center">

# 🚀 OpenCode for GitHub Copilot Chat

## Use **30+ frontier AI models** (DeepSeek V4, Kimi K2.6, GLM-5.1, GPT-5.5, Claude Opus 4.7, Gemini 3.5, Grok…) in GitHub Copilot Chat — **BYOK**

**Bring Your Own Key (BYOK)** · OpenCode Zen (free + paid models) or Go ($10/mo subscription) · Works with native Copilot Agent Mode

[![CI](https://github.com/ltmoerdani/opencode-copilot-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/ltmoerdani/opencode-copilot-chat/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/badge/Install-VS%20Code%20Marketplace-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=ltmoerdani.opencode-copilot-chat)
[![Version](https://img.shields.io/github/v/release/ltmoerdani/opencode-copilot-chat?label=Version&color=6c47ff)](https://github.com/ltmoerdani/opencode-copilot-chat/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.118%2B-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen)](./CONTRIBUTING.md)
[![Stars](https://img.shields.io/github/stars/ltmoerdani/opencode-copilot-chat?style=social)](https://github.com/ltmoerdani/opencode-copilot-chat)

[**✨ Why you'll love it**](#-why-youll-love-it) · [**⚡ Quick Start (60 sec)**](#-quick-start-60-sec) · [**🧠 Models**](#-models) · [**📊 Compare**](#-github-copilot-vs-this-extension) · [**🔧 Settings**](#-settings) · [**❓ FAQ**](#-faq) · [**💬 Community**](#-community)

</div>

---

> ### 💡 The elevator pitch
>
> **Copilot Chat is great — but its premium models cost $39/mo (Pro+), and the free tier is rate-limited.**
> This extension plugs **OpenCode's model gateway** into Copilot Chat's model picker. **OpenCode Zen** gives you 2-5 rotating free models (Big Pickle is always free; DeepSeek V4 Flash, MiMo-V2.5, and others rotate) plus paid models like Claude Opus, GPT-5.5, and Gemini at pay-as-you-go rates. **OpenCode Go** ($10/mo, $5 first month promo) gives you a curated set of open models (DeepSeek V4 Pro, Kimi K2.6, GLM-5.1, Qwen3.7 Max, MiMo V2.5 Pro) with generous usage limits. You keep the native Copilot UI, tool-calling, and Agent Mode — you just get **way more models**, often **cheaper than Copilot Pro+**.

---

## 🔥 Why you'll love it

|                                  | What you get                                                                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 💸 **Cheaper than Copilot Pro+** | Copilot Free + OpenCode **Zen free** models = **$0** for 2-5 rotating models (Big Pickle always free; DeepSeek V4 Flash, MiMo-V2.5, and others rotate). Paid Zen models (Claude Opus, GPT-5.5) available at pay-as-you-go rates. Go subscription **$10/mo** ($5 first month) |
| 🌍 **30+ frontier models**       | DeepSeek V4, Kimi K2.6, GLM-5.1, Qwen3.7 Max, MiMo V2.5, MiniMax M2.7, Big Pickle, Nemotron — **all in one picker**                                                                                                                                                          |
| 🤖 **Full Agent Mode**           | Tool-calling (read files, edit, run terminal) works natively — not just chat. Models also appear in the **Agents window** (Copilot CLI session)                                                                                                                              |
| 🧠 **Thinking controls**         | Per-model reasoning effort (DeepSeek `max`, Qwen `thinking_budget`, MiniMax `on/off`, Mimo `low/med/high`)                                                                                                                                                                   |
| 🖼️ **Vision proxy**              | Text-only models can "see" images via a configured vision model. Run **OpenCode Go: Configure Vision Proxy** from the Command Palette to set it up.                                                                                                                          |
| 📊 **Live usage tracking**       | Status bar shows Go subscription burn-rate across 5h / weekly / monthly tiers                                                                                                                                                                                                |
| 🔌 **Dual providers**            | OpenCode **Go** ($10/mo subscription) + OpenCode **Zen** (free + paid models) — run both at once, switch instantly                                                                                                                                                           |
| 🎯 **Smart routing**             | Each model family auto-routes to its native transport (`/responses`, `/messages`, `streamGenerateContent`, `/chat/completions`)                                                                                                                                              |
| 🖼️ **Vision + PDF + Audio**      | Multimodal models pass through image, PDF, audio, and video inputs                                                                                                                                                                                                           |
| 🔒 **Your key, your control**    | API key stored in VS Code SecretStorage — never leaves your machine                                                                                                                                                                                                          |

---

## ⚡ Quick Start (60 sec)

```text
1.  Install GitHub Copilot Chat (free) ──────────────────────────── ✓
2.  Install this extension ──────────────────────────────────────── ✓
3.  Get an OpenCode Zen API key → opencode.ai/auth ─────────────── ✓
4.  Open Copilot Chat → click model → "Add Models" → OpenCode Zen ── ✓
5.  Paste API key → pick a free model → CHAT 🎉
```

<details>
<summary><b>📖 Detailed step-by-step with screenshots</b></summary>

1. **Install [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat)** — free, requires only a GitHub account.
2. **Install this extension** from the VS Code Marketplace (or press `F5` in this repo for dev mode).
3. **Get an API key:**
   - **Free models:** Sign up at [opencode.ai](https://opencode.ai) → grab an **OpenCode Zen** key. 2-5 models are truly free (Big Pickle is always free; DeepSeek V4 Flash Free, MiMo-V2.5 Free, and others rotate).
   - **Paid Zen models (optional):** Add a payment method to your Zen account to unlock Claude Opus, GPT-5.5, Gemini, and other paid models at pay-as-you-go rates. Adding $20+ balance also improves rate limits on free models.
   - **OpenCode Go (optional):** Subscribe to **OpenCode Go** ($10/mo, $5 first month promo) for curated open models like DeepSeek V4 Pro, Kimi K2.6, GLM-5.1, Qwen3.7 Max, MiMo V2.5 Pro.
4. **Open Copilot Chat** (Cmd/Ctrl+Shift+I, or click the Copilot icon).
5. **Click the model picker** (current model name) → **Add Models…**
6. **Select** **OpenCode Go** or **OpenCode Zen**.
7. **Press Enter** to accept the default group name.
8. **Paste your API key** when prompted (stored securely in VS Code SecretStorage).
9. **Pick the models** you want enabled.
10. **Select any OpenCode model** from the picker and start chatting. 🚀

> **💡 Tips:**
>
> - Go and Zen are **separate provider groups** — both can be active simultaneously. Switch anytime from the picker.
> - If a model shows in **Language Models** view but not the chat picker, hover its row and click the **eye icon (👁)** to enable it.
> - Set `opencodego.freeOnly: false` to reveal **paid Zen models** in the picker.

</details>

---

## 🎬 Demo

<p align="center">
  <img src="docs/screenshots/model-picker.gif" alt="Copilot Chat model picker showing OpenCode models" width="480" />
</p>

_Selecting an OpenCode model from the Copilot Chat model picker._

---

## 🧠 Models

The extension fetches **live model lists** on every startup from:

| Provider         | Endpoint                               | Cost                                                                          |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| **OpenCode Go**  | `https://opencode.ai/zen/go/v1/models` | $10/mo ($5 first month promo) — usage limits: 5h/$12, weekly/$30, monthly/$60 |
| **OpenCode Zen** | `https://opencode.ai/zen/v1/models`    | 2-5 rotating free models + pay-as-you-go for premium models                   |

### ⭐ OpenCode Go (subscription — $10/mo, $5 first month promo)

| Model                                   |       Context | Max Output | Highlights                  |
| --------------------------------------- | ------------: | ---------: | --------------------------- |
| `deepseek-v4-pro` / `deepseek-v4-flash` | **1,000,000** |    384,000 | 🧠 Reasoning `off`→`max`    |
| `qwen3.7-max`                           | **1,000,000** |     65,536 | 🧠 `thinking_budget` 4K–82K |
| `mimo-v2.5-pro` / `mimo-v2-pro`         | **1,048,576** |    128,000 | 🧠 Effort `low`→`high`      |
| `mimo-v2.5`                             | **1,000,000** |    128,000 | Fast & cheap                |
| `kimi-k2.6` / `kimi-k2.5`               |       262,144 |     65,536 | 🧠 `on`/`off`               |
| `minimax-m3`                            |       512,000 |    131,072 | 🧠 `on`/`off`               |
| `minimax-m2.7` / `minimax-m2.5`         |       204,800 |    131,072 | 🧠 `on`/`off`               |
| `minimax-m2.1` / `minimax-m2`           |       204,800 |    131,072 | 🧠 `on`/`off`               |
| `glm-5.1` / `glm-5`                     |       202,752 |     32,768 | 🧠 `on`/`off`               |
| `hy3-preview`                           |       256,000 |     64,000 | Preview                     |
| `ring-2.6-1t`                           |       262,000 |     66,000 | Large context               |

### 🆓 OpenCode Zen — Free models (no payment needed)

OpenCode Zen offers **2-5 rotating free models** — no balance required. **Big Pickle is always free**; other models rotate (DeepSeek V4 Flash Free, MiMo-V2.5 Free, Nemotron, etc.). Without a balance, rate limits are low. Adding $20+ to your Zen balance significantly improves rate limits on free models.

> **Note:** Free models rotate periodically. The table below shows current offerings, but availability may change. Big Pickle is the only model guaranteed to always be free.

| Model                    | Context | Max Output | Vendor                       |
| ------------------------ | ------: | ---------: | ---------------------------- |
| `big-pickle`             | 200,000 |    128,000 | 🥒 Mystery box (always free) |
| `deepseek-v4-flash-free` | 200,000 |    128,000 | DeepSeek                     |
| `mimo-v2.5-free`         | 200,000 |    128,000 | Xiaomi                       |
| `nemotron-3-super-free`  | 204,800 |    128,000 | NVIDIA                       |
| `north-mini-code-free`   | 131,072 |    131,072 | Cohere                       |

### 💰 OpenCode Zen — Paid models (requires balance)

Add a payment method to your Zen account to unlock these models at pay-as-you-go rates.

| Model                                                    |           Context | Max Output | Input / Output per 1M tokens |
| -------------------------------------------------------- | ----------------: | ---------: | ---------------------------- |
| `claude-opus-4-7` / `claude-opus-4-6`                    |     **1,000,000** |    128,000 | $5 / $25                     |
| `claude-sonnet-4-6` / `claude-sonnet-4-5`                |     **1,000,000** |     64,000 | $3 / $15                     |
| `claude-haiku-4-5`                                       |           200,000 |     64,000 | $1 / $5                      |
| `gpt-5.5` / `gpt-5.5-pro`                                |     **1,050,000** |    128,000 | $5 / $30                     |
| `gpt-5.4` / `gpt-5.4-pro` / `gpt-5.4-mini`               | 400,000–1,050,000 |    128,000 | $0.75–$30 / $4.50–$180       |
| `gpt-5.3-codex` / `gpt-5.2`                              |           400,000 |    128,000 | $1.75 / $14                  |
| `gpt-5.1` / `gpt-5` / `gpt-5-nano`                       |           400,000 |    128,000 | $0.05–$1.07 / $0.40–$8.50    |
| `gemini-3.5-flash` / `gemini-3.1-pro` / `gemini-3-flash` |     **1,048,576** |     65,536 | $0.50–$4 / $3–$18            |
| `grok-build-0.1`                                         |           256,000 |    256,000 | $1 / $2                      |
| `qwen3.7-max` / `qwen3.6-plus` / `qwen3.5-plus`          | 262,144–1,000,000 |     65,536 | $0.20–$7.50                  |
| `deepseek-v4-pro` / `deepseek-v4-flash`                  |     **1,000,000** |    384,000 | $0.14–$3.48                  |
| `kimi-k2.6` / `kimi-k2.5`                                |           262,144 |     65,536 | $0.60–$4.00                  |
| `glm-5.1` / `glm-5`                                      |           202,752 |     32,768 | $1.00–$4.40                  |
| `minimax-m2.7` / `minimax-m2.5`                          |           204,800 |    131,072 | $0.30 / $1.20                |

> Set `opencodego.freeOnly: false` to show paid Zen models in the picker (default shows only free models).

<details>
<summary><b>🔬 How model metadata is resolved (3-tier fallback)</b></summary>

Limits and capabilities resolve in this priority order:

1. **Live metadata** from OpenCode `/models` endpoint
2. **6-hour models.dev snapshot** cached in VS Code `globalState`
3. **Bundled fallback catalog** shipped with the extension (works offline)

Deprecated/unavailable models are filtered before registration. Per-provider limits tracked separately (Go vs Zen) so shared models (e.g. `glm-5.1`, `qwen3.6-plus`) use correct values for each.

</details>

<details>
<summary><b>🛣️ Endpoint routing per model family</b></summary>

| Family                                                | Endpoint                         | Why                  |
| ----------------------------------------------------- | -------------------------------- | -------------------- |
| Zen GPT (`gpt-*`)                                     | `/responses`                     | OpenAI native        |
| Zen Gemini (`gemini-*`)                               | `:streamGenerateContent?alt=sse` | Google native        |
| Zen Claude (`claude-*`) + Go MiniMax (`minimax-m2.*`) | `/messages`                      | Anthropic-compatible |
| Everything else (Qwen, DeepSeek, GLM, Kimi, MiMo…)    | `/chat/completions`              | OpenAI-compatible    |

All Qwen models use `/chat/completions` because they use OpenAI-native tool-calling format. Routing to Anthropic `/messages` broke tool calls.

</details>

---

## 📊 GitHub Copilot vs This Extension

GitHub Copilot has four tiers now — **Free**, **Pro ($10/mo)**, **Pro+ ($39/mo)**, and **Max ($100/mo)**. Here's how BYOK via OpenCode compares:

|                                  | **Copilot Free**                          | **Copilot Pro $10/mo**                 | **Copilot Pro+ $39/mo**    | **OpenCode for Copilot Chat**                                                                                 |
| -------------------------------- | ----------------------------------------- | -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 💰 **Cost**                      | $0                                        | $10/mo                                 | $39/mo                     | **$0** with free Zen models · Go is **$10/mo** subscription                                                   |
| 🤖 **Models**                    | GPT-5 mini, Haiku 4.5 (2,000 completions) | Pro catalog + Claude Code/Codex agents | Premium (Opus)             | **30+ models**: DeepSeek V4, Kimi K2.6, GLM-5.1, Qwen3.7, MiMo V2.5, MiniMax M2.7, + 2-5 rotating free models |
| 🧠 **Reasoning controls**        | —                                         | Per-model (GitHub decides)             | Per-model (GitHub decides) | **Per-family thinking effort** you control (DeepSeek `max`, Qwen `thinking_budget`, etc.)                     |
| 🖼️ **Multimodal**                | Limited                                   | Yes (limited)                          | Yes (limited)              | **Vision + PDF + Audio + Video** (per-model)                                                                  |
| 🔧 **Agent Mode / tool-calling** | —                                         | ✅                                     | ✅                         | ✅ **Full** (read, edit, terminal)                                                                            |
| 📊 **Usage transparency**        | Opaque                                    | Opaque                                 | Audit logs                 | **Status bar burn-rate** + diagnostics report                                                                 |
| 🔌 **Provider**                  | GitHub only                               | GitHub only                            | GitHub only                | **Bring any OpenCode key** — Go ($10/mo subscription) or Zen (free + paid), run both at once                  |
| 🎁 **Free frontier models?**     | ❌                                        | ❌                                     | ❌ (paid tier only)        | ✅ **2-5 rotating free models** via Zen (Big Pickle always free)                                              |
| 🚫 **Rate limit**                | 2,000 completions/mo                      | Unlimited (rate-limited)               | 4× Pro credits             | Per OpenCode tier (Zen free has low limits without balance; Go has generous limits)                           |

> **Not a replacement** — this extension _extends_ Copilot Chat. You still need the (free) Copilot Chat extension + a GitHub account. BYOK models bypass the Copilot subscription billing entirely — you pay OpenCode directly (or nothing, on Zen free).

### 💡 When to use which?

- **Copilot Free + OpenCode Zen** → **$0 total**. Best for students, hobbyists, and trying frontier models.
- **Copilot Pro + OpenCode Go** → $10/mo for Copilot's polish + $10/mo for DeepSeek Pro, Kimi K2.6, Qwen3.7 Max.
- **This extension alone** → Already works with just Copilot Free. Keep Copilot for autocomplete, use OpenCode models for chat/agent when you need variety or free tier.

---

## ✨ Features Deep Dive

### 🧠 Thinking & Reasoning Controls

Per-model reasoning configuration, dynamically enhanced with `reasoning_options` from `models.dev`:

| Family                         | Options                                                | Setting                                    |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------ |
| **DeepSeek**                   | `off` / `low` / `medium` / `high` / `max`              | `opencodego.thinking.deepseek`             |
| **GLM**                        | `on` / `off`                                           | `opencodego.thinking.glm`                  |
| **Kimi**                       | `on` / `off`                                           | `opencodego.thinking.kimi`                 |
| **MiniMax**                    | `off` / `on`                                           | `opencodego.thinking.minimax`              |
| **Mimo (Xiaomi)**              | `off` / `low` / `medium` / `high`                      | `opencodego.thinking.mimo`                 |
| **Qwen**                       | `auto` / `on` / `off` + `thinking_budget` (4096–81920) | `opencodego.thinking.qwen` + `.qwenBudget` |
| **Any future reasoning model** | `off` / `on` (auto-detected from `models.dev`)         | —                                          |

> **`opencodego.debugReasoning`** — writes provider `reasoning_content` to **Output → OpenCode** for debugging.

### 📊 Usage Tracking

- **Go Usage Tracker** — real-time burn-rate of OpenCode Go subscription:
  - Tracks **5-hour rolling** ($12), **weekly** ($30), **monthly** ($60) tiers.
  - Client-side cost calc: token usage × per-model pricing (input/output/cache_read).
  - Status bar: `Go: 27%·62%·75%` — ⚠ warning when any tier exceeds 80%.
  - Persisted in VS Code `globalState` — survives restarts.
- **Response usage bar** — latest prompt/output/total/cache summary after each response.
- **Normalized usage DataPart** — emits `usage` MIME so Copilot Chat's context widget shows accurate token counts.

#### Multiple Go accounts

You can use more than one OpenCode Go account in the same VS Code window.
When a **second** Go API key is added via the Manage Language Models panel,
the extension creates a new usage profile ("Profile 1", "Profile 2", etc.)
on the first request made with each key.

- **Auto-switch** — the status bar and SVG hover card follow the model you
  last used. If you chat with a model from a different account, the panel
  switches automatically.
- **QuickPick** — click the status bar to see which profile is active and
  switch to another profile.
- **Commands** — `OpenCode Go: Rename Active Profile` and `OpenCode Go:
Delete Active Profile` help you manage your profiles. The label you give
  a profile appears in the status bar and SVG title.
- **Storage isolation** — each profile has its own `globalState` storage
  namespace (`opencodego.usageLog.v1.<fingerprint>`) so data never mixes.
- **SQLite** — when 2+ profiles exist, the extension does not consult the
  shared `opencode.db` (which is per-machine and cannot be attributed to a
  specific API key). Accuracy falls back to in-memory entries for
  multi-account setups.

> **Upgrading from a single-account install?** Your existing usage data
> is migrated into Profile 1 the first time a second profile is created.
> Your original stats are preserved — nothing is lost.

### 🪟 Agents Window (Copilot CLI) Support

OpenCode models appear in the VS Code **Agents window** model picker when starting a Copilot CLI / Background agent session — not just the regular Chat view. Two sets of models are available:

| Provider                                 | Appears under | Notes                                                                                                                                                        |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `opencodego` / `opencodezen`             | **Local**     | Normal models, no `targetChatSessionType`. From VS Code ≥1.126 they appear naturally in the Local section (once the extension loads in the sessions window). |
| `opencodego-agent` / `opencodezen-agent` | **Copilot**   | Agent variants with `targetChatSessionType: "copilotcli"`. Picked up by `CopilotChatSessionsProvider` for agent sessions.                                    |

**How it works:**

| Setting                                   | Default | What it controls                                        |
| ----------------------------------------- | ------- | ------------------------------------------------------- |
| `opencodego.agentsWindow`                 | `true`  | Registers agent-host providers at runtime               |
| `opencodego.showAgentModelsInManagePanel` | `false` | Shows agent vendors in the Manage Language Models panel |

**Setup:**

1. Agent models are enabled by default (`agentsWindow: true`). No changes needed for basic usage.
2. Add this to your VS Code `settings.json` to enable the extension in the Agents window process:

   ```json
   "extensions.supportAgentsWindow": {
     "ltmoerdani.opencode-copilot-chat": true
   }
   ```

3. Reload the window (`Developer: Reload Window`).
4. Open the **Agents window** → start a new session → select **Copilot CLI** as the agent type.
5. Open the model picker — OpenCode models appear under **Local** (normal models) and **Copilot** (agent-host variants).

Normal OpenCode models (`opencodego`, `opencodezen`) appear in the **Local** section of the Agents window picker from VS Code ≥1.126 onwards. On ≤1.125 they may require the `supportAgentsWindow` setting. Agent-host variants (`opencodego-agent`, `opencodezen-agent`) appear under **Copilot** because they carry `targetChatSessionType: "copilotcli"` and are matched by `CopilotChatSessionsProvider`.

To manage agent API keys separately or see agent vendors in the Manage panel, enable:

```json
"opencodego.showAgentModelsInManagePanel": true
```

### 🛠️ Smart Routing & Reliability

- **Native endpoint routing** per family (see [Models](#-models) table)
- **Tool-calling** forwarded in correct format per endpoint (OpenAI `tool_calls` vs Anthropic `tool_use`)
- **Sticky gateway headers** (`x-opencode-session`, `x-opencode-request`, `x-opencode-client`) for affinity
- **Request & stream timeouts** — defaults 600s total / 120s idle; configurable
- **`ground` tag filtering** — `opencodego.stripThinkTags` (`auto` strips MiniMax only, `always`, `never`)

### 🔍 Diagnostics

| Command                              | What it does                                                |
| ------------------------------------ | ----------------------------------------------------------- |
| `OpenCode Go: Diagnostics`           | Markdown report of all Go models + recent request summaries |
| `OpenCode Zen: Diagnostics`          | Same for Zen                                                |
| `OpenCode: Model Picker Diagnostics` | All registered models (Go + Zen + Copilot) side-by-side     |

---

## 🔧 Settings

| Setting                                   | Default  | Description                                                                      |
| ----------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `opencodego.temperature`                  | `0.2`    | Sampling temperature (`0`–`2`)                                                   |
| `opencodego.maxTokens`                    | `0`      | Max output token override (`0` = per-model max)                                  |
| `opencodego.maxInputTokens`               | `0`      | Context window override (`0` = per-model default)                                |
| `opencodego.debugReasoning`               | `false`  | Log `reasoning_content` to Output panel                                          |
| `opencodego.requestTimeoutSeconds`        | `600`    | Total request timeout                                                            |
| `opencodego.streamIdleTimeoutSeconds`     | `120`    | Cancel if stream goes idle                                                       |
| `opencodego.showUsageStatusBar`           | `true`   | Show usage summary in status bar                                                 |
| `opencodego.showProviderPrefix`           | `true`   | Include `OpenCode Go` / `OpenCode Zen` in model names                            |
| `opencodego.freeOnly`                     | `true`   | Zen: free models only. `false` = include paid                                    |
| `opencodego.agentsWindow`                 | `true`   | Expose agent-host model variants (`targetChatSessionType`) for the Agents window |
| `opencodego.showAgentModelsInManagePanel` | `false`  | Show agent vendors in Manage Language Models panel                               |
| `opencodego.stripThinkTags`               | `"auto"` | Strip `<think>` tags (`never`/`auto`/`always`)                                   |
| `opencodego.thinking.deepseek`            | `"off"`  | `off`/`low`/`medium`/`high`/`max`                                                |
| `opencodego.thinking.glm`                 | `"off"`  | `on`/`off`                                                                       |
| `opencodego.thinking.kimi`                | `"off"`  | `on`/`off`                                                                       |
| `opencodego.thinking.minimax`             | `"off"`  | `off`/`on`                                                                       |
| `opencodego.thinking.mimo`                | `"off"`  | `off`/`low`/`medium`/`high`                                                      |
| `opencodego.thinking.qwen`                | `"off"`  | `auto`/`on`/`off`                                                                |
| `opencodego.thinking.qwenBudget`          | `"auto"` | `auto`/`4096`/`16384`/`32768`/`81920`                                            |

<details>
<summary><b>📜 Full settings reference with descriptions</b></summary>

All settings live under the **OpenCode** namespace in VS Code Settings. Run **Preferences: Open Settings (UI)** and search `opencode`.

</details>

---

## 🎛️ Commands

The easiest way to manage your key is **Settings → Language Models** (gear ⚙). For advanced use, open the Command Palette (`Cmd/Ctrl+Shift+P`):

| Command                              | Description                                                   |
| ------------------------------------ | ------------------------------------------------------------- |
| `OpenCode Go: Manage Provider`       | Manage legacy API key, refresh models, test connection        |
| `OpenCode Go: Set API Key`           | Store/update legacy OpenCode Go API key                       |
| `OpenCode Go: Refresh Models`        | Force a fresh model-list fetch (bypasses the Manage menu)     |
| `OpenCode Go: Diagnostics`           | Report of Go models + request history                         |
| `OpenCode Zen: Manage Provider`      | Manage Zen API key, refresh models, test connection           |
| `OpenCode Zen: Refresh Models`       | Force a fresh Zen model-list fetch (bypasses the Manage menu) |
| `OpenCode Zen: Diagnostics`          | Report of Zen models + request history                        |
| `OpenCode: Model Picker Diagnostics` | All registered models (Go + Zen + Copilot) side-by-side       |
| `OpenCode: Set Thinking Effort…`     | Per-family thinking mode picker                               |
| `OpenCode Go: Show Usage Details`    | Detailed Go subscription usage breakdown                      |

---

## ❓ FAQ

<details>
<summary><b>Do I need Copilot Pro, Pro+, or Max?</b></summary>

**No.** You only need the free [GitHub Copilot Chat extension](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) and any GitHub account — even the **Copilot Free** tier works. BYOK models bypass Copilot's subscription billing entirely.

If you already pay for Copilot Pro ($10), Pro+ ($39), or Max ($100), you can still use this extension alongside it — keep Copilot for autocomplete, switch to OpenCode models in chat when you want variety, free tier, or specific models GitHub doesn't offer.

</details>

<details>
<summary><b>Is it really free? What's the catch?</b></summary>

**OpenCode Zen** offers **2-5 rotating free models** — no balance required. **Big Pickle is always free**; other models rotate (DeepSeek V4 Flash Free, MiMo-V2.5 Free, Nemotron, etc.). Without a balance, rate limits are low. Adding $20+ to your Zen balance significantly improves rate limits on free models. Paid Zen models (Claude Opus, GPT-5.5, Gemini, etc.) require adding a payment method — they're pay-as-you-go.

**OpenCode Go** is a **subscription** — **$10/mo** ($5 first month promo) — with generous usage limits (5h/$12, weekly/$30, monthly/$60). It unlocks curated open models like DeepSeek V4 Pro, Kimi K2.6, GLM-5.1, Qwen3.7 Max, MiMo V2.5 Pro. When you hit the limit, you can continue using the free Zen models.

**This extension is free and open source** — you never pay us. You pay OpenCode directly (or nothing, on Zen free).

</details>

<details>
<summary><b>Does Agent Mode / tool-calling work?</b></summary>

**Yes — fully.** The extension forwards VS Code tool schemas in the correct format for each endpoint (OpenAI `tool_calls` or Anthropic `tool_use`). Copilot Agent can read files, search, edit, and run terminal commands through any OpenCode model.

</details>

<details>
<summary><b>Where is my API key stored?</b></summary>

In VS Code's **SecretStorage** — the same encrypted store used by GitHub auth. It never leaves your machine and is never sent anywhere except directly to `opencode.ai`.

</details>

<details>
<summary><b>Can I use Go and Zen at the same time?</b></summary>

**Yes.** They're separate provider groups. Add both via **Language Models → Add Models…**, enter each key separately, and switch between them from the chat model picker anytime.

</details>

<details>
<summary><b>A model shows in Language Models but not the chat picker — why?</b></summary>

Hover its row in the **Language Models** view and click the **eye icon (👁)** to toggle visibility.

</details>

<details>
<summary><b>Tool calls loop forever on Qwen — help?</b></summary>

Known issue with `qwen3.6-plus-free` on broad agent tasks (see [issue #1](./docs/issues/01-20260515-qwen36-tool-call-loop.md)). Workaround: set `opencodego.thinking.qwen: "off"` and use a narrower task scope, or switch to a paid Qwen model.

</details>

<details>
<summary><b>How do I use OpenCode models in the Agents window (Copilot CLI)?</b></summary>

Agent models are enabled by default (`opencodego.agentsWindow: true`). Just add this to your VS Code `settings.json`:

```json
"extensions.supportAgentsWindow": {
  "ltmoerdani.opencode-copilot-chat": true
}
```

Then reload the window, open the **Agents window**, start a Copilot CLI session, and pick any OpenCode model from the picker. See the [Agents Window section](#-agents-window-copilot-cli-support) above for details.

</details>

<details>
<summary><b>How do I report a bug or request a model?</b></summary>

[Open an issue](https://github.com/ltmoerdani/opencode-copilot-chat/issues/new/choose) — pick the Bug Report or Feature Request template. Include the diagnostics report (`OpenCode Go: Diagnostics` or `OpenCode Zen: Diagnostics`).

</details>

---

## 🏗️ Architecture

```mermaid
flowchart LR
    A[VS Code Copilot Chat] -->|model picker| B{Which vendor?}
    B -->|Copilot| C[GitHub models]
    B -->|OpenCode Go| D[Go API Key]
    B -->|OpenCode Zen| E[Zen API Key]

    D --> F[Smart Router]
    E --> F

    F -->|GPT| G[" /responses "]
    F -->|Gemini| H[" :streamGenerateContent "]
    F -->|Claude + MiniMax| I[" /messages "]
    F -->|Qwen/DeepSeek/GLM/Kimi/MiMo| J[" /chat/completions "]

    G & H & I & J --> K[opencode.ai gateway]
    K --> L[SSE Stream]
    L -->|tool_calls / tool_use| A
    L -->|usage DataPart| M[Status Bar]
    L -->|context hook| N[Context Widget]
```

See [`docs/architecture/`](./docs/architecture/) for the full provider architecture, routing, and metadata resolution docs.

---

## 🤝 Contributing

Contributions welcome! Whether it's a typo fix, new model support, or a screenshot — every PR counts.

📋 See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.
💬 Discussions: [GitHub Discussions](https://github.com/ltmoerdani/opencode-copilot-chat/discussions)
🐞 Bugs: [Issue Tracker](https://github.com/ltmoerdani/opencode-copilot-chat/issues)

### Development

```bash
npm install      # install deps
npm run compile  # build TypeScript
npm run watch    # watch mode
npm run package  # build .vsix
```

Press `F5` in VS Code to launch an **Extension Development Host**.

---

## 📈 Roadmap

- [ ] 🎥 Demo GIF + screenshots
- [ ] 🌐 GitHub Pages landing page
- [ ] 📦 Publish to VS Code Marketplace
- [ ] 🏷️ Verified publisher badge
- [ ] 🔔 Webhook for new OpenCode models
- [ ] 🎨 Custom model aliases / favorites
- [ ] 📊 Usage charts webview panel
- [ ] 🌍 i18n (id, zh, ja)

> Have an idea? [Start a discussion](https://github.com/ltmoerdani/opencode-copilot-chat/discussions/new) or [open a feature request](https://github.com/ltmoerdani/opencode-copilot-chat/issues/new?labels=enhancement&template=feature_request.md).

---

## ⭐ Star History

<p align="center">
  <a href="https://github.com/ltmoerdani/opencode-copilot-chat">
    <img src="https://img.shields.io/github/stars/ltmoerdani/opencode-copilot-chat?style=social" alt="GitHub stars" />
  </a>
  &nbsp;👆 <b>Star this repo if it saved you money or unlocked a model you needed!</b>
</p>

<a href="https://star-history.com/#ltmoerdani/opencode-copilot-chat&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ltmoerdani/opencode-copilot-chat&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ltmoerdani/opencode-copilot-chat&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ltmoerdani/opencode-copilot-chat&type=Date" />
 </picture>
</a>

---

## 💬 Community

[![GitHub Discussions](https://img.shields.io/badge/Discussions-Ask%20questions-blue?logo=github)](https://github.com/ltmoerdani/opencode-copilot-chat/discussions)
[![Issues](https://img.shields.io/badge/Issues-Report%20bugs-red?logo=github)](https://github.com/ltmoerdani/opencode-copilot-chat/issues)
[![X / Twitter](https://img.shields.io/badge/X-Share-orange?logo=x)](https://twitter.com/intent/tweet?text=Using%2030%2B%20AI%20models%20in%20GitHub%20Copilot%20Chat%20for%20free%20with%20BYOK!&url=https://github.com/ltmoerdani/opencode-copilot-chat&hashtags=vscode,copilot,ai,byok,opencode)
[![Reddit](https://img.shields.io/badge/Reddit-Share-orange?logo=reddit)](https://www.reddit.com/submit?url=https://github.com/ltmoerdani/opencode-copilot-chat&title=OpenCode%20for%20Copilot%20Chat)

**If this saves you money or unlocks a model you needed — ⭐ star the repo and share it!**

---

## 📄 License

[MIT](./LICENSE) © 2026 [ltmoerdani](https://github.com/ltmoerdani)

OpenCode is a trademark of [opencode.ai](https://opencode.ai). This project is independent and not affiliated with GitHub, Microsoft, Anthropic, OpenAI, Google, or any model provider.

<div align="center">

**[⬆ Back to top](#-opencode-for-github-copilot-chat)**

</div>
