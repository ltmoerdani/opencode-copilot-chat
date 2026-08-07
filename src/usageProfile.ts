/**
 * Per-profile identity for multi-account OpenCode Go usage tracking.
 *
 * @see issue #63
 */
import * as vscode from "vscode";

export const PROFILES_REGISTRY_KEY = "opencodego.profiles.v1";
export const ACTIVE_PROFILE_KEY = "opencodego.activeProfile.v1";
export const MIGRATED_KEY = "opencodego.migratedTo.v1";
export const LEGACY_SECRET_KEY = "opencodego.apiKey";
export const LEGACY_FINGERPRINT = "legacy";

export interface UsageProfile {
  fingerprint: string;
  label: string;
  lastSeenAt: number;
}

/**
 * 8 primeiros + 8 últimos caracteres da API key.
 * Determinístico, legível, nunca expõe a key completa.
 */
export function keyFingerprint(apiKey: string): string {
  if (!apiKey) return LEGACY_FINGERPRINT;
  return `${apiKey.slice(0, 8)}-${apiKey.slice(-8)}`;
}

export function readActiveProfile(context: vscode.ExtensionContext): string {
  return context.globalState.get<string>(ACTIVE_PROFILE_KEY) ?? LEGACY_FINGERPRINT;
}

export async function writeActiveProfile(context: vscode.ExtensionContext, fingerprint: string): Promise<void> {
  await context.globalState.update(ACTIVE_PROFILE_KEY, fingerprint);
}

/** Which profile fingerprint already received the legacy singleton migration. */
export function readMigratedTo(context: vscode.ExtensionContext): string | undefined {
  return context.globalState.get<string>(MIGRATED_KEY);
}

export async function writeMigratedTo(context: vscode.ExtensionContext, fingerprint: string): Promise<void> {
  await context.globalState.update(MIGRATED_KEY, fingerprint);
}

export function readProfiles(context: vscode.ExtensionContext): UsageProfile[] {
  const stored = context.globalState.get<UsageProfile[]>(PROFILES_REGISTRY_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((p) => p && typeof p.fingerprint === "string" && typeof p.label === "string" && typeof p.lastSeenAt === "number");
}

export async function writeProfiles(context: vscode.ExtensionContext, profiles: UsageProfile[]): Promise<void> {
  await context.globalState.update(PROFILES_REGISTRY_KEY, profiles);
}

export function findProfile(profiles: UsageProfile[], fingerprint: string): UsageProfile | undefined {
  return profiles.find((p) => p.fingerprint === fingerprint);
}

export async function renameProfile(context: vscode.ExtensionContext, fingerprint: string, newLabel: string): Promise<void> {
  const profiles = readProfiles(context);
  const next = profiles.map((p) => (p.fingerprint === fingerprint ? { ...p, label: newLabel.trim() || p.label } : p));
  await writeProfiles(context, next);
}

/**
 * Get or create a profile for the given fingerprint.
 * Labels are assigned sequentially: "Profile 1", "Profile 2", etc.
 */
export async function getOrCreateProfile(context: vscode.ExtensionContext, fingerprint: string): Promise<UsageProfile> {
  const profiles = readProfiles(context);
  const existing = findProfile(profiles, fingerprint);
  if (existing) {
    existing.lastSeenAt = Date.now();
    await writeProfiles(context, profiles);
    return existing;
  }
  const nextNumber = profiles.length + 1;
  const profile: UsageProfile = {
    fingerprint,
    label: `Profile ${nextNumber}`,
    lastSeenAt: Date.now(),
  };
  profiles.push(profile);
  await writeProfiles(context, profiles);
  return profile;
}

/** Read profiles, excluding the legacy fingerprint (which is not a real profile). */
export function readActiveProfiles(context: vscode.ExtensionContext): UsageProfile[] {
  return readProfiles(context).filter((p) => p.fingerprint !== LEGACY_FINGERPRINT && p.fingerprint !== "");
}

/** Count real (non-legacy) profiles. */
export function nonLegacyCount(profiles: UsageProfile[]): number {
  return profiles.filter((p) => p.fingerprint !== LEGACY_FINGERPRINT && p.fingerprint !== "").length;
}
