import { App, Modal, Setting } from "obsidian";
import { sanitizeProjectName } from "../core/templates";

export interface NewProjectRequest {
  /** Vault-relative folder ("" = vault root) the project folder is created in. */
  folder: string;
  name: string;
  mathlib: boolean;
  blueprint: boolean;
}

export class NewProjectModal extends Modal {
  private req: NewProjectRequest;
  private warn!: HTMLElement;
  constructor(app: App, initialFolder: string, private teXPaneAvailable: boolean, private onSubmit: (r: NewProjectRequest) => void) {
    super(app);
    this.req = { folder: initialFolder, name: "my-lean-project", mathlib: false, blueprint: true };
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (typeof (this as Partial<Modal>).setTitle === "function") this.setTitle("New Lean project");
    else this.titleEl.setText("New Lean project");

    new Setting(contentEl).setName("Project name").setDesc("Letters, digits, - and _. Becomes the folder name and the Lean library name.").addText((t) => {
      t.setValue(this.req.name).onChange((v) => {
        this.req.name = v;
        this.refresh();
      });
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
      window.setTimeout(() => {
        t.inputEl.focus();
        t.inputEl.select();
      }, 10);
    });
    new Setting(contentEl).setName("Location").setDesc("Vault folder to create the project in (empty = vault root).").addText((t) =>
      t.setPlaceholder("vault root").setValue(this.req.folder).onChange((v) => (this.req.folder = v.trim().replace(/^\/+|\/+$/g, ""))),
    );
    new Setting(contentEl)
      .setName("Add Mathlib")
      .setDesc("Uses the Mathlib template and downloads the prebuilt cache (several GB on disk, can take a few minutes). Off: a plain Lean project that builds in seconds.")
      .addToggle((t) => t.setValue(this.req.mathlib).onChange((v) => (this.req.mathlib = v)));
    new Setting(contentEl)
      .setName("Add a blueprint")
      .setDesc(
        this.teXPaneAvailable
          ? "Adds blueprint/src with LaTeX files and a starter lemma linked to a starter theorem. TeXPane compiles and tracks it."
          : "Adds blueprint/src with LaTeX files and a starter lemma linked to a starter theorem. Install TeXPane to edit and compile the LaTeX in Obsidian.",
      )
      .addToggle((t) => t.setValue(this.req.blueprint).onChange((v) => (this.req.blueprint = v)));
    this.warn = contentEl.createDiv({ cls: "lp-form-warning" });
    new Setting(contentEl).addButton((b) => b.setButtonText("Create project").setCta().onClick(() => this.submit()));
    this.refresh();
  }
  private refresh(): void {
    const clean = sanitizeProjectName(this.req.name);
    this.warn.setText(clean && clean !== this.req.name.trim() ? `The folder will be called "${clean}".` : "");
  }
  private submit(): void {
    const name = sanitizeProjectName(this.req.name);
    if (!name) {
      this.warn.setText("Please enter a project name.");
      return;
    }
    this.close();
    this.onSubmit({ ...this.req, name });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
