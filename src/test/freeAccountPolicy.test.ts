import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAID_CONFIRMATION_TTL_MS } from "../config.js";
import {
  countFreeAccounts,
  emptyFreeAccountPolicy,
  fromStored,
  isPaid,
  markFreeUsage,
  markPaid,
  removeAccount,
  shouldBlockFreeUsage,
  toStored,
  unmarkPaid,
} from "../usage/freeAccountPolicy.js";

const NOW = 1_700_000_000_000;

describe("freeAccountPolicy", () => {
  it("always allows a single free account", () => {
    let p = emptyFreeAccountPolicy();
    p = markFreeUsage(p, "A", NOW);
    assert.equal(countFreeAccounts(p, NOW), 1);
    assert.equal(shouldBlockFreeUsage(p, NOW), false);
  });

  it("blocks free usage once a second free account is seen", () => {
    let p = emptyFreeAccountPolicy();
    p = markFreeUsage(p, "A", NOW);
    p = markFreeUsage(p, "B", NOW);
    assert.equal(countFreeAccounts(p, NOW), 2);
    assert.equal(shouldBlockFreeUsage(p, NOW), true);
  });

  it("does not double-count the same fingerprint", () => {
    let p = emptyFreeAccountPolicy();
    p = markFreeUsage(p, "A", NOW);
    p = markFreeUsage(p, "A", NOW);
    assert.equal(countFreeAccounts(p, NOW), 1);
    assert.equal(shouldBlockFreeUsage(p, NOW), false);
  });

  it("exempts confirmed paid accounts from the free limit", () => {
    let p = emptyFreeAccountPolicy();
    p = markFreeUsage(p, "A", NOW); // free account A
    p = markPaid(p, "B", NOW); // paid account B
    p = markFreeUsage(p, "B", NOW); // B uses a free model but is paid → not counted
    assert.equal(countFreeAccounts(p, NOW), 1);
    assert.equal(shouldBlockFreeUsage(p, NOW), false);
  });

  it("allows multiple active paid accounts even when they use free models", () => {
    let p = emptyFreeAccountPolicy();
    p = markPaid(p, "P1", NOW);
    p = markPaid(p, "P2", NOW);
    p = markFreeUsage(p, "P1", NOW);
    p = markFreeUsage(p, "P2", NOW);
    assert.equal(countFreeAccounts(p, NOW), 0);
    assert.equal(shouldBlockFreeUsage(p, NOW), false);
  });

  it("re-classifies a lapsed paid account as free after the confirmation TTL", () => {
    let p = emptyFreeAccountPolicy();
    p = markPaid(p, "P", NOW); // paid while the subscription was active
    const later = NOW + PAID_CONFIRMATION_TTL_MS + 1; // sub lapsed
    assert.equal(isPaid(p, "P", later), false);
    p = markFreeUsage(p, "P", later); // now uses a free model
    assert.equal(countFreeAccounts(p, later), 1);
  });

  it("blocks two lapsed paid accounts once both are used as free", () => {
    let p = emptyFreeAccountPolicy();
    p = markPaid(p, "P1", NOW);
    p = markPaid(p, "P2", NOW);
    const later = NOW + PAID_CONFIRMATION_TTL_MS + 1;
    p = markFreeUsage(p, "P1", later);
    p = markFreeUsage(p, "P2", later);
    assert.equal(countFreeAccounts(p, later), 2);
    assert.equal(shouldBlockFreeUsage(p, later), true);
  });

  it("renews paid status on fresh paid confirmation (subscription renewed)", () => {
    let p = emptyFreeAccountPolicy();
    p = markPaid(p, "P", NOW);
    const later = NOW + PAID_CONFIRMATION_TTL_MS + 1;
    p = markPaid(p, "P", later); // renewed
    p = markFreeUsage(p, "P", later);
    assert.equal(isPaid(p, "P", later), true);
    assert.equal(countFreeAccounts(p, later), 0);
  });

  it("unmarkPaid drops paid confirmation (Go endpoint reports no subscription)", () => {
    let p = emptyFreeAccountPolicy();
    p = markPaid(p, "P", NOW);
    p = unmarkPaid(p, "P");
    assert.equal(isPaid(p, "P", NOW), false);
    p = markFreeUsage(p, "P", NOW);
    assert.equal(countFreeAccounts(p, NOW), 1);
  });

  it("removing a deleted account drops the count back below the limit", () => {
    let p = emptyFreeAccountPolicy();
    p = markFreeUsage(p, "A", NOW);
    p = markFreeUsage(p, "B", NOW);
    assert.equal(shouldBlockFreeUsage(p, NOW), true);
    p = removeAccount(p, "B");
    assert.equal(countFreeAccounts(p, NOW), 1);
    assert.equal(shouldBlockFreeUsage(p, NOW), false);
  });

  it("round-trips through the persisted shape", () => {
    let p = emptyFreeAccountPolicy();
    p = markFreeUsage(p, "A", NOW);
    p = markPaid(p, "P", NOW);
    const stored = toStored(p);
    assert.deepEqual(stored.free, ["A"]);
    assert.equal(stored.paid["P"], NOW);

    const restored = fromStored(stored.free, stored.paid);
    assert.equal(countFreeAccounts(restored, NOW), 1);
    assert.equal(isPaid(restored, "P", NOW), true);
  });

  it("ignores malformed persisted data", () => {
    const restored = fromStored(["ok", 42 as unknown as string, null as unknown as string], { P: "not-a-number" as unknown as number });
    assert.deepEqual([...restored.freeAccounts], ["ok"]);
    assert.equal(restored.paidAccounts.size, 0);
  });
});
