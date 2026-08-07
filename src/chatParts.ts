import * as vscode from "vscode";
import { hasUsageSnapshot, toProviderUsagePayload, type UsageSnapshot } from "./usage";

export const OPENCODE_USAGE_DATA_MIME = "application/vnd.opencode.usage+json";
export const COPILOT_USAGE_DATA_MIME = "usage";

export function createUsageDataPart(usage: UsageSnapshot): vscode.LanguageModelDataPart | undefined {
  return createUsageDataParts(usage)[0];
}

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
  return part.mimeType === OPENCODE_USAGE_DATA_MIME || part.mimeType === COPILOT_USAGE_DATA_MIME;
}
