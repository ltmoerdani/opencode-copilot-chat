**Status:** 🟢 Active

# Beam Free — Reasoning Configuration and Agent Loop Fix

**Topic:** thinking / streaming / tool-calling / models / provider
**Updated:** 2026-10-31
**Tags:** #beam #thinking #reasoning #tool-calling #streaming #models
**Supersedes:** —

---

## Overview

`beam-free` was routed to OpenAI-compatible chat-completions but had no
dedicated thinking strategy. That was unsafe because Reflection documents Beam
as an always-reasoning model: it accepts `low`, `medium`, `high`, `xhigh`, and
`max`, and does not support a reasoning-off value.

## Root Cause

The registry classified Beam with `thinkingFamily: null`. Offline fallback
metadata also did not classify `beam-*` as reasoning-capable, while the generic
thinking default was `off`. Depending on metadata availability, the extension
could either hide the thinking picker or omit `reasoning_effort`, leaving the
gateway to apply its default effort (documented as organization-dependent and
shown as `max` in Reflection's example model response). Beam reasoning history
was also not included by the generic family-based replay gate.

## Fix

- Added `BeamThinking` with the official effort set and default `low`.
- Normalized stale workspace/per-model `off` values to `low`.
- Added Beam to the registry's thinking family and history replay path.
- Added Go fallback metadata for the documented 1,048,576-token context and
  131,072-token output limits.
- Added regression tests for payload, schema, metadata, registry, and history.
- Added a Beam-only circuit breaker: three identical tool-call turns, or eight
  consecutive tool-calling turns since the last user prompt, now trigger a
  tool-free recovery turn with an explicit finalization instruction. This
  bounds the agent loop while still giving Beam one chance to return an answer
  when it varies file paths or arguments without converging.

No `repetition_penalty` was added: Reflection documents that parameter as a
server-applied default that cannot be set per request, and unsupported request
parameters may return HTTP 400.

## Verification

- `npm test` — passed (including the Beam tool-loop guard regression tests)
- `npm run lint` — passed (all 7 checks)
- `npm run compile` — passed as part of `npm test`
- Live references checked 2026-10-31:
  - Reflection Models API: <https://developers.reflection.ai/models>
  - Reflection OpenAI compatibility: <https://developers.reflection.ai/openai-compatibility>
  - OpenCode Go model catalog: <https://opencode.ai/v2/docs/console/go/>

## Remaining Follow-up

The pasted live trace showed successful `stop` responses with repeated
`tool_calls`, growing history, and `reasoning_effort=max`; it did not show HTTP
retries or empty-stream recovery. The new guard addresses that client-side
agent loop. After reloading the extension, a live multi-turn run should verify
that the guard log appears, the recovery request has no tools, and the model
returns a final answer. Existing
workspace configuration may still explicitly select `max`; lowering it to
`medium` or `low` can reduce how much reasoning precedes the guard.
