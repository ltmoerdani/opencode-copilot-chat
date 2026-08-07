export interface UsageSnapshot {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  finishReason?: string;
  /** Computed credits (for VS Code session cost accumulation). */
  copilotCredits?: number;
}

export interface ProviderUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  finish_reason?: string;
  /** Credits for VS Code session cost accumulation. */
  copilotCredits?: number;
}

export function withUsageTotals(usage: UsageSnapshot): UsageSnapshot {
  const totalTokens =
    usage.totalTokens ??
    (usage.promptTokens !== undefined && usage.completionTokens !== undefined ? usage.promptTokens + usage.completionTokens : undefined);

  return totalTokens === usage.totalTokens
    ? usage
    : {
        ...usage,
        totalTokens,
      };
}

export function hasUsageSnapshot(usage: UsageSnapshot): boolean {
  return usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.totalTokens !== undefined;
}

export function formatCompactTokenCount(value: number | undefined): string {
  if (value === undefined) {
    return "?";
  }

  if (value >= 10000) {
    return `${Math.round(value / 1000)}k`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  return String(value);
}

export function cacheHitRatio(usage: UsageSnapshot): number | undefined {
  if (usage.cachedTokens === undefined || usage.promptTokens === undefined || usage.promptTokens <= 0) {
    return undefined;
  }

  return (usage.cachedTokens / usage.promptTokens) * 100;
}

export function formatCacheHitRatio(usage: UsageSnapshot): string | undefined {
  const ratio = cacheHitRatio(usage);
  return ratio === undefined ? undefined : `${ratio.toFixed(1)}%`;
}

export function formatUsageStatusBarText(providerDisplayName: string, usage: UsageSnapshot): string | undefined {
  const normalized = withUsageTotals(usage);
  if (!hasUsageSnapshot(normalized)) {
    return undefined;
  }

  return [
    providerDisplayName,
    `${formatCompactTokenCount(normalized.promptTokens)}→${formatCompactTokenCount(normalized.completionTokens)}`,
    `(${formatCompactTokenCount(normalized.totalTokens)}) tok`,
  ].join(" ");
}

export function formatUsageStatusBarTooltip(providerDisplayName: string, modelId: string, usage: UsageSnapshot): string {
  const normalized = withUsageTotals(usage);
  const lines = [
    `Provider: ${providerDisplayName}`,
    `Model: ${modelId}`,
    `Prompt: ${normalized.promptTokens ?? "n/a"} tokens`,
    `Output: ${normalized.completionTokens ?? "n/a"} tokens`,
    `Total: ${normalized.totalTokens ?? "n/a"} tokens`,
  ];

  if (normalized.cachedTokens !== undefined) {
    lines.push(`Cached input: ${normalized.cachedTokens} tokens`);
  }

  const ratio = formatCacheHitRatio(normalized);
  if (ratio) {
    lines.push(`Cache hit ratio: ${ratio}`);
  }

  if (normalized.finishReason) {
    lines.push(`Finish reason: ${normalized.finishReason}`);
  }

  return lines.join("\n");
}

export function formatUsageLogLine(usage: UsageSnapshot): string | undefined {
  const normalized = withUsageTotals(usage);
  if (!hasUsageSnapshot(normalized)) {
    return undefined;
  }

  const parts = [
    `prompt=${normalized.promptTokens ?? "n/a"}`,
    `completion=${normalized.completionTokens ?? "n/a"}`,
    `total=${normalized.totalTokens ?? "n/a"}`,
  ];

  if (normalized.cachedTokens !== undefined) {
    parts.push(`cached=${normalized.cachedTokens}`);
  }

  const ratio = formatCacheHitRatio(normalized);
  if (ratio) {
    parts.push(`cacheHit=${ratio}`);
  }

  if (normalized.finishReason) {
    parts.push(`finishReason=${normalized.finishReason}`);
  }

  return parts.join(" ");
}

export function toProviderUsagePayload(usage: UsageSnapshot): ProviderUsagePayload | undefined {
  const normalized = withUsageTotals(usage);
  if (!hasUsageSnapshot(normalized)) {
    return undefined;
  }

  return {
    ...(normalized.promptTokens === undefined ? {} : { prompt_tokens: normalized.promptTokens }),
    ...(normalized.completionTokens === undefined ? {} : { completion_tokens: normalized.completionTokens }),
    ...(normalized.totalTokens === undefined ? {} : { total_tokens: normalized.totalTokens }),
    ...(normalized.cachedTokens === undefined
      ? {}
      : {
          prompt_tokens_details: {
            cached_tokens: normalized.cachedTokens,
          },
        }),
    ...(normalized.finishReason === undefined ? {} : { finish_reason: normalized.finishReason }),
    ...(normalized.copilotCredits === undefined ? {} : { copilotCredits: normalized.copilotCredits }),
  };
}
