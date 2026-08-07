**Status:** ✅ Solved

# Output Channel Cleanup & Buffer TypeScript Fix

**Topic:** extension / output channel / debug logging / TypeScript  
**Updated:** 2026-06-09  
**Tags:** #extension #fix #output-channel #debug #typescript  
**Supersedes:** —

---

## Overview

The "OpenCode" output channel was flooded with verbose debug and informational logs on every session load and every API request. Hundreds of lines per minute made the output channel essentially unusable for real troubleshooting. Additionally, a stale `Buffer` class reference caused a TypeScript compilation error (`Cannot find name 'Buffer'`) in VS Code's language server.

---

## Timeline

### 1. 2026-06-09 — Initial Problem: Verbose Debug Logs

**Problem:** The "OpenCode" output channel was producing an enormous volume of debug logs during normal operation. The primary culprit was the `Model registered:` log line in `provideLanguageModelChatInformation()` which fired for every model (17+ models) on every metadata refresh cycle. Each line included the full `configurationSchema` JSON blob (sometimes hundreds of characters). With metadata refreshes happening frequently, this produced thousands of lines.

Additional verbose logs included:

- `[go-usage] Recording:` and `[go-usage] After record:` on every request
- `Request:` with verbose fields (initiator, rawModel, metadataSource, session, modelConfiguration, thinking, thinkingPayload)
- `Request completed:` on every request
- `[metadata] refreshed models.dev cache` and `[metadata] refresh failed`
- `[stream-summary]` on every stream function
- `[response-summary]` + `[usage]` (double-logged per request)
- `[request] url=` with full payload details
- `[http] 200 OK content-type=...` on every request
- `[sse-stats]` on every request
- `Filtered unavailable/deprecated models:` listing every filtered model name

**Root Cause:** Every diagnostic data point was logged to the same output channel at the same level. No log-level filtering existed — everything was `info` level with no `debug` tier. The `this.log()` method wrote directly to the output channel unconditionally.

**Solution:**

1. Replaced per-model `Model registered:` log with single summary: `Models registered: N models for displayName`
2. Removed `Request:` verbose log entirely
3. Removed `Request completed:` log entirely
4. Removed `[go-usage] Recording:` and `[go-usage] After record:` logs
5. Removed `[metadata] refreshed/failed` logs
6. Removed `Filtered unavailable/deprecated models:` and `Could not fetch model status` logs
7. Removed `Testing connection` and `Test response` logs
8. Removed `goUsageLogChannel` and its callback from `GoUsageTracker`
9. Removed all `[stream-summary]` logs from 4 stream functions
10. Removed `[response-summary]` + `[usage]` double-log, replaced with single compact line (kept in code for diagnostics doc, not printed)
11. Removed `[request] url=`, `[http] 200 OK`, and `[sse-stats]` logs from `streaming.ts`
12. Removed `formatUsageLogLine` import (no longer used)

**Status:** ✅ Solved

### 2. 2026-06-09 — Buffer TypeScript Error

**Problem:** `Buffer.from(part.data).toString("utf8")` in `estimateDataPartTokenCount()` caused TS2591: `Cannot find name 'Buffer'`. The project's `tsconfig.json` does not include `@types/node` in `types`, and the project targets web-compatible APIs.

**Root Cause:** `Buffer` is a Node.js-specific global. The project runs as a VS Code extension (which has Node.js available) but the TypeScript compilation targets don't include Node type definitions.

**Solution:** Replaced `Buffer.from(part.data).toString("utf8")` with `new TextDecoder().decode(part.data)`. `TextDecoder` is a Web API available in all JS environments (browser, Node.js, Deno) without requiring any type definitions.

**Status:** ✅ Solved

### 3. 2026-06-09 — Changelog & Version Bump

**Problem:** Changes needed to be documented and versioned before release.

**Solution:**

- Added `[0.2.3] — 2026-06-09` entry to `CHANGELOG.md` with Added/Changed/Fixed sections
- Bumped version in `package.json` from `0.2.2` to `0.2.3`

**Status:** ✅ Solved

### 4. 2026-06-09 — Build & Install

**Problem:** Need to verify changes compile cleanly and install in local VS Code.

**Solution:**

- `npm run compile` — clean, 0 errors
- `npx @vscode/vsce package --no-dependencies` — VSIX packaged
- Installed via `--install-extension` with `--force` flag

**Status:** ✅ Solved

---

## Files Changed

| File                   | Change                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`     | Removed 8+ `this.log()` calls, removed `goUsageLogChannel`, replaced `Buffer.from` with `TextDecoder`, removed `[metadata]` appendLine calls |
| `src/streaming.ts`     | Removed `[request]`, `[http]`, `[sse-stats]`, `[response-summary]`, `[usage]`, `[stream-summary]` logs; removed `formatUsageLogLine` import  |
| `package.json`         | Version bump 0.2.2 → 0.2.3                                                                                                                   |
| `CHANGELOG.md`         | Added `[0.2.3]` entry                                                                                                                        |
| `media/opencodego.svg` | Refreshed icon (from commit `c8383735`)                                                                                                      |
| `media/opencodego.png` | Refreshed icon (from commit `c8383735`)                                                                                                      |

---

## What Remains in the Output Channel

After cleanup, only error/warning-level messages are logged:

| Log                     | When                                |
| ----------------------- | ----------------------------------- |
| `ERROR model=...`       | On request failure                  |
| `[warn] empty response` | Model returns no text or tool calls |
| `[rate-limit]`          | API rate limit hit                  |
| `[http-error-body]`     | Non-2xx HTTP response               |
| `[non-stream-body]`     | Unexpected non-SSE response         |

The "OpenCode Go Usage" output channel is also silenced (no callback passed to `GoUsageTracker`).

---

## Verification

```bash
npm run compile    # clean, 0 errors
npx tsc --noEmit   # clean, 0 errors
npx @vscode/vsce package --no-dependencies
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension opencode-copilot-chat-0.2.3.vsix --force
```

---

## Lessons Learned

1. **Log levels matter.** When every diagnostic is logged at the same level, the output becomes noise. Consider adding a `debugReasoning`-style gate for verbose logs in the future.
2. **Web APIs > Node APIs.** `TextDecoder` is universally available and avoids `@types/node` dependency. Prefer Web APIs when writing VS Code extension code.
3. **Diagnostics are still available.** Removed logs were already accessible through the extension's diagnostics document (`OpenCode: Show Diagnostics`), so no diagnostic capability was lost.
