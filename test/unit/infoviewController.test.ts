import { describe, expect, it } from "vitest";
import { InfoviewController, type InfoviewHostLike } from "../../src/view/InfoviewController";
import type { InfoviewHostOptions } from "../../src/infoview/host";

const fakeServer = { state: "running", initializeResult: { capabilities: {}, serverInfo: { name: "Lean", version: "4.25.1" } } } as any;

function make(host: Partial<InfoviewHostLike> & { mountResult?: boolean | Error }) {
  const calls: string[] = [];
  const modes: Array<[string, string | undefined]> = [];
  let opts!: InfoviewHostOptions;
  const full: InfoviewHostLike = {
    mount: async () => {
      calls.push("mount");
      if (host.mountResult instanceof Error) throw host.mountResult;
      return host.mountResult ?? true;
    },
    setCursor: (u, p) => void calls.push(`cursor ${u} ${p.line}:${p.character}`),
    serverRestarted: (r) => void calls.push(`restarted ${r.serverInfo?.version}`),
    serverStopped: (r) => void calls.push(`stopped ${r}`),
    sentClientNotification: (m) => void calls.push(`sent ${m}`),
    refreshTheme: () => void calls.push("theme"),
    dispose: () => void calls.push("dispose"),
    ...host,
  } as InfoviewHostLike;
  const c = new InfoviewController({
    container: {} as HTMLElement,
    getServer: () => fakeServer,
    editor: {} as any,
    onMode: (m, r) => modes.push([m, r]),
    createHost: (o) => ((opts = o), full),
  });
  return { c, calls, modes, opts: () => opts };
}

describe("InfoviewController", () => {
  it("goes interactive after mount and replays what it missed", async () => {
    const { c, calls, modes } = make({});
    const started = c.start();
    c.setCursor("file:///a", { line: 1, character: 2 });
    c.sentClientNotification("textDocument/didOpen", {});
    c.sentClientNotification("textDocument/didChange", {});
    await started;
    expect(modes).toEqual([["interactive", undefined]]);
    expect(calls).toEqual(["mount", "restarted 4.25.1", "sent textDocument/didOpen", "sent textDocument/didChange", "cursor file:///a 1:2"]);
    c.setCursor("file:///a", { line: 3, character: 0 });
    c.serverStopped("bye");
    c.refreshTheme();
    expect(calls.slice(-3)).toEqual(["cursor file:///a 3:0", "stopped bye", "theme"]);
    expect(c.active).toBe(true);
  });

  it("falls back to plain when mount() throws synchronously (host not implemented yet)", async () => {
    const { c, modes, calls } = make({ mount: (() => { throw new Error("TODO(stage 3 infoview)"); }) as any });
    await c.start();
    expect(modes).toEqual([["plain", expect.stringContaining("TODO")]]);
    expect(calls).toContain("dispose");
    c.setCursor("file:///a", { line: 0, character: 0 }); // must not throw
    expect(c.failed).toBe(true);
  });

  it("falls back when mount() resolves false or the host reports failure", async () => {
    const a = make({ mountResult: false });
    await a.c.start();
    expect(a.modes[0][0]).toBe("plain");
    const b = make({});
    await b.c.start();
    b.opts().onFailed("no ready message");
    expect(b.modes.at(-1)).toEqual(["plain", expect.stringContaining("no ready message")]);
  });

  it("falls back for good when a later call throws, and stays quiet afterwards", async () => {
    let n = 0;
    const { c, modes } = make({ setCursor: () => { if (++n === 1) throw new Error("kaput"); } });
    await c.start();
    c.setCursor("file:///a", { line: 0, character: 0 });
    expect(modes.at(-1)?.[0]).toBe("plain");
    c.setCursor("file:///a", { line: 1, character: 0 });
    expect(n).toBe(1);
  });

  it("dispose removes the host and allows a fresh start", async () => {
    const { c, calls } = make({});
    await c.start();
    c.dispose();
    expect(calls).toContain("dispose");
    expect(c.active).toBe(false);
    c.setCursor("file:///a", { line: 0, character: 0 });
    expect(calls.filter((x) => x.startsWith("cursor"))).toHaveLength(0);
  });
});
