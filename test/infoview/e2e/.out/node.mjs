// test/infoview/e2e/node.ts
import * as fs2 from "node:fs";
import * as path3 from "node:path";

// src/core/server.ts
import { spawn as spawn2 } from "node:child_process";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import * as rpc from "vscode-jsonrpc/node";

// src/core/proc.ts
import { spawn } from "node:child_process";
function killTree(child, platform = process.platform) {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false }).on("error", () => void 0);
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      const t = setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
        }
      }, 2e3);
      t.unref?.();
    }
  } catch {
  }
}

// src/core/server.ts
var STDERR_KEEP = 200;
var defaultTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h)
};
function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}
function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
function within(p, ms) {
  return new Promise((resolve3) => {
    const t = setTimeout(resolve3, ms);
    const done = () => {
      clearTimeout(t);
      resolve3();
    };
    p.then(done, done);
  });
}
function exitWithin(child, ms) {
  if (hasExited(child)) return Promise.resolve();
  return within(new Promise((resolve3) => child.once("exit", () => resolve3())), ms);
}
var LeanServer = class {
  constructor(spec, opts = {}) {
    this.state = "stopped";
    this.gen = 0;
    this.startedAt = 0;
    this.crashes = 0;
    this.stopping = false;
    this.stateListeners = /* @__PURE__ */ new Set();
    this.notifListeners = /* @__PURE__ */ new Map();
    this.requestHandlers = /* @__PURE__ */ new Map();
    /** reject functions of in-flight requests, called when the process dies or is stopped */
    this.pending = /* @__PURE__ */ new Set();
    this.stderrLines = [];
    this.spec = spec;
    this.rootPath = opts.rootPath ?? spec.cwd;
    this.backoffMs = opts.backoffMs ?? [1e3, 5e3, 3e4];
    this.maxCrashes = opts.maxCrashes ?? 3;
    this.stableMs = opts.stableMs ?? 6e4;
    this.initTimeoutMs = opts.initTimeoutMs ?? 12e4;
    this.initOptions = opts.initializationOptions ?? {};
    this.log = opts.log;
    this.timers = opts.timers ?? defaultTimers;
  }
  start() {
    if (this.stopPromise) return this.stopPromise.then(() => this.start());
    if (this.state === "running") return Promise.resolve();
    if (this.state === "starting") return this.handshakePromise ?? Promise.resolve();
    this.cancelBackoff();
    this.crashes = 0;
    this.stopping = false;
    return this.launch(false);
  }
  stop() {
    if (this.state === "stopped" && !this.child && !this.handshake && !this.backoffTimer) return Promise.resolve();
    if (!this.stopPromise) {
      this.stopPromise = this.doStop().finally(() => {
        this.stopPromise = void 0;
      });
    }
    return this.stopPromise;
  }
  async restart() {
    await this.stop();
    this.crashes = 0;
    return this.start();
  }
  request(method, params, signal) {
    const conn = this.conn;
    if (this.state !== "running" || !conn) return Promise.reject(new Error("Lean server is not running"));
    const cts = new rpc.CancellationTokenSource();
    return new Promise((resolve3, reject) => {
      let settled = false;
      const settle = (err, value) => {
        if (settled) return;
        settled = true;
        this.pending.delete(onDeath);
        signal?.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve3(value);
      };
      const onDeath = (e) => settle(e);
      const onAbort = () => {
        cts.cancel();
        settle(new Error(`${method} was cancelled`));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.pending.add(onDeath);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        conn.sendRequest(method, params, cts.token).then(
          (v) => settle(void 0, v),
          (e) => settle(e instanceof Error ? e : new Error(errMsg(e)))
        );
      } catch (e) {
        settle(new Error(errMsg(e)));
      }
    });
  }
  notify(method, params) {
    const conn = this.conn;
    if (this.state !== "running" || !conn) return;
    try {
      conn.sendNotification(method, params);
    } catch (e) {
      this.log?.(`notify ${method} failed: ${errMsg(e)}`);
    }
  }
  onNotification(method, handler) {
    let set = this.notifListeners.get(method);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.notifListeners.set(method, set);
    }
    const entry = (params, m) => handler(params, m);
    const listeners = set;
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }
  onRequest(method, handler) {
    this.requestHandlers.set(method, handler);
    return () => {
      if (this.requestHandlers.get(method) === handler) this.requestHandlers.delete(method);
    };
  }
  onState(handler) {
    this.stateListeners.add(handler);
    return () => {
      this.stateListeners.delete(handler);
    };
  }
  stderrTail(n = 40) {
    if (n <= 0) return [];
    return this.stderrLines.slice(-n);
  }
  // ---- lifecycle -------------------------------------------------------------------------------
  /** Spawns a new process and performs the handshake. `auto` = an automatic restart after a crash. */
  launch(auto) {
    const gen = ++this.gen;
    this.setState("starting");
    const p = new Promise((resolve3, reject) => {
      this.handshake = { gen, auto, resolve: () => resolve3(), reject };
      this.spawnAndInit(gen);
    });
    p.catch(() => void 0);
    this.handshakePromise = p;
    return p;
  }
  spawnAndInit(gen) {
    const { command, args, cwd, env } = this.spec;
    let child;
    try {
      child = spawn2(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true
      });
    } catch (e) {
      this.failHandshake(gen, `Could not start ${command}: ${errMsg(e)}`);
      return;
    }
    this.child = child;
    this.pid = child.pid;
    this.startedAt = Date.now();
    this.stderrLines.length = 0;
    child.stdin?.on("error", () => void 0);
    child.stdout?.on("error", () => void 0);
    child.stderr?.on("error", () => void 0);
    this.readStderr(child);
    child.on("error", (err) => {
      if (child !== this.child) return;
      if (child.pid === void 0) this.failHandshake(gen, `Could not start ${command}: ${err.message}`);
      else this.log?.(`lean server: ${err.message}`);
    });
    child.once("exit", (code, signal) => this.afterStderrDrained(child, () => this.onExit(child, code, signal)));
    const conn = rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout), new rpc.StreamMessageWriter(child.stdin));
    this.conn = conn;
    conn.onNotification((method, params) => this.dispatch(method, params));
    conn.onRequest((method, params) => this.serveRequest(method, params));
    conn.listen();
    const h = this.handshake;
    if (h && h.gen === gen) {
      h.timer = this.timers.setTimeout(
        () => this.failHandshake(gen, `Lean server initialize timed out after ${this.initTimeoutMs} ms`),
        this.initTimeoutMs
      );
    }
    conn.sendRequest("initialize", this.initParams()).then(
      (result) => {
        const cur = this.handshake;
        if (!cur || cur.gen !== gen) return;
        this.clearTimer(cur);
        this.handshake = void 0;
        this.initializeResult = result;
        try {
          conn.sendNotification("initialized", {});
        } catch {
        }
        this.setState("running");
        cur.resolve();
      },
      (e) => this.afterStderrDrained(child, () => {
        if (this.handshake?.gen === gen && !hasExited(child)) this.failHandshake(gen, `Lean server failed to initialize: ${errMsg(e)}`);
      })
    );
  }
  /** Handshake failed before "running": a first start rejects, an automatic restart counts as another crash. */
  failHandshake(gen, msg) {
    const h = this.handshake;
    if (!h || h.gen !== gen) return;
    this.handshake = void 0;
    this.clearTimer(h);
    const child = this.child;
    if (child) this.teardown(child);
    const text = this.describe(msg);
    if (h.auto) this.onCrash(text);
    else this.setState("failed", text);
    h.reject(new Error(text));
  }
  onExit(child, code, signal) {
    if (child !== this.child) return;
    if (this.stopping) {
      this.teardown(child);
      return;
    }
    const head = `Lean server exited (${signal ? `signal ${signal}` : `code ${code}`})`;
    if (this.handshake) {
      this.failHandshake(this.handshake.gen, `${head} during startup`);
      return;
    }
    const stable = this.state === "running" && Date.now() - this.startedAt >= this.stableMs;
    const text = this.describe(head);
    this.teardown(child);
    if (stable) this.crashes = 0;
    this.onCrash(text);
  }
  /** Counts a crash; either gives up (failed) or schedules a restart after the backoff delay. */
  onCrash(text) {
    if (this.stopping) return;
    this.crashes++;
    if (this.crashes >= this.maxCrashes) {
      this.setState("failed", text);
      return;
    }
    this.setState("backoff", text);
    const delay = this.backoffMs[Math.min(this.crashes - 1, this.backoffMs.length - 1)] ?? 1e3;
    const handle = this.timers.setTimeout(() => {
      this.backoffTimer = void 0;
      if (this.stopping || this.state !== "backoff") return;
      void this.launch(true);
    }, delay);
    this.backoffTimer = { handle };
  }
  async doStop() {
    this.stopping = true;
    this.cancelBackoff();
    const h = this.handshake;
    this.handshake = void 0;
    if (h) {
      this.clearTimer(h);
      h.reject(new Error("Lean server was stopped during startup"));
    }
    const child = this.child;
    if (child) {
      const conn = this.conn;
      const graceful = this.state === "running" && !!conn;
      this.rejectPending(new Error("Lean server was stopped"));
      if (graceful && conn && !hasExited(child)) {
        await within(Promise.resolve().then(() => conn.sendRequest("shutdown")), 1500);
        try {
          conn.sendNotification("exit");
        } catch {
        }
      }
      if (!hasExited(child)) await exitWithin(child, 1500);
      this.teardown(child);
      await exitWithin(child, 1500);
    }
    this.setState("stopped");
  }
  /** Forgets the current process (if it is still the current one), rejects pending requests, kills its group. */
  teardown(child) {
    if (child !== this.child) return;
    const conn = this.conn;
    this.child = void 0;
    this.conn = void 0;
    this.pid = void 0;
    try {
      conn?.dispose();
    } catch {
    }
    this.rejectPending(new Error("Lean server exited"));
    killTree(child);
  }
  cancelBackoff() {
    if (this.backoffTimer) {
      this.timers.clearTimeout(this.backoffTimer.handle);
      this.backoffTimer = void 0;
    }
  }
  clearTimer(h) {
    if (h.timer !== void 0) this.timers.clearTimeout(h.timer);
    h.timer = void 0;
  }
  rejectPending(err) {
    for (const f of [...this.pending]) f(err);
  }
  // ---- stderr and messages ---------------------------------------------------------------------
  readStderr(child) {
    const decoder = new StringDecoder("utf8");
    let partial = "";
    child.stderr?.on("data", (chunk) => {
      partial += decoder.write(chunk);
      let nl = partial.indexOf("\n");
      while (nl >= 0) {
        this.pushStderr(partial.slice(0, nl).replace(/\r$/, ""));
        partial = partial.slice(nl + 1);
        nl = partial.indexOf("\n");
      }
    });
    child.stderr?.on("end", () => {
      if (partial) this.pushStderr(partial);
      partial = "";
    });
  }
  pushStderr(line) {
    this.stderrLines.push(line);
    if (this.stderrLines.length > STDERR_KEEP) this.stderrLines.splice(0, this.stderrLines.length - STDERR_KEEP);
    this.log?.(line);
  }
  /** Runs cb once the child's stderr has been read to the end (or after a short grace period), so its last lines are reported. */
  afterStderrDrained(child, cb) {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      cb();
    };
    const err = child.stderr;
    if (!err || err.readableEnded || err.destroyed) {
      run();
      return;
    }
    err.once("end", run);
    err.once("close", run);
    setTimeout(run, 100);
  }
  describe(head) {
    const tail = this.stderrTail(10).join("\n").trim();
    return tail ? `${head}: ${tail}` : head;
  }
  dispatch(method, params) {
    const handlers = [...this.notifListeners.get("*") ?? []];
    if (method !== "*") handlers.push(...this.notifListeners.get(method) ?? []);
    for (const h of handlers) {
      try {
        const r = h(params, method);
        if (r instanceof Promise) r.catch(() => void 0);
      } catch {
      }
    }
  }
  async serveRequest(method, params) {
    const h = this.requestHandlers.get(method);
    if (!h) return null;
    const result = await h(params);
    return result === void 0 ? null : result;
  }
  initParams() {
    const root = path.resolve(this.rootPath);
    const uri = pathToFileURL(root).toString();
    return {
      processId: process.pid,
      clientInfo: { name: "LeanPane", version: "0.1.0" },
      rootUri: uri,
      workspaceFolders: [{ uri, name: path.basename(root) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          publishDiagnostics: { relatedInformation: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: { completionItem: { snippetSupport: false } },
          definition: {},
          semanticTokens: { requests: { full: true, range: true }, tokenTypes: [], tokenModifiers: [], formats: ["relative"] }
        },
        window: { workDoneProgress: true, showDocument: { support: true } },
        workspace: { semanticTokens: { refreshSupport: true }, applyEdit: true, workspaceFolders: true },
        experimental: {}
      },
      initializationOptions: { hasWidgets: true, editDelay: 50, ...this.initOptions }
    };
  }
  setState(state, error) {
    this.state = state;
    const e = { state, crashes: this.crashes };
    if (error !== void 0 && (state === "backoff" || state === "failed")) e.error = error;
    for (const l of [...this.stateListeners]) {
      try {
        l(e);
      } catch {
      }
    }
  }
};

// test/infoview/e2e/tools.ts
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path2 from "node:path";
function findTools() {
  const candidates = [process.env.LEANPANE_TEST_ELAN_BIN, path2.join(os.homedir(), ".elan", "bin"), ...(process.env.PATH ?? "").split(path2.delimiter)].filter(Boolean);
  for (const dir of candidates) {
    const lake = path2.join(dir, "lake");
    if (fs.existsSync(lake) && fs.existsSync(path2.join(dir, "lean"))) {
      const env = { ...process.env, PATH: dir + path2.delimiter + (process.env.PATH ?? "") };
      if (spawnSync(lake, ["--version"], { env, timeout: 3e4 }).status === 0) return { binDir: dir, lake, env };
    }
  }
  return null;
}
var FIXTURE = path2.resolve("/home/claude/leanpane-build/obsidian-leanpane/test/infoview/e2e", "..", "..", "fixtures", "lean", "status_proj");
function copyFixtureToTmp() {
  const dst = fs.mkdtempSync(path2.join(os.tmpdir(), "leanpane-iv-"));
  fs.cpSync(FIXTURE, dst, { recursive: true, filter: (src) => !src.includes(`${path2.sep}.lake`) });
  return dst;
}
function fileUri(p) {
  return "file://" + encodeURI(path2.resolve(p).replace(/\\/g, "/"));
}

// test/infoview/e2e/node.ts
var leanTools = findTools();
var LEAN_SKIP_MESSAGE = "Lean (elan + lake) not found; set LEANPANE_TEST_ELAN_BIN. Skipping e2e.";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main(o) {
  if (!leanTools) {
    console.error(LEAN_SKIP_MESSAGE);
    return 2;
  }
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push([name, ok, detail]);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " -- " + detail : ""}`);
  };
  const proj = copyFixtureToTmp();
  const file = path3.join(proj, "StatusProj", "Goals.lean");
  const text = fs2.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const uri = fileUri(file);
  const line = (needle) => lines.findIndex((l) => l.includes(needle));
  const server = new LeanServer({ kind: "lake", command: leanTools.lake, args: ["serve", "--"], cwd: proj, env: leanTools.env }, { rootPath: proj });
  const browser = await o.chromium.launch({ executablePath: o.executablePath, args: ["--no-sandbox"] });
  try {
    const pg = await browser.newPage({ viewport: { width: 900, height: 700 } });
    pg.on("console", (m) => console.log("  [page]", m.text()));
    pg.on("pageerror", (e) => console.log("  [pageerror]", String(e)));
    const controllers = /* @__PURE__ */ new Map();
    await pg.exposeFunction("__leanRequest", async (id, method, params) => {
      const ac = new AbortController();
      controllers.set(id, ac);
      try {
        return { ok: true, result: await server.request(method, params, ac.signal) };
      } catch (e) {
        return { ok: false, message: String(e?.message ?? e), code: e?.code };
      } finally {
        controllers.delete(id);
      }
    });
    await pg.exposeFunction("__leanCancel", (id) => controllers.get(id)?.abort());
    await pg.exposeFunction("__leanNotify", (method, params) => server.notify(method, params));
    await pg.setContent(`<!doctype html><html><body class="theme-dark" style="margin:0;background:#1e1e2e;--background-primary:#1e1e2e;--background-secondary:#181825;--text-normal:#cdd6f4;--text-muted:#a6adc8;--text-faint:#6c7086;--text-error:#f38ba8;--interactive-accent:#7f6df2;--text-on-accent:#ffffff;--font-monospace:'DejaVu Sans Mono',monospace;--font-interface:sans-serif;--font-text-size:16px;--code-size:0.875em">
      <div id="container" style="width:800px;height:600px"></div></body></html>`);
    server.onNotification("*", (params, method) => {
      pg.evaluate(([m, p]) => window.__t.deliver(m, p), [method, params]).catch(() => {
      });
    });
    await pg.addScriptTag({ content: o.pageJs });
    const mounted = await pg.evaluate(() => window.__t.mount());
    check("mount() resolves true (infoview ready in sandboxed iframe)", mounted === true, JSON.stringify(await pg.evaluate(() => window.__t.state)));
    const sandbox = await pg.evaluate(() => document.querySelector("iframe").getAttribute("sandbox"));
    check("iframe is sandboxed without allow-same-origin", sandbox === "allow-scripts", String(sandbox));
    await server.start();
    await pg.evaluate((r) => window.__t.host.serverRestarted(r), server.initializeResult);
    server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: 1, text } });
    await pg.evaluate(([m, p]) => window.__t.host.sentClientNotification(m, p), ["textDocument/didOpen", { textDocument: { uri } }]);
    const frame = () => pg.frames().find((f) => f !== pg.mainFrame());
    const proofLine = line("constructor");
    await pg.evaluate(([u, l]) => window.__t.host.setCursor(u, { line: l, character: 2 }), [uri, proofLine]);
    const deadline = Date.now() + 9e4;
    let rootText = "";
    while (Date.now() < deadline) {
      rootText = await frame().evaluate(() => document.getElementById("react_root").innerText).catch(() => "");
      if (rootText.includes("\u22A2 q \u2227 p")) break;
      await sleep(500);
    }
    console.log("  --- infoview text ---\n" + rootText.split("\n").map((l) => "  | " + l).join("\n"));
    check("infoview shows the goal `\u22A2 q \u2227 p` at `constructor`", rootText.includes("\u22A2 q \u2227 p"));
    check("infoview shows hypotheses `hp : p`", /hp\s*:\s*p/.test(rootText));
    const l2 = line("\xB7 exact hp");
    await pg.evaluate(([u, l]) => window.__t.host.setCursor(u, { line: l, character: 4 }), [uri, l2]);
    let t2 = "";
    const d2 = Date.now() + 3e4;
    while (Date.now() < d2) {
      t2 = await frame().evaluate(() => document.getElementById("react_root").innerText).catch(() => "");
      if (/⊢ p\s*$/m.test(t2) && !t2.includes("\u22A2 q \u2227 p")) break;
      await sleep(300);
    }
    check("after moving the cursor the goal is `\u22A2 p`", /⊢ p\s*$/m.test(t2) && !t2.includes("\u22A2 q \u2227 p"), t2.replace(/\n/g, " | ").slice(0, 120));
    const bg = () => frame().evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("theme applied (background = Obsidian --background-primary)", await bg() === "rgb(30, 30, 46)", await bg());
    await pg.evaluate(() => {
      document.body.classList.replace("theme-dark", "theme-light");
      document.body.style.setProperty("--background-primary", "#fafafa");
      document.body.style.setProperty("--text-normal", "#202020");
      window.__t.host.refreshTheme();
    });
    await sleep(300);
    check("refreshTheme() updates the iframe", await bg() === "rgb(250, 250, 250)", await bg());
    const failed = await pg.evaluate(() => window.__t.state.failed);
    check("onFailed was not called", failed === void 0, String(failed));
    await pg.evaluate(() => window.__t.host.dispose());
    check("dispose() removes the iframe", await pg.evaluate(() => document.querySelectorAll("iframe").length) === 0);
  } catch (e) {
    check("e2e run", false, String(e?.stack ?? e));
  } finally {
    await browser.close().catch(() => {
    });
    await server.stop().catch(() => {
    });
    if (!o.keep) fs2.rmSync(proj, { recursive: true, force: true });
  }
  const bad = results.filter((r) => !r[1]).length;
  console.log(bad === 0 ? "\nE2E PASSED" : `
E2E FAILED (${bad})`);
  return bad === 0 ? 0 : 1;
}
export {
  main
};
