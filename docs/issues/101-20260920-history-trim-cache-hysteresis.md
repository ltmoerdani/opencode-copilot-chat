**Status:** 🟢 Active

# History-trim cache hysteresis — stable cut points at the context ceiling

**Topic:** provider / history-trim / prompt-cache
**Updated:** 2026-09-20
**Tags:** #cache #provider #history-trim #deepseek #go
**Related:** Upstream PR #212 (cache-key parity + deterministic prefix), issue [#232](https://github.com/ltmoerdani/opencode-copilot-chat/issues/232) (cache-rate monitoring)

---

## Problem

A long session that reaches the input budget loses its provider prompt-cache
hits almost entirely. Observed on a 614K-token OpenCode Go session
(`deepseek-v4.1-flash`, chat-completions): the cache-hit rate alternated
between ~99.8% and **11.4%** in the same conversation, minutes apart, and the
whole session averaged 49% with ~45% token efficiency (20.1M prompt tokens,
9.1M cached). The 11.4% misses always reported the same
`cachedTokens=69888` — exactly the fixed head (system prompt + tools).

## Analysis

The trimmer (`trimOldMessagesToFitContext`) drops the oldest droppable units
until the payload fits **and then stops at the minimal fit**. At the ceiling,
the landing sits just under the budget with almost no slack, so the next
turn's growth (one user turn is easily 2K+ tokens) exceeds the budget again —
and the next trim moves the cut point to a **different position**.

The provider's prefix cache only reuses the bytes before the first changed
message. A moved cut therefore invalidates everything after the anchor:
only system prompt + tools stay cached (69,888 tokens ≈ 11.4% of 614K).
Every moved cut re-bills the conversation body at full input price.

Log correlation from the affected session (trim drop count → next hit rate):

```text
05:35  trim=245  → 99.8%   (cut unchanged)
05:36  trim=249  → 11.4%   (cut moved)
05:37  trim=251  → 11.4%   (cut moved)
05:37  trim=253  → 100.0%  (retry of the same cut re-primes)
06:00  trim=317  → 99.8% ×4 (cut stable again)
06:02  trim=319  → 11.3%   (cut moved)
```

207 trims fired on that session across a ~12-hour span. The fix is not about the
cache key (that layer was verified working): it is about **keeping the cut
point still** once a trim is unavoidable.

### Why the low-water mark alone was not enough (evening follow-up)

The first live deployment looked solved in the morning (13 consecutive trims at
the identical cut, 99.9% hits) but collapsed in the afternoon: from ~14h local
the hit rate fell to 37-68% with a **12.4% miss every 1-3 requests**. The log
shows exactly why — every miss sits on a drop-count change:

```text
17:47 TRIM dropped=214 -> hit 12.4%    (cut moved)
17:47 TRIM dropped=214 -> hit 100.0%   (same cut)
17:48 TRIM dropped=216 -> hit 12.4%    (cut moved again)
18:24 TRIM dropped=222 -> hit 12.4%
18:25 TRIM dropped=224 -> hit 12.4%
```

The crossing pass stops at the **first unit** that reaches the low-water mark,
so the slack left for the following turns is bounded by that unit's size. The
moment per-turn growth approaches one unit, the cut advances on nearly every
request. The morning session was lucky — its dropped units happened to include
large tool results (the first landing left 11,282 tokens of slack, holding the
cut for 13 trims). The evening session's units averaged ~2.7K tokens against
~1K of growth per request, so the slack ran out almost immediately.

Shifting the target does **not** help: the landing hugs whichever target within
one unit, so the move frequency is unchanged — verified in simulation (200-300
requests, ~2.7K-token units): 75-112 cut moves with the target shifted by up to
98K tokens below the low-water mark, same as shifting by zero.

## Fix

Two changes now keep the cut still (same unit granularity, same tool-group
safety rules, both applied to the byte ceiling via `HISTORY_BYTES_PER_TOKEN`):

1. **Low-water mark.** When the trimmer drops anything, it keeps dropping until
   the payload is at or below `budget − headroom`, with the headroom from
   `HISTORY_TRIM_HEADROOM_RATIO` (3%), floored by
   `HISTORY_TRIM_HEADROOM_MIN_TOKENS` (8,192 — capped at 10% of the budget) and
   capped by `HISTORY_TRIM_HEADROOM_MAX_TOKENS` (32,768).
2. **Cut-step alignment.** It then continues to the next
   `HISTORY_TRIM_CUT_STEP_TOKENS` (32,768; capped at 10% of the budget) boundary
   of _dropped_ payload. That boundary is a fixed grid: the cut stays until
   accumulated growth pushes the crossing past it — up to a full step of slack per
   advance, instead of one unit.

Trade-off: a trim sheds a bounded amount of extra (oldest-first) context — up
to the headroom plus one cut step — in exchange for a cut that survives many
turns: one cold prefix per epoch instead of one on nearly every turn.

## Files Changed

| File                          | Change                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/config.ts`               | `HISTORY_TRIM_HEADROOM_RATIO` / `_MIN_TOKENS` / `_MAX_TOKENS`, `HISTORY_TRIM_CUT_STEP_TOKENS`        |
| `src/provider/historyTrim.ts` | Low-water pass + cut-step pass after the minimal-fit drop; documented contract                       |
| `src/test/messages.test.ts`   | Low-water landing test + no-re-trim stability test + production-shape re-supply test + cut-step test |

## Verification

- `npm run lint` clean (editorconfig, ESLint, markdown, prettier, shell,
  TypeScript, tests).
- 468/468 unit tests pass, including the four new cases:
  - a trim lands at or below the low-water mark (`finalTokens ≤ budget − 8,192`
    at a 100K budget) while anchor + current prompt are preserved;
  - five follow-up turns after the trim do not move the cut (`removed == 0`)
    — with zero headroom (control), the same turns re-trim and move it;
  - the production shape (full history re-supplied each turn): the drop count
    stays constant across turns and each sent payload is a nested prefix of the
    previous one. Against the compiled pre-fix artifact the same scenario fails
    (drop count 12 → 13, cut moved);
  - the cut-step grid: a ~1.1K-token follow-up turn does not move the cut —
    the same scenario moves it without the step pass (verified against the
    pre-step build: 68 → 70 vs 79 → 79 dropped units).
- Simulation (300 requests, production budget 613,952, byte cap 2,762,784):
  cut moves fall from **84/300 (28%) to 12/300 (4%)** in the evening regime
  (~2.7K-token units, ~1K growth per request) and from **244/300 (81%) to
  14/300 (5%)** in the smaller-unit regime (~800-token units) — the step pass
  makes the stability independent of the unit size.
- Runtime smoke test against the compiled `out/provider/historyTrim.js` of a
  patched local 0.7.5 build: trim 38 units, land at 91,179 tokens against a
  91,808 low-water mark, cut stable across five turns.
- Live confirmation (2026-09-20, patched build serving real chats): a session
  grew to 625,118 tokens against the 613,952 budget and produced 15 trims —
  every landing 584,252-595,440 (all ≤ the 595,534 low-water mark). Thirteen
  consecutive trims held the identical cut at 99.9-100% cache hits; the cut
  shifted only twice after the initial trim, each shift costing exactly one
  12.3% request, recovered on the next. High-context requests (> 580K tokens):
  55 requests at 95.2% average with 3 sub-50 misses, versus 243 requests at
  63.4% with 100 sub-50 misses (41%) pre-fix.
- Live counter-example that motivated the cut-step pass (same day, evening):
  the hour-by-hour hit rate fell from 99.9% (10h-13h local) to **37-68% from
  14h on**, with a 12.4% miss on every drop-count change (drop counts walked
  214 → 242 over ~50 minutes). See the evening analysis above.

## Lessons Learned

A trim that "just fits" is not free: at the context ceiling it turns every
following turn into a cache miss, because the provider prefix cache breaks at
the first changed message. Trimming is only cheap when its cut point is
**stable** — and stability is bounded by the _granularity_ the cut advances in.
A low landing target alone does not help: the trimmer stops at the first unit
that crosses it, so the slack is always one unit wide at best. Making the cut
advance on a fixed grid is what buys multi-turn stillness.
