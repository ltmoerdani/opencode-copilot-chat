**Status:** ✅ Solved
**Fix PR:** [#189](https://github.com/ltmoerdani/opencode-copilot-chat/pull/189)
**Related:** #183, #79 (Muse Spark stream completion)
**Landed:** PR #189 (Fahad090NP/fix/issue-183-muse-vision-fallback, merge `dd4fefb`)

# Include Muse Spark 1.2 variants in offline vision fallback

**Topic:** models / vision / muse-spark
**Updated:** 2026-08-26
**Tags:** #models #vision #muse-spark #bug

---

## Problem

Muse Spark 1.2 models (`muse-spark-1.2-contributor` on Go, `muse-spark-1.2-contributor-free` on Zen) were missing from the offline vision fallback list. When the models.dev fetch failed (cold start, network issue), the extension's bundled fallback metadata did not mark these models as vision-capable, so image attachments were silently dropped for Muse Spark 1.2 users.

## Root cause

The offline vision fallback list in `src/models/metadata.ts` (or equivalent) was populated when Muse Spark 1.2 support was added (PR #168, feature doc 18), but the vision-capable model IDs for the 1.2 variants were not included. The live models.dev fetch correctly reports `imageInput: true` for these models, so the bug only manifested when the fetch failed.

## Fix

Added `muse-spark-1.2-contributor` and `muse-spark-1.2-contributor-free` to the offline vision fallback set, so the extension correctly identifies them as vision-capable even without a live models.dev response.

## Verification

- `npm run lint` all 7 checks green.
- Manual: simulate models.dev fetch failure → Muse Spark 1.2 models retain vision capability in the bundled fallback.
