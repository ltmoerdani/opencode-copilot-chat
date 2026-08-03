export const GO_DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";

export interface ProviderUrls {
  modelsUrl: string;
  chatCompletionsUrl: string;
  messagesUrl: string;
  responsesUrl: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function buildProviderUrls(
  defaultBaseUrl: string,
  overrideBaseUrl?: string,
): ProviderUrls {
  const baseUrl = normalizeBaseUrl((overrideBaseUrl ?? "").trim() || defaultBaseUrl);

  return {
    modelsUrl: new URL("models", baseUrl).toString(),
    chatCompletionsUrl: new URL("chat/completions", baseUrl).toString(),
    messagesUrl: new URL("messages", baseUrl).toString(),
    responsesUrl: new URL("responses", baseUrl).toString(),
  };
}