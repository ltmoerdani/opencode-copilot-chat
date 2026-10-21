# Beam Free 400 — Tool Names Over 64 Chars on Chat-Completions

**Status:** ✅ Solved
**Topic:** provider / tool-calling / models
**Updated:** 2026-10-22
**Tags:** #provider #tool-calling #beam #chat-completions #mcp
**Related:** issue #165 (Muse truncation), [114 — Muse tool schema depth](114-20261021-muse-tool-schema-depth-limit.md)

---

## Problem

Selecting `beam-free` failed before any text streamed:

```text
OpenCode Go API request failed (400) model=beam-free payloadBytes=260163:
Upstream request failed: [invalid_value] Invalid value for 'tools[7].function.name': maximum string length is 64.
```

## Root Cause

The Muse fix for issue #165 truncated tool names > 64 chars — but only on the **Responses API** path (`mapResponsesTools`). `mapOpenAiTools` (chat-completions) never truncated, and `beam-free` routes to chat-completions, where Beam's upstream enforces the same OpenAI 64-char function-name limit. Long MCP tool names (e.g. `mcp__postman-api_create-collection-request-with-new-api-definition-...`) therefore 400 the whole request.

## Fix

| File                                | Change                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/registry.ts`              | New `beam` family row (`/^beam-/i`, chat-completions) so beam resolves via the registry like muse.                                                                                                           |
| `src/request/openai.ts`             | New `needsToolNameTruncation()` gate (muse + beam families); applied in `mapOpenAiTools` (chat-completions) and `mapResponsesTools`; `buildResponsesToolNameMap` renamed to `buildToolNameMap` and re-gated. |
| `src/provider/OpenCodeProvider.ts`  | Chat-completions transport now also receives `toolNameMap` so truncated names round-trip.                                                                                                                    |
| `src/transports/chatCompletions.ts` | Forwards `options.toolNameMap` into `OpenAiResponseExtractor` (9th ctor arg, same as the Responses transport).                                                                                               |
| `src/core/transport.ts`             | `toolNameMap` docstring updated (no longer Responses-only).                                                                                                                                                  |
| Tests                               | 5 new: beam truncation on chat-completions, ungated passthrough, gate truth table, beam round-trip map, beam routing/thinking-null.                                                                          |

## Verification

- `npm test` — 556/556 pass.
- `npm run lint` — all 7 checks pass.

## Notes

- `isMuseFamily` remains for the Muse-specific `truncation: "disabled"` request field.
- Truncation is deterministic (first 55 chars + `_` + 8-char hash), so the reverse map always resolves back to the original tool name.
