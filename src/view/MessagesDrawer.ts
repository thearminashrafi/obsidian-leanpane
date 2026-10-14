import { setIcon } from "obsidian";
import { diagnosticText, severityOf, type Severity } from "../core/lsp";
import type { Diagnostic } from "../types";

const ICONS: Record<Severity, string> = { error: "circle-x", warning: "triangle-alert", info: "info" };

export interface MessagesCallbacks {
  onSelect(d: Diagnostic): void;
  onClose(): void;
  /** Lines of the server's stderr for the "Server log" tab. */
  serverLog(): string[];
}

/** Bottom drawer: Lean messages (errors, warnings, #check / #eval output) and the server log. Styled like TeXPane's log drawer. */
export class MessagesDrawer {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<string, HTMLElement>();
  private readonly filterButtons = new Map<Severity, HTMLElement>();
  private tab: "messages" | "server" = "messages";
  private diags: Diagnostic[] = [];
  private filters: Record<Severity, boolean> = { error: true, warning: true, info: true };
  private open = false;

  constructor(parent: HTMLElement, private readonly cb: MessagesCallbacks) {
    this.el = parent.createDiv({ cls: "lp-messages" });
    const head = this.el.createDiv({ cls: "lp-log-head" });
    const tabs = head.createDiv({ cls: "lp-log-tabs" });
    for (const [id, label] of [["messages", "Messages"], ["server", "Server log"]] as const) {
      const b = tabs.createDiv({ cls: "lp-log-tab", text: label });
      b.addEventListener("click", () => {
        this.tab = id;
        this.render();
      });
      this.tabButtons.set(id, b);
    }
    head.createDiv({ cls: "lp-spacer" });
    const filters = head.createDiv({ cls: "lp-log-filters" });
    for (const sev of ["error", "warning", "info"] as Severity[]) {
      const b = filters.createDiv({ cls: `lp-log-filter is-${sev}` });
      b.addEventListener("click", () => {
        this.filters[sev] = !this.filters[sev];
        this.render();
      });
      this.filterButtons.set(sev, b);
    }
    const close = head.createDiv({ cls: "clickable-icon lp-log-close", attr: { "aria-label": "Close messages" } });
    setIcon(close, "x");
    close.addEventListener("click", () => cb.onClose());
    this.body = this.el.createDiv({ cls: "lp-log-body" });
    this.setOpen(false);
  }

  isOpen(): boolean {
    return this.open;
  }
  setOpen(o: boolean): void {
    this.open = o;
    this.el.toggleClass("is-open", o);
    if (o) this.render();
  }
  toggle(): void {
    this.setOpen(!this.open);
  }

  counts(): Record<Severity, number> {
    const c = { error: 0, warning: 0, info: 0 };
    for (const d of this.diags) c[severityOf(d)]++;
    return c;
  }

  set(diags: Diagnostic[]): void {
    this.diags = diags;
    this.render();
  }
  refreshServerLog(): void {
    if (this.tab === "server") this.render();
  }
  showServerLog(): void {
    this.tab = "server";
    this.setOpen(true);
    this.render();
  }

  private render(): void {
    const c = this.counts();
    for (const [sev, b] of this.filterButtons) {
      b.empty();
      setIcon(b.createSpan({ cls: "lp-log-filter-icon" }), ICONS[sev]);
      b.createSpan({ text: String(c[sev]) });
      b.toggleClass("is-active", this.filters[sev]);
      b.setAttr("aria-label", `${sev === "info" ? "info messages" : sev + "s"}`);
    }
    for (const [id, b] of this.tabButtons) b.toggleClass("is-active", id === this.tab);
    this.el.toggleClass("show-filters", this.tab === "messages");
    if (!this.open) return;
    this.body.empty();
    if (this.tab === "server") {
      this.body.createEl("pre", { cls: "lp-log-raw", text: this.cb.serverLog().join("\n") || "No server output yet." });
      return;
    }
    const shown = this.diags.filter((d) => this.filters[severityOf(d)]);
    if (shown.length === 0) {
      this.body.createDiv({ cls: "lp-log-empty", text: this.diags.length ? "No messages match the current filters." : "No messages." });
      return;
    }
    const sorted = [...shown].sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
    for (const d of sorted) {
      const sev = severityOf(d);
      const item = this.body.createDiv({ cls: "tree-item lp-log-item" });
      const self = item.createDiv({ cls: `tree-item-self is-clickable lp-sev-${sev}` });
      setIcon(self.createSpan({ cls: "lp-log-sev" }), ICONS[sev]);
      self.createDiv({ cls: "tree-item-inner" }).createSpan({ cls: "lp-log-msg", text: diagnosticText(d) });
      self.createDiv({ cls: "tree-item-flair-outer" }).createSpan({ cls: "tree-item-flair", text: `${d.range.start.line + 1}:${d.range.start.character + 1}` });
      self.addEventListener("click", () => this.cb.onSelect(d));
    }
  }
}
