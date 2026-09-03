import * as vscode from "vscode";
import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { OPEN_CODE_CLIENT } from "../config";
import { getUserAgent } from "../provider/definitions";
import { messageText } from "../provider/tokens";
import { isRecord } from "../utils";

// --- Context-cache parity (mirrors ~/.config/opencode/plugins/opencode-context-cache.mjs) ---
const SESSION_HEADER_NAMES = ["x-session-id", "conversation_id", "session_id"] as const;
const CONTEXT_CACHE_DEBUG_ENV_VAR = "OPENCODE_CONTEXT_CACHE_DEBUG";

function appendContextCacheLog(message: string): void {
  const flag = process.env[CONTEXT_CACHE_DEBUG_ENV_VAR] ?? "";
  if (flag !== "1" && flag !== "true") return;
  try {
    const logPath = path.join(os.homedir(), ".config", "opencode", "plugins", "context-cache-vscode.log");
    const safe = message.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    const line = `[${new Date().toISOString()}] [pid:${String(process.pid)}] [context-cache-vscode] ${safe}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    /* best-effort */
  }
}

export function hashRawCacheKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function normalizeDirForCacheKey(dir: string): string {
  // Canonicalize separators so C:\a\b and C:/a/b hash identically.
  // Drive-letter upper-casing keeps c:\ vs C:\ stable on Windows.
  let out = dir.replace(/\\/g, "/");
  if (out.length >= 2 && out[1] === ":" && out[0] !== out[0].toUpperCase()) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

function resolveRawProjectCacheKey(modelId: string): string | null {
  const env = process.env as Record<string, string | undefined>;
  const override = (env.OPENCODE_PROMPT_CACHE_KEY ?? env.OPENCODE_STICKY_SESSION_ID ?? "").trim();
  if (override) return override;
  try {
    const user = env.USERNAME ?? env.USER ?? env.LOGNAME ?? "unknown";
    const host = os.hostname();
    let dir = "";
    try {
      dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    } catch {
      dir = "";
    }
    if (dir) dir = normalizeDirForCacheKey(dir);
    if (!dir) dir = modelId || "no-workspace";
    return `${user}@${host}:${dir}`;
  } catch {
    return null;
  }
}

export function resolveProjectCacheKey(modelId: string): string | null {
  const raw = resolveRawProjectCacheKey(modelId);
  if (!raw) return null;
  return hashRawCacheKey(raw);
}

// The official OpenCode client sends these headers on every request. The Zen
// gateway reads x-opencode-session first, then converts that sticky identifier
// into provider-specific affinity headers such as x-session-affinity upstream.
//
// VS Code's provider API does not currently expose a guaranteed public session
// identifier everywhere, so we first probe a few known internal fields and then
// fall back to a stable hash of the first messages in the conversation. That
// preserves sticky routing and cache affinity without depending on hidden state.
export function buildOpenCodeRequestHeaders(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  modelId: string,
): Record<string, string> {
  const sessionId = cleanHeaderValue(
    findStringOption(options, [
      "sessionId",
      "sessionID",
      "chatSessionId",
      "chatSessionID",
      "conversationId",
      "conversationID",
      "threadId",
      "threadID",
      "session.id",
      "chatSession.id",
    ]) ?? `vscode-${stableHash(conversationAnchor(messages, modelId))}`,
  );
  const requestId = cleanHeaderValue(
    findStringOption(options, ["requestId", "requestID", "messageId", "messageID"]) ??
      `req-${stableHash(`${String(Date.now())}-${String(Math.random())}-${sessionId}-${modelId}`)}`,
  );

  const projectCacheKey = resolveProjectCacheKey(modelId);
  const headers: Record<string, string> = {
    "x-opencode-session": sessionId,
    "x-opencode-request": requestId,
    "x-opencode-client": OPEN_CODE_CLIENT,
    "User-Agent": getUserAgent(),
  };
  if (projectCacheKey) {
    for (const name of SESSION_HEADER_NAMES) headers[name] = projectCacheKey;
    appendContextCacheLog(
      `model=${modelId} raw=${resolveRawProjectCacheKey(modelId) ?? ""} hash=${projectCacheKey} headers=${SESSION_HEADER_NAMES.join(",")}`,
    );
  } else {
    appendContextCacheLog(`model=${modelId} no stable cache key resolved`);
  }
  return headers;
}

/**
 * Stringify an arbitrary transport-layer initiator value for diagnostics.
 * Objects and functions are JSON-serialized, nullish values are dropped, and
 * primitives are converted directly so logs never show "[object Object]".
 */
export function stringifyInitiator(initiator: unknown): string | undefined {
  if (initiator === undefined || initiator === null) {
    return undefined;
  }
  if (typeof initiator === "string") {
    return initiator;
  }
  if (typeof initiator === "object" || typeof initiator === "function") {
    return JSON.stringify(initiator);
  }
  if (typeof initiator === "symbol" || typeof initiator === "bigint") {
    return initiator.toString();
  }
  if (typeof initiator === "number" || typeof initiator === "boolean") {
    return String(initiator);
  }
  // No known primitive type left; nothing useful to stringify.
  return undefined;
}

export function findStringOption(options: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(options, path.split("."));
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function conversationAnchor(messages: readonly vscode.LanguageModelChatRequestMessage[], modelId: string): string {
  const anchorMessages = messages.slice(0, 3).map((message) => `${String(message.role)}:${messageText(message).slice(0, 2048)}`);
  return anchorMessages.length ? anchorMessages.join("\n") : modelId;
}

export function cleanHeaderValue(value: string): string {
  const cleaned = value.replace(/[\r\n]/g, " ").trim();
  return cleaned ? cleaned.slice(0, 256) : "unknown";
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
