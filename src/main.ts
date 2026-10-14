import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type LeanPaneSettings } from "./types";
import { infoviewAssets } from "./infoview/assets";

export default class LeanPanePlugin extends Plugin {
  settings: LeanPaneSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Stage 3 (lead): views, commands, settings tab, API. Stage 1 only has to build.
    void infoviewAssets;
  }

  onunload(): void {}
}
