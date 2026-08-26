/**
 * Runtime retry decisions for HTTP failures.
 *
 * Two distinct retry families are handled here:
 * 1. Degraded-parameter retry for HTTP 400 errors (see analyzeHttp400ForRetry).
 * 2. Transient 5xx classification (see isTransientServerError) for short
 *    backoff retries when the gateway router is temporarily unavailable.
 *
 * CONTRACT:
 * - Pure functions only — no vscode import, no side effects.
 * - analyzeHttp400ForRetry handles recoverable parameter errors and context
 *   overflows with authoritative token counts. Auth (401/403), rate limit
 *   (429), and permanent server errors are NOT retried via parameter patching.
 *   At most ONE retry per request avoids infinite loops.
 * - isTransientServerError only flags server conditions that are known to be
 *   momentary (router capacity / upstream churn). Unknown 5xx payloads are NOT
 *   retried so real bugs surface instead of being masked by retries.
 */

import { compactErrorCode, getErrorMessage, positiveNumber } from "./utils";
import { CONTEXT_RETRY_MIN_SAFETY_TOKENS, CONTEXT_RETRY_SAFETY_RATIO } from "./config";

export { TRANSIENT_5XX_MAX_RETRIES, TRANSIENT_5XX_RETRY_BASE_MS, TRANSIENT_5XX_RETRY_JITTER_MS } from "./config";
export { TRANSIENT_FETCH_MAX_RETRIES, TRANSIENT_FETCH_RETRY_BASE_MS, TRANSIENT_FETCH_RETRY_JITTER_MS } from "./config";

/**
 * Classify a fetch error as transient (worth retrying) vs. permanent.
 *
 * RULES:
 * - Network-layer errors (DNS, TCP reset, connect timeout, socket errors)
 *   are transient — undici exposes the real code via `error.cause`.
 * - HTTP 4xx (except 408/429) is permanent — retrying won't help.
 * - HTTP 408/429/5xx is transient — gateway/rate-limit style failures.
 *   These arrive via the "Model list request failed (NNN): ..." message
 *   that `fetchModels()` throws on a non-2xx response.
 * - AbortError from a CancellationToken is NEVER retried. TimeoutError from
 *   AbortSignal.timeout is transient and can be retried.
 *
 * This is the shared classifier used by both the model-list fetch (issue #78)
 * and the chat-request transport (engine.ts) so transient socket races
 * (nodejs/undici#5450) don't surface as hard failures.
 */
export function isTransientFetchError(error: unknown): boolean {
  // DOMException is a global since Node 17; guard anyway so a hypothetical
  // older host never crashes inside error classification.
  if (typeof DOMException === "function" && error instanceof DOMException) {
    if (error.name === "AbortError") return false;
    if (error.name === "TimeoutError") return true;
  }
  const cause = (error as { cause?: { code?: string; name?: string } } | undefined)?.cause;
  const code = cause?.code ?? (error as { code?: string } | undefined)?.code;
  const name = cause?.name ?? (error as { name?: string } | undefined)?.name;
  // undici network error codes
  if (code && /^E(AI_AGAIN|CONNRESET|CONNREFUSED|CONNABORTED|TIMEDOUT|HOSTUNREACH|NETUNREACH|PROTO|PIPE)$/.test(code)) {
    return true;
  }
  if (name && /^UND_ERR_(CONNECT_TIMEOUT|SOCKET|REQUEST_TIMEOUT)$/.test(name)) {
    return true;
  }
  // TypeError: fetch failed (the generic wrapper undici throws) — always retry;
  // if the cause turns out to be non-transient, the inner check above handles it.
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) return true;
  // Extract HTTP status from either an explicit `.status` field or the
  // "Model list request failed (NNN): ..." message pattern.
  const explicitStatus = (error as { status?: number } | undefined)?.status;
  const msg = getErrorMessage(error);
  const msgMatch = msg.match(/\((\d{3})\)/);
  const httpStatus = typeof explicitStatus === "number" ? explicitStatus : msgMatch ? Number(msgMatch[1]) : undefined;
  if (typeof httpStatus === "number") {
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return true;
    return false;
  }
  return false;
}

/** Result of attempting to patch a request body for retry. */
export interface RetryPatch {
  /** The patched request body, or undefined if no patch was possible. */
  body: Record<string, unknown> | undefined;
  /** Human-readable description of what was changed (for logging). */
  reason: string;
}

/**
 * Patterns that indicate a recoverable 400 error caused by an unsupported
 * parameter value. Each pattern has a regex to match the error message and
 * a function to patch the request body.
 *
 * Order matters: more specific patterns should come first.
 */
const RECOVERABLE_ERROR_PATTERNS: {
  pattern: RegExp;
  patch: (body: Record<string, unknown>, match?: RegExpMatchArray) => Record<string, unknown>;
  describe: (match: RegExpMatchArray) => string;
}[] = [
  // --- Thinking errors ---
  // "invalid thinking: only type=enabled is allowed for this model"
  {
    pattern: /invalid thinking[:\s]+only type=enabled/i,
    patch: (body) => {
      const next = { ...body };
      if (next.thinking && typeof next.thinking === "object") {
        next.thinking = { ...(next.thinking as Record<string, unknown>), type: "enabled" };
      }
      return next;
    },
    describe: () => "forced thinking.type='enabled'",
  },
  // "invalid thinking: only type=disabled is allowed"
  {
    pattern: /invalid thinking[:\s]+only type=disabled/i,
    patch: (body) => {
      const next = { ...body };
      delete next.thinking;
      return next;
    },
    describe: () => "removed thinking field (model requires disabled)",
  },
  // "This model always engages in thinking and cannot be disabled" (GLM 5.3+)
  // Scoped to thinking-related phrasing so unrelated "cannot be disabled"
  // errors never trigger a thinking-strip retry.
  {
    pattern: /always engages in thinking|thinking.*cannot be disabled/i,
    patch: (body) => {
      const next = { ...body };
      delete next.thinking;
      return next;
    },
    describe: () => "removed thinking field (model cannot disable thinking)",
  },
  // Generic "invalid thinking" — strip the field entirely
  {
    pattern: /invalid thinking/i,
    patch: (body) => {
      const next = { ...body };
      delete next.thinking;
      return next;
    },
    describe: () => "removed thinking field",
  },

  // --- Thinking tag errors ---
  // "Extra inputs are not permitted, field: 'enable_thinking'"
  {
    pattern: /extra inputs are not permitted.*enable_thinking/i,
    patch: (body) => {
      const next = { ...body };
      delete next.enable_thinking;
      return next;
    },
    describe: () => "removed enable_thinking (not accepted by this model)",
  },

  // --- Temperature errors ---
  // "invalid temperature: only 1 is allowed for this model"
  {
    pattern: /invalid temperature[:\s]+only \d+(\.\d+)? is allowed/i,
    patch: (body) => {
      const next = { ...body };
      delete next.temperature;
      return next;
    },
    describe: () => "removed temperature (model has fixed value)",
  },
  // Generic "invalid temperature"
  {
    pattern: /invalid temperature/i,
    patch: (body) => {
      const next = { ...body };
      delete next.temperature;
      return next;
    },
    describe: () => "removed temperature",
  },

  // --- Reasoning effort errors ---
  // "MiniMax M2 only accepts string reasoning_effort values"
  {
    pattern:
      /reasoning_effort|reasoning_effort.*(?:string|only accepts|invalid|unsupported)|(?:string|only accepts|invalid|unsupported).*reasoning_effort/i,
    patch: (body) => {
      const next = { ...body };
      delete next.reasoning_effort;
      return next;
    },
    describe: () => "removed reasoning_effort (unsupported value)",
  },
  // "Extra inputs are not permitted, field: 'reasoning_effort'"
  {
    pattern: /extra inputs are not permitted.*reasoning_effort/i,
    patch: (body) => {
      const next = { ...body };
      delete next.reasoning_effort;
      return next;
    },
    describe: () => "removed reasoning_effort (not accepted by this model)",
  },

  // --- Thinking budget errors ---
  {
    pattern: /extra inputs are not permitted.*thinking_budget/i,
    patch: (body) => {
      const next = { ...body };
      delete next.thinking_budget;
      return next;
    },
    describe: () => "removed thinking_budget (not accepted by this model)",
  },
  // budget_tokens — used by Mimo thinking payload to cap reasoning tokens
  {
    pattern: /extra inputs are not permitted.*budget_tokens/i,
    patch: (body) => {
      const next = { ...body };
      delete next.budget_tokens;
      return next;
    },
    describe: () => "removed budget_tokens (not accepted by this model)",
  },

  // --- Generic extra inputs ---
  // "Extra inputs are not permitted, field: '<field>'"
  {
    pattern: /extra inputs are not permitted.*field:\s*'([^']+)'/i,
    patch: (body, match) => {
      const fieldName = match?.[1];
      if (!fieldName) return body;
      const next = { ...body };
      next[fieldName] = undefined;
      return next;
    },
    describe: (match) => `removed field '${match[1]}' (not accepted by this model)`,
  },
];

/**
 * Check if an HTTP 400 error is recoverable by patching the request body.
 * Returns a RetryPatch if the error is recoverable, undefined otherwise.
 *
 * @param errorMessage The error message from the API response body
 * @param body The original request body (will not be mutated)
 * @returns RetryPatch if recoverable, undefined otherwise
 */
export function analyzeHttp400ForRetry(errorMessage: string, body: Record<string, unknown>): RetryPatch | undefined {
  const contextPatch = patchContextOverflow(errorMessage, body);
  if (contextPatch) return contextPatch;

  const capPatch = patchMaxTokensCap(errorMessage, body);
  if (capPatch) return capPatch;

  const degradedPatch = patchInvalidInput(errorMessage, body);
  if (degradedPatch) return degradedPatch;

  for (const { pattern, patch, describe } of RECOVERABLE_ERROR_PATTERNS) {
    const match = errorMessage.match(pattern);
    if (match) {
      const patchedBody = patch(body, match);
      // Verify the patch actually changed something
      if (JSON.stringify(patchedBody) !== JSON.stringify(body)) {
        return {
          body: patchedBody,
          reason: describe(match),
        };
      }
    }
  }
  return undefined;
}

function patchContextOverflow(errorMessage: string, body: Record<string, unknown>): RetryPatch | undefined {
  const contextWindow = parseTokenCount(errorMessage.match(/maximum context length is\s*([\d,]+)\s*tokens?/i)?.[1]);
  const requestedTokens = parseTokenCount(errorMessage.match(/you requested\s*([\d,]+)\s*tokens?/i)?.[1]);
  if (contextWindow === undefined || requestedTokens === undefined) return undefined;

  const target = findOutputTarget(body);
  if (target.configuredOutput === undefined) return undefined;

  const reportedOutput = parseTokenCount(errorMessage.match(/([\d,]+)\s+in the (?:completion|output)/i)?.[1]);
  const currentOutput = reportedOutput ?? target.configuredOutput;
  const overflow = requestedTokens - contextWindow;
  if (overflow <= 0) return undefined;

  const safetyMargin = Math.max(CONTEXT_RETRY_MIN_SAFETY_TOKENS, Math.ceil(contextWindow * CONTEXT_RETRY_SAFETY_RATIO));
  const nextOutput = Math.floor(currentOutput - overflow - safetyMargin);
  if (nextOutput < 1 || nextOutput >= target.configuredOutput) {
    return undefined;
  }

  const patchedBody = applyOutputTarget(body, target, nextOutput);

  return {
    body: patchedBody,
    reason: `reduced ${target.label} from ${String(target.configuredOutput)} to ${String(nextOutput)} using upstream context counts`,
  };
}

/**
 * Clamp the output budget to the completion cap the upstream reports when it
 * rejects the request outright. OpenCode Go now enforces per-model completion
 * caps that models.dev does not yet reflect:
 * "max_tokens is too large: 384000. This model supports at most 131072
 * completion tokens" (issue #171). Clamping to the reported cap makes any
 * stale-metadata model self-heal with one retry instead of a hard failure.
 */
function patchMaxTokensCap(errorMessage: string, body: Record<string, unknown>): RetryPatch | undefined {
  const cap = parseTokenCount(
    errorMessage.match(/max_tokens is too large:\s*[\d,]+\.?\s*This model supports at most\s*([\d,]+)\s+completion tokens/i)?.[1],
  );
  if (cap === undefined) return undefined;

  const target = findOutputTarget(body);
  if (target.configuredOutput === undefined || target.configuredOutput <= cap) return undefined;

  return {
    body: applyOutputTarget(body, target, cap),
    reason: `capped ${target.label} from ${String(target.configuredOutput)} to ${String(cap)} (upstream completion limit)`,
  };
}

/**
 * Degrade the request when the upstream rejects it with a generic
 * "[1210] Invalid API parameter … invalid input" (issue #190, ox-alpha-free).
 *
 * The gateway gives no hint WHICH parameter is invalid, so the retry strips
 * optional parameters in order of least-likely-to-matter first, one per
 * engine retry attempt (the engine retries the patched body once per 400):
 *
 *   attempt 1 → drop `stream_options` (usage accounting nicety)
 *   attempt 2 → drop `temperature` (fall back to the model default)
 *   attempt 3 → drop image parts (some models reject data-URL images even
 *               when metadata claims vision support)
 *
 * Each patch only fires when the parameter is actually present, so the
 * sequence naturally stops once everything optional is gone and the request
 * fails for real.
 */
function patchInvalidInput(errorMessage: string, body: Record<string, unknown>): RetryPatch | undefined {
  if (!/\[\s*1210\s*\]/.test(errorMessage) || !/invalid input|invalid api parameter/i.test(errorMessage)) {
    return undefined;
  }

  // 1. stream_options — pure accounting hint, safest to drop.
  if (body.stream_options !== undefined) {
    const next = { ...body };
    delete next.stream_options;
    return { body: next, reason: "removed stream_options ([1210] invalid input degradation)" };
  }

  // 2. temperature — fall back to the model's own default.
  if (body.temperature !== undefined) {
    const next = { ...body };
    delete next.temperature;
    return { body: next, reason: "removed temperature ([1210] invalid input degradation)" };
  }

  // 3. Image parts — some models reject data-URL images despite metadata.
  const messages = Array.isArray(body.messages) ? body.messages : undefined;
  if (
    messages?.some((m) => {
      if (typeof m !== "object" || m === null) return false;
      const content = (m as Record<string, unknown>).content;
      return (
        Array.isArray(content) &&
        content.some((p) => typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "image_url")
      );
    })
  ) {
    const nextMessages = messages.map((m) => {
      if (typeof m !== "object" || m === null) return m as Record<string, unknown>;
      const msg = m as Record<string, unknown>;
      const content = msg.content;
      if (
        !Array.isArray(content) ||
        !content.some((p) => typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "image_url")
      ) {
        return msg;
      }
      const textParts = content
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "text")
        .map((p) => p.text)
        .filter((t): t is string => typeof t === "string");
      return { ...msg, content: [{ type: "text", text: textParts.join("\n") || "[Image removed — rejected by the model]" }] };
    });
    return { body: { ...body, messages: nextMessages }, reason: "removed image parts ([1210] invalid input degradation)" };
  }

  return undefined;
}

interface OutputTarget {
  /** Top-level body key carrying the output budget, if present. */
  outputKey?: "max_tokens" | "max_output_tokens" | "max_completion_tokens";
  generationConfig: Record<string, unknown>;
  configuredOutput?: number;
  label: string;
}

function findOutputTarget(body: Record<string, unknown>): OutputTarget {
  const outputKey = ["max_tokens", "max_output_tokens", "max_completion_tokens"].find((key) => positiveNumber(body[key]) !== undefined) as
    OutputTarget["outputKey"] | undefined;
  const generationConfig = recordValue(body.generationConfig) ?? {};
  const configuredOutput = outputKey ? positiveNumber(body[outputKey]) : positiveNumber(generationConfig.maxOutputTokens);
  return { outputKey, generationConfig, configuredOutput, label: outputKey ?? "generationConfig.maxOutputTokens" };
}

function applyOutputTarget(body: Record<string, unknown>, target: OutputTarget, value: number): Record<string, unknown> {
  return target.outputKey
    ? { ...body, [target.outputKey]: value }
    : { ...body, generationConfig: { ...target.generationConfig, maxOutputTokens: value } };
}

function parseTokenCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return positiveNumber(Number(value.replaceAll(",", "")));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * Classify an HTTP error as a transient server failure worth retrying.
 *
 * - 502/503/504 are transient by definition (gateway churn, upstream down).
 * - Other 5xx are retried only when the response body identifies the known
 *   momentary condition `Router.Unavailable` (the OpenCode Zen gateway
 *   reports it when no healthy backend is currently reachable for a model).
 * - Anything else (including 500s with unrelated bodies) is permanent.
 */
export function isTransientServerError(status: number, errorDetail: string): boolean {
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }
  return status >= 500 && /RouterUnavailable/i.test(compactErrorCode(errorDetail));
}
