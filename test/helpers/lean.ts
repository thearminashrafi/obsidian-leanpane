/**
 * Harness for real-Lean integration tests. Locates elan/lake/lean, skips with a clear message when Lean is missing,
 * and offers the fixture projects (test/fixtures/lean/*). Never downloads anything: fixtures use
 * `leanprover/lean4:v4.25.1`, which must already be installed (`elan toolchain list`).
 */
import { describe } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as rpc from "vscode-jsonrpc/node";
import { killTree } from "../../src/core/proc";

export interface LeanTools {
  binDir: string;
  lake: string;
  lean: string;
  /** process.env with binDir prepended to PATH (and no ELAN_TOOLCHAIN override). */
  env: NodeJS.ProcessEnv;
}

function findTools(): LeanTools | null {
  const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);
  const candidates = [process.env.LEANPANE_TEST_ELAN_BIN, path.join(os.homedir(), ".elan", "bin"), ...(process.env.PATH ?? "").split(path.delimiter)].filter(Boolean) as string[];
  for (const dir of candidates) {
    const lake = path.join(dir, exe("lake"));
    const lean = path.join(dir, exe("lean"));
    if (fs.existsSync(lake) && fs.existsSync(lean)) {
      const env = { ...process.env, PATH: dir + path.delimiter + (process.env.PATH ?? "") };
      // The toolchain must work offline: `lake --version` triggers an elan toolchain resolve.
      const r = spawnSync(lake, ["--version"], { env, encoding: "utf8", timeout: 30000 });
      if (r.status === 0) return { binDir: dir, lake, lean, env };
    }
  }
  return null;
}

export const leanTools: LeanTools | null = findTools();
export const LEAN_SKIP_MESSAGE = "Lean (elan + lake with toolchain leanprover/lean4:v4.25.1) not found; set LEANPANE_TEST_ELAN_BIN to the elan bin dir. Skipping real-Lean tests.";
if (!leanTools) console.warn(`[leanpane tests] ${LEAN_SKIP_MESSAGE}`);

/** `describe` that is skipped (with the warning above) when Lean is not available. */
export const describeLean: typeof describe = (leanTools ? describe : describe.skip) as typeof describe;

export const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures", "lean");
/** Absolute path of a file inside test/fixtures/lean. */
export function fixturePath(...parts: string[]): string {
  return path.join(FIXTURES_DIR, ...parts);
}
export const STATUS_PROJ = fixturePath("status_proj");

/** Run `lake build` in a fixture project if its default target has not been built yet. */
export function ensureBuilt(projectRoot: string = STATUS_PROJ): void {
  if (!leanTools) return;
  if (fs.existsSync(path.join(projectRoot, ".lake", "build", "lib", "lean", "StatusProj.olean"))) return;
  const r = spawnSync(leanTools.lake, ["build"], { cwd: projectRoot, env: leanTools.env, encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) throw new Error(`lake build failed in ${projectRoot}:\n${r.stdout}\n${r.stderr}`);
}

/** Copy a fixture project (without .lake) into a fresh temp dir so tests may edit files. Returns the new root. */
export function copyFixtureToTmp(name = "status_proj"): string {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "leanpane-fx-"));
  fs.cpSync(fixturePath(name), dst, { recursive: true, filter: (src) => !src.includes(`${path.sep}.lake`) });
  return dst;
}

export function fileUri(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/");
  return "file://" + (abs.startsWith("/") ? "" : "/") + encodeURI(abs);
}

export interface RawServer {
  child: ChildProcess;
  conn: rpc.MessageConnection;
  /** All notifications received, in order. */
  notifications: Array<{ method: string; params: any }>;
  initializeResult: any;
  waitFor(pred: (n: { method: string; params: any }) => boolean, timeoutMs?: number): Promise<{ method: string; params: any }>;
  dispose(): Promise<void>;
}

/**
 * Minimal, dependency-free LSP client used by the smoke test and for capturing fixtures. It is deliberately NOT
 * the production client (src/core/server.ts); it only exists so that tests of other modules can talk to real Lean.
 */
export async function startRawServer(projectRoot: string): Promise<RawServer> {
  if (!leanTools) throw new Error(LEAN_SKIP_MESSAGE);
  const child = spawn(leanTools.lake, ["serve", "--"], { cwd: projectRoot, env: leanTools.env, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: process.platform !== "win32" });
  child.stderr!.resume();
  const conn = rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout!), new rpc.StreamMessageWriter(child.stdin!));
  const notifications: Array<{ method: string; params: any }> = [];
  const waiters: Array<{ pred: (n: { method: string; params: any }) => boolean; resolve: (n: { method: string; params: any }) => void }> = [];
  conn.onNotification((method: string, params: any) => {
    const n = { method, params };
    notifications.push(n);
    for (const w of [...waiters]) if (w.pred(n)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(n); }
  });
  conn.onRequest((_method: string) => null); // answer client/registerCapability etc.
  conn.listen();
  const initializeResult = await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: fileUri(projectRoot),
    capabilities: { textDocument: { publishDiagnostics: {}, documentSymbol: { hierarchicalDocumentSymbolSupport: true } }, window: { workDoneProgress: true }, workspace: { semanticTokens: { refreshSupport: true } } },
    initializationOptions: { editDelay: 50, hasWidgets: true },
    workspaceFolders: [{ uri: fileUri(projectRoot), name: path.basename(projectRoot) }],
  });
  conn.sendNotification("initialized", {});
  return {
    child, conn, notifications, initializeResult,
    waitFor(pred, timeoutMs = 90000) {
      const hit = notifications.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timed out waiting for notification")), timeoutMs);
        waiters.push({ pred, resolve: (n) => { clearTimeout(t); resolve(n); } });
      });
    },
    async dispose() {
      try { await Promise.race([conn.sendRequest("shutdown"), new Promise((r) => setTimeout(r, 3000))]); conn.sendNotification("exit"); } catch { /* ignore */ }
      conn.dispose();
      killTree(child);
    },
  };
}

/** Open a file in a raw server and wait until Lean reports it fully processed (fileProgress with empty `processing`). */
export async function openAndWait(s: RawServer, file: string, languageId = "lean4"): Promise<{ uri: string; text: string }> {
  const uri = fileUri(file);
  const text = fs.readFileSync(file, "utf8");
  s.conn.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
  await s.waitFor((n) => n.method === "$/lean/fileProgress" && n.params.textDocument.uri === uri && n.params.processing.length === 0);
  return { uri, text };
}
