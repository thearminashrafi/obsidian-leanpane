import { describe, expect, it, vi } from "vitest";
import { findLeaf, type LeafLike } from "../../src/view/leafLookup";

class FakeView {
  constructor(public file: string) {}
}
const isView = (v: unknown): v is FakeView => v instanceof FakeView;

function deferred(file: string): LeafLike & { loaded: number; view: unknown } {
  const leaf = {
    loaded: 0,
    view: { placeholder: true } as unknown,
    getViewState: () => ({ state: { file } }),
    loadIfDeferred: vi.fn(async () => {
      leaf.loaded++;
      leaf.view = new FakeView(file);
    }),
  };
  return leaf;
}

describe("findLeaf", () => {
  it("finds a loaded view without loading anything", async () => {
    const d = deferred("b.lean");
    const loaded = { view: new FakeView("a.lean"), getViewState: () => ({ state: { file: "a.lean" } }) };
    const r = await findLeaf([d, loaded], isView, (v) => v.file === "a.lean", (st) => st.file === "a.lean");
    expect(r?.leaf).toBe(loaded);
    expect(d.loaded).toBe(0);
  });
  it("matches a deferred leaf by its saved state and loads it (no duplicate tab)", async () => {
    const other = deferred("x.lean");
    const d = deferred("a.lean");
    const r = await findLeaf([other, d], isView, (v) => v.file === "a.lean", (st) => st.file === "a.lean");
    expect(r?.leaf).toBe(d);
    expect(r?.view.file).toBe("a.lean");
    expect(d.loaded).toBe(1);
    expect(other.loaded).toBe(0);
  });
  it("returns null when nothing matches or a deferred leaf fails to load", async () => {
    expect(await findLeaf([deferred("x.lean")], isView, () => false, (st) => st.file === "a.lean")).toBeNull();
    const bad = deferred("a.lean");
    bad.loadIfDeferred = async () => { throw new Error("x"); };
    expect(await findLeaf([bad], isView, () => false, (st) => st.file === "a.lean")).toBeNull();
  });
});
