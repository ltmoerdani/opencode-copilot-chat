# Changelog Writing & Update Guide

This document contains rules, format, and step-by-step instructions for creating and maintaining the changelog for the **OpenCode Copilot Chat** VS Code extension. The goal is to ensure all contributors document changes consistently, readably, and traceably.

---

## Purpose of the Changelog

- Serve as the official record of all changes — new features, bug fixes, security updates, and performance improvements.
- Help contributors, users, and maintainers track the extension's evolution.
- Provide transparency and historical reference for all changes to the extension's model support, routing, and provider integrations.
- Document changes specific to BYOK provider support, streaming, model routing, and VS Code API integration.

## Changelog Structure & Format

1. **Main heading**: Use `# Changelog` at the very top.
2. **Opening paragraph**: Briefly explain the changelog's purpose (max 2 short paragraphs).
3. **Each release/version** must follow this consistent order:
   - `## [x.y.z] — YYYY-MM-DD`
   - `### Added` / `### Changed` / `### Fixed` / `### Removed` (standard Keep a Changelog categories)
   - Bullet points describing each change concisely
4. **Separator between versions**: Use `---`.
5. Keep entries in reverse chronological order (newest first).

## Format Principles

- Prioritize HTML-scannable structure: short headings, concise paragraphs, flat lists.
- One section = one type of content. Don't mix paragraphs, tables, and nested lists in the same block.
- Use `###` for standard Keep a Changelog categories (`Added`, `Changed`, `Fixed`, `Removed`).
- Limit 4–8 bullets per section. If more, split into a new section.
- Avoid nested bullets. If details are too many, link to an issue or PR.
- Avoid tables in release entries unless truly necessary.
- Avoid raw HTML in markdown. Use standard markdown elements only.
- Avoid listing commit hashes in headings or opening paragraphs. Link to them in issues if needed.

## HTML Compatibility Rules

- Use only safe, stable markdown elements: headings, paragraphs, unordered lists, ordered lists, blockquotes, and fenced code blocks.
- Keep headings short — ideally 6–14 words.
- Keep paragraphs concise — target 2–4 sentences.
- Use inline code only for file paths, settings names, commands, or important technical identifiers.
- Use code blocks only for `Action Required` or commands that genuinely need multi-line instructions.

## Writing Rules

- **One version = one batch of related changes** (a feature set, bug fix batch, or provider update).
- Avoid raw commit dumps or daily work logs. The changelog is a release summary, not a development transcript.
- Use the standard Keep a Changelog categories (`### Added`, `### Changed`, `### Fixed`, `### Removed`) as section headings.
- Write in **English** — clear, concise, and professional.
- For model-specific changes, include the model family name and the provider (Go or Zen).
- Every security update or API change must be explained in detail.
- Document changes to provider routing, streaming, or VS Code API integration completely.
- Every entry must include the release date.
- Don't delete old version history.
- **Affected systems**: Mention which modules or components are affected (e.g., `[Streaming]`, `[Routing]`, `[Model Registry]`, `[Usage Tracker]`).
- **Action Required**: If users need to update settings, reconfigure API keys, or take manual steps, document clearly.
- **Breaking Changes**: Highlight any changes that break backward compatibility.

## Recommended Release Template

```md
## [x.y.z] — YYYY-MM-DD

### Added

- **Feature description.** Brief explanation of what was added and why it matters.
- **Another feature.** Context and benefit for users.

### Changed

- **Changed behavior.** What changed and how it differs from before.

### Fixed

- **Bug fix description.** What was broken and how it was fixed, including root cause.

### Removed

- **Removed feature/code.** What was removed and why.

---
```

## 🏷 Versioning Standard (Semantic Versioning)

We use **Major.Minor.Patch** (x.y.z) versioning. Here is guidance on when to increment each number:

### 🔹 Patch (x.x.Z) — _Bug Fixes & Minor Improvements_

> Increment the last number when the change is **safe, small, and doesn't fundamentally alter how the extension works.**

- **Definition:** Bug fixes, config tuning, or minor improvements that are backward-compatible.
- **Examples:**
  - Fix a bug where a model's thinking output wasn't stripped correctly.
  - Fix a typo in a settings description.
  - Tune stream timeout from 120s to 180s.
  - Minor dependency update that doesn't break anything.
  - Fix a visual glitch in the status bar usage indicator.

### 🔹 Minor (x.Y.x) — _New Features & Enhancements_

> Increment the middle number when **adding features or significant enhancements** that don't break compatibility.

- **Definition:** New features, new provider support, or significant improvements without breaking changes.
- **Examples:**
  - Add support for a new model family (e.g., add Grok models).
  - Add a new provider tier (e.g., OpenCode Zen support).
  - Add context size selector for tiered-pricing models.
  - Add thinking/reasoning controls for a model family.
  - Add usage tracking dashboard in the status bar.
  - Add a new diagnostics command.

### 🔹 Major (X.y.x) — _Breaking Changes & Critical Upgrades_

> Increment the front number when changes **potentially break things, require migration, or significantly change the architecture.**

- **Definition:** Non-backward-compatible changes, major API refactors, or upgrades requiring user action.
- **Examples:**
  - Change the settings schema so users must reconfigure.
  - Remove support for a deprecated VS Code API version.
  - Change the provider routing logic so previously working models now need different configuration.
  - Deprecate a major feature (e.g., remove support for a provider tier).
  - Upgrade minimum VS Code version requirement.

---

## Steps to Create/Update the Changelog

1. After a feature/bugfix/security update is ready for release:
   - Determine the new version number (follow semver: MAJOR.MINOR.PATCH).
   - For security updates, use PATCH increment.
   - For new model support or features, use MINOR increment.
   - For breaking changes, use MAJOR increment.
   - Add the new entry at the top of the changelog following the template.
   - Include the date and list of affected areas.
2. Review before merging to `main`.
3. For security-related changes, coordinate with maintainers.
4. Ensure the changelog is always up-to-date before publishing a new release.
5. Tag the release: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`.

## Example Entry

```md
## [0.3.0] — 2026-07-01

### Added

- **Grok model family support.** Adds routing and tool-calling support for Grok models on both OpenCode Go and Zen providers. Includes thinking effort controls (`off`/`low`/`medium`/`high`).
- **Audio input indicator.** Models supporting audio input now show a speaker icon in the model picker tooltip, sourced from live `models.dev` metadata.

### Changed

- **Improved streaming error recovery.** When a stream is interrupted, the extension now attempts to re-emit the partial response instead of silently failing.

### Fixed

- **Qwen tool calls dropping on long conversations.** Root cause: the message trimmer was cutting tool-call blocks mid-sequence, breaking atomicity. The trimmer now preserves complete tool-call rounds.

### Removed

- **Legacy `opencodego.showUsage` command.** Removed in favor of the status bar indicator which provides the same data at a glance.

---
```

## ✅ Tips & Best Practices

### Before Writing a Changelog Entry

- [ ] Ensure all features/fixes are tested and **merged to `main`**
- [ ] Confirm the version number with maintainers
- [ ] If there are breaking changes, coordinate with users via GitHub Issues/Discussions
- [ ] Update the `package.json` version to match

### While Writing an Entry

- ✍️ Use **present tense** (e.g., "adds support", "fixes", "removes" — not "added", "fixed")
- ✍️ Avoid unnecessary jargon — focus on **user impact**
- ✍️ When mentioning external APIs/providers, include the version (e.g., "OpenCode Go gateway v2")
- ✍️ Use consistent section headings: `### Added`, `### Changed`, `### Fixed`, `### Removed`
- ✍️ When listing files, limit to the most important ones and link to the PR for full details

### Pre-Release Checklist

- [ ] Changelog updated with the latest version
- [ ] All breaking changes highlighted
- [ ] `package.json` version bumped
- [ ] Git tag created: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- [ ] README updated if new features require documentation

---

## Change Categories for This Extension

### 🔒 Security Updates

- **Critical**: API key exposure fixes, authentication changes
- **High**: Request header security, data protection improvements
- **Medium**: Access control updates, logging enhancements
- **Low**: Security-related UI improvements, warning messages

### 🤖 Model & Provider Support

- **New Models**: Adding support for new model families
- **Model Routing**: Endpoint routing changes, transport fixes
- **Thinking/Reasoning**: Per-model reasoning control changes
- **Tool Calling**: Tool schema forwarding and parsing fixes

### 🔧 Extension Infrastructure

- **Streaming**: SSE parsing, response extraction, error recovery
- **Model Registry**: Live metadata fetching, caching, fallback behavior
- **Usage Tracking**: Cost calculation, subscription monitoring, status bar
- **Diagnostics**: Debug commands, output channel, provider history

### 📱 UI/UX Improvements

- **Model Picker**: Settings, tooltips, context size selectors
- **Status Bar**: Usage indicators, response summaries
- **Settings**: New configuration options, improved descriptions
- **Commands**: New VS Code commands, keyboard shortcuts

## References

- [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
- [Semantic Versioning](https://semver.org/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [OpenCode API](https://opencode.ai)

---

_This guide must be followed by all contributors to the OpenCode Copilot Chat project._
