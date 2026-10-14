import { ItemView, Menu, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type LeanPanePlugin from "../main";
import { HeaderActions, addServerMenuItems } from "./header";
import { LeanWorkbench } from "./LeanWorkbench";

export const EXTERNAL_VIEW_TYPE = "leanpane-external";

interface ExternalState {
  path?: string;
  /** A file whose project supplies the language server (the file you jumped from). */
  context?: string;
  line?: number;
  column?: number;
}

/** Read-only view of a Lean source outside the vault (Lean core, Mathlib and other packages). */
export class LeanExternalView extends ItemView {
  private wb: LeanWorkbench | null = null;
  private headerActions: HeaderActions | null = null;
  private st: ExternalState = {};
  private loaded = "";

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LeanPanePlugin) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return EXTERNAL_VIEW_TYPE;
  }
  getDisplayText(): string {
    return this.st.path ? `${path.basename(this.st.path)} (read-only)` : "Lean source";
  }
  getIcon(): string {
    return "leanpane-lambda";
  }
  getWorkbench(): LeanWorkbench | null {
    return this.wb;
  }
  filePath(): string | undefined {
    return this.st.path;
  }

  async onOpen(): Promise<void> {
    this.wb = new LeanWorkbench({
      plugin: this.plugin,
      el: this.contentEl,
      component: this,
      readOnly: true,
      onChanged: () => {
        this.headerActions?.update();
        this.plugin.workbenchChanged(this.wb);
      },
      onBlueprintRefs: (refs) => this.headerActions?.setBlueprintRefs(refs.length),
    });
    this.wb.mount();
    this.headerActions = new HeaderActions(this, () => this.wb, this.plugin, false);
    this.headerActions.update();
    if (this.st.path) await this.leanLoad();
  }

  async onClose(): Promise<void> {
    this.wb?.destroy();
    this.wb = null;
    this.headerActions = null;
  }

  getState(): Record<string, unknown> {
    return { path: this.st.path, context: this.st.context };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as ExternalState;
    const changed = s.path !== undefined && s.path !== this.st.path;
    if (s.path !== undefined) this.st = { path: s.path, context: s.context ?? this.st.context, line: s.line, column: s.column };
    await super.setState(state, result);
    if (changed && this.wb) await this.leanLoad();
    else if (typeof s.line === "number") this.wb?.revealLine(s.line, s.column);
  }

  private async leanLoad(): Promise<void> {
    const file = this.st.path;
    const wb = this.wb;
    if (!file || !wb) return;
    let text = "";
    try {
      text = await fsp.readFile(file, "utf8");
    } catch (e) {
      text = `-- Could not read ${file}\n-- ${e instanceof Error ? e.message : String(e)}\n`;
    }
    this.loaded = text;
    wb.setText(text, true);
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    void wb.attach(file, this.st.context);
    if (typeof this.st.line === "number") wb.revealLine(this.st.line, this.st.column);
  }

  /** Jump to a 1-based position in the already open file. */
  revealLine(line: number, col?: number): void {
    this.wb?.revealLine(line, col);
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    if (source !== "more-options" && source !== "tab-header") return;
    addServerMenuItems(menu, this.plugin, this.wb);
  }

  currentText(): string {
    return this.loaded;
  }
}
