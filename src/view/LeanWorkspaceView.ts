import { Menu, Scope, TFile, TextFileView, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import * as path from "node:path";
import { findNext, findPrevious, openSearchPanel } from "@codemirror/search";
import type LeanPanePlugin from "../main";
import { HeaderActions, addServerMenuItems } from "./header";
import { LeanWorkbench } from "./LeanWorkbench";

export const VIEW_TYPE = "leanpane-workspace";

/** Editable view of a .lean file in the vault: editor | goals | messages. */
export class LeanWorkspaceView extends TextFileView {
  private wb: LeanWorkbench | null = null;
  private headerActions: HeaderActions | null = null;
  private lastManualSave = 0;
  private pendingReveal: { line: number; col?: number } | null = null;
  /** Content last read from or written to disk; the editor has unsaved edits when it differs. */
  private diskData: string | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LeanPanePlugin) {
    super(leaf);
    this.navigation = true;
    // Mod-s through Obsidian's keymap too: the editor keymap alone never sees it if Obsidian handles the key first
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "s", () => (this.leanSaveNow(), false));
    const withEditor = (fn: (v: NonNullable<ReturnType<LeanWorkbench["getEditor"]>>) => unknown) => () => {
      const ed = this.wb?.getEditor();
      if (ed) fn(ed);
      return false;
    };
    this.scope.register(["Mod"], "f", withEditor(openSearchPanel));
    this.scope.register(["Mod"], "g", withEditor(findNext));
    this.scope.register(["Mod", "Shift"], "g", withEditor(findPrevious));
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return this.file?.basename ?? "Lean";
  }
  getIcon(): string {
    return "leanpane-lambda";
  }
  getWorkbench(): LeanWorkbench | null {
    return this.wb;
  }
  absPath(): string | null {
    return this.file ? path.join(this.plugin.basePath(), ...this.file.path.split("/")) : null;
  }

  // ---------------------------------------------------------------- lifecycle
  async onOpen(): Promise<void> {
    this.wb = new LeanWorkbench({
      plugin: this.plugin,
      el: this.contentEl,
      component: this,
      readOnly: false,
      onUserEdit: () => this.leanOnUserEdit(),
      onDocChanged: () => {
        // keep `data` current on every change: Obsidian reads it (not getViewData) in some save paths
        if (this.wb) this.data = this.wb.getText();
      },
      onSaveKey: () => this.leanSaveNow(),
      onChanged: () => {
        this.headerActions?.update();
        this.plugin.workbenchChanged(this.wb);
      },
      onBlueprintRefs: (refs) => this.headerActions?.setBlueprintRefs(refs.length),
    });
    this.wb.mount();
    this.headerActions = new HeaderActions(this, () => this.wb, this.plugin, true);
    this.headerActions.update();
  }

  async onClose(): Promise<void> {
    // flush unsaved edits BEFORE the editor is destroyed (the debounced save may not have fired yet)
    if (this.wb) this.data = this.wb.getText();
    if (this.file && this.data !== this.diskData) {
      try {
        await this.save();
      } catch (e) {
        this.plugin.log(`could not save ${this.file.path} on close: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.wb?.destroy();
    this.wb = null;
    this.headerActions = null;
  }

  // ---------------------------------------------------------------- TextFileView contract
  getViewData(): string {
    if (this.wb) this.data = this.wb.getText();
    return this.data;
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    this.diskData = data;
    this.wb?.setText(data, clear);
    if (this.pendingReveal && this.wb) {
      const r = this.pendingReveal;
      this.pendingReveal = null;
      this.wb.revealLine(r.line, r.col);
    }
  }

  clear(): void {
    this.wb?.setText("", true);
    this.data = "";
    this.diskData = null;
  }

  /** The file changed on disk (another editor, git, sync). Take the new text unless there are unsaved edits. */
  reloadIfClean(file: TFile, disk: string): void {
    if (file !== this.file || !this.wb) return;
    const cur = this.getViewData();
    if (disk === cur || cur !== this.diskData) return;
    this.setViewData(disk, false);
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    this.leanAttach();
  }

  async onUnloadFile(file: TFile): Promise<void> {
    // super saves pending edits first; detach afterwards so the server still has the document while saving
    await super.onUnloadFile(file);
    this.wb?.detach();
  }

  async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    this.leanAttach();
  }

  private leanAttach(): void {
    const abs = this.absPath();
    if (abs && this.wb) void this.wb.attach(abs);
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
  }

  setEphemeralState(state: any): void {
    super.setEphemeralState(state);
    if (state && typeof state.line === "number") {
      const line = state.line + 1;
      const col = state.column !== undefined ? state.column + 1 : undefined;
      if (this.wb && this.file && this.wb.getText().length > 0) this.wb.revealLine(line, col);
      else this.pendingReveal = { line, col };
    }
  }

  async save(clear?: boolean): Promise<void> {
    const data = this.getViewData();
    const file = this.file;
    await super.save(clear);
    if (file && file === this.file) {
      this.diskData = data;
      this.wb?.save();
    }
  }

  private leanSaveNow(): void {
    const now = Date.now();
    if (now - this.lastManualSave < 250) return;
    this.lastManualSave = now;
    void this.save().catch(() => undefined);
  }

  private leanOnUserEdit(): void {
    this.requestSave();
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    if (source !== "more-options" && source !== "tab-header") return;
    addServerMenuItems(menu, this.plugin, this.wb);
  }

  // ---------------------------------------------------------------- used by the plugin
  revealLine(line: number, col?: number): void {
    if (this.wb) this.wb.revealLine(line, col);
    else this.pendingReveal = { line, col };
  }
}
