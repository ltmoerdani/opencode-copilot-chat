interface ParsedApiError {
  message?: string;
  code?: string;
  type?: string;
  retryIn?: string;
}

interface RateLimitInfo {
  retryAfterMs?: number;
  resetAfterMs?: number;
  requestLimit?: string;
  requestRemaining?: string;
  tokenLimit?: string;
  tokenRemaining?: string;
}

export class OpenCodeRequestError extends Error {
  constructor(
    message: string,
    readonly userMessage: string = message,
  ) {
    super(message);
    this.name = "OpenCodeRequestError";
  }
}

export function buildOpenCodeRequestError(
  providerDisplayName: string,
  response: Response,
  rawDetail: string,
  modelId: string | undefined,
  payloadBytes: number,
  capacityHint: string,
): OpenCodeRequestError {
  const apiError = parseApiError(rawDetail);
  const rateLimitInfo = readRateLimitInfo(response.headers);
  const modelHint = modelId ? ` model=${modelId}` : "";
  const sizeHint = ` payloadBytes=${payloadBytes}`;
  const apiMessage = (apiError.message ?? rawDetail.trim()) || response.statusText;
  const isLimit = isRateLimitResponse(response.status, apiError);

  if (isLimit) {
    const waitText = apiError.retryIn ?? formatWaitText(rateLimitInfo.retryAfterMs ?? rateLimitInfo.resetAfterMs);
    const quotaText = formatRateLimitSummary(rateLimitInfo);
    const reason = classifyRateLimit(apiError, response.status);
    const details = [
      shouldIncludeApiMessage(apiMessage, reason) ? apiMessage : undefined,
      waitText ? `Retry after ${waitText}.` : undefined,
      quotaText ? `Quota: ${quotaText}.` : undefined,
    ].filter((part): part is string => Boolean(part));
    const userMessage = `${providerDisplayName}: ${reason}${modelHint ? ` (${modelId})` : ""}. ${details.join(" ")}`.trim();
    return new OpenCodeRequestError(
      `${providerDisplayName} API rate/quota limit (${response.status})${modelHint}${sizeHint}: ${apiMessage}; ${quotaText || "no quota headers"}`,
      userMessage,
    );
  }

  const userMessage = `${providerDisplayName} API request failed (HTTP ${response.status})${modelHint ? ` for ${modelId}` : ""}: ${describeRouterUnavailable(apiError, apiMessage)}${capacityHint}`;
  const requestMessage = `${providerDisplayName} API request failed (${response.status})${modelHint}${sizeHint}${capacityHint}: ${apiMessage}`;
  return new OpenCodeRequestError(requestMessage, userMessage);
}

/**
 * Replace the raw gateway JSON detail with an actionable hint when the error
 * is the transient `Router.Unavailable` condition (no healthy backend for
 * the model right now). Returns the original message otherwise.
 */
function describeRouterUnavailable(apiError: ParsedApiError, fallback: string): string {
  const type = apiError.type?.toLowerCase() ?? "";
  if (!type.includes("routerunavailable")) {
    return fallback;
  }
  return "OpenCode's router has no healthy backend for this model right now. Retry in a few seconds, or switch to another model.";
}

export function truncateForLog(value: string, max = 1200): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}… (+${collapsed.length - max} chars)` : collapsed;
}

function parseApiError(rawDetail: string): ParsedApiError {
  const fallback = rawDetail.trim();
  if (!fallback) {
    return {};
  }

  try {
    const parsed = JSON.parse(fallback) as unknown;
    if (!isRecord(parsed)) {
      return { message: fallback };
    }

    const error = isRecord(parsed.error) ? parsed.error : parsed;
    return {
      message: firstString(error.message, parsed.message, fallback),
      code: firstString(error.code, parsed.code),
      type: firstString(error.type, parsed.type),
      retryIn: firstString(error.retryIn, parsed.retryIn, error.retry_in, parsed.retry_in),
    };
  } catch {
    return { message: fallback };
  }
}

export function readRateLimitInfo(headers: Headers): RateLimitInfo {
  const retryAfter = firstHeader(headers, ["retry-after"]);
  const requestLimit = firstHeader(headers, [
    "x-ratelimit-limit-requests",
    "anthropic-ratelimit-requests-limit",
    "x-ratelimit-limit",
    "ratelimit-limit",
  ]);
  const requestRemaining = firstHeader(headers, [
    "x-ratelimit-remaining-requests",
    "anthropic-ratelimit-requests-remaining",
    "x-ratelimit-remaining",
    "ratelimit-remaining",
  ]);
  const tokenLimit = firstHeader(headers, ["x-ratelimit-limit-tokens", "anthropic-ratelimit-tokens-limit"]);
  const tokenRemaining = firstHeader(headers, ["x-ratelimit-remaining-tokens", "anthropic-ratelimit-tokens-remaining"]);
  const reset = firstHeader(headers, [
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-reset",
    "x-ratelimit-reset",
    "ratelimit-reset",
  ]);

  return {
    retryAfterMs: parseRetryAfter(retryAfter),
    resetAfterMs: parseResetAfter(reset),
    requestLimit,
    requestRemaining,
    tokenLimit,
    tokenRemaining,
  };
}

export function formatRateLimitSummary(info: RateLimitInfo): string | undefined {
  const parts = [
    info.requestRemaining || info.requestLimit
      ? `requests remaining=${info.requestRemaining ?? "?"}${info.requestLimit ? `/${info.requestLimit}` : ""}`
      : undefined,
    info.tokenRemaining || info.tokenLimit
      ? `tokens remaining=${info.tokenRemaining ?? "?"}${info.tokenLimit ? `/${info.tokenLimit}` : ""}`
      : undefined,
    info.retryAfterMs !== undefined ? `retry-after=${formatDuration(info.retryAfterMs)}` : undefined,
    info.resetAfterMs !== undefined ? `reset=${formatDuration(info.resetAfterMs)}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? parts.join("; ") : undefined;
}

function classifyRateLimit(apiError: ParsedApiError, status: number): string {
  const code = `${apiError.code ?? ""} ${apiError.type ?? ""} ${apiError.message ?? ""}`.toLowerCase();
  const compactCode = compactErrorCode(code);
  if (compactCode.includes("gosubscriptionrollinglimitexceeded")) {
    return "5-hour OpenCode Go usage limit reached";
  }
  if (compactCode.includes("gosubscriptionweeklylimitexceeded")) {
    return "weekly OpenCode Go usage limit reached";
  }
  if (compactCode.includes("gosubscriptionmonthlylimitexceeded")) {
    return "monthly OpenCode Go usage limit reached";
  }
  if (code.includes("subscriptionquota") || code.includes("quota")) {
    return "OpenCode quota exceeded";
  }
  return status === 429 ? "rate limit exceeded" : "OpenCode usage limit reached";
}

function isRateLimitResponse(status: number, apiError: ParsedApiError): boolean {
  const code = `${apiError.code ?? ""} ${apiError.type ?? ""} ${apiError.message ?? ""}`.toLowerCase();
  const compactCode = compactErrorCode(code);
  return (
    status === 429 ||
    compactCode.includes("ratelimit") ||
    code.includes("rate_limit") ||
    code.includes("quota") ||
    compactCode.includes("limitexceeded")
  );
}

function compactErrorCode(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function shouldIncludeApiMessage(apiMessage: string, reason: string): boolean {
  const normalizedMessage = compactErrorCode(apiMessage.toLowerCase());
  const normalizedReason = compactErrorCode(reason.toLowerCase());
  return Boolean(normalizedMessage) && !normalizedMessage.startsWith(normalizedReason);
}

function firstHeader(headers: Headers, names: string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : parseDurationLike(value);
}

function parseResetAfter(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    if (numeric > 1_000_000_000_000) {
      return Math.max(0, numeric - Date.now());
    }
    if (numeric > 1_000_000_000) {
      return Math.max(0, numeric * 1000 - Date.now());
    }
    return numeric * 1000;
  }
  const durationMs = parseDurationLike(value);
  if (durationMs !== undefined) {
    return durationMs;
  }
  return parseRetryAfter(value);
}

function parseDurationLike(value: string): number | undefined {
  const matches = value
    .trim()
    .toLowerCase()
    .matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g);
  let totalMs = 0;
  let found = false;
  for (const match of matches) {
    found = true;
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) {
      continue;
    }
    if (unit === "ms") {
      totalMs += amount;
    } else if (unit === "s") {
      totalMs += amount * 1000;
    } else if (unit === "m") {
      totalMs += amount * 60 * 1000;
    } else if (unit === "h") {
      totalMs += amount * 60 * 60 * 1000;
    }
  }
  return found ? Math.max(0, Math.ceil(totalMs)) : undefined;
}

function formatWaitText(value: number | undefined): string | undefined {
  return value === undefined ? undefined : formatDuration(value);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
