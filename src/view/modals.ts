import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";

/** Modal.setTitle is missing on some 1.x builds; minAppVersion is 1.8.0. */
function title(m: Modal, text: string): void {
  if (typeof (m as Partial<Modal>).setTitle === "function") m.setTitle(text);
  else m.titleEl.setText(text);
}

export class PromptModal extends Modal {
  private value: string;
  private submitted = false;
  constructor(app: App, private heading: string, private placeholder: string, initial: string, private cta: string, private onSubmit: (v: string) => void) {
    super(app);
    this.value = initial;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    title(this, this.heading);
    let input: HTMLInputElement | null = null;
    new Setting(contentEl).addText((t) => {
      input = t.inputEl;
      t.setPlaceholder(this.placeholder).setValue(this.value).onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
      t.inputEl.addClass("lp-wide-input");
    });
    new Setting(contentEl).addButton((b) => b.setButtonText(this.cta).setCta().onClick(() => this.submit()));
    window.setTimeout(() => {
      input?.focus();
      input?.select();
    }, 10);
  }
  private submit(): void {
    const v = this.value.trim();
    if (!v || this.submitted) return;
    this.submitted = true;
    this.close();
    this.onSubmit(v);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** "Trust this Lean project?" Resolves true only when the user presses the trust button. */
export class TrustModal extends Modal {
  private answered = false;
  constructor(app: App, private root: string, private toolchain: string | null, private done: (trusted: boolean) => void) {
    super(app);
  }
  static ask(app: App, root: string, toolchain: string | null): Promise<boolean> {
    return new Promise((resolve) => new TrustModal(app, root, toolchain, resolve).open());
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    title(this, "Trust this Lean project?");
    contentEl.createEl("p", { text: "LeanPane is about to start the Lean server for this project. Lakefiles and Lean files can run arbitrary code on your computer when they are built or elaborated, so only continue for projects you trust." });
    contentEl.createEl("p", { cls: "lp-trust-path" }).createEl("code", { text: this.root });
    if (this.toolchain) contentEl.createEl("p", { cls: "setting-item-description", text: `Toolchain: ${this.toolchain}. If it is not installed yet, elan downloads it on first use.` });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Don't trust").onClick(() => this.finish(false)))
      .addButton((b) => b.setButtonText("Trust and start Lean").setCta().onClick(() => this.finish(true)));
  }
  private finish(v: boolean): void {
    if (this.answered) return;
    this.answered = true;
    this.done(v);
    this.close();
  }
  onClose(): void {
    if (!this.answered) {
      this.answered = true;
      this.done(false);
    }
    this.contentEl.empty();
  }
}

/** Live output of a long-running command with a Cancel button. Closing the window while it runs just hides it. */
export class ProgressModal extends Modal {
  private readonly ac = new AbortController();
  private pre!: HTMLElement;
  private statusEl!: HTMLElement;
  private buttonRow!: HTMLElement;
  private buffer = "";
  private finished = false;
  private hidden = false;
  private lastNotice = "";

  constructor(app: App, private heading: string) {
    super(app);
  }
  get signal(): AbortSignal {
    return this.ac.signal;
  }
  onOpen(): void {
    this.hidden = false;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lp-progress-modal");
    title(this, this.heading);
    this.statusEl = contentEl.createDiv({ cls: "lp-progress-status", text: this.lastNotice || "Working…" });
    this.pre = contentEl.createEl("pre", { cls: "lp-progress-output", text: this.buffer });
    this.buttonRow = contentEl.createDiv({ cls: "lp-progress-buttons" });
    this.renderButtons();
    this.pre.scrollTop = this.pre.scrollHeight;
  }
  onClose(): void {
    this.hidden = true;
    this.contentEl.empty();
  }
  private renderButtons(): void {
    this.buttonRow.empty();
    if (this.finished) {
      this.buttonRow.createEl("button", { text: "Close", cls: "mod-cta" }).addEventListener("click", () => this.close());
    } else {
      this.buttonRow.createEl("button", { text: "Hide" }).addEventListener("click", () => this.close());
      this.buttonRow.createEl("button", { text: "Cancel", cls: "mod-warning" }).addEventListener("click", () => this.ac.abort());
    }
  }
  setStatus(text: string): void {
    this.lastNotice = text;
    if (!this.hidden) this.statusEl?.setText(text);
  }
  log(text: string): void {
    this.buffer += text;
    if (this.buffer.length > 200000) this.buffer = "…" + this.buffer.slice(-150000);
    if (this.hidden || !this.pre) return;
    const atEnd = this.pre.scrollTop + this.pre.clientHeight >= this.pre.scrollHeight - 24;
    this.pre.setText(this.buffer);
    if (atEnd) this.pre.scrollTop = this.pre.scrollHeight;
  }
  /** Mark the task as done; when the window was hidden, say so with a notice instead. */
  finish(ok: boolean, message: string): void {
    this.finished = true;
    this.lastNotice = message;
    if (this.hidden) {
      new Notice(`LeanPane: ${message}`, ok ? 6000 : 10000);
      return;
    }
    this.statusEl?.setText(message);
    this.statusEl?.toggleClass("is-error", !ok);
    this.renderButtons();
  }
}

/** Pick one of the given files (vault paths). */
export class FilePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private files: TFile[], placeholder: string, private onPick: (f: TFile) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): TFile[] {
    return this.files;
  }
  getItemText(f: TFile): string {
    return f.path;
  }
  onChooseItem(f: TFile): void {
    this.onPick(f);
  }
}
