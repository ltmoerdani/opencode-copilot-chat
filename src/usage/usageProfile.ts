/**
 * Per-profile identity for multi-account OpenCode Go usage tracking.
 *
 * @see issue #63
 */
import * as vscode from "vscode";
import { PROFILES_REGISTRY_KEY, ACTIVE_PROFILE_KEY, MIGRATED_KEY, LEGACY_FINGERPRINT } from "../config";

export { PROFILES_REGISTRY_KEY, ACTIVE_PROFILE_KEY, MIGRATED_KEY, LEGACY_SECRET_KEY, LEGACY_FINGERPRINT } from "../config";

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

/** SecretStorage key containing the full API key for one profile. */
export function profileSecretKey(fingerprint: string): string {
  return `opencodego.apiKey.profile.${fingerprint}`;
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
  const stored = context.globalState.get<(UsageProfile | null)[]>(PROFILES_REGISTRY_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (p): p is UsageProfile =>
      p !== null && typeof p.fingerprint === "string" && typeof p.label === "string" && typeof p.lastSeenAt === "number",
  );
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

/** Read profiles, excluding the legacy fingerprint (which is not a real profile). */
export function readActiveProfiles(context: vscode.ExtensionContext): UsageProfile[] {
  return readProfiles(context).filter((p) => p.fingerprint !== LEGACY_FINGERPRINT && p.fingerprint !== "");
}

/** Count real (non-legacy) profiles. */
export function nonLegacyCount(profiles: UsageProfile[]): number {
  return profiles.filter((p) => p.fingerprint !== LEGACY_FINGERPRINT && p.fingerprint !== "").length;
}
