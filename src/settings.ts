import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type LeanPanePlugin from "./main";

export class LeanPaneSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: LeanPanePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async (): Promise<void> => {
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
    };

    new Setting(containerEl).setName("Lean installation").setHeading();
    this.leanRenderElan(containerEl.createDiv({ cls: "lp-settings-elan" }));
    new Setting(containerEl)
      .setName("Elan folder")
      .setDesc("Folder with the elan shims (lake, lean, elan). Leave empty to auto-detect: ~/.elan/bin, then your PATH.")
      .addText((t) =>
        t.setPlaceholder("auto-detect").setValue(s.elanBinDir).onChange(async (v) => {
          s.elanBinDir = v.trim();
          await save();
        }),
      )
      .addButton((b) =>
        b.setButtonText("Re-check").onClick(async () => {
          await this.plugin.recheckElan();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Lean projects folder")
      .setDesc("Where New in the Lean projects panel creates projects and files (created if missing). Leave empty for the vault root.")
      .addText((t) =>
        t.setPlaceholder("Lean").setValue(s.projectsFolder).onChange(async (v) => {
          s.projectsFolder = v.trim();
          await save();
        }),
      );

    new Setting(containerEl).setName("Goals").setHeading();
    new Setting(containerEl)
      .setName("Goal view")
      .setDesc("Interactive is the same infoview VS Code uses (hover over terms, click to expand). Plain shows the goals as text and always works. Applies to files opened from now on.")
      .addDropdown((d) =>
        d.addOptions({ interactive: "Interactive", plain: "Plain text" }).setValue(s.goalView).onChange(async (v) => {
          s.goalView = v as "interactive" | "plain";
          await save();
        }),
      );

    new Setting(containerEl).setName("Server").setHeading();
    new Setting(containerEl)
      .setName("Stop idle servers after (minutes)")
      .setDesc("A project's Lean server is shut down this long after its last file is closed. 0 keeps it running until Obsidian quits.")
      .addText((t) =>
        t.setValue(String(s.idleShutdownMinutes)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0) {
            s.idleShutdownMinutes = Math.floor(n);
            await save();
          }
        }),
      );
    new Setting(containerEl)
      .setName("Edit delay (ms)")
      .setDesc("Quiet time after typing before the change is sent to Lean (100 to 1000).")
      .addSlider((sl) =>
        sl.setLimits(100, 1000, 50).setValue(s.debounceMs).setDynamicTooltip().onChange(async (v) => {
          s.debounceMs = v;
          await save();
        }),
      );
    this.leanRenderTrusted(containerEl);

    new Setting(containerEl).setName("Editor").setHeading();
    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Pixels.")
      .addSlider((sl) =>
        sl.setLimits(10, 24, 1).setValue(s.fontSize).setDynamicTooltip().onChange(async (v) => {
          s.fontSize = v;
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Syntax colours")
      .setDesc("LeanPane's palette, or the code colours of your Obsidian theme.")
      .addDropdown((d) =>
        d.addOptions({ leanpane: "LeanPane", theme: "Follow theme" }).setValue(s.syntaxColours).onChange(async (v) => {
          s.syntaxColours = v as "leanpane" | "theme";
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Semantic highlighting")
      .setDesc("Colour functions, types and namespaces using Lean's own knowledge, on top of the basic highlighting.")
      .addToggle((t) =>
        t.setValue(s.semanticTokens).onChange(async (v) => {
          s.semanticTokens = v;
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Hover information")
      .setDesc("Show types and documentation when the pointer rests on a term.")
      .addToggle((t) =>
        t.setValue(s.showHover).onChange(async (v) => {
          s.showHover = v;
          await save();
        }),
      );

    new Setting(containerEl).setName("Unicode input").setHeading();
    new Setting(containerEl)
      .setName("Type Lean abbreviations")
      .setDesc("Typing \\to followed by a space or Tab gives →.")
      .addToggle((t) =>
        t.setValue(s.unicodeInput).onChange(async (v) => {
          s.unicodeInput = v;
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Leader character")
      .setDesc("Starts an abbreviation. Typing it twice gives the character itself.")
      .addText((t) =>
        t.setValue(s.unicodeLeader).onChange(async (v) => {
          if (v.length === 1) {
            s.unicodeLeader = v;
            await save();
          }
        }),
      );
    new Setting(containerEl)
      .setName("Replace as soon as unambiguous")
      .setDesc("Off: abbreviations are replaced only after a space or Tab.")
      .addToggle((t) =>
        t.setValue(s.unicodeEager).onChange(async (v) => {
          s.unicodeEager = v;
          await save();
        }),
      );
  }

  private leanRenderElan(el: HTMLElement): void {
    el.empty();
    const info = this.plugin.elanInfo();
    if (!info) {
      el.createEl("p", { text: "Detecting Lean tools…", cls: "setting-item-description" });
      void this.plugin.ensureElan().then(() => {
        if (el.isConnected) this.leanRenderElan(el);
      }, () => undefined);
      return;
    }
    const rows: Array<[string, string | undefined, boolean]> = [
      ["elan", info.elanVersion, false],
      ["lake", info.lakeVersion, true],
      ["lean", info.leanPath ? "found" : undefined, true],
    ];
    const list = el.createDiv({ cls: "lp-tool-list" });
    for (const [name, version, required] of rows) {
      const row = list.createDiv({ cls: "lp-tool-row" });
      const ic = row.createSpan({ cls: "lp-tool-icon" });
      setIcon(ic, version ? "check" : required ? "x" : "minus");
      ic.addClass(version ? "is-ok" : required ? "is-missing" : "is-optional");
      row.createSpan({ text: name, cls: "lp-tool-name" });
      row.createSpan({ text: version ?? (required ? "not found" : "not installed"), cls: "lp-tool-version" });
    }
    if (info.binDir) el.createEl("p", { text: `Found in ${info.binDir}`, cls: "setting-item-description" });
    if (info.toolchains.length > 0) {
      const tc = el.createDiv({ cls: "lp-tool-row" });
      const ic = tc.createSpan({ cls: "lp-tool-icon" });
      setIcon(ic, "package");
      tc.createSpan({ text: "toolchains", cls: "lp-tool-name" });
      tc.createSpan({ text: info.toolchains.map((t) => (t === info.defaultToolchain ? `${t} (default)` : t)).join(", "), cls: "lp-tool-version" });
    }
    if (!info.lakePath) {
      const card = el.createDiv({ cls: "lp-setup-card" });
      card.createEl("strong", { text: "Lean was not found" });
      card.createEl("p", { text: "Install elan from https://github.com/leanprover/elan (it provides lake and lean), then press Re-check. If elan is installed but not found, enter its folder above (for example ~/.elan/bin): applications started from the Dock or Finder do not see your shell's PATH." });
    }
  }

  private leanRenderTrusted(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el).setName("Trusted projects").setDesc("LeanPane asks before it first starts Lean for a project. Remove a project to be asked again.");
    if (s.trustedProjects.length === 0) {
      el.createEl("p", { text: "No trusted projects yet.", cls: "setting-item-description" });
      return;
    }
    for (const p of s.trustedProjects) {
      new Setting(el).setName(p).addExtraButton((b) =>
        b.setIcon("trash-2").setTooltip("Stop trusting this project").onClick(async () => {
          s.trustedProjects = s.trustedProjects.filter((x) => x !== p);
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    }
  }
}
