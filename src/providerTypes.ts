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
  return vendor === AGENT_GO_VENDOR ? GO_VENDOR : vendor === AGENT_ZEN_VENDOR ? ZEN_VENDOR : (vendor as ProviderVendor);
}

export interface ProviderRoutingDefinition {
  vendor: AllProviderVendor;
  chatCompletionsUrl: string;
  messagesUrl: string;
  modelsUrl: string;
  responsesUrl?: string;
}
