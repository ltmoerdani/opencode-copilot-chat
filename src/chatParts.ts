import * as vscode from "vscode";
import { MAX_THOUGHT_SIGNATURES } from "./config";
import { hasUsageSnapshot, toProviderUsagePayload, type UsageSnapshot } from "./usage/usage";

export const OPENCODE_USAGE_DATA_MIME = "application/vnd.opencode.usage+json";
export const COPILOT_USAGE_DATA_MIME = "usage";
export const OPENCODE_REASONING_DATA_MIME = "application/vnd.opencode.reasoning+json";
export const OPENCODE_THOUGHT_SIGNATURE_DATA_MIME = "application/vnd.opencode.thought-signature+json";

export function createUsageDataParts(usage: UsageSnapshot): vscode.LanguageModelDataPart[] {
  if (!hasUsageSnapshot(usage)) {
    return [];
  }

  const payload = toProviderUsagePayload(usage);
  if (!payload) {
    return [];
  }

  const data = new TextEncoder().encode(JSON.stringify(payload));
  return [
    new vscode.LanguageModelDataPart(data, COPILOT_USAGE_DATA_MIME),
    new vscode.LanguageModelDataPart(data, OPENCODE_USAGE_DATA_MIME),
  ];
}

export function isInternalDataPart(part: vscode.LanguageModelDataPart): boolean {
  return (
    part.mimeType === OPENCODE_USAGE_DATA_MIME ||
    part.mimeType === COPILOT_USAGE_DATA_MIME ||
    part.mimeType === OPENCODE_REASONING_DATA_MIME ||
    part.mimeType === OPENCODE_THOUGHT_SIGNATURE_DATA_MIME
  );
}

/**
 * A data part that marks text the model produced as reasoning while the
 * request had thinking OFF. The Go gateway wraps such responses in
 * `reasoning_content`, which the extension surfaces as visible text (gateway
 * bug #37635). The marker rides along in the conversation transcript so the
 * next turn can echo that text back as `reasoning_content` — DeepSeek's
 * thinking-mode validator 400s ("The reasoning_content in the thinking mode
 * must be passed back to the API") when it is missing.
 */
export function createReasoningMarkerPart(reasoning: string): vscode.LanguageModelDataPart {
  const data = new TextEncoder().encode(JSON.stringify({ reasoning }));
  return new vscode.LanguageModelDataPart(data, OPENCODE_REASONING_DATA_MIME);
}

export function isReasoningMarkerPart(part: vscode.LanguageModelDataPart): boolean {
  return part.mimeType === OPENCODE_REASONING_DATA_MIME;
}

/** Read the reasoning text carried by a marker part, if any. */
export function readReasoningMarker(part: vscode.LanguageModelDataPart): string | undefined {
  try {
    const payload = JSON.parse(new TextDecoder().decode(part.data)) as { reasoning?: unknown };
    return typeof payload.reasoning === "string" ? payload.reasoning : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Carry Gemini's opaque thought signatures through the Copilot Chat transcript.
 * Google requires them on the next turn for Gemini 3+ with thinking enabled;
 * VS Code history has no generic metadata field, so an internal data part is
 * the only lossless round-trip seam (same pattern as the reasoning marker).
 */
export function createThoughtSignaturePart(signatures: readonly string[]): vscode.LanguageModelDataPart {
  const payload = { signatures: signatures.slice(0, MAX_THOUGHT_SIGNATURES) };
  const data = new TextEncoder().encode(JSON.stringify(payload));
  return new vscode.LanguageModelDataPart(data, OPENCODE_THOUGHT_SIGNATURE_DATA_MIME);
}

export function isThoughtSignaturePart(part: vscode.LanguageModelDataPart): boolean {
  return part.mimeType === OPENCODE_THOUGHT_SIGNATURE_DATA_MIME;
}

/** Read the signatures carried by a marker part, if any. */
export function readThoughtSignaturePart(part: vscode.LanguageModelDataPart): string[] | undefined {
  try {
    const payload = JSON.parse(new TextDecoder().decode(part.data)) as { signatures?: unknown };
    return Array.isArray(payload.signatures)
      ? payload.signatures.filter((value): value is string => typeof value === "string" && value.length > 0)
      : undefined;
  } catch {
    return undefined;
  }
}
