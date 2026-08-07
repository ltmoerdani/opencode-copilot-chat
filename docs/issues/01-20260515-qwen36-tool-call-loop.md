**Status:** ✅ Solved

# Qwen 3.6 Plus Free — Tool-Call Loop Investigation

**Topic:** streaming / tool-calling / routing / models / provider  
**Updated:** 2026-06-13  
**Tags:** #streaming #tool-calling #routing #models #qwen #anthropic-bridge #zen  
**Supersedes:** —

---

## Overview

`qwen3.6-plus-free` from OpenCode Zen can enter a repeated tool-call loop in VS Code Copilot Chat. The model is able to call workspace tools (`read_file`, `list_dir`, `manage_todo_list`), but in longer agent tasks it may keep requesting additional or repeated tool calls instead of synthesizing the final answer.

This document is backdated to the original investigation session on **2026-05-15**. It was verified against the current modular codebase on **2026-06-13**.

> **Resolution (2026-06-13):** All code-level issues are ✅ Solved. The Qwen routing (`isMessagesQwenModel()` in `src/routing.ts`), Anthropic SSE parser (`AnthropicResponseExtractor` in `src/streaming.ts`), and tool-call surfacing are all confirmed working in the codebase (fixed in v0.1.9/v0.1.10, CHANGELOG entries confirmed). The remaining "tool-call loop" is inherent model behavior on the free tier (`qwen3.6-plus-free`) when given overly broad prompts — the model keeps exploring instead of synthesizing. This is a model capability limitation, not a code bug. The proposed `flattenToolHistoryToText()` mitigation is documented as an optional future enhancement (see Proposed Next Fix section below) but was never implemented because the core code issues were all resolved.

---

## Current Status

| Field                      | Value                                                                         |
| -------------------------- | ----------------------------------------------------------------------------- |
| Status                     | ✅ Solved (all code-level issues fixed)                                       |
| Original session           | 2026-05-15                                                                    |
| Last codebase verification | 2026-06-13                                                                    |
| Affected model             | `qwen3.6-plus-free`                                                           |
| Provider                   | OpenCode Zen                                                                  |
| Current route in code      | `/messages` via `resolveModelRouting()`                                       |
| Current parser             | `AnthropicResponseExtractor`                                                  |
| Main unresolved issue      | Long agent runs can continue tool-calling instead of producing a final answer |

## Codebase Verification

Verified on 2026-06-13:

```bash
rg -n "isMessagesQwenModel|resolveModelRouting" src/routing.ts
rg -n "buildAnthropicMessagesRequestBody|buildAnthropicMessages" src/extension.ts
rg -n "AnthropicResponseExtractor|content_block_start|input_json_delta|tool_use" src/streaming.ts
rg -n "qwen3.6-plus-free|thinking.qwen" src package.json README.md CHANGELOG.md
```

Current routing in `src/routing.ts`:

```ts
function isMessagesQwenModel(modelId: string): boolean {
  return /^qwen3\.(?:5|6)-plus(?:-free)?$/i.test(modelId) || /^qwen3\.7-max$/i.test(modelId);
}
```

This means `qwen3.5-plus`, `qwen3.6-plus`, `qwen3.6-plus-free`, and `qwen3.7-max` currently route to the Anthropic-style `/messages` endpoint.

---

## Problem

When the user asks Copilot Chat to perform a broad workspace task, for example:

```text
Update all project documentation based on the current codebase.
Identify stale README/docs content, inspect features, and edit the files.
```

`qwen3.6-plus-free` may:

1. Start correctly by calling tools.
2. Read files and directories through Copilot tools.
3. Continue issuing more tool calls.
4. Repeat similar reads or directory listings.
5. Fail to produce the final synthesis or edits.

Observed tool pattern from the original session:

```text
[stream_debug] Anthropic tool_use start: index=2 name=read_file
[stream_debug] Anthropic tool_use stop: index=2 name=read_file inputLength=96
[stream_debug] Anthropic tool_use start: index=3 name=list_dir
[stream_debug] Anthropic tool_use stop: index=3 name=list_dir inputLength=63
[stream_debug] Anthropic tool_use start: index=4 name=read_file
[stream_debug] Anthropic tool_use stop: index=4 name=read_file inputLength=107
```

Observed empty or non-final turn pattern:

```json
{"message":{"model":"qwen3.6-plus","role":"assistant","type":"message","content":[],"usage":{"input_tokens":29082,"output_tokens":0}},"type":"message_start"}
{"type":"ping"}
{"delta":{"stop_reason":"end_turn"},"type":"message_delta","usage":{"output_tokens":11}}
```

---

## Root Cause Timeline

### 1. 2026-05-15 — Model Appeared Under Zen Free Catalog

**Problem:** `qwen3.6-plus-free` appeared in `https://opencode.ai/zen/v1/models`, but older local metadata/fallbacks did not fully account for it.

**Root Cause:** The free model was re-enabled by OpenCode Zen with limited capacity and was not covered by the initial metadata table.

**Actions Taken:**

- Added `qwen3.6-plus-free` to the Zen fallback list.
- Added bundled model metadata for context/output limits.
- Corrected the provider label so Zen failures do not say "OpenCode Go API request failed".

**Status:** ✅ Solved

### 2. 2026-05-15 — Context Size Display Was Wrong

**Problem:** VS Code's model picker/context indicator showed inflated context values.

**Root Cause:** Earlier code advertised context as:

```text
contextWindow + maxOutputTokens
```

This made the context display larger than the real provider context.

**Actions Taken:**

- Changed advertised context metadata to stay inside the actual context window.
- Later releases moved model limits into per-provider metadata so Go and Zen models with the same ID do not contaminate each other.

**Status:** ✅ Solved

### 3. 2026-05-15 — Stream Shape Was Not OpenAI-Only

**Problem:** The extension initially expected OpenAI-style chat-completions stream chunks:

```json
{ "choices": [{ "delta": { "content": "..." } }] }
```

But the gateway returned Anthropic-style SSE for Qwen:

```json
{"type":"message_start","message":{"content":[]}}
{"type":"content_block_start","content_block":{"type":"thinking","thinking":""},"index":0}
{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"..."}}
```

**Root Cause:** Qwen on the OpenCode gateway is backed by an Anthropic-style transport in at least some routes/tiers. The response stream can be Anthropic-shaped even when the model is conceptually exposed through Zen.

**Actions Taken:**

- Added/expanded Anthropic SSE parsing.
- Added support for:
  - `message_start`
  - `content_block_start`
  - `content_block_delta`
  - `message_delta`
  - `message_stop`
  - `tool_use`
  - `input_json_delta`
  - `thinking_delta`
- Ensured `tool_use` becomes `vscode.LanguageModelToolCallPart`.

**Status:** ✅ Solved for parsing

### 4. 2026-05-15 — Tool Calls Worked, But Tool Loop Continued

**Problem:** After parsing was fixed, Copilot tool calls executed, but Qwen continued calling tools instead of finalizing.

**Evidence:**

The `messages` count increased across turns, which confirms Copilot received tool calls and returned tool results:

```text
messages=120 → 123 → 126 → 130 → 133 → 138
```

**Root Cause Candidates:**

| Candidate                                     | Current Assessment                                                |
| --------------------------------------------- | ----------------------------------------------------------------- |
| Parser drops tool calls                       | Unlikely after Anthropic parser fix; logs show tool calls emitted |
| Tool results are missing from history         | Possible in some earlier request-shape experiments                |
| Model ignores results and keeps exploring     | Likely for broad tasks with many files                            |
| Gateway reintroduces tool access from history | Possible when history contains many prior tool calls              |
| User prompt is too broad for the free tier    | Likely contributes                                                |

**Actions Tried:**

| Attempt                                   | Result                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Buffer pre-tool text                      | Prevented repeated narration but did not stop structural loop                                         |
| Dedupe repeated exact tool calls          | Stops identical calls only; does not stop distinct path exploration                                   |
| Anti-loop system instruction              | Helps but cannot guarantee model compliance                                                           |
| Hard cap by total tool results            | Too aggressive because old chat history can contain many tool results                                 |
| OpenAI-shaped history on chat-completions | Tried in earlier single-file implementation, but current codebase now routes Qwen through `/messages` |

**Status:** ✅ Solved — model behavior limitation documented

---

## Current Architecture

### Request Flow

```mermaid
graph TD
    A[Copilot Chat] --> B[provideLanguageModelChatResponse]
    B --> C[convertMessage]
    C --> D[normalizeMessages]
    D --> E[resolveModelRouting]
    E -->|Qwen 3.x| F[/messages endpoint]
    F --> G[buildAnthropicMessagesRequestBody]
    G --> H[buildAnthropicMessages]
    H --> I[runStreamAnthropicMessages]
    I --> J[AnthropicResponseExtractor]
    J -->|tool_use| K[LanguageModelToolCallPart]
    K --> L[Copilot executes workspace tool]
    L --> M[Next request includes tool result]
```

### Relevant Files

| File                  | Responsibility                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `src/routing.ts`      | Chooses `/messages`, `/chat/completions`, `/responses`, or Google transport                |
| `src/extension.ts`    | Converts VS Code messages, builds request bodies, applies model metadata/thinking settings |
| `src/streaming.ts`    | Parses OpenAI, Anthropic, Responses, and Google streams into VS Code response parts        |
| `src/openCodeAuth.ts` | Builds endpoint-specific auth headers                                                      |
| `src/metadata.ts`     | Provides per-provider model metadata and fallback limits                                   |

### Current Qwen Route

| Model               | Provider | Current endpoint | Parser    |
| ------------------- | -------- | ---------------- | --------- |
| `qwen3.5-plus`      | Go / Zen | `/messages`      | Anthropic |
| `qwen3.6-plus`      | Go / Zen | `/messages`      | Anthropic |
| `qwen3.6-plus-free` | Zen      | `/messages`      | Anthropic |
| `qwen3.7-max`       | Go       | `/messages`      | Anthropic |

---

## Important Lessons

### Do Not Rely on Chat UI Text Samples

Repeated text such as:

```text
I will inspect the codebase...
```

is only a symptom. The fix must be based on stream structure and tool-call history, not on hardcoded phrases.

### Do Not Count Total Historical Tool Results as a Loop Guard

A guard such as:

```text
if totalToolResults >= 10 then stop
```

is unsafe because Copilot history can already contain many tool results from earlier retries. It can stop a fresh request immediately.

### Exact Tool-Call Dedupe Is Only Partial

Signature-based dedupe:

```text
toolName + stableStringify(input)
```

can prevent identical repeats, but it does not stop exploration loops such as:

```text
read_file(A)
read_file(B)
list_dir(C)
read_file(D)
...
```

### Broad Agent Tasks Need a Tool Budget

The unresolved part is not simple parsing anymore. It is an agent-control problem: after enough evidence, the model must synthesize instead of continuing to inspect.

---

## Proposed Next Fix

Implement a Qwen-specific tool-history flattening strategy after a per-request threshold, not a whole-history threshold.

### Trigger

Apply only when all are true:

1. Model ID matches `qwen3.*`.
2. Current route is `/messages`.
3. The current active tool loop has exceeded a small threshold, e.g. 4-6 tool round-trips.
4. The model has not emitted final text.

### Strategy

Before sending the next request to Qwen:

1. Convert prior assistant `tool_use` blocks into plain assistant text:

```text
[Tool call already completed: read_file {"path":"README.md"}]
```

2. Convert `tool_result` blocks into plain user text:

```text
[Tool result for read_file README.md]
<truncated result>
```

3. Remove all structured `tool_use` / `tool_result` blocks from the history.

4. Omit `tools` from the request body for this forced-synthesis turn.

5. Append a final user instruction:

```text
You have enough tool results. Do not call tools. Write the final answer or edit plan now using only the information above.
```

### Why This Is Safer

It removes the structured evidence that allows the gateway/model to continue the tool protocol and turns the prior tool results into plain conversation context.

### Open Implementation Questions

| Question                                  | Notes                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Where to detect active loop?              | Prefer request-local loop state over total historical count                                    |
| Should this be configurable?              | A setting like `opencodego.qwenToolBudget` may be useful                                       |
| How much tool result text to keep?        | 1500-3000 chars per result is probably enough                                                  |
| Should edits be allowed after flattening? | For edit tasks, flattening may prevent tool-based edits; use only when repeated reads dominate |

---

## Verification Plan

### Static Checks

```bash
npm run compile
rg -n "isMessagesQwenModel|resolveModelRouting" src/routing.ts
rg -n "buildAnthropicMessagesRequestBody|buildAnthropicMessages" src/extension.ts
rg -n "class AnthropicResponseExtractor|content_block_start|input_json_delta" src/streaming.ts
```

### Manual Test

Use a new Copilot Chat thread to avoid old tool-result history.

1. Select `OpenCode Zen / Qwen 3.6 Plus Free`.
2. Ask a bounded workspace task:

```text
Read README.md and package.json, then summarize whether README is up to date. Do not inspect more than those two files.
```

3. Expected result:
   - At most 2-3 tool calls.
   - Final answer appears.
   - No repeated `read_file` for the same path.

4. Then test a broad task:

```text
Audit docs for stale references and propose updates. Stop after reading at most 6 files.
```

5. Expected result:
   - Tool calls stop near the budget.
   - Final synthesis appears.
   - No runaway loop.

### Debug Logs To Watch

```text
Request: ... rawModel=qwen3.6-plus-free endpoint=messages
Anthropic tool_use start
Anthropic tool_use stop
message_delta stop_reason=end_turn
```

---

## Files Changed Historically

| Date       | File                                               | Purpose                                            |
| ---------- | -------------------------------------------------- | -------------------------------------------------- |
| 2026-05-15 | `src/extension.ts`                                 | Initial single-file parser/request experiments     |
| 2026-05-15 | `CHANGELOG.md`                                     | Recorded Qwen free/context/tool-call findings      |
| 2026-06-04 | `src/routing.ts`                                   | Qwen routing work across chat-completions/messages |
| 2026-06-05 | `src/streaming.ts`                                 | Anthropic SSE parser improvements                  |
| 2026-06-13 | `docs/issues/01-20260515-qwen36-tool-call-loop.md` | Consolidated issue history and active fix plan     |

---

## Security Notes

- No API keys or user secrets are needed to debug this issue.
- Logs may contain file paths and snippets of local project content. Treat pasted logs as local diagnostic data.
- Do not paste real OpenCode API keys into issue documents or devlog entries.

---

_Backdated issue document: 2026-05-15. Last verified against codebase: 2026-06-13._
