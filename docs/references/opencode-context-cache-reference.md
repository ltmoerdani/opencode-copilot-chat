# opencode-context-cache reference

This file pins the cache-key resolution used by the local CLI plugin
`~/.config/opencode/plugins/opencode-context-cache.mjs` so the VS Code
extension's parity claim is verifiable without access to that file.

## Source

`opencode-context-cache.mjs` — `CacheKeyResolver.resolveCacheKey(input)`

## Precedence (first match wins)

1. `OPENCODE_PROMPT_CACHE_KEY` env var (trimmed, non-empty)
2. `OPENCODE_STICKY_SESSION_ID` env var (trimmed, non-empty)
3. `user@host:directory` — `userInfo().username || USER/USERNAME/LOGNAME || "unknown"`, `hostname()`, `process.cwd()` (CLI) / `workspaceFolders[0].fsPath` (VS Code)
4. Model headers `x-session-id` / `conversation_id` / `session_id` (only when no stable default exists)
5. `input.sessionID` (opencode session fallback)

## Hashing

- Raw key: `{user}@{host}:{directory}` (or env override verbatim)
- Sent key: `SHA256(raw)` hex (64 chars), via `createHash("sha256").update(raw,"utf8").digest("hex")`
- If raw already looks like SHA256 hex (64 hex chars), it is forwarded as-is (no double-hash).

## Normalization (VS Code parity)

- Separators canonicalized: `dir.replace(/\\/g, "/")` so `C:\a\b` and `C:/a/b` hash identically.
- Drive letter upper-cased on Windows: `c:` -> `C:`.

## Parity scope

Parity holds when the CLI is run from the first workspace root (`process.cwd() === workspaceFolders[0].fsPath` after normalization).
Multi-root workspaces or CLI invoked from a subfolder will diverge — expected limitation.

## Pinned hash (regression guard)

```text
raw  = "testuser@testhost:C:/project"
hash = "4f77e704edc190c1872f5ac84f42320d082a4cf4c52bfdacd2634db07de24120"
```

See `src/test/headers.test.ts` — `hashRawCacheKey` is the pure function under test.
