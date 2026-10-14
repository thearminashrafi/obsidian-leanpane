/** Node side of the e2e: real LeanServer + Playwright driver. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LeanServer } from "../../../src/core/server";
import { copyFixtureToTmp, fileUri, findTools } from "./tools";

const leanTools = findTools();
const LEAN_SKIP_MESSAGE = "Lean (elan + lake) not found; set LEANPANE_TEST_ELAN_BIN. Skipping e2e.";

type Json = unknown;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function main(o: { chromium: any; executablePath?: string; pageJs: string; root: string; keep: boolean }): Promise<number> {
  if (!leanTools) {
    console.error(LEAN_SKIP_MESSAGE);
    return 2;
  }
  const results: Array<[string, boolean, string]> = [];
  const check = (name: string, ok: boolean, detail = "") => {
    results.push([name, ok, detail]);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " -- " + detail : ""}`);
  };

  const proj = copyFixtureToTmp();
  // reuse the prebuilt fixture oleans if present (copyFixtureToTmp skips .lake); the test file only imports Init
  const file = path.join(proj, "StatusProj", "Goals.lean");
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const uri = fileUri(file);
  const line = (needle: string) => lines.findIndex((l) => l.includes(needle));

  const server = new LeanServer({ kind: "lake", command: leanTools.lake, args: ["serve", "--"], cwd: proj, env: leanTools.env }, { rootPath: proj });
  const browser = await o.chromium.launch({ executablePath: o.executablePath, args: ["--no-sandbox"] });
  try {
    const pg = await browser.newPage({ viewport: { width: 900, height: 700 } });
    pg.on("console", (m: any) => console.log("  [page]", m.text()));
    pg.on("pageerror", (e: any) => console.log("  [pageerror]", String(e)));

    const controllers = new Map<number, AbortController>();
    await pg.exposeFunction("__leanRequest", async (id: number, method: string, params: Json) => {
      const ac = new AbortController();
      controllers.set(id, ac);
      try {
        return { ok: true, result: await server.request(method, params, ac.signal) };
      } catch (e: any) {
        return { ok: false, message: String(e?.message ?? e), code: e?.code };
      } finally {
        controllers.delete(id);
      }
    });
    await pg.exposeFunction("__leanCancel", (id: number) => controllers.get(id)?.abort());
    await pg.exposeFunction("__leanNotify", (method: string, params: Json) => server.notify(method, params));

    await pg.setContent(`<!doctype html><html><body class="theme-dark" style="margin:0;background:#1e1e2e;--background-primary:#1e1e2e;--background-secondary:#181825;--text-normal:#cdd6f4;--text-muted:#a6adc8;--text-faint:#6c7086;--text-error:#f38ba8;--interactive-accent:#7f6df2;--text-on-accent:#ffffff;--font-monospace:'DejaVu Sans Mono',monospace;--font-interface:sans-serif;--font-text-size:16px;--code-size:0.875em">
      <div id="container" style="width:800px;height:600px"></div></body></html>`);

    // server -> page forwarding (before the page host exists is fine: it only forwards once subscribed)
    server.onNotification("*", (params, method) => {
      pg.evaluate(([m, p]: [string, unknown]) => (window as any).__t.deliver(m, p), [method, params] as [string, unknown]).catch(() => {});
    });

    await pg.addScriptTag({ content: o.pageJs });
    const mounted = await pg.evaluate(() => (window as any).__t.mount());
    check("mount() resolves true (infoview ready in sandboxed iframe)", mounted === true, JSON.stringify(await pg.evaluate(() => (window as any).__t.state)));
    const sandbox = await pg.evaluate(() => document.querySelector("iframe")!.getAttribute("sandbox"));
    check("iframe is sandboxed without allow-same-origin", sandbox === "allow-scripts", String(sandbox));

    await server.start();
    await pg.evaluate((r: any) => (window as any).__t.host.serverRestarted(r), server.initializeResult as any);

    server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: 1, text } });
    await pg.evaluate(([m, p]: [string, unknown]) => (window as any).__t.host.sentClientNotification(m, p), ["textDocument/didOpen", { textDocument: { uri } }] as [string, unknown]);

    const frame = () => pg.frames().find((f: any) => f !== pg.mainFrame())!;
    const proofLine = line("constructor");
    await pg.evaluate(([u, l]: [string, number]) => (window as any).__t.host.setCursor(u, { line: l, character: 2 }), [uri, proofLine] as [string, number]);

    const deadline = Date.now() + 90000;
    let rootText = "";
    while (Date.now() < deadline) {
      rootText = await frame().evaluate(() => document.getElementById("react_root")!.innerText).catch(() => "");
      if (rootText.includes("⊢ q ∧ p")) break;
      await sleep(500);
    }
    console.log("  --- infoview text ---\n" + rootText.split("\n").map((l: string) => "  | " + l).join("\n"));
    check("infoview shows the goal `⊢ q ∧ p` at `constructor`", rootText.includes("⊢ q ∧ p"));
    check("infoview shows hypotheses `hp : p`", /hp\s*:\s*p/.test(rootText));

    // move the cursor: second bullet `exact hp` => goal ⊢ p
    const l2 = line("· exact hp");
    await pg.evaluate(([u, l]: [string, number]) => (window as any).__t.host.setCursor(u, { line: l, character: 4 }), [uri, l2] as [string, number]);
    let t2 = "";
    const d2 = Date.now() + 30000;
    while (Date.now() < d2) {
      t2 = await frame().evaluate(() => document.getElementById("react_root")!.innerText).catch(() => "");
      if (/⊢ p\s*$/m.test(t2) && !t2.includes("⊢ q ∧ p")) break;
      await sleep(300);
    }
    check("after moving the cursor the goal is `⊢ p`", /⊢ p\s*$/m.test(t2) && !t2.includes("⊢ q ∧ p"), t2.replace(/\n/g, " | ").slice(0, 120));

    // theme: iframe body gets the Obsidian background, and refreshTheme() re-applies
    const bg = () => frame().evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("theme applied (background = Obsidian --background-primary)", (await bg()) === "rgb(30, 30, 46)", await bg());
    await pg.evaluate(() => { document.body.classList.replace("theme-dark", "theme-light"); document.body.style.setProperty("--background-primary", "#fafafa"); document.body.style.setProperty("--text-normal", "#202020"); (window as any).__t.host.refreshTheme(); });
    await sleep(300);
    check("refreshTheme() updates the iframe", (await bg()) === "rgb(250, 250, 250)", await bg());

    // hover popups need the sendClientRequest path with RPC sessions; also check that a session was kept alive
    const failed = await pg.evaluate(() => (window as any).__t.state.failed);
    check("onFailed was not called", failed === undefined, String(failed));

    await pg.evaluate(() => (window as any).__t.host.dispose());
    check("dispose() removes the iframe", (await pg.evaluate(() => document.querySelectorAll("iframe").length)) === 0);
  } catch (e) {
    check("e2e run", false, String((e as Error)?.stack ?? e));
  } finally {
    await browser.close().catch(() => {});
    await server.stop().catch(() => {});
    if (!o.keep) fs.rmSync(proj, { recursive: true, force: true });
  }
  const bad = results.filter((r) => !r[1]).length;
  console.log(bad === 0 ? "\nE2E PASSED" : `\nE2E FAILED (${bad})`);
  return bad === 0 ? 0 : 1;
}
