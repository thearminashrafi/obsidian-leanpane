import { expect, it } from "vitest";
import { RefCounts } from "../../src/infoview/refcount";

it("ref-counts subscriptions per method", () => {
  const r = new RefCounts();
  expect(r.inc("a")).toBe(true);
  expect(r.inc("a")).toBe(false);
  expect(r.count("a")).toBe(2);
  expect(r.dec("a")).toBe(false);
  expect(r.has("a")).toBe(true);
  expect(r.dec("a")).toBe(true);
  expect(r.has("a")).toBe(false);
  expect(r.dec("a")).toBe(false); // unbalanced: ignored
  r.inc("b");
  r.inc("c");
  expect(r.keys().sort()).toEqual(["b", "c"]);
  r.clear();
  expect(r.keys()).toEqual([]);
});
