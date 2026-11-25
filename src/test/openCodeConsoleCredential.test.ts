import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSOLE_KEYS_URL, parseCredentialRows } from "../openCodeConsoleCredential.js";

describe("OpenCode Console credential import (#286)", () => {
  it("reads the sqlite3 -json array shape", () => {
    assert.equal(parseCredentialRows([{ value: "oc_sk_placeholder" }]), "oc_sk_placeholder");
  });

  it("reads the node:sqlite single-row shape and trims whitespace", () => {
    assert.equal(parseCredentialRows({ value: "  oc_sk_placeholder  " }), "oc_sk_placeholder");
  });

  it("returns undefined for missing or empty values", () => {
    assert.equal(parseCredentialRows([]), undefined);
    assert.equal(parseCredentialRows([{ value: "   " }]), undefined);
    assert.equal(parseCredentialRows(null), undefined);
    assert.equal(parseCredentialRows([{ other: "x" }]), undefined);
  });

  it("points at the Console personal API keys page", () => {
    assert.match(CONSOLE_KEYS_URL, /opencode\.ai\/console\/api/);
  });
});
