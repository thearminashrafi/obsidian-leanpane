import { App, Modal, Setting } from "obsidian";

export interface AddToBlueprintRequest {
  texFile: string;
  env: string;
  label: string;
  leanName: string;
  statement: string;
}

const ENVS = ["theorem", "lemma", "proposition", "corollary", "definition"];

/** Asks where and how to add a declaration to the blueprint (TeXPane inserts it). */
export class AddToBlueprintModal extends Modal {
  private req: AddToBlueprintRequest;
  constructor(app: App, init: AddToBlueprintRequest, private texFiles: string[], private onSubmit: (r: AddToBlueprintRequest) => void) {
    super(app);
    this.req = { ...init };
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof (this as Partial<Modal>).setTitle === "function") this.setTitle("Add to blueprint");
    else this.titleEl.setText("Add to blueprint");
    contentEl.createEl("p", { cls: "setting-item-description", text: `Adds \\lean{${this.req.leanName}} to a new environment in the LaTeX blueprint.` });
    new Setting(contentEl).setName("LaTeX file").addDropdown((d) => {
      const opts: Record<string, string> = {};
      for (const f of this.texFiles) opts[f] = f;
      d.addOptions(opts).setValue(this.req.texFile).onChange((v) => (this.req.texFile = v));
    });
    new Setting(contentEl).setName("Environment").addDropdown((d) => {
      const opts: Record<string, string> = {};
      for (const e of ENVS) opts[e] = e;
      d.addOptions(opts).setValue(this.req.env).onChange((v) => (this.req.env = v));
    });
    new Setting(contentEl).setName("Label").addText((t) => t.setValue(this.req.label).onChange((v) => (this.req.label = v.trim())));
    new Setting(contentEl).setName("Statement").setDesc("LaTeX text of the statement; edit it later in the .tex file.").addTextArea((t) => {
      t.setValue(this.req.statement).onChange((v) => (this.req.statement = v));
      t.inputEl.rows = 4;
      t.inputEl.addClass("lp-wide-input");
    });
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Add").setCta().onClick(() => {
        if (!this.req.label || !this.req.texFile) return;
        this.close();
        this.onSubmit(this.req);
      }),
    );
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
