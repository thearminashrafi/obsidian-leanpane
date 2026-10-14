import { describe, expect, it } from "vitest";
import { statusLine } from "../../src/core/statusText";
import type { SessionSnapshot } from "../../src/core/session";

const snap = (o: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  phase: "running", message: "", diagnostics: [], processing: [], progress: 1, sorryLines: [], sorryCount: 0, project: null, decls: [], ...o,
});

describe("statusLine", () => {
  it("is empty without a session", () => {
    expect(statusLine(null).kind).toBe("none");
    expect(statusLine(snap({ phase: "idle" })).text).toBe("");
  });
  it("walks through Starting / Checking / Ready / Error", () => {
    expect(statusLine(snap({ phase: "preparing", message: "Starting Lean…" }))).toEqual({ kind: "starting", text: "Starting…" });
    expect(statusLine(snap({ phase: "preparing", message: "Preparing Lean (may download leanprover/lean4:v4.99.0)…" }))).toEqual({ kind: "preparing", text: "Preparing…" });
    const range = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } };
    expect(statusLine(snap({ processing: [{ range }], progress: 0.424, leanVersion: "4.25.1" })).text).toBe("Checking 42% · Lean 4.25.1");
    expect(statusLine(snap({ leanVersion: "4.25.1" })).text).toBe("Ready · Lean 4.25.1");
    const err = { range, severity: 1 as const, message: "x" };
    expect(statusLine(snap({ diagnostics: [err] })).kind).toBe("error");
  });
  it("adds the sorry count and 'no project'", () => {
    expect(statusLine(snap({ leanVersion: "4.25.1", sorryCount: 1 })).text).toBe("Ready · Lean 4.25.1 · 1 sorry");
    expect(statusLine(snap({ leanVersion: "4.25.1", sorryCount: 3 }), false).text).toBe("Ready · Lean 4.25.1 · 3 sorries · no project");
  });
  it("names the failure states", () => {
    expect(statusLine(snap({ phase: "failed" })).kind).toBe("failed");
    expect(statusLine(snap({ phase: "restarting" })).text).toBe("Restarting…");
    expect(statusLine(snap({ phase: "no-lean" })).text).toBe("Lean not found");
    expect(statusLine(snap({ phase: "untrusted" })).text).toBe("Not trusted");
  });
});
