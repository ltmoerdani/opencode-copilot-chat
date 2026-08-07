# 📋 OpenCode Copilot Chat — Documentation Standards

**Version:** 3.0 | **Updated:** 2026-06-12

---

## 🎯 Core Principles

| #   | Principle                    | Description                                                  |
| --- | ---------------------------- | ------------------------------------------------------------ |
| 1   | **One topic = One document** | Consolidate, don't fragment                                  |
| 2   | **Self-contained**           | Readers should not need to open other documents              |
| 3   | **Codebase verification**    | Cross-check against the codebase before deprecating          |
| 4   | **English language**         | Primary language for all documentation (open-source project) |
| 5   | **No Hardcoded Secrets**     | Use env vars or references to secret managers                |

### Codebase Verification

```bash
# REQUIRED before deprecating — check if a pattern is still used
grep -r "ClassName" src/
```

> ⚠️ **DO NOT** deprecate something just because it looks old. Verify first!

---

## 📁 File Naming & Header

### Naming Format

```text
[seq]-[YYYYMMDD]-[topic-description].md
```

**Example:** `01-20260612-streaming-error-recovery.md`

**Rules:** Lowercase • Sequential 2-digit • YYYYMMDD • Dash separator

### Header Template

```markdown
**Status:** 🟢 Active | ✅ Solved | ⚠️ Deprecated

# Document Title

**Topic:** streaming / routing / models / provider / usage  
**Updated:** YYYY-MM-DD  
**Tags:** #tag1 #tag2  
**Supersedes:** [Link if deprecated]

---

## Overview

[Brief description of the document]
```

### Common Tags

```text
#streaming #routing #models #provider #usage #byok #vscode #thinking #tool-calling #security
```

---

## 📊 Status & Lifecycle

| Status            | When to Use                                        |
| ----------------- | -------------------------------------------------- |
| 🟢 **Active**     | Ongoing, not yet resolved                          |
| ✅ **Solved**     | Issue fixed, still relevant for reference          |
| ⚠️ **Deprecated** | A newer document exists (stays in original folder) |

### Lifecycle Rules

- **DELETE** → If 100% covered by a new document
- **DEPRECATED** → If historical reference is useful, or the issue may recur
- **SOLVED** → If the fix is permanent and still useful for reference

> Deprecated documents **stay in their original folder** with a status marking.

---

## 🔐 Security Rules

**NEVER** include in documentation:

- Passwords, API keys, tokens
- OpenCode API keys, GitHub tokens, or secrets
- Connection strings with credentials
- VS Code `globalState` contents with real data

### ✅ Safe Patterns

```bash
# Environment variable
OPENCODE_API_KEY=<YOUR_API_KEY>

# Placeholder
OPENCODE_GO_API_KEY=sk-xxxxxxxxxxxx

# Reference to settings
Configure via VS Code Settings > Extensions > OpenCode Copilot Chat
```

### If Secrets Are Accidentally Committed

1. **STOP** — Do not push
2. **Report** to maintainers immediately
3. **Rotate** the secret immediately
4. **Remove** from git history with `git filter-repo`

---

## 📂 Folder Structure

```text
/docs/
├── documentation-standards.md    ← Master reference (this file)
├── changelog-guide.md            ← Changelog writing guide
├── devlog.md                     ← Development activity log & session state
├── devlog-guide.md               ← How to read/update the devlog
├── architecture/                 # System design & decisions
├── features/                     # Per-feature documentation (flat files)
├── issues/                       # Bugs & fixes (flat files)
└── references/                   # API docs, configs, provider specs
```

### Root Directory Clean Rules

**Only allowed in root:**

- `package.json`, `tsconfig.json`, `README.md`, `LICENSE`, `CHANGELOG.md`
- `.gitignore`, `.eslintrc.*`, `.prettierrc.*`

**Move to appropriate folder:**

- Debug scripts → delete or `scripts/`
- Verification scripts → `scripts/`

---

## 🔄 Workflow

### Development Phase

Create separate documents during research/analysis/implementation → **OK**

### Consolidation Phase

```text
User: "consolidate, make it compact"
├── Read all related documents
├── Write 1 main document
├── Preserve substance, remove redundancy
└── DELETE old documents that are fully covered
```

### ⏱️ Consolidation Rules: Timeline Order

**REQUIRED** when merging multiple documents/issues:

1. **Arrange chronologically** — earliest issue at top, most recent at bottom
2. **Include dates** — every issue/event must have a date
3. **Create a clear timeline** — readers must understand the sequence of events

#### Consolidated Document Format

```markdown
# [Topic] - Consolidated Issues

## Overview

Summary of the problem and final solution.

## Timeline

### 1. [YYYY-MM-DD] First Issue

**Problem:** Description of the initial issue
**Root Cause:** The cause
**Solution:** What was done
**Status:** ✅ Solved

### 2. [YYYY-MM-DD] Second Issue

**Problem:** The next issue
**Root Cause:** The cause
**Solution:** What was done
**Status:** ✅ Solved

### 3. [YYYY-MM-DD] Latest Issue

**Problem:** The current issue
**Root Cause:** The cause
**Solution:** What was done
**Status:** 🟢 Active / ✅ Solved

## Final Solution

The solution that resolved all issues.

## Files Changed

- src/path/to/file1.ts
- src/path/to/file2.ts
```

#### Example Timeline Table (Alternative)

```markdown
## Issue Timeline

| #   | Date       | Issue                   | Root Cause             | Status    |
| --- | ---------- | ----------------------- | ---------------------- | --------- |
| 1   | 2026-06-01 | Stream SSE parse error  | Missing event handler  | ✅ Solved |
| 2   | 2026-06-05 | Qwen tool calls dropped | Wrong endpoint routing | ✅ Solved |
| 3   | 2026-06-10 | Usage tracker NaN       | Missing cost metadata  | ✅ Solved |
```

### Document Structure (Single Issue)

```markdown
# [Topic] - [Description]

## Problem

## Root Cause

## Solution

## Files Changed

## Verification
```

---

## 🧪 Contract Documentation Standards

### Purpose

When writing or modifying code, document the **function contract** so that contributors writing tests can use it directly without reading the implementation. This prevents "implementation-locked tests" — tests that always pass because they mimic code rather than testing behavior.

### 3-Tier Contract — When to Write What

| Tier                        | When                                                                       | What to Document in Source       |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| **Tier 1: Type = Contract** | Simple pure function, clear signature                                      | Nothing needed                   |
| **Tier 2: JSDoc Contract**  | Shared utility, critical business logic, behavior that's easy to get wrong | Brief JSDoc in the source file   |
| **Tier 3: Contract Header** | Non-obvious behavior, many edge cases, complex logic                       | Block comment above the function |

### Workflow While Coding

1. **Is the type signature sufficient?** → Tier 1, move on
2. **Are there rules/behaviors not visible from the type?** → Add JSDoc (Tier 2)
3. **Are there important invariants or edge cases?** → Add contract header (Tier 3)

**Focus on non-obvious behavior — don't write contracts that repeat the type.**

---

## ✅ Final Checklist

Before committing documentation:

- [ ] Header is complete (Status, Topic, Updated, Tags)
- [ ] Overview section exists
- [ ] **No secrets/credentials**
- [ ] Not redundant with other documents
- [ ] Root directory is clean (no temp scripts)
- [ ] Codebase verified before deprecating

---

_This guide is for maintainability. Flexible, not rigid._
