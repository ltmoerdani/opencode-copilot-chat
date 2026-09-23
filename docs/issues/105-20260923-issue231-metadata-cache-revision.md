# Issue #231 — "Wrong details for Deepseek Flash 4.1": Stale Metadata Cache, Now Revision-Scoped

**Status:** ✅ Solved — implemented + verified end-to-end
**Topic:** models / metadata / caching
**Updated:** 2026-09-23
**Tags:** #models #metadata #caching #modelsdev
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#231](https://github.com/ltmoerdani/opencode-copilot-chat/issues/231)
**Related:** CHANGELOG [Unreleased] "Bundled offline fallback data synced to models.dev (2026-09-08 snapshot)"

---

## Problem

The picker showed `deepseek-v4.1-flash` with a 262K context window, and the reporter believed the model did not exist at all (their check against DeepSeek's own API listed only `deepseek-flash` / `deepseek-v4-pro`). The stale limit reportedly caused billing surprises on paid requests.

## Analysis

1. **The model is real.** `deepseek-v4.1-flash` is in the official OpenCode Go endpoint table (<https://opencode.ai/docs/go>) and in the live models.dev registry. The reporter's check hit `api.deepseek.com`, which is DeepSeek's own API catalog — a different catalog from the models the OpenCode Go gateway hosts.
2. **models.dev is currently correct:** `deepseek-v4.1-flash` → context 1,000,000 / output 384,000 (verified live 2026-09-23).
3. **The 262K number was stale persisted data.** The models.dev snapshot is cached in globalState under a **fixed** key (`opencode.modelMetadataCache.v5`) with a 1-hour TTL — but the key itself never changed when a release updated its bundled fallback tables, so old snapshots survived extension upgrades (fallback only engages when the refetch fails, and the stale persisted copy kept shadowing fresh data until TTL refetch happened to succeed).

## Fix — cache key scoped to the bundled-data revision

`MODEL_METADATA_CACHE_KEY` is now derived from the bundled snapshot revision:

```text
opencode.modelMetadataCache.v5  →  opencode.modelMetadataCache.v6.<MODEL_METADATA_REVISION>
```

Whenever a release syncs the bundled fallback tables (new revision), the key changes and every stale persisted snapshot is abandoned automatically — no user action, no TTL race. **Refresh Models** stays as the manual escape hatch (it already clears both caches via `clearOpenCodeModelMetadataCache()` + `fetcher.invalidate()`).

## Files Changed

| File                      | Change                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `src/config.ts`           | `MODEL_METADATA_CACHE_KEY` → `v6.<MODEL_METADATA_REVISION>`, with rationale comment |
| `src/test/errors.test.ts` | Cache-key/revision binding test                                                     |

## Verification

- `npm run lint` (full 7-check gate) pass; 484/484 unit tests pass.
- Live models.dev check (2026-09-23): `deepseek-v4.1-flash` = 1M/384K on both `opencode-go` and `opencode` provider entries.
- Manual: `Refresh Models` on an install that showed 262K → picker shows 1M/384K.

---

Detected 2026-09-09 | Reported by @nickchomey | Fixed 2026-09-23
