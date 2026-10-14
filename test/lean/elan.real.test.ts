import { expect, it } from "vitest";
import { discoverElan, nodeFs, defaultExec } from "../../src/core/elan";
import { describeLean, leanTools } from "../helpers/lean";

describeLean("discoverElan with the real elan", () => {
  it("finds elan/lake/lean, versions and the installed toolchain", async () => {
    const info = await discoverElan({ settingsDir: leanTools!.binDir, fs: nodeFs, exec: defaultExec });
    expect(info.binDir).toBe(leanTools!.binDir);
    expect(info.lakePath).toBeTruthy();
    expect(info.lakeVersion).toMatch(/Lake version/);
    expect(info.toolchains.some((t) => t.includes("v4.25.1"))).toBe(true);
  });
});
