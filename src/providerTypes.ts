export const GO_VENDOR = "opencodego" as const;
export const ZEN_VENDOR = "opencodezen" as const;
export const AGENT_GO_VENDOR = "opencodego-agent" as const;
export const AGENT_ZEN_VENDOR = "opencodezen-agent" as const;

/** Base vendor IDs used for metadata lookups and API routing. */
export type ProviderVendor = typeof GO_VENDOR | typeof ZEN_VENDOR;

/** All vendor IDs including agent-host variants. */
export type AllProviderVendor = typeof GO_VENDOR | typeof ZEN_VENDOR | typeof AGENT_GO_VENDOR | typeof AGENT_ZEN_VENDOR;

/** Resolve agent-host vendor variants back to their base vendor for metadata/routing lookups. */
export function resolveBaseVendor(vendor: AllProviderVendor): ProviderVendor {
  return vendor === AGENT_GO_VENDOR ? GO_VENDOR : vendor === AGENT_ZEN_VENDOR ? ZEN_VENDOR : vendor;
}

export interface ProviderRoutingDefinition {
  vendor: AllProviderVendor;
  chatCompletionsUrl: string;
  messagesUrl: string;
  modelsUrl: string;
  /**
   * Base of the Google-native generate route (`{base}/{modelId}:streamGenerateContent`).
   * Absent = same base as `modelsUrl` (Zen and custom gateways). Only Go's
   * built-in gateway serves that route on a different base (issue #247 keeps a
   * configured `apiBaseUrl` in charge of every route).
   */
  googleModelsUrl?: string;
  responsesUrl?: string;
}
