export type OpenCodeEndpointKind = "chat-completions" | "messages" | "responses" | "google";

export function buildOpenCodeGatewayAuthHeaders(endpointKind: OpenCodeEndpointKind, apiKey: string): Record<string, string> {
  if (endpointKind === "messages") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  if (endpointKind === "google") {
    return {
      "x-goog-api-key": apiKey,
    };
  }

  return {
    Authorization: `Bearer ${apiKey}`,
  };
}
