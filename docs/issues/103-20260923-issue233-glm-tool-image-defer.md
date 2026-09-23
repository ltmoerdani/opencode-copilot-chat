# Issue #233 — glm-5.3-flash 422 on Images: Tool-Result Images Deferred to a User Message

**Status:** ✅ Solved — implemented + verified end-to-end
**Topic:** provider / serialization / vision / chat-completions
**Updated:** 2026-09-23
**Tags:** #tool-calling #vision #serialization #chat-completions
**GitHub Issue:** [ltmoerdani/opencode-copilot-chat#233](https://github.com/ltmoerdani/opencode-copilot-chat/issues/233)
**Related:** issue doc [34 — MCP tool result image](34-20260720-mcp-tool-result-image-dropped.md), issue doc [75 — #173 vision byte cap](75-20260821-issue173-vision-byte-cap.md), issue doc [102 — #239 reasoning echo self-heal](102-20260923-issue239-reasoning-echo-self-heal.md)

---

## Problem

On `glm-5.3-flash` (OpenCode Go), any conversation whose history contains a **tool result carrying an image** (e.g. a browser/screenshot MCP tool) failed on every subsequent turn:

```text
OpenCode Go API request failed (422) model=glm-5.3-flash payloadBytes=949611:
Error from provider (Console Go): Upstream request failed: [invalid_request_error]
Input should be a valid string
```

The tool result stays in the history, so like the MiMo #38 family, the failure repeats on every follow-up turn until a new conversation. Reported by @felocru (0.7.5).

## Root Cause (verified with a direct gateway reproducer)

Excellent community diagnosis in the issue (minimal repro matrix against `zen/go/v1/chat/completions`, model `glm-5.3-flash`):

| #   | Payload shape                                  | Result                                                               |
| --- | ---------------------------------------------- | -------------------------------------------------------------------- |
| 1   | user message, string content                   | 200                                                                  |
| 2   | user message, array with `image_url`           | **200 — vision works**                                               |
| 3   | user message, two text parts                   | 200                                                                  |
| 4   | assistant `tool_calls` with string arguments   | 200                                                                  |
| 5   | tool message, array of one **text** part       | 200                                                                  |
| 6   | **tool message, array containing `image_url`** | **422 — this issue**                                                 |
| 7   | assistant `tool_calls` with object arguments   | 422 (not reachable from our serializer — we always `JSON.stringify`) |

So the upstream **does** accept images in user messages — only **list-type content on `role: "tool"` messages** is rejected (the gateway returns the offending field, e.g. `messages.2.tool.content.str`). Our converter emits a multimodal array on tool messages whenever a tool result carries an image and the model isn't MiMo (doc 34) — glm-5.3-flash's Console Go upstream rejects exactly that. Notably it is a **422**, so the engine's 400-patch retry loop never engages — serialization is the only correct fix layer.

## Fix — per-upstream handling mode, images preserved

New pure mapping `requiresStringToolContent(rawModelId)` (`src/models/modelCapabilities.ts`):

| Mode      | Models        | Handling                                                                                                                                                                |
| --------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"drop"`  | `mimo-*`      | Unchanged #38 behavior: flatten to string, images replaced with placeholder notes (upstream cannot see tool images at all)                                              |
| `"defer"` | `glm-5.3*`    | Tool message flattened to a string with a pointer note; images **moved into a follow-up user message** — vision preserved (upstream accepts images there, per repro #2) |
| `null`    | everyone else | Multimodal tool content forwarded unchanged (kimi, glm-5.1/5.2, minimax, qwen)                                                                                          |

The deferred emission is a pure helper `withDeferredToolImageMessages()` (`src/request/shared.ts`, CONTRACT: no `vscode` import) called from `convertMessage()`'s `finish()`, so the appended user message lands after the tool results in the same conversion output and flows through the normal normalization/trim paths.

## Files Changed

| File                                       | Change                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/models/modelCapabilities.ts`          | `requiresStringToolContent()` — evidence-based per-upstream mapping (drop/defer/null)                |
| `src/request/shared.ts`                    | `withDeferredToolImageMessages()` + `DEFERRED_TOOL_IMAGES_NOTE` (pure, unit-tested)                  |
| `src/provider/messages.ts`                 | Tool branch reworked to the 3-mode gate; MiMo path byte-identical; `finish()` emits deferred message |
| `src/test/modelCapabilities.test.ts`       | 3 tests: defer for glm-5.3*, drop for mimo, null for other families                                  |
| `src/test/deferredToolImages.test.ts`      | 3 tests: append shape, no-op when empty, input not mutated                                           |
| `tmp/e2e-issues-233-239-serialization.mjs` | Serialization e2e simulation (decision chain + wire shapes, 13 checks)                               |

## Verification

- `npm run lint` (full 7-check gate) pass; 480/480 unit tests pass.
- E2E simulation (`tmp/e2e-issues-233-239-serialization.mjs`) — 13/13 pass, including regression guards: MiMo behavior unchanged (no deferred message), kimi-k3 multimodal forwarded unchanged, text-only tool results never change shape.
- Real-model manual test (Copilot Chat, glm-5.3-flash + screenshot tool, multi-turn) — PASS (2026-09-23).
- Note: `tool_calls[].function.arguments` (reproducer #7) is already always a string from our serializer — no change needed.

---

Detected 2026-09-16 | Reported by @felocru | Fixed 2026-09-23
