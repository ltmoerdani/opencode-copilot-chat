**Status:** ✅ Solved
**Related issue:** [#286](https://github.com/ltmoerdani/opencode-copilot-chat/issues/286)
**Related memory:** `opencode-auth-research.md`

# Sign in with OpenCode Console without manually copying a key

**Topic:** auth / byok / provider / vscode
**Updated:** 2026-11-25
**Tags:** #auth #byok #provider #vscode

---

## Problem

The request was to sign in with OpenCode Console the way `/connect` works in
the OpenCode CLI, so users would not have to enter an API key manually.

## Research

Official OpenCode docs (`/console/go`, `/console/api`, `/cli/providers`) show
that `/connect` for **OpenCode Go still asks for an API key**. OAuth in
`/connect` applies to other providers (ChatGPT/Codex, GitHub Copilot, Azure).
The Console API issues personal or service keys (`oc_sk_...`); there is no
documented third-party OAuth flow for Go.

The OpenCode CLI does save that key locally. On this machine the SQLite store
`~/.local/share/opencode/opencode.db` has a `credential` table with an
`opencode-go` row whose `value` is the API key. The extension already reads the
same database read-only for usage history (`src/usage/history.ts`), so the
credential can be imported with the user's explicit consent instead of being
scraped silently.

## Fix

- `src/openCodeConsoleCredential.ts` — node-only helper that reads the
  `opencode-go` credential from the CLI database using `node:sqlite`, falling
  back to the `sqlite3` binary. `parseCredentialRows()` accepts both row
  shapes. The key is returned to the caller and never logged; read failures
  degrade to `undefined`.
- `src/commands/consoleSignIn.ts` — new command
  **OpenCode Go: Sign In with OpenCode Console**:
  - if a CLI key exists, ask "Import?" with **Import / Open Console / Cancel**;
  - otherwise open the Console personal-API-keys page and prompt for the key;
  - store the key in VS Code SecretStorage under `secretKeyFor(GO_VENDOR)` and
    refresh the model list.
- `src/extension.ts` / `package.json` — command registration and title.

No Console session cookie or OAuth token is handled, and no undocumented RPC
endpoint is used. The user always confirms before a key is copied.

## Verification

- `src/test/openCodeConsoleCredential.test.ts` — both SQLite row shapes, empty
  values, and the Console URL.
- `npm run lint` (compile + unit tests + all strict checks) passes.
