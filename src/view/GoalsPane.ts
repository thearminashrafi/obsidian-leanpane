import { setIcon } from "obsidian";
import { goalCountLabel } from "../core/goals";
import type { PlainGoal } from "../types";

/** The goals pane: plain-text goals rendered natively, a mount point for the interactive infoview, and status cards. */
export class GoalsPane {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly flairEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly plainEl: HTMLElement;
  /** The interactive infoview is appended here. */
  readonly infoviewEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private mode: "plain" | "interactive" = "plain";

  constructor(parent: HTMLElement) {
    this.el = parent.createDiv({ cls: "lp-goals" });
    const head = this.el.createDiv({ cls: "lp-pane-head" });
    this.titleEl = head.createSpan({ cls: "lp-pane-title", text: "Goals" });
    this.flairEl = head.createSpan({ cls: "lp-pane-flair" });
    this.bodyEl = this.el.createDiv({ cls: "lp-goals-body" });
    this.plainEl = this.bodyEl.createDiv({ cls: "lp-goals-plain" });
    this.infoviewEl = this.bodyEl.createDiv({ cls: "lp-goals-infoview" });
    this.cardEl = this.bodyEl.createDiv({ cls: "lp-goals-card-host" });
    this.setMode("plain");
  }

  /** Which of the two renderers is visible. */
  setMode(mode: "plain" | "interactive"): void {
    this.mode = mode;
    this.plainEl.toggleClass("is-hidden", mode !== "plain");
    this.infoviewEl.toggleClass("is-hidden", mode !== "interactive");
    this.el.toggleClass("is-interactive", mode === "interactive");
    if (mode === "interactive") {
      this.titleEl.setText("Infoview");
      this.flairEl.setText("");
    } else this.titleEl.setText("Goals");
  }
  getMode(): "plain" | "interactive" {
    return this.mode;
  }

  /** A full-pane card (setup problems, crashes, "preparing"); pass null to remove it. */
  showCard(card: HTMLElement | null): void {
    this.cardEl.empty();
    this.cardEl.toggleClass("is-visible", !!card);
    if (card) this.cardEl.appendChild(card);
  }
  hasCard(): boolean {
    return this.cardEl.hasClass("is-visible");
  }

  /** Muted one-line message in place of the goals. */
  showMessage(text: string): void {
    this.plainEl.empty();
    this.flairEl.setText("");
    this.plainEl.createDiv({ cls: "lp-goals-empty", text });
  }

  showPlain(goals: PlainGoal[], term: PlainGoal | null): void {
    const el = this.plainEl;
    el.empty();
    this.flairEl.setText(goals.length ? goalCountLabel(goals.length) : "");
    if (goals.length === 0 && !term) {
      el.createDiv({ cls: "lp-goals-empty", text: "No goals at the cursor." });
      return;
    }
    goals.forEach((g, i) => this.renderGoal(el.createDiv({ cls: "lp-goal" }), g, goals.length > 1 ? i + 1 : 0));
    if (term) {
      el.createDiv({ cls: "lp-goal-section", text: "Expected type" });
      this.renderGoal(el.createDiv({ cls: "lp-goal lp-goal-term" }), term, 0);
    }
  }

  private renderGoal(el: HTMLElement, g: PlainGoal, index: number): void {
    if (g.caseName !== undefined || index > 0) {
      const head = el.createDiv({ cls: "lp-goal-case" });
      if (index > 0) head.createSpan({ cls: "lp-goal-index", text: String(index) });
      if (g.caseName !== undefined) head.createSpan({ text: `case ${g.caseName}` });
    }
    for (const h of g.hyps) {
      const row = el.createDiv({ cls: "lp-hyp" });
      row.createSpan({ cls: "lp-hyp-names", text: h.names.join(" ") });
      row.createSpan({ cls: "lp-hyp-sep", text: " : " });
      row.createSpan({ cls: "lp-hyp-type", text: h.type });
      if (h.value !== undefined) {
        row.createSpan({ cls: "lp-hyp-sep", text: " := " });
        row.createSpan({ cls: "lp-hyp-type", text: h.value });
      }
    }
    const target = el.createDiv({ cls: "lp-goal-target" });
    target.createSpan({ cls: "lp-turnstile", text: "⊢" });
    target.createSpan({ cls: "lp-goal-type", text: " " + g.target });
  }

  /** A card with a title, text and optional buttons. */
  static makeCard(opts: { icon?: string; title: string; lines?: string[]; pre?: string; buttons?: Array<{ text: string; cta?: boolean; onClick: () => void }> }): HTMLElement {
    const card = createDiv({ cls: "lp-card" });
    const head = card.createDiv({ cls: "lp-card-head" });
    if (opts.icon) setIcon(head.createSpan({ cls: "lp-card-icon" }), opts.icon);
    head.createEl("strong", { text: opts.title });
    for (const l of opts.lines ?? []) card.createEl("p", { text: l });
    if (opts.pre) card.createEl("pre", { cls: "lp-card-pre", text: opts.pre });
    if (opts.buttons?.length) {
      const row = card.createDiv({ cls: "lp-card-buttons" });
      for (const b of opts.buttons) {
        const btn = row.createEl("button", { text: b.text, cls: b.cta ? "mod-cta" : "" });
        btn.addEventListener("click", b.onClick);
      }
    }
    return card;
  }
}
