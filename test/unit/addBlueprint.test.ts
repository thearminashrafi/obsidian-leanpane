import { describe, expect, it } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addBlueprintSkeleton } from "../../src/core/projectCreate";

describe("addBlueprintSkeleton", () => {
  it("adds files, imports the starter, and never overwrites", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "lp-bp-"));
    await fsp.mkdir(path.join(root, "Proj"), { recursive: true });
    await fsp.writeFile(path.join(root, "Proj.lean"), "import Proj.Basic\n");
    const r1 = await addBlueprintSkeleton(root, "proj", "Proj");
    expect(r1.created).toContain("blueprint/src/content.tex");
    expect(await fsp.readFile(path.join(root, "Proj.lean"), "utf8")).toContain("import Proj.Starter");
    await fsp.writeFile(r1.contentTex, "MINE");
    const r2 = await addBlueprintSkeleton(root, "proj", "Proj");
    expect(r2.created).toEqual([]);
    expect(await fsp.readFile(r1.contentTex, "utf8")).toBe("MINE");
    const root2 = (await fsp.readFile(path.join(root, "Proj.lean"), "utf8")).split("import Proj.Starter").length;
    expect(root2).toBe(2); // imported exactly once
  });
});
