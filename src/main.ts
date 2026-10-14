import { EventRef, FileSystemAdapter, Notice, Plugin, TFile, TFolder, WorkspaceLeaf, addIcon, normalizePath } from "obsidian";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_SETTINGS, type ElanInfo, type LeanPaneSettings, type ProjectDescriptor, type Position } from "./types";
import { discoverElan, buildEnv, makeServerSpec, toolchainDownloadHint } from "./core/elan";
import { nodeFs } from "./core/nodeio";
import { ProjectRegistry, describeProject, findProjectRoot } from "./core/projects";
import { LeanServer } from "./core/server";
import { LeanNotFoundError, LeanSession } from "./core/session";
import { StatusEngine } from "./core/statusEngine";
import { runListQuery, runStatusQuery } from "./core/statusQuery";
import { UnicodeEngine } from "./core/unicode";
import { runStreaming } from "./core/runner";
import { killAllQueries } from "./core/execTree";
import { resolveVaultFolder } from "./core/paths";
import { killServerProcesses } from "./core/shutdown";
import { createLeanProject, ProjectCreateError } from "./core/projectCreate";
import { defaultBlueprintEnv, defaultBlueprintLabel, symbolKindLabel, uriToPath } from "./core/lsp";
import { MATHLIB_CACHE_ARGS, newLeanFileContent, uniqueFileName } from "./core/templates";
import {
  LEANPANE_READY_EVENT,
  LEANPANE_UNLOAD_EVENT,
  TEXPANE_READY_EVENT,
  TEXPANE_UNLOAD_EVENT,
  getTeXPaneApi,
  type BlueprintRef,
  type LeanPaneApiV1,
  type TeXPaneApiV1,
} from "./integration/api-types";
import { createLeanPaneApi } from "./integration/provider";
import { LeanPaneSettingTab } from "./settings";
import { LeanWorkspaceView, VIEW_TYPE } from "./view/LeanWorkspaceView";
import { EXTERNAL_VIEW_TYPE, LeanExternalView } from "./view/LeanExternalView";
import { OUTLINE_TYPE, OutlineView } from "./view/OutlineView";
import type { LeanWorkbench } from "./view/LeanWorkbench";
import { AddToBlueprintModal } from "./view/AddToBlueprintModal";
import { findLeaf } from "./view/leafLookup";
import { NewProjectModal } from "./view/NewProjectModal";
import { ProgressModal, TrustModal } from "./view/modals";

/** A lambda, drawn in Obsidian's 100x100 icon box. */
const LAMBDA_ICON = `<path d="M28 12 L76 88 M52 50 L24 88" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;

type LeanView = LeanWorkspaceView | LeanExternalView;

export default class LeanPanePlugin extends Plugin {
  settings: LeanPaneSettings = { ...DEFAULT_SETTINGS };
  private apiImpl: LeanPaneApiV1 | null = null;
  private apiAvailable = false;
  /**
   * The cross-plugin API (SPEC section 6); other plugins read `app.plugins.plugins.leanpane.api`. Reads as undefined
   * once unloading has started, so a consumer reacting to `leanpane:api-unload` does not find a dying API.
   */
  get api(): LeanPaneApiV1 | undefined {
    return this.apiAvailable && this.apiImpl ? this.apiImpl : undefined;
  }
  statusEngine!: StatusEngine;
  registry!: ProjectRegistry;

  private elan: ElanInfo | null = null;
  private elanPromise: Promise<ElanInfo> | null = null;
  private readonly workbenches = new Set<LeanWorkbench>();
  private lastView: LeanView | null = null;
  private statusEl: HTMLElement | null = null;
  private changeListeners = new Set<() => void>();
  private unicodeCache: { key: string; engine: UnicodeEngine } | null = null;
  private refsCache = new Map<string, Promise<BlueprintRef[]>>();
  private tpUnsubscribe: (() => void) | null = null;
  private unloading = false;
  /** TeXPane announced `texpane:api-unload`: its API counts as gone until it announces itself again. */
  private texpaneGone = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    addIcon("leanpane-lambda", LAMBDA_ICON);

    this.statusEngine = new StatusEngine({
      isTrusted: (root) => this.isTrusted(root),
      runStatus: async (root, names) => {
        const info = await this.ensureElan();
        if (!this.isTrusted(root)) return {};
        return runStatusQuery({ projectRoot: root, lakePath: info.lakePath ?? "lake", env: buildEnv(info, process.env), names });
      },
      runList: async (root, prefix) => {
        const info = await this.ensureElan();
        if (!this.isTrusted(root)) return [];
        return runListQuery({ projectRoot: root, lakePath: info.lakePath ?? "lake", env: buildEnv(info, process.env), prefix });
      },
    });

    this.registry = new ProjectRegistry({
      factory: (spec) => {
        const server = new LeanServer(spec, { rootPath: spec.cwd, initTimeoutMs: 15 * 60 * 1000, log: (m) => this.log(m) });
        server.onRequest("workspace/applyEdit", (p: { edit?: unknown }) => ({ applied: this.applyEditEverywhere(p?.edit) }));
        server.onRequest("window/showDocument", async (p: { uri: string; selection?: { start: Position } }) => {
          await this.openLeanUri(p.uri, p.selection?.start, { newLeaf: true });
          return { success: true };
        });
        return server;
      },
      makeSpec: (project, dir) => makeServerSpec(this.elan ?? { binDir: null, lakePath: null, leanPath: null, elanPath: null, toolchains: [] }, project, dir, process.env),
      findProject: (dir) => this.findProjectDescriptor(dir),
      ensureTrusted: (p) => this.ensureTrusted(p),
      ensureTrustedLoose: (dir) => this.ensureTrustedLoose(dir),
      idleMinutes: () => this.settings.idleShutdownMinutes,
      log: (m) => this.log(m),
    });

    this.apiImpl = createLeanPaneApi({
      vaultBase: () => this.basePath(),
      findProject: (dir) => this.findProjectDescriptor(dir),
      isDirectory: async (abs) => {
        try {
          return (await fsp.stat(abs)).isDirectory();
        } catch {
          return false;
        }
      },
      engine: this.statusEngine,
      openLocation: (abs, line, o) => this.openLeanFile(abs, { line, newLeaf: o.newLeaf, context: o.projectRoot }),
      readFile: (abs) => this.readLeanText(abs),
      writeFile: (abs, text) => this.writeLeanText(abs, text),
    });
    this.apiAvailable = true;

    this.registerView(VIEW_TYPE, (leaf) => new LeanWorkspaceView(leaf, this));
    this.registerView(EXTERNAL_VIEW_TYPE, (leaf) => new LeanExternalView(leaf, this));
    this.registerView(OUTLINE_TYPE, (leaf) => new OutlineView(leaf, this));
    try {
      this.registerExtensions(["lean"], VIEW_TYPE);
    } catch (e) {
      this.log(`could not register .lean: ${String(e)}`);
      new Notice("LeanPane: the .lean extension is already handled by another plugin and was left alone.");
    }
    this.addSettingTab(new LeanPaneSettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("lp-status");
    this.registerDomEvent(this.statusEl, "click", () => this.activeWorkbench()?.toggleMessages());
    this.statusEl.hide();

    this.addCommands();
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addItem((i) => i.setTitle("New Lean file").setIcon("file-plus").onClick(() => void this.newLeanFile(file)));
        menu.addItem((i) => i.setTitle("New Lean project").setIcon("folder-plus").onClick(() => this.newLeanProject(file)));
      }),
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatusBar()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.updateStatusBar()));
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (!(f instanceof TFile) || f.extension !== "lean") return;
        const views = this.leanWorkspaceViews().filter((v) => v.file === f);
        if (views.length === 0) return;
        void this.app.vault.read(f).then((disk) => {
          for (const v of views) v.reloadIfClean(f, disk);
        });
      }),
    );
    // Obsidian does not call onunload when the app quits: make sure no Lean process outlives it.
    this.registerDomEvent(window, "beforeunload", () => this.killAllServers());

    this.app.workspace.onLayoutReady(() => {
      void this.ensureElan();
      this.hookTeXPane();
      // deferred: `app.plugins.plugins.leanpane` is only set once onload has returned
      window.setTimeout(() => {
        if (!this.unloading) (this.app.workspace as unknown as { trigger(name: string): void }).trigger(LEANPANE_READY_EVENT);
      }, 0);
    });
  }

  onunload(): void {
    this.unloading = true;
    this.apiAvailable = false; // `plugin.api` reads as unavailable BEFORE listeners hear about the unload
    (this.app.workspace as unknown as { trigger(name: string): void }).trigger(LEANPANE_UNLOAD_EVENT);
    TrustModal.closeAll();
    killAllQueries();
    this.tpUnsubscribe?.();
    this.tpUnsubscribe = null;
    this.killAllServers();
    void this.registry?.dispose();
    this.statusEngine?.dispose();
    this.changeListeners.clear();
  }

  log(message: string): void {
    console.debug(`[LeanPane] ${message}`);
  }

  // ------------------------------------------------------------------ settings
  async loadSettings(): Promise<void> {
    const d = (await this.loadData()) ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...d, trustedProjects: Array.isArray(d.trustedProjects) ? d.trustedProjects : [] };
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
  refreshViews(): void {
    for (const wb of this.workbenches) wb.applySettings();
    this.notifyChanged();
  }

  // ------------------------------------------------------------------ environment
  basePath(): string {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : "";
  }
  private vaultRel(abs: string): string | null {
    const rel = path.relative(this.basePath(), abs);
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel.split(path.sep).join("/");
  }

  elanInfo(): ElanInfo | null {
    return this.elan;
  }
  /** Detected elan / lake / lean; waits for (or starts) the first detection. Never rejects. */
  ensureElan(): Promise<ElanInfo> {
    if (this.elan) return Promise.resolve(this.elan);
    return this.elanPromise ?? this.recheckElan();
  }
  recheckElan(): Promise<ElanInfo> {
    const p = discoverElan({ settingsDir: this.settings.elanBinDir || null }).then(
      (info) => {
        this.elan = info;
        return info;
      },
      () => {
        const none: ElanInfo = { binDir: null, lakePath: null, leanPath: null, elanPath: null, toolchains: [] };
        this.elan = none;
        return none;
      },
    );
    this.elanPromise = p;
    return p;
  }

  unicode(): UnicodeEngine {
    const key = `${this.settings.unicodeLeader}|${this.settings.unicodeEager}`;
    if (!this.unicodeCache || this.unicodeCache.key !== key) {
      this.unicodeCache = { key, engine: new UnicodeEngine({ leader: this.settings.unicodeLeader || "\\", eager: this.settings.unicodeEager }) };
    }
    return this.unicodeCache.engine;
  }

  async findProjectDescriptor(dirAbs: string): Promise<ProjectDescriptor | null> {
    const found = await findProjectRoot(dirAbs, nodeFs);
    return found ? describeProject(found.root, found.lakefile, nodeFs) : null;
  }

  // ------------------------------------------------------------------ trust
  /** Trusted entries are project roots, or `loose:<folder>` for Lean files outside any project. */
  isTrusted(key: string): boolean {
    return this.settings.trustedProjects.includes(key);
  }

  private async trustDecision(key: string, ask: () => Promise<boolean>): Promise<boolean> {
    if (this.isTrusted(key)) return true;
    if (this.unloading) return false;
    const ok = await ask();
    if (ok && !this.unloading) {
      if (!this.isTrusted(key)) this.settings.trustedProjects.push(key);
      await this.saveSettings();
      this.onTrustGranted(key);
    }
    return ok;
  }

  private ensureTrusted(p: ProjectDescriptor): Promise<boolean> {
    return this.trustDecision(p.root, () => TrustModal.ask(this.app, p.root, p.toolchain));
  }

  /** `lean --server` for a file outside any project can run #eval: trust is per containing folder. */
  private ensureTrustedLoose(dir: string): Promise<boolean> {
    return this.trustDecision("loose:" + dir, () => TrustModal.ask(this.app, dir, null, true));
  }

  /** Statuses become available and views that were refused start Lean. */
  private onTrustGranted(key: string): void {
    if (!key.startsWith("loose:")) this.statusEngine?.invalidate(key);
    for (const wb of this.workbenches) wb.retryIfUntrusted();
  }

  /** Command "Trust this Lean project": ask about the project (or folder) of the active Lean file. */
  async trustActiveProject(wb: LeanWorkbench | null = this.activeWorkbench()): Promise<void> {
    const file = wb?.currentFile();
    if (!file) {
      new Notice("LeanPane: open a Lean file first.");
      return;
    }
    const dir = path.dirname(file);
    const project = await this.findProjectDescriptor(dir);
    const key = project ? project.root : "loose:" + dir;
    if (this.isTrusted(key)) {
      new Notice(`LeanPane: ${project ? "this project" : "this folder"} is already trusted.`);
      return;
    }
    if (project ? await this.ensureTrusted(project) : await this.ensureTrustedLoose(dir)) new Notice("LeanPane: trusted. Lean is starting.");
  }

  /** A session for one open file. The workbench opens it; see LeanSession. */
  createSession(filePath: string, onSent: (method: string, params: unknown) => void): LeanSession {
    return new LeanSession(
      {
        acquire: async (file, context, hooks) => {
          const info = await this.ensureElan();
          const project = await this.findProjectDescriptor(path.dirname(context));
          if (project ? !info.lakePath : !info.leanPath) throw new LeanNotFoundError();
          const hint = toolchainDownloadHint(project?.toolchain ?? info.defaultToolchain ?? null, info.toolchains);
          if (hint) hooks.preparing(hint);
          void file;
          return this.registry.acquire(context);
        },
        debounceMs: () => this.settings.debounceMs,
        onSent,
        log: (m) => this.log(m),
      },
      filePath,
    );
  }

  killAllServers(): void {
    killAllQueries();
    if (!this.registry) return;
    killServerProcesses(this.registry.entries().map((e) => e.server));
  }

  // ------------------------------------------------------------------ views
  leanWorkspaceViews(): LeanWorkspaceView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((v): v is LeanWorkspaceView => v instanceof LeanWorkspaceView);
  }
  leanExternalViews(): LeanExternalView[] {
    return this.app.workspace.getLeavesOfType(EXTERNAL_VIEW_TYPE).map((l) => l.view).filter((v): v is LeanExternalView => v instanceof LeanExternalView);
  }
  private activeLeanView(): LeanView | null {
    const ws = this.app.workspace;
    const v = ws.getActiveViewOfType(LeanWorkspaceView) ?? ws.getActiveViewOfType(LeanExternalView);
    if (v) {
      this.lastView = v;
      return v;
    }
    // keep showing the last one while a sidebar (e.g. the outline) is focused
    const alive = this.lastView && [...this.leanWorkspaceViews(), ...this.leanExternalViews()].includes(this.lastView);
    return alive ? this.lastView : null;
  }
  activeWorkbench(): LeanWorkbench | null {
    return this.activeLeanView()?.getWorkbench() ?? null;
  }

  registerWorkbench(wb: LeanWorkbench): void {
    this.workbenches.add(wb);
  }
  unregisterWorkbench(wb: LeanWorkbench): void {
    this.workbenches.delete(wb);
    if (!this.unloading) this.notifyChanged();
  }
  workbenchForPath(abs: string): LeanWorkbench | null {
    for (const wb of this.workbenches) if (wb.currentFile() === abs) return wb;
    return null;
  }

  onWorkbenchChanged(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }
  workbenchChanged(_wb: LeanWorkbench | null): void {
    this.notifyChanged();
  }
  private notifyChanged(): void {
    this.updateStatusBar();
    for (const l of [...this.changeListeners]) {
      try {
        l();
      } catch (e) {
        this.log(`listener failed: ${String(e)}`);
      }
    }
  }

  // ------------------------------------------------------------------ status bar
  updateStatusBar(): void {
    const el = this.statusEl;
    if (!el) return;
    const wb = this.activeWorkbench();
    const st = wb?.status();
    if (!wb || !st || st.kind === "none") {
      el.hide();
      return;
    }
    el.show();
    el.setText(`Lean: ${st.text}`);
    el.setAttr("aria-label", "Click to toggle the Lean messages");
    el.dataset.state = st.kind;
  }

  // ------------------------------------------------------------------ opening files
  /** Open a Lean source. Vault files open in the normal editable view, others in a read-only view. */
  async openLeanFile(abs: string, o: { line?: number; column?: number; newLeaf?: boolean; context?: string; split?: boolean } = {}): Promise<boolean> {
    const ws = this.app.workspace;
    const rel = this.vaultRel(abs);
    const file = rel !== null ? this.app.vault.getAbstractFileByPath(rel) : null;
    try {
      if (file instanceof TFile) {
        const existing = await findLeaf(
          ws.getLeavesOfType(VIEW_TYPE),
          (v): v is LeanWorkspaceView => v instanceof LeanWorkspaceView,
          (v) => v.file === file,
          (st) => st.file === file.path,
        );
        if (existing) {
          void ws.revealLeaf(existing.leaf);
          if (o.line) existing.view.revealLine(o.line, o.column);
          return true;
        }
        const leaf = o.split ? ws.getLeaf("split") : o.newLeaf === false ? ws.getLeaf(false) : ws.getLeaf("tab");
        await leaf.openFile(file, o.line ? { eState: { line: o.line - 1, column: o.column ? o.column - 1 : undefined } } : undefined);
        return true;
      }
      const existingExt = await findLeaf(
        ws.getLeavesOfType(EXTERNAL_VIEW_TYPE),
        (v): v is LeanExternalView => v instanceof LeanExternalView,
        (v) => v.filePath() === abs,
        (st) => st.path === abs,
      );
      if (existingExt) {
        void ws.revealLeaf(existingExt.leaf);
        if (o.line) existingExt.view.revealLine(o.line, o.column);
        return true;
      }
      try {
        await fsp.access(abs);
      } catch {
        new Notice(`LeanPane: ${abs} does not exist.`);
        return false;
      }
      const leaf: WorkspaceLeaf = o.split ? ws.getLeaf("split") : ws.getLeaf("tab");
      await leaf.setViewState({ type: EXTERNAL_VIEW_TYPE, active: true, state: { path: abs, context: o.context, line: o.line, column: o.column } });
      return true;
    } catch (e) {
      new Notice(`LeanPane: could not open ${abs}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async openLeanUri(uri: string, pos: Position | undefined, o: { newLeaf?: boolean; context?: string; split?: boolean } = {}): Promise<boolean> {
    const abs = uriToPath(uri);
    if (!abs) {
      new Notice(`LeanPane: cannot open ${uri}`);
      return false;
    }
    return this.openLeanFile(abs, { ...o, line: pos ? pos.line + 1 : undefined, column: pos ? pos.character + 1 : undefined });
  }

  private applyEditEverywhere(edit: unknown): boolean {
    let applied = false;
    for (const wb of this.workbenches) applied = wb.applyWorkspaceEdit(edit) || applied;
    return applied;
  }

  // ------------------------------------------------------------------ file access for the API
  async readLeanText(abs: string): Promise<string | null> {
    const wb = this.workbenchForPath(abs);
    if (wb) return wb.getText();
    try {
      return await fsp.readFile(abs, "utf8");
    } catch {
      return null;
    }
  }

  async writeLeanText(abs: string, text: string): Promise<void> {
    const wb = this.workbenchForPath(abs);
    if (wb) {
      const ed = wb.getEditor();
      if (ed.state.readOnly) throw new Error(`${abs} is open read-only in LeanPane and cannot be edited.`);
      const old = ed.state.doc.toString();
      if (text.startsWith(old)) ed.dispatch({ changes: { from: old.length, insert: text.slice(old.length) }, userEvent: "input" });
      else ed.dispatch({ changes: { from: 0, to: old.length, insert: text }, userEvent: "input" });
      return;
    }
    const rel = this.vaultRel(abs);
    const existing = rel !== null ? this.app.vault.getAbstractFileByPath(rel) : null;
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, text);
    } else if (rel !== null) {
      await this.ensureFolder(path.posix.dirname(rel));
      await this.app.vault.create(rel, text);
    } else {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, text, "utf8");
    }
  }

  async ensureFolder(dir: string): Promise<void> {
    if (dir === "" || dir === "." || dir === "/") return;
    let cur = "";
    for (const seg of dir.split("/").filter(Boolean)) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!this.app.vault.getAbstractFileByPath(cur)) await this.app.vault.createFolder(cur);
    }
  }

  // ------------------------------------------------------------------ TeXPane integration (feature-detected every time)
  texpaneApi(): TeXPaneApiV1 | null {
    return this.texpaneGone ? null : getTeXPaneApi(this.app);
  }

  /** Blueprint places that mention a Lean declaration; [] without TeXPane. Cached until the blueprint changes. */
  blueprintRefs(name: string): Promise<BlueprintRef[]> {
    const api = this.texpaneApi();
    if (!api) return Promise.resolve([]);
    let p = this.refsCache.get(name);
    if (!p) {
      p = api.blueprintRefs(name).catch(() => []);
      this.refsCache.set(name, p);
    }
    return p;
  }

  private hookTeXPane(): void {
    const ws = this.app.workspace as unknown as { on(name: string, cb: () => void): EventRef };
    const resubscribe = (): void => {
      this.texpaneGone = false;
      this.tpUnsubscribe?.();
      this.tpUnsubscribe = null;
      this.refsCache.clear();
      const api = this.texpaneApi();
      if (api) {
        try {
          this.tpUnsubscribe = api.onBlueprintChanged(() => this.onBlueprintChanged());
        } catch (e) {
          this.log(`TeXPane subscription failed: ${String(e)}`);
        }
      }
      this.onBlueprintChanged();
    };
    this.registerEvent(ws.on(TEXPANE_READY_EVENT, resubscribe));
    this.registerEvent(
      ws.on(TEXPANE_UNLOAD_EVENT, () => {
        this.texpaneGone = true; // its API is gone immediately, whatever `app.plugins` still says
        this.tpUnsubscribe = null; // the plugin is gone; its unsubscribe function is not needed
        this.refsCache.clear();
        this.onBlueprintChanged();
      }),
    );
    resubscribe();
  }

  private onBlueprintChanged(): void {
    this.refsCache.clear();
    for (const wb of this.workbenches) wb.refreshBlueprintLink();
    for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_TYPE)) if (leaf.view instanceof OutlineView) leaf.view.refresh();
  }

  async addToBlueprint(wb: LeanWorkbench): Promise<void> {
    const api = this.texpaneApi();
    if (!api) {
      new Notice("LeanPane: install and enable TeXPane to use the blueprint.");
      return;
    }
    const decl = wb.declAtCursor();
    const project = wb.getSession()?.project;
    if (!decl || !project) {
      new Notice("LeanPane: put the cursor inside a declaration of a Lean project.");
      return;
    }
    const projRel = this.vaultRel(project.root);
    if (projRel === null) {
      new Notice("LeanPane: this project is outside the vault.");
      return;
    }
    const prefix = projRel === "" ? "" : projRel + "/";
    const tex = this.app.vault
      .getFiles()
      .filter((f) => f.extension === "tex" && f.path.startsWith(prefix) && !f.path.includes("/.") )
      .map((f) => f.path)
      .sort((a, b) => Number(b.endsWith("blueprint/src/content.tex")) - Number(a.endsWith("blueprint/src/content.tex")) || a.localeCompare(b));
    if (tex.length === 0) {
      new Notice("LeanPane: this project has no .tex files yet. Create blueprint/src/content.tex first.");
      return;
    }
    const kind = symbolKindLabel(decl.symbolKind);
    const text = wb.getText().split("\n");
    const startLine = text.slice(decl.range.start.line).join("\n");
    const doc = /^\/--([\s\S]*?)-\//.exec(startLine.slice(decl.range.start.character));
    const statement = doc ? doc[1].trim() : `TODO: state \\texttt{${decl.name.replace(/_/g, "\\_")}} in LaTeX.`;
    new AddToBlueprintModal(
      this.app,
      { texFile: tex[0], env: defaultBlueprintEnv(kind), label: defaultBlueprintLabel(decl.name, kind), leanName: decl.name, statement },
      tex,
      async (req) => {
        try {
          const r = await api.addBlueprintEntry(req);
          new Notice(`LeanPane: added ${req.label} to ${r.file}.`);
          await api.openLocation(r.file, r.line);
        } catch (e) {
          new Notice(`LeanPane: could not add to the blueprint: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    ).open();
  }

  // ------------------------------------------------------------------ commands
  private addCommands(): void {
    const withWb = (fn: (wb: LeanWorkbench) => void) => (checking: boolean): boolean => {
      const wb = this.activeWorkbench();
      if (!wb || !this.activeLeanView() || this.app.workspace.getActiveViewOfType(OutlineView)) return false;
      if (!checking) fn(wb);
      return true;
    };
    this.addCommand({ id: "restart-file", name: "Restart file", icon: "refresh-cw", checkCallback: withWb((wb) => wb.restartFile()) });
    this.addCommand({ id: "restart-server", name: "Restart Lean server", icon: "power", checkCallback: withWb((wb) => void wb.restartServer()) });
    this.addCommand({
      id: "build-project",
      name: "Build project",
      icon: "hammer",
      checkCallback: withWb((wb) => {
        const root = wb.projectRoot();
        if (root) void this.buildProject(root);
        else new Notice("LeanPane: this file is not in a Lean project.");
      }),
    });
    this.addCommand({
      id: "fetch-mathlib-cache",
      name: "Fetch Mathlib cache",
      icon: "download",
      checkCallback: (checking) => {
        const wb = this.activeWorkbench();
        const project = wb?.getSession()?.project;
        if (!wb || !project?.usesMathlib || !this.activeLeanView()) return false;
        if (!checking) void this.fetchMathlibCache(project.root);
        return true;
      },
    });
    this.addCommand({
      id: "trust-project",
      name: "Trust this Lean project",
      icon: "shield-check",
      checkCallback: (checking) => {
        if (!this.activeWorkbench()?.currentFile() || !this.activeLeanView()) return false;
        if (!checking) void this.trustActiveProject();
        return true;
      },
    });
    this.addCommand({ id: "new-project", name: "New Lean project", icon: "folder-plus", callback: () => this.newLeanProject(this.defaultFolder()) });
    this.addCommand({ id: "new-file", name: "New Lean file", icon: "file-plus", callback: () => void this.newLeanFile(this.defaultFolder()) });
    this.addCommand({
      id: "toggle-goals",
      name: "Toggle goals pane",
      icon: "target",
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "g" }],
      checkCallback: withWb((wb) => wb.toggleGoals()),
    });
    this.addCommand({
      id: "toggle-messages",
      name: "Toggle messages",
      icon: "triangle-alert",
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "l" }],
      checkCallback: withWb((wb) => wb.toggleMessages()),
    });
    this.addCommand({ id: "cycle-layout", name: "Cycle layout (split, editor, goals)", icon: "columns-2", checkCallback: withWb((wb) => wb.cycleLayout()) });
    this.addCommand({
      id: "jump-to-blueprint",
      name: "Jump to blueprint",
      icon: "book-open",
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "b" }],
      checkCallback: (checking) => {
        const wb = this.activeWorkbench();
        if (!wb || !this.activeLeanView() || !this.texpaneApi()) return false;
        if (!checking) void wb.jumpToBlueprint();
        return true;
      },
    });
    this.addCommand({
      id: "add-to-blueprint",
      name: "Add to blueprint",
      icon: "book-plus",
      checkCallback: (checking) => {
        const wb = this.activeWorkbench();
        if (!wb || !this.activeLeanView() || !this.texpaneApi()) return false;
        if (!checking) void this.addToBlueprint(wb);
        return true;
      },
    });
    this.addCommand({
      id: "go-to-definition",
      name: "Go to definition",
      icon: "corner-down-right",
      hotkeys: [{ modifiers: [], key: "F12" }],
      checkCallback: withWb((wb) => void wb.gotoDefinition(wb.getEditor().state.selection.main.head, false)),
    });
    this.addCommand({ id: "next-message", name: "Next message", icon: "arrow-down", hotkeys: [{ modifiers: [], key: "F8" }], checkCallback: withWb((wb) => wb.nextMessage(1)) });
    this.addCommand({ id: "previous-message", name: "Previous message", icon: "arrow-up", hotkeys: [{ modifiers: ["Shift"], key: "F8" }], checkCallback: withWb((wb) => wb.nextMessage(-1)) });
    this.addCommand({ id: "open-outline", name: "Open Lean outline", icon: "list-tree", callback: () => void this.openOutline() });
    this.addCommand({
      id: "recheck-lean",
      name: "Re-check Lean installation",
      icon: "stethoscope",
      callback: async () => {
        const info = await this.recheckElan();
        new Notice(info.lakePath ? `LeanPane: ${info.lakeVersion ?? "lake"} found in ${info.binDir}` : "LeanPane: lake was not found. See Settings → LeanPane.");
      },
    });
  }

  private defaultFolder(): TFolder {
    return this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
  }

  async openOutline(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(OUTLINE_TYPE)[0];
    const leaf: WorkspaceLeaf | null = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: OUTLINE_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  // ------------------------------------------------------------------ new file / new project
  async newLeanFile(folder: TFolder): Promise<void> {
    const dir = folder.isRoot() ? "" : folder.path + "/";
    const name = uniqueFileName("Untitled", "lean", (n) => !!this.app.vault.getAbstractFileByPath(normalizePath(dir + n)));
    const f = await this.app.vault.create(normalizePath(dir + name), newLeanFileContent(name));
    await this.app.workspace.getLeaf("tab").openFile(f);
  }

  newLeanProject(folder: TFolder): void {
    new NewProjectModal(this.app, folder.isRoot() ? "" : folder.path, !!this.texpaneApi(), (req) => void this.createProject(req)).open();
  }

  private async createProject(req: { folder: string; name: string; mathlib: boolean; blueprint: boolean }): Promise<void> {
    const parentDir = resolveVaultFolder(this.basePath(), req.folder);
    if (parentDir === null || !this.basePath()) {
      new Notice("LeanPane: the location must be a folder inside the vault.", 8000);
      return;
    }
    const info = await this.ensureElan();
    if (!info.lakePath) {
      new Notice("LeanPane: lake was not found. Install Lean through elan, or set its folder in Settings → LeanPane.", 10000);
      return;
    }
    const modal = new ProgressModal(this.app, `Creating ${req.name}`);
    modal.open();
    modal.setStatus(req.mathlib ? "Creating the project and downloading the Mathlib cache…" : "Creating the project…");
    try {
      const res = await createLeanProject({
        parentDir,
        name: req.name,
        mathlib: req.mathlib,
        blueprint: req.blueprint,
        lakePath: info.lakePath,
        env: buildEnv(info, process.env),
        signal: modal.signal,
        onLog: (t) => modal.log(t),
      });
      // the user created this project themselves
      if (!this.settings.trustedProjects.includes(res.root)) {
        this.settings.trustedProjects.push(res.root);
        await this.saveSettings();
      }
      const warn = res.warnings.length ? ` ${res.warnings[0]}` : "";
      modal.finish(true, `Project created.${warn}`);
      const main = await this.waitForVaultFile(res.mainLean);
      if (main) await this.app.workspace.getLeaf("tab").openFile(main);
      if (res.contentTex && this.texpaneApi()) {
        const tex = await this.waitForVaultFile(res.contentTex);
        if (tex) await this.app.workspace.getLeaf("split", "vertical").openFile(tex);
      }
    } catch (e) {
      modal.finish(false, e instanceof ProjectCreateError ? e.message : `Could not create the project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Files written by lake/node become TFiles only when Obsidian's file watcher notices them. */
  private async waitForVaultFile(abs: string, timeoutMs = 6000): Promise<TFile | null> {
    const rel = this.vaultRel(abs);
    if (rel === null) return null;
    const t0 = Date.now();
    for (;;) {
      const f = this.app.vault.getAbstractFileByPath(rel);
      if (f instanceof TFile) return f;
      if (Date.now() - t0 > timeoutMs) return null;
      await new Promise((r) => window.setTimeout(r, 200));
    }
  }

  // ------------------------------------------------------------------ build / cache
  /** `lake build` / `lake exe cache get` run project code: only for trusted projects (asks, as the user started it). */
  private async trustedForLake(root: string): Promise<boolean> {
    if (this.isTrusted(root)) return true;
    const project = await this.findProjectDescriptor(root);
    if (!project) return false;
    return this.ensureTrusted(project);
  }

  async buildProject(root: string): Promise<void> {
    if (!(await this.trustedForLake(root))) {
      new Notice("LeanPane: the project is not trusted, so it was not built.");
      return;
    }
    const ok = await this.runLake(`Build ${path.basename(root)}`, ["build"], root);
    if (!ok) return;
    await this.statusEngine.refreshAfterBuild(root);
    for (const wb of this.workbenches) if (wb.getSession()?.project?.root === root && !wb.getEditor().state.readOnly) wb.restartFile();
  }

  async fetchMathlibCache(root: string): Promise<void> {
    if (!(await this.trustedForLake(root))) {
      new Notice("LeanPane: the project is not trusted, so the cache was not fetched.");
      return;
    }
    const ok = await this.runLake("Fetch Mathlib cache", MATHLIB_CACHE_ARGS, root);
    if (ok) this.statusEngine.invalidate(root);
  }

  private async runLake(title: string, args: string[], cwd: string): Promise<boolean> {
    const info = await this.ensureElan();
    if (!info.lakePath) {
      new Notice("LeanPane: lake was not found. See Settings → LeanPane.", 8000);
      return false;
    }
    const modal = new ProgressModal(this.app, title);
    modal.open();
    modal.setStatus(`lake ${args.join(" ")}`);
    modal.log(`$ lake ${args.join(" ")}\n`);
    try {
      const res = await runStreaming(info.lakePath, args, { cwd, env: buildEnv(info, process.env), signal: modal.signal, onOutput: (t) => modal.log(t) });
      if (res.cancelled) {
        modal.finish(false, "Cancelled.");
        return false;
      }
      modal.finish(res.code === 0, res.code === 0 ? "Done." : `lake exited with code ${res.code ?? "none"}. See the output above.`);
      return res.code === 0;
    } catch (e) {
      modal.finish(false, `Could not run lake: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
}
