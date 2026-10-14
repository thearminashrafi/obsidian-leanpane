import { ItemView, Menu, setIcon } from "obsidian";
import type LeanPanePlugin from "../main";
import { LAYOUT_ICONS, LeanWorkbench } from "./LeanWorkbench";

/** The header buttons both Lean views share. `update()` refreshes the message badge and the layout icon. */
export class HeaderActions {
  private readonly layoutBtn: HTMLElement;
  private readonly messagesBtn: HTMLElement;
  private readonly blueprintBtn: HTMLElement;

  constructor(view: ItemView, private readonly wb: () => LeanWorkbench | null, plugin: LeanPanePlugin, editable: boolean) {
    if (editable) view.addAction("refresh-cw", "Restart file", () => this.wb()?.restartFile());
    this.layoutBtn = view.addAction(LAYOUT_ICONS[plugin.settings.layout], "Layout", (e) => this.wb()?.layoutMenu(e));
    this.messagesBtn = view.addAction("triangle-alert", "Messages", () => this.wb()?.toggleMessages());
    this.messagesBtn.addClass("lp-action-messages");
    this.blueprintBtn = view.addAction("book-open", "Open in blueprint", () => void this.wb()?.jumpToBlueprint());
    this.blueprintBtn.addClass("is-hidden");
  }

  update(): void {
    const w = this.wb();
    if (!w) return;
    LeanWorkbench.decorateMessagesButton(this.messagesBtn, w.messageCounts());
    setIcon(this.layoutBtn, LAYOUT_ICONS[w.getLayout()]);
  }

  setBlueprintRefs(count: number): void {
    this.blueprintBtn.toggleClass("is-hidden", count === 0);
    this.blueprintBtn.setAttr("aria-label", count > 1 ? `Open in blueprint (${count} places)` : "Open in blueprint");
  }
}

/** "Restart Lean server", "Build project" and friends, shared by the "more options" menu of both views. */
export function addServerMenuItems(menu: Menu, plugin: LeanPanePlugin, wb: LeanWorkbench | null): void {
  if (!wb) return;
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Restart Lean server").setIcon("power").onClick(() => void wb.restartServer()));
  const project = wb.getSession()?.project ?? null;
  if (project) {
    menu.addItem((i) => i.setTitle("Build project").setIcon("hammer").onClick(() => void plugin.buildProject(project.root)));
    if (project.usesMathlib) menu.addItem((i) => i.setTitle("Fetch Mathlib cache").setIcon("download").onClick(() => void plugin.fetchMathlibCache(project.root)));
  }
  menu.addItem((i) => i.setTitle("Show server log").setIcon("scroll-text").onClick(() => wb.showServerLog()));
}
