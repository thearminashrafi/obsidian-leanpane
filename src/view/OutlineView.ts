import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { symbolKindLabel } from "../core/lsp";
import type { LiveDecl, LiveDeclState } from "../types";
import type LeanPanePlugin from "../main";
import type { LeanWorkbench } from "./LeanWorkbench";

export const OUTLINE_TYPE = "leanpane-outline";

const STATE_ICON: Record<LiveDeclState, string> = { proved: "circle-check", stated: "triangle-alert", error: "circle-x" };
const STATE_LABEL: Record<LiveDeclState, string> = { proved: "proved", stated: "uses sorry", error: "has an error" };

/** Sidebar: the declarations of the active Lean file with proved / sorry / error icons. */
export class OutlineView extends ItemView {
  private off: (() => void) | null = null;
  private timer: number | null = null;
  private runId = 0;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LeanPanePlugin) {
    super(leaf);
  }
  getViewType(): string {
    return OUTLINE_TYPE;
  }
  getDisplayText(): string {
    return "Lean outline";
  }
  getIcon(): string {
    return "list-tree";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("lp-outline");
    this.off = this.plugin.onWorkbenchChanged(() => this.leanSchedule());
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.leanSchedule()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.leanSchedule()));
    this.leanDraw();
  }
  async onClose(): Promise<void> {
    this.off?.();
    if (this.timer) window.clearTimeout(this.timer);
  }

  refresh(): void {
    this.leanSchedule();
  }
  private leanSchedule(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.leanDraw();
    }, 150);
  }

  private leanDraw(): void {
    const el = this.contentEl;
    const run = ++this.runId;
    const wb: LeanWorkbench | null = this.plugin.activeWorkbench();
    el.empty();
    if (!wb) {
      el.createDiv({ cls: "pane-empty", text: "Open a .lean file to see its declarations." });
      return;
    }
    const decls = wb.decls();
    if (decls.length === 0) {
      const phase = wb.snapshot()?.phase;
      el.createDiv({ cls: "pane-empty", text: phase === "running" ? "No declarations yet." : "Waiting for Lean…" });
      return;
    }
    const list = el.createDiv({ cls: "lp-outline-list" });
    const rows = new Map<string, HTMLElement>();
    for (const d of decls) rows.set(d.name, this.leanRow(list, d, wb));
    void this.leanMarkBlueprint(run, decls, rows, wb);
  }

  private leanRow(list: HTMLElement, d: LiveDecl, wb: LeanWorkbench): HTMLElement {
    const row = list.createDiv({ cls: "tree-item lp-outline-row" });
    const self = row.createDiv({ cls: `tree-item-self is-clickable lp-decl-${d.state}` });
    const icon = self.createSpan({ cls: "lp-decl-icon" });
    setIcon(icon, STATE_ICON[d.state]);
    icon.setAttr("aria-label", STATE_LABEL[d.state]);
    self.createDiv({ cls: "tree-item-inner", text: d.shortName });
    const flair = self.createDiv({ cls: "tree-item-flair-outer" });
    flair.createSpan({ cls: "tree-item-flair", text: symbolKindLabel(d.symbolKind) });
    self.addEventListener("click", () => wb.revealLine(d.selectionRange.start.line + 1, d.selectionRange.start.character + 1));
    return row;
  }

  /** With TeXPane present: mark declarations the blueprint does not mention (when the file/project is tracked at all). */
  private async leanMarkBlueprint(run: number, decls: LiveDecl[], rows: Map<string, HTMLElement>, wb: LeanWorkbench): Promise<void> {
    if (!this.plugin.texpaneApi()) return;
    const refs = await Promise.all(decls.map((d) => this.plugin.blueprintRefs(d.name)));
    if (run !== this.runId) return;
    let tracked = refs.some((r) => r.length > 0);
    if (!tracked) {
      const root = wb.getSession()?.project?.root;
      if (root) {
        try {
          await fsp.access(path.join(root, "blueprint"));
          tracked = true;
        } catch {
          /* no blueprint folder */
        }
      }
    }
    if (!tracked || run !== this.runId) return;
    decls.forEach((d, i) => {
      if (refs[i].length > 0) return;
      const self = rows.get(d.name)?.querySelector(".tree-item-self");
      if (!self) return;
      const mark = (self as HTMLElement).createSpan({ cls: "lp-blueprint-missing", attr: { "aria-label": "Not mentioned in the blueprint" } });
      setIcon(mark, "unlink");
    });
  }
}
