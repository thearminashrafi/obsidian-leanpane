import { describe, expect, it } from "vitest";
import { StatusEngine, combineStatus } from "../../src/core/statusEngine";
import type { DeclStatus, DeclSummary, LiveDecl } from "../../src/types";

const range = (l: number) => ({ start: { line: l, character: 0 }, end: { line: l + 3, character: 0 } });
const live = (name: string, state: LiveDecl["state"], line = 4): LiveDecl => ({ name, shortName: name.split(".").pop()!, symbolKind: 6, range: range(line), selectionRange: range(line), state });
const build = (name: string, state: DeclStatus["state"], extra: Partial<DeclStatus> = {}): DeclStatus => ({ name, state, source: "build", updatedAt: 1, ...extra });

describe("combineStatus", () => {
  it("without live information the build result (or unknown) is used", () => {
    expect(combineStatus("A", undefined, build("A", "proved", { line: 3 }), 9)).toMatchObject({ state: "proved", source: "build", line: 3 });
    expect(combineStatus("A", undefined, undefined, 9)).toEqual({ name: "A", state: "unknown", source: "none", updatedAt: 9 });
  });
  it("live error and stated win over the build", () => {
    const f = "/p/A.lean";
    expect(combineStatus("A", { decl: live("A", "error"), file: f }, build("A", "proved"), 9)).toMatchObject({ state: "error", source: "live", file: f, line: 5 });
    expect(combineStatus("A", { decl: live("A", "stated"), file: f }, build("A", "proved"), 9).state).toBe("stated");
  });
  it("live proved is proved, except that the build's sorry dependencies stay visible", () => {
    const e = { decl: live("A", "proved"), file: "/p/A.lean" };
    expect(combineStatus("A", e, build("A", "stated"), 9).state).toBe("proved");
    expect(combineStatus("A", e, undefined, 9).state).toBe("proved");
    expect(combineStatus("A", e, build("A", "proved-with-sorry-deps", { signature: "x = x" }), 9)).toMatchObject({ state: "proved-with-sorry-deps", signature: "x = x" });
  });
});

function engineWith(answers: Record<string, DeclStatus>, calls: string[][] = []) {
  let t = 100;
  return new StatusEngine({
    now: () => t++,
    runStatus: async (_root, names) => {
      calls.push(names);
      return Object.fromEntries(names.filter((n) => answers[n]).map((n) => [n, answers[n]]));
    },
    runList: async (): Promise<DeclSummary[]> => [{ name: "P.old", kind: "theorem", file: "/p/P.lean", line: 2 }],
  });
}

describe("StatusEngine", () => {
  it("queries the build once per name and caches, unanswered names become unknown", async () => {
    const calls: string[][] = [];
    const e = engineWith({ "P.a": build("P.a", "proved") }, calls);
    const r1 = await e.getStatus("/p", ["P.a", "P.b"]);
    expect(r1["P.a"].state).toBe("proved");
    expect(r1["P.b"].state).toBe("unknown");
    await e.getStatus("/p", ["P.a"]);
    expect(calls).toEqual([["P.a", "P.b"]]);
    await e.getStatus("/p", ["P.a"], { refresh: true });
    expect(calls).toHaveLength(2);
  });

  it("open-file state wins and spares the query for error/stated declarations", async () => {
    const calls: string[][] = [];
    const e = engineWith({ "P.a": build("P.a", "proved") }, calls);
    e.setLive("/p", "/p/P.lean", [live("P.a", "stated")]);
    const r = await e.getStatus("/p", ["P.a"]);
    expect(r["P.a"]).toMatchObject({ state: "stated", source: "live", file: "/p/P.lean" });
    expect(calls).toEqual([]);
    e.setLive("/p", "/p/P.lean", null);
    expect((await e.getStatus("/p", ["P.a"]))["P.a"].state).toBe("proved");
  });

  it("emits the names whose live state changed, 'all' after a build", async () => {
    const e = engineWith({ "P.a": build("P.a", "proved") });
    const events: Array<[string, string[] | "all"]> = [];
    const off = e.onStatusChanged((root, names) => events.push([root, names]));
    e.setLive("/p", "/p/P.lean", [live("P.a", "proved"), live("P.b", "stated")]);
    e.setLive("/p", "/p/P.lean", [live("P.a", "proved"), live("P.b", "proved")]); // only b changed
    e.setLive("/p", "/p/P.lean", null);
    expect(events).toEqual([
      ["/p", ["P.a", "P.b"]],
      ["/p", ["P.b"]],
      ["/p", ["P.a", "P.b"]],
    ]);
    events.length = 0;
    await e.getStatus("/p", ["P.a"]);
    events.length = 0;
    await e.refreshAfterBuild("/p");
    expect(events.at(-1)).toEqual(["/p", "all"]);
    off();
    e.setLive("/p", "/p/P.lean", [live("P.z", "error")]);
    expect(events.at(-1)).toEqual(["/p", "all"]); // unsubscribed: nothing new
  });

  it("serialises queries per project and re-asks cached unknown answers only after the TTL", async () => {
    let running = 0;
    let maxRunning = 0;
    let t = 0;
    const e = new StatusEngine({
      now: () => t,
      unknownTtlMs: 1000,
      runStatus: async (_r, names) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
        return Object.fromEntries(names.map((n) => [n, { name: n, state: "unknown" as const, source: "none" as const, updatedAt: t }]));
      },
      runList: async () => [],
    });
    await Promise.all([e.getStatus("/p", ["A"]), e.getStatus("/p", ["B"]), e.getStatus("/p", ["C"])]);
    expect(maxRunning).toBe(1);
    let calls = 0;
    const e2 = new StatusEngine({ now: () => t, unknownTtlMs: 1000, runStatus: async (_r, n) => (calls++, Object.fromEntries(n.map((x) => [x, { name: x, state: "unknown" as const, source: "none" as const, updatedAt: t }]))), runList: async () => [] });
    await e2.getStatus("/p", ["A"]);
    await e2.getStatus("/p", ["A"]);
    expect(calls).toBe(1);
    t = 5000;
    await e2.getStatus("/p", ["A"]);
    expect(calls).toBe(2);
  });

  it("a failing query yields unknown instead of throwing", async () => {
    const e = new StatusEngine({ runStatus: async () => { throw new Error("boom"); }, runList: async () => { throw new Error("boom"); } });
    expect((await e.getStatus("/p", ["A"]))["A"].state).toBe("unknown");
    expect(await e.listDeclarations("/p")).toEqual([]);
  });

  it("listDeclarations merges the built list with live declarations and filters by prefix", async () => {
    const e = engineWith({});
    e.setLive("/p", "/p/Q.lean", [live("P.new_one", "stated", 10), live("Other.x", "proved")]);
    const all = await e.listDeclarations("/p");
    expect(all.map((d) => d.name).sort()).toEqual(["Other.x", "P.new_one", "P.old"]);
    expect(all.find((d) => d.name === "P.new_one")).toMatchObject({ file: "/p/Q.lean", line: 11, kind: "theorem" });
    expect((await e.listDeclarations("/p", "P.")).map((d) => d.name).sort()).toEqual(["P.new_one", "P.old"]);
  });
});

describe("StatusEngine trust gating", () => {
  function gated(trusted: { v: boolean }) {
    const spawned = { status: 0, list: 0 };
    const e = new StatusEngine({
      isTrusted: () => trusted.v,
      runStatus: async (_r, names) => (spawned.status++, Object.fromEntries(names.map((n) => [n, build(n, "proved")]))),
      runList: async () => (spawned.list++, [{ name: "P.old", kind: "theorem", file: "/p/P.lean", line: 2 }]),
    });
    return { e, spawned };
  }
  it("an untrusted project answers unknown / empty and spawns nothing", async () => {
    const trusted = { v: false };
    const { e, spawned } = gated(trusted);
    const r = await e.getStatus("/p", ["P.a"], { refresh: true });
    expect(r["P.a"]).toMatchObject({ state: "unknown", source: "none" });
    expect(await e.listDeclarations("/p")).toEqual([]);
    await e.refreshAfterBuild("/p");
    expect(spawned).toEqual({ status: 0, list: 0 });
    // live information of open files still works, and the unknown answer was not cached
    e.setLive("/p", "/p/P.lean", [live("P.b", "stated")]);
    expect((await e.getStatus("/p", ["P.b"]))["P.b"].state).toBe("stated");
    trusted.v = true;
    e.invalidate("/p");
    expect((await e.getStatus("/p", ["P.a"]))["P.a"].state).toBe("proved");
    expect(spawned.status).toBe(1);
  });
  it("a query already queued when trust is revoked does not run", async () => {
    const trusted = { v: true };
    const { e, spawned } = gated(trusted);
    const p = e.getStatus("/p", ["P.a"]);
    trusted.v = false;
    expect((await p)["P.a"].state).toBe("unknown");
    expect(spawned.status).toBe(0);
  });
});

describe("StatusEngine list queries and pending stubs", () => {
  it("concurrent listDeclarations share one in-flight query per prefix; different prefixes run one at a time", async () => {
    let running = 0;
    let max = 0;
    let calls = 0;
    const e = new StatusEngine({
      runStatus: async () => ({}),
      runList: async () => {
        calls++;
        running++;
        max = Math.max(max, running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
        return [];
      },
    });
    await Promise.all([e.listDeclarations("/p"), e.listDeclarations("/p"), e.listDeclarations("/p", "A."), e.listDeclarations("/p", "B.")]);
    expect(calls).toBe(3);
    expect(max).toBe(1);
    await e.listDeclarations("/p");
    expect(calls).toBe(4); // finished promises are not cached
  });
  it("registerPending makes a name `stated` (live) at once, notifies, and is superseded by the open file", async () => {
    const e = engineWith({});
    const events: Array<string[] | "all"> = [];
    e.onStatusChanged((_r, n) => events.push(n));
    e.registerPending("/p", "/p/New.lean", live("P.stub", "stated", 3));
    expect(events).toEqual([["P.stub"]]);
    expect((await e.getStatus("/p", ["P.stub"]))["P.stub"]).toMatchObject({ state: "stated", source: "live", file: "/p/New.lean", line: 4 });
    expect((await e.listDeclarations("/p")).find((d) => d.name === "P.stub")).toMatchObject({ file: "/p/New.lean", line: 4 });
    e.setLive("/p", "/p/New.lean", [live("P.stub", "proved", 3)]);
    expect((await e.getStatus("/p", ["P.stub"]))["P.stub"].state).toBe("proved");
    e.setLive("/p", "/p/New.lean", null);
    expect((await e.getStatus("/p", ["P.stub"]))["P.stub"].state).not.toBe("stated"); // pending entry was dropped
  });
});
