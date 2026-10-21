# Muse Spark 400 — Tool Schema Exceeds Nesting Depth 10

**Status:** ✅ Solved
**Topic:** provider / tool-calling / muse
**Updated:** 2026-10-21
**Tags:** #provider #tool-calling #muse #responses #mcp #gateway
**Related:** [89 — issue208 Grok Responses routing](89-20260903-issue208-grok-responses-routing.md), [86 — issue197/198 Responses API finish reason](86-20260828-issue197-198-responses-api-finish-reason-text-extraction.md)

---

## Problem

Selecting `muse-spark-1.3-contributor` in Copilot Chat failed before any text streamed:

```text
OpenCode Go API request failed (400) model=muse-spark-1.3-contributor payloadBytes=274790:
JSON schema exceeds the maximum nesting depth of 10 levels
```

The same tool set (built-in VS Code tools plus several MCP servers) worked on chat-completions models.

## Root Cause

Muse is routed to the Responses API (`src/core/registry.ts` → `endpointKind: "responses"`), which matches OpenCode's Go endpoint table (`muse-spark-*` → `@ai-sdk/openai` / `/v1/responses`). The gateway validates every tool `parameters` schema on that endpoint and rejects the whole request when any nested subschema sits deeper than 10 levels.

`src/request/schema.ts` resolved `$ref`/`$defs`, stripped unsupported keywords, and guarded against cycles, but it never limited nesting depth. Deeply nested MCP schemas — the Postman `createCollection` tree (`collection` → `item` → nested folder `item` → `request` → `body`/`auth`) is the clearest offender — exceed the limit, so the request 400s before generation starts.

Why only Muse: chat-completions endpoints do not apply the same nesting check, so the identical schemas were accepted there. Grok uses the same Responses route, so the bug was latent for every `grok-*` model too.

## Fix

| File                      | Change                                                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`           | New `MAX_TOOL_SCHEMA_DEPTH = 10` (single source of truth).                                                                                                                                                                                                       |
| `src/request/schema.ts`   | `sanitizeJsonSchemaNode` now carries a `depth` through `properties`, `items`, `additionalProperties`, `anyOf`/`oneOf`/`allOf`, and resolved `$ref` targets. At the ceiling it emits a childless node with leaf keywords only (`type`, `description`, `enum`, …). |
| `src/test/schema.test.ts` | Three regression tests: a 25-level object chain is capped at 10, a schema exactly at the limit is preserved, and 25-level array `items` are capped too.                                                                                                          |

Returning `{}` for the children alone would not work: an empty child schema still counts as one level upstream. The node on the ceiling keeps its scalar hints but carries no `properties`/`items`/composition keyword, so the maximum reachable depth is exactly 10.

The guard lives in the shared sanitizer, so the OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Google builders all inherit it.

## Verification

- `npm test` — 551/551 pass, including the three new depth tests.
- `npm run lint` — all seven checks pass (editorconfig, ESLint, markdown, Prettier, shell, TypeScript, tests).
- Live Muse retry is pending: reload the extension and re-run the same chat. If a specific tool still trips a different 400, capture that body — the clamp guarantees no schema sent by the extension exceeds 10 nested schema levels.

## Notes

- Truncation only affects the copy of the schema sent to the model; tool-call validation still uses VS Code's real `inputSchema`, so executions are unchanged.
- If the gateway ever raises the limit, only `MAX_TOOL_SCHEMA_DEPTH` needs to change.
