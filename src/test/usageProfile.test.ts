import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { ExtensionContext } from "vscode";

let mod: typeof import("../usageProfile.js");

function createMockContext(initial: Record<string, unknown> = {}): ExtensionContext {
  const store = new Map(Object.entries(initial));
  return {
    globalState: {
      get: <T>(key: string, defaultVal?: T): T | undefined => (store.has(key) ? (store.get(key) as T) : defaultVal),
      update: (key: string, value: unknown): Promise<void> => {
        if (value === undefined) store.delete(key);
        else store.set(key, value);
        return Promise.resolve();
      },
    },
    subscriptions: [],
  } as unknown as ExtensionContext;
}

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-usageprofile-")), "index.js");
fs.mkdirSync(path.dirname(vscodeMockPath), { recursive: true });
fs.writeFileSync(
  vscodeMockPath,
  `"use strict";\nclass MarkdownString { value = ""; supportThemeIcons = false; isTrusted = false; appendMarkdown(_text) {} }\nmodule.exports = { ExtensionContext: class {}, MarkdownString };`,
  "utf-8",
);

type ModuleWithResolveFilename = {
  _resolveFilename: (request: string, parent: unknown, ...args: unknown[]) => string;
};
const originalResolveFilename = (Module as unknown as ModuleWithResolveFilename)._resolveFilename;
(Module as unknown as ModuleWithResolveFilename)._resolveFilename = function (
  request: string,
  parent: unknown,
  ...args: unknown[]
): string {
  if (request === "vscode") return vscodeMockPath;
  return originalResolveFilename.call(this, request, parent, ...args);
};

before(async () => {
  mod = await import("../usageProfile.js");
});

describe("keyFingerprint", () => {
  it("returns 'legacy' for empty input", () => {
    assert.equal(mod.keyFingerprint(""), mod.LEGACY_FINGERPRINT);
  });
  it("takes 8 leading + 8 trailing chars", () => {
    assert.equal(mod.keyFingerprint("sk-90UzXXab-XXXXXXXX-cdWToa"), "sk-90UzX-X-cdWToa");
  });
  it("is stable (same key, same fingerprint)", () => {
    const k = "sk-aaaabbbb-cccccccc-dddd-eeee-ffff-12345678";
    assert.equal(mod.keyFingerprint(k), mod.keyFingerprint(k));
  });
});

describe("profile registry", () => {
  it("returns empty when no profiles stored", () => {
    assert.deepEqual(mod.readProfiles(createMockContext()), []);
  });
  it("round-trips profiles through writeProfiles/readProfiles", async () => {
    const ctx = createMockContext();
    const p = { fingerprint: "fp1", label: "Profile 1", lastSeenAt: Date.now(), isLegacy: false };
    await mod.writeProfiles(ctx, [p]);
    assert.equal(mod.readProfiles(ctx).length, 1);
    assert.equal(mod.readProfiles(ctx)[0].fingerprint, "fp1");
  });
  it("findProfile returns matching profile or undefined", () => {
    const profiles = [
      { fingerprint: "a", label: "A", lastSeenAt: 0, isLegacy: false },
      { fingerprint: "b", label: "B", lastSeenAt: 0, isLegacy: false },
    ];
    assert.equal(mod.findProfile(profiles, "a")?.label, "A");
    assert.equal(mod.findProfile(profiles, "missing"), undefined);
  });
  it("renameProfile updates label", async () => {
    const ctx = createMockContext();
    const p = { fingerprint: "fp1", label: "Profile 1", lastSeenAt: Date.now(), isLegacy: false };
    await mod.writeProfiles(ctx, [p]);
    await mod.renameProfile(ctx, "fp1", "Renamed");
    assert.equal(mod.readProfiles(ctx)[0].label, "Renamed");
  });
});

describe("active profile", () => {
  it("defaults to legacy when not stored", () => {
    assert.equal(mod.readActiveProfile(createMockContext()), mod.LEGACY_FINGERPRINT);
  });
  it("round-trips through writeActiveProfile", async () => {
    const ctx = createMockContext();
    await mod.writeActiveProfile(ctx, "my-fp");
    assert.equal(mod.readActiveProfile(ctx), "my-fp");
  });
});
