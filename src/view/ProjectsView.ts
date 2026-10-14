import { App, ItemView, Menu, Modal, Notice, TAbstractFile, TFile, TFolder, WorkspaceLeaf, setIcon } from "obsidian";
import * as path from "node:path";
import type LeanPanePlugin from "../main";
import { buildLeanIndex, type LeanVaultProject } from "../core/leanIndex";

export const PROJECTS_TYPE = "leanpane-projects";

/**
 * Sidebar panel: every Lean project in the vault (folders with a lakefile) and loose .lean files, with a New menu.
 * Note: private helpers must not reuse names of Obsidian View internals (open, close, load, ...); they replace them.
 */
export class ProjectsView extends ItemView {
  private expanded = new Set<string>();
  private filter = "";
  private listEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LeanPanePlugin) {
    super(leaf);
  }
  getViewType(): string {
    return PROJECTS_TYPE;
  }
  getDisplayText(): string {
    return "Lean projects";
  }
  getIcon(): string {
    return "leanpane-lambda";
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), expanded: [...this.expanded] };
  }
  async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    const ex = (state as { expanded?: unknown } | null)?.expanded;
    if (Array.isArray(ex)) this.expanded = new Set(ex.filter((x): x is string => typeof x === "string"));
    await super.setState(state, result);
    if (this.listEl) this.lpRedraw();
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("lp-projects");

    const bar = root.createDiv({ cls: "lp-projects-toolbar" });
    const newBtn = bar.createEl("button", { cls: "lp-projects-new mod-cta", attr: { "aria-label": "New Lean project, file or folder" } });
    setIcon(newBtn.createSpan({ cls: "lp-projects-new-icon" }), "plus");
    newBtn.createSpan({ text: "New" });
    setIcon(newBtn.createSpan({ cls: "lp-projects-new-caret" }), "chevron-down");
    newBtn.addEventListener("click", (e) => this.lpNewMenu(e));
    bar.createDiv({ cls: "lp-projects-spacer" });
    this.lpIconButton(bar, "chevrons-down-up", "Collapse all", () => {
      this.expanded.clear();
      this.lpStateChanged();
    });
    this.lpIconButton(bar, "refresh-cw", "Refresh", () => this.lpRedraw());

    const row = root.createDiv({ cls: "search-row lp-projects-search" });
    const box = row.createDiv({ cls: "search-input-container" });
    const input = box.createEl("input", { attr: { type: "search", placeholder: "Filter…", spellcheck: "false", "aria-label": "Filter Lean projects" } });
    input.addEventListener("input", () => {
      this.filter = input.value;
      this.lpRedraw();
    });

    this.listEl = root.createDiv({ cls: "lp-projects-list" });
    this.footerEl = root.createDiv({ cls: "lp-projects-footer" });

    const again = () => this.lpSchedule();
    this.registerEvent(this.app.vault.on("create", again));
    this.registerEvent(this.app.vault.on("delete", again));
    this.registerEvent(this.app.vault.on("rename", again));
    this.registerEvent(this.app.workspace.on("file-open", again));
    this.register(this.plugin.onWorkbenchChanged(again)); // trust changes arrive as workbench updates
    this.lpRedraw();
  }

  async onClose(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private lpIconButton(parent: HTMLElement, icon: string, label: string, cb: () => void): void {
    const b = parent.createDiv({ cls: "clickable-icon", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", cb);
  }

  private lpSchedule(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.lpRedraw(), 150);
  }
  private lpStateChanged(): void {
    this.app.workspace.requestSaveLayout();
    this.lpRedraw();
  }
  private lpToggle(key: string): void {
    if (this.expanded.has(key)) this.expanded.delete(key);
    else this.expanded.add(key);
    this.lpStateChanged();
  }

  // ------------------------------------------------------------------ drawing
  private lpRedraw(): void {
    if (!this.listEl) return;
    const q = this.filter.trim().toLowerCase();
    const idx = buildLeanIndex(this.app.vault.getFiles().map((f) => f.path));
    const active = this.app.workspace.getActiveFile()?.path ?? null;
    const projects = idx.projects.filter((p) => !q || p.name.toLowerCase().includes(q));
    const loose = idx.loose.filter((f) => !q || f.toLowerCase().includes(q));

    const scroll = this.listEl.scrollTop;
    this.listEl.empty();
    if (idx.projects.length === 0 && idx.loose.length === 0) this.lpEmpty();
    else {
      if (projects.length > 0) {
        const sec = this.listEl.createDiv({ cls: "lp-projects-section" });
        sec.createDiv({ cls: "lp-projects-section-head", text: "Projects" });
        for (const p of projects) this.lpProjectRow(sec, p, active);
      }
      if (loose.length > 0) {
        const sec = this.listEl.createDiv({ cls: "lp-projects-section" });
        sec.createDiv({ cls: "lp-projects-section-head", text: "Loose files" });
        for (const f of loose) this.lpFileRow(sec, f, f, active);
      }
      if (projects.length === 0 && loose.length === 0) this.listEl.createDiv({ cls: "lp-projects-note", text: "Nothing matches the filter." });
    }
    this.listEl.scrollTop = scroll;
    const nFiles = idx.projects.reduce((n, p) => n + p.files.length, 0) + idx.loose.length;
    this.footerEl.setText(`${idx.projects.length} project${idx.projects.length === 1 ? "" : "s"} · ${nFiles} Lean file${nFiles === 1 ? "" : "s"}`);
  }

  private lpEmpty(): void {
    const box = this.listEl.createDiv({ cls: "lp-projects-empty" });
    box.createDiv({ text: "No Lean projects in this vault yet." });
    const btns = box.createDiv({ cls: "lp-projects-empty-buttons" });
    const add = (icon: string, label: string, cb: () => void, cta = false) => {
      const b = btns.createEl("button", { cls: cta ? "mod-cta" : "" });
      setIcon(b.createSpan({ cls: "lp-btn-icon" }), icon);
      b.createSpan({ text: label });
      b.addEventListener("click", cb);
    };
    add("folder-plus", "New Lean project", () => void this.lpNewProject(), true);
    add("file-plus", "New Lean file", () => void this.lpNewFile());
  }

  private lpProjectRow(parent: HTMLElement, p: LeanVaultProject, active: string | null): void {
    const key = `p:${p.root}`;
    const open = this.expanded.has(key);
    const abs = this.lpAbs(p.root);
    const trusted = this.plugin.isTrusted(abs);
    const item = parent.createDiv({ cls: "tree-item lp-node lp-project" });
    const self = item.createDiv({ cls: "tree-item-self is-clickable mod-collapsible lp-row" });
    if (active && p.files.includes(active)) self.addClass("is-active");
    const chev = self.createDiv({ cls: "tree-item-icon collapse-icon" });
    chev.toggleClass("is-collapsed", !open);
    setIcon(chev, "right-triangle");
    chev.addEventListener("click", (e) => {
      e.stopPropagation();
      this.lpToggle(key);
    });
    setIcon(self.createDiv({ cls: "lp-row-icon" }), "folder-code");
    self.createDiv({ cls: "tree-item-inner", text: p.name, attr: { title: p.root || "(vault root)" } });
    if (!trusted) {
      const lock = self.createSpan({ cls: "lp-badge", text: "not trusted", attr: { "aria-label": "Lean has not been allowed to run in this project yet. Right-click to trust it." } });
      lock.addClass("is-untrusted");
    }
    self.addEventListener("click", () => this.lpToggle(key));
    self.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      void this.lpProjectMenu(p, e);
    });
    if (!open) return;
    const kids = item.createDiv({ cls: "tree-item-children" });
    if (p.files.length === 0) kids.createDiv({ cls: "lp-projects-note", text: "No .lean files yet" });
    for (const f of p.files) this.lpFileRow(kids, f, p.root ? f.slice(p.root.length + 1) : f, active);
  }

  private lpFileRow(parent: HTMLElement, filePath: string, label: string, active: string | null): void {
    const item = parent.createDiv({ cls: "tree-item lp-node" });
    const self = item.createDiv({ cls: "tree-item-self is-clickable lp-row lp-file" });
    if (filePath === active) self.addClass("is-active");
    self.createDiv({ cls: "lp-chevron-space" });
    setIcon(self.createDiv({ cls: "lp-row-icon" }), filePath.endsWith(".lean") ? "file-code" : "file-cog");
    self.createDiv({ cls: "tree-item-inner", text: label, attr: { title: filePath } });
    self.addEventListener("click", (e) => void this.lpOpenFile(filePath, e.ctrlKey || e.metaKey));
    self.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const m = new Menu();
      m.addItem((i) => i.setTitle("Open").setIcon("file-code").onClick(() => void this.lpOpenFile(filePath, false)));
      m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => void this.lpOpenFile(filePath, true)));
      m.addItem((i) => i.setTitle("Reveal in file explorer").setIcon("folder-search").onClick(() => this.lpReveal(filePath)));
      m.addSeparator();
      m.addItem((i) => i.setTitle("Delete file…").setIcon("trash-2").setWarning(true).onClick(() => this.lpConfirmDelete(filePath, `"${filePath}"`)));
      m.showAtMouseEvent(e);
    });
  }

  // ------------------------------------------------------------------ actions
  private lpAbs(rel: string): string {
    const base = this.plugin.basePath();
    return rel ? path.join(base, rel) : base;
  }

  private async lpOpenFile(filePath: string, newTab: boolean): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (!(f instanceof TFile)) return;
    await this.plugin.openLeanFile(this.lpAbs(filePath), { newLeaf: newTab ? true : false });
  }

  /** Home folder for new things (setting, default "Lean"), created on demand. */
  private async lpHome(): Promise<TFolder> {
    const rel = (this.plugin.settings.projectsFolder || "").trim().replace(/^\/+|\/+$/g, "");
    if (!rel) return this.app.vault.getRoot();
    let f = this.app.vault.getAbstractFileByPath(rel);
    if (!f) {
      await this.app.vault.createFolder(rel);
      f = this.app.vault.getAbstractFileByPath(rel);
    }
    return f instanceof TFolder ? f : this.app.vault.getRoot();
  }

  private async lpNewProject(): Promise<void> {
    try {
      this.plugin.newLeanProject(await this.lpHome());
    } catch (e) {
      new Notice(`LeanPane: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  private async lpNewFile(): Promise<void> {
    try {
      await this.plugin.newLeanFile(await this.lpHome());
    } catch (e) {
      new Notice(`LeanPane: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  private lpNewMenu(e: MouseEvent): void {
    const m = new Menu();
    m.addItem((i) => i.setTitle("New Lean project").setIcon("folder-plus").onClick(() => void this.lpNewProject()));
    m.addItem((i) => i.setTitle("New Lean file").setIcon("file-plus").onClick(() => void this.lpNewFile()));
    m.showAtMouseEvent(e);
  }

  private async lpProjectMenu(p: LeanVaultProject, e: MouseEvent): Promise<void> {
    const abs = this.lpAbs(p.root);
    const desc = await this.plugin.findProjectDescriptor(abs).catch(() => null);
    const trusted = this.plugin.isTrusted(abs);
    const main = p.files.find((f) => f.endsWith(`/${p.name}.lean`) || f === `${p.name}.lean`) ?? p.files.find((f) => !f.endsWith("lakefile.lean")) ?? p.files[0];
    const m = new Menu();
    if (main) {
      m.addItem((i) => i.setTitle("Open main file").setIcon("file-code").onClick(() => void this.lpOpenFile(main, false)));
      m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => void this.lpOpenFile(main, true)));
    }
    m.addItem((i) =>
      i.setTitle("New Lean file in project").setIcon("file-plus").onClick(() => {
        const folder = p.root ? this.app.vault.getAbstractFileByPath(p.root) : this.app.vault.getRoot();
        if (folder instanceof TFolder) void this.plugin.newLeanFile(folder);
      }),
    );
    m.addSeparator();
    if (!trusted) m.addItem((i) => i.setTitle("Trust this project…").setIcon("shield-check").onClick(() => void this.lpTrust(abs)));
    m.addItem((i) => i.setTitle("Build project").setIcon("hammer").onClick(() => void this.plugin.buildProject(abs)));
    if (desc?.usesMathlib) m.addItem((i) => i.setTitle("Fetch Mathlib cache").setIcon("download").onClick(() => void this.plugin.fetchMathlibCache(abs)));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Reveal in file explorer").setIcon("folder-search").onClick(() => this.lpReveal(p.root)));
    if (p.root) {
      m.addItem((i) => i.setTitle("Delete project…").setIcon("trash-2").setWarning(true).onClick(() => this.lpConfirmDelete(p.root, `the project "${p.name}" and all its files`)));
    }
    m.showAtMouseEvent(e);
  }

  private async lpTrust(abs: string): Promise<void> {
    await this.plugin.trustProjectAt(abs);
    this.lpRedraw();
  }

  private lpReveal(p: string): void {
    const target = p ? this.app.vault.getAbstractFileByPath(p) : this.app.vault.getRoot();
    if (!target) return;
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    if (!leaf) {
      new Notice("LeanPane: the file explorer is not open.");
      return;
    }
    void this.app.workspace.revealLeaf(leaf);
    (leaf.view as unknown as { revealInFolder?: (f: unknown) => void }).revealInFolder?.(target);
  }

  private lpConfirmDelete(p: string, what: string): void {
    const target: TAbstractFile | null = this.app.vault.getAbstractFileByPath(p);
    if (!target) return;
    new ConfirmModal(this.app, "Delete?", `Move ${what} to the trash?`, "Delete", () => {
      void this.app.fileManager
        .trashFile(target)
        .then(() => new Notice(`LeanPane: deleted ${target.name}`))
        .catch((err) => new Notice(`LeanPane: could not delete (${err instanceof Error ? err.message : String(err)})`));
    }).open();
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly body: string,
    private readonly okLabel: string,
    private readonly onOk: () => void,
  ) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl("p", { text: this.body });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    const ok = row.createEl("button", { text: this.okLabel, cls: "mod-warning" });
    const cancel = row.createEl("button", { text: "Cancel" });
    ok.addEventListener("click", () => {
      this.close();
      this.onOk();
    });
    cancel.addEventListener("click", () => this.close());
    cancel.focus();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
