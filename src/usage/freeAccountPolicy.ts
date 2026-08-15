/**
 * Single-free-account fair-use policy.
 *
 * OpenCode grants each person a free quota; harvesting that quota by
 * registering multiple free accounts hurts everyone (inference is expensive).
 * This policy enforces ONE free account per install:
 *
 *   - A profile (identified by its API-key fingerprint) becomes a "free
 *     account" the moment a free model is used and it is not currently a
 *     confirmed paid account.
 *   - A profile is "confirmed paid" while it has an active subscription —
 *     detected via the Go usage endpoint (authoritative) or by successfully
 *     using a paid (non-free) model. Paid accounts never count toward the
 *     free limit, so multiple paid accounts are fine.
 *   - Confirmed-paid status expires after {@link PAID_CONFIRMATION_TTL_MS}
 *     without re-confirmation, so a lapsed subscription is re-classified as
 *     free (the user renews → paid usage re-confirms → exempt again).
 *   - Free-model usage is BLOCKED as soon as two free accounts are known, and
 *     stays blocked until the user keeps only one free account (delete the
 *     others via the profile commands) or one of them becomes paid.
 *
 * CONTRACT: pure — operates on plain Sets/Maps, no `vscode` import, no side
 * effects. Unit-tested in plain Node.
 *
 * LIMITATION (documented honestly): this is a per-install deterrent, not an
 * identity guarantee — two keys cannot be proven to belong to one person, and
 * a determined user could bypass it on another machine or via the CLI. Its
 * goal is to stop casual multi-account free-quota harvesting.
 */
import { PAID_CONFIRMATION_TTL_MS } from "../config";

export interface FreeAccountPolicy {
  /** Fingerprints currently treated as free accounts. */
  freeAccounts: Set<string>;
  /** Fingerprint → last time it was confirmed as a paid account (ms). */
  paidAccounts: Map<string, number>;
}

export function emptyFreeAccountPolicy(): FreeAccountPolicy {
  return { freeAccounts: new Set(), paidAccounts: new Map() };
}

/** Whether `fingerprint` is currently a live confirmed paid account. */
export function isPaid(policy: FreeAccountPolicy, fingerprint: string, nowMs: number): boolean {
  const confirmedAt = policy.paidAccounts.get(fingerprint);
  if (confirmedAt === undefined) {
    return false;
  }
  return nowMs - confirmedAt < PAID_CONFIRMATION_TTL_MS;
}

/** Count free accounts — freeAccounts entries that are not currently confirmed paid. */
export function countFreeAccounts(policy: FreeAccountPolicy, nowMs: number): number {
  let count = 0;
  for (const fp of policy.freeAccounts) {
    if (!isPaid(policy, fp, nowMs)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Record that a free model was used under `fingerprint`. Paid accounts are
 * exempt (they may use free models without counting toward the limit).
 * Returns the SAME reference when nothing changed.
 */
export function markFreeUsage(policy: FreeAccountPolicy, fingerprint: string, nowMs: number): FreeAccountPolicy {
  if (isPaid(policy, fingerprint, nowMs) || policy.freeAccounts.has(fingerprint)) {
    return policy;
  }
  const next: FreeAccountPolicy = {
    freeAccounts: new Set(policy.freeAccounts),
    paidAccounts: new Map(policy.paidAccounts),
  };
  next.freeAccounts.add(fingerprint);
  return next;
}

/**
 * Confirm `fingerprint` as a paid account (active subscription / successful
 * paid-model usage). Removes it from the free-account set. Returns the SAME
 * reference when nothing changed.
 */
export function markPaid(policy: FreeAccountPolicy, fingerprint: string, nowMs: number): FreeAccountPolicy {
  const isCurrentlyPaid = isPaid(policy, fingerprint, nowMs);
  if (isCurrentlyPaid && !policy.freeAccounts.has(fingerprint)) {
    return policy;
  }
  const next: FreeAccountPolicy = {
    freeAccounts: new Set(policy.freeAccounts),
    paidAccounts: new Map(policy.paidAccounts),
  };
  next.paidAccounts.set(fingerprint, nowMs);
  next.freeAccounts.delete(fingerprint);
  return next;
}

/**
 * Drop the paid confirmation (subscription lapsed / endpoint reports no
 * subscription). The account becomes free only when it next uses a free model.
 * Returns the SAME reference when nothing changed.
 */
export function unmarkPaid(policy: FreeAccountPolicy, fingerprint: string): FreeAccountPolicy {
  if (!policy.paidAccounts.has(fingerprint)) {
    return policy;
  }
  const next: FreeAccountPolicy = {
    freeAccounts: new Set(policy.freeAccounts),
    paidAccounts: new Map(policy.paidAccounts),
  };
  next.paidAccounts.delete(fingerprint);
  return next;
}

/**
 * Whether free-model usage must be blocked: true once two or more free
 * accounts are known. The user must keep only one free account (delete the
 * others) or make the extra ones paid before free usage works again.
 */
export function shouldBlockFreeUsage(policy: FreeAccountPolicy, nowMs: number): boolean {
  return countFreeAccounts(policy, nowMs) >= 2;
}

/** Remove a deleted profile from both sets (free-account count drops). */
export function removeAccount(policy: FreeAccountPolicy, fingerprint: string): FreeAccountPolicy {
  if (!policy.freeAccounts.has(fingerprint) && !policy.paidAccounts.has(fingerprint)) {
    return policy;
  }
  const next: FreeAccountPolicy = {
    freeAccounts: new Set(policy.freeAccounts),
    paidAccounts: new Map(policy.paidAccounts),
  };
  next.freeAccounts.delete(fingerprint);
  next.paidAccounts.delete(fingerprint);
  return next;
}

/** Rebuild a policy from the persisted (JSON-safe) shape. */
export function fromStored(free: string[] | undefined, paid: Record<string, number> | undefined): FreeAccountPolicy {
  const paidEntries = Object.entries(paid ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return {
    freeAccounts: new Set(Array.isArray(free) ? free.filter((fp): fp is string => typeof fp === "string") : []),
    paidAccounts: new Map(paidEntries),
  };
}

/** Serialize a policy to the persisted (JSON-safe) shape. */
export function toStored(policy: FreeAccountPolicy): { free: string[]; paid: Record<string, number> } {
  const paid: Record<string, number> = {};
  for (const [fp, at] of policy.paidAccounts) {
    paid[fp] = at;
  }
  return { free: [...policy.freeAccounts], paid };
}
