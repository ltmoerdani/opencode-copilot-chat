/**
 * Persistence for the single-free-account policy.
 *
 * Thin wrapper over globalState so the pure policy logic
 * (`./freeAccountPolicy.ts`) stays unit-testable and every caller reads and
 * writes through the same keys.
 */
import * as vscode from "vscode";
import { FREE_ACCOUNTS_STATE_KEY, PAID_ACCOUNTS_STATE_KEY } from "../config";
import { fromStored, shouldBlockFreeUsage, toStored, type FreeAccountPolicy } from "./freeAccountPolicy";

/** Load the current policy from globalState. */
export function loadFreeAccountPolicy(context: vscode.ExtensionContext): FreeAccountPolicy {
  return fromStored(
    context.globalState.get<string[]>(FREE_ACCOUNTS_STATE_KEY, []),
    context.globalState.get<Record<string, number>>(PAID_ACCOUNTS_STATE_KEY, {}),
  );
}

/** Persist the policy to globalState (fire-and-forget like other state). */
export function persistFreeAccountPolicy(context: vscode.ExtensionContext, policy: FreeAccountPolicy): void {
  const stored = toStored(policy);
  void context.globalState.update(FREE_ACCOUNTS_STATE_KEY, stored.free);
  void context.globalState.update(PAID_ACCOUNTS_STATE_KEY, stored.paid);
}

/** Human-readable diagnostics for the policy (fingerprints are key hashes, safe to show). */
export function freeAccountPolicyDiagnostics(context: vscode.ExtensionContext): string[] {
  const policy = loadFreeAccountPolicy(context);
  const free = [...policy.freeAccounts];
  const paid = [...policy.paidAccounts.keys()];
  return [
    `- freeAccounts (${String(free.length)}): ${free.length ? free.join(", ") : "none"}`,
    `- paidAccounts (${String(paid.length)}): ${paid.length ? paid.join(", ") : "none"}`,
    `- freeUsageBlocked: ${String(shouldBlockFreeUsage(policy, Date.now()))}`,
  ];
}
