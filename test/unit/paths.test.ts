import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { isInside, resolveVaultFolder } from "../../src/core/paths";

const VAULT = path.resolve("/vaults/main");

describe("resolveVaultFolder", () => {
  it("resolves vault-relative folders and the vault root", () => {
    expect(resolveVaultFolder(VAULT, "")).toBe(VAULT);
    expect(resolveVaultFolder(VAULT, "a/b")).toBe(path.join(VAULT, "a", "b"));
    expect(resolveVaultFolder(VAULT, "./a//b/")).toBe(path.join(VAULT, "a", "b"));
  });
  it("rejects anything that could leave the vault", () => {
    for (const f of ["..", "../x", "a/../../x", "a/..", "/etc", "\\x", "C:\\x", "c:/x", "a\\..\\..\\x", "a\0b"]) expect(resolveVaultFolder(VAULT, f), f).toBeNull();
  });
});

describe("isInside", () => {
  it("is true for the folder itself and descendants only", () => {
    expect(isInside("/p", "/p")).toBe(true);
    expect(isInside("/p", "/p/a/b.lean")).toBe(true);
    expect(isInside("/p", "/p/../q/x.lean")).toBe(false);
    expect(isInside("/p", "/pq/x.lean")).toBe(false);
  });
});
