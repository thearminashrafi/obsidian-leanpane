/**
 * The Lean workspace: editor | goals pane | messages drawer, plus everything that connects them to the language
 * server. One workbench lives inside each LeanWorkspaceView (editable, vault file) and each LeanExternalView
 * (read-only file outside the vault, e.g. Mathlib or toolchain sources).
 *
 * Private helpers are prefixed `wb` / `do` on purpose: a helper named like an Obsidian View/Component internal
 * (open, close, load, render, ...) can silently replace it (a TeXPane panel once went blank that way).
 */
import { Annotation, Compartment, EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, toggleLineComment } from "@codemirror/commands";
import { findNext, findPrevious, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Component, MarkdownRenderer, Menu, Notice } from "obsidian";
import type { BlueprintRef } from "../integration/api-types";
import { parsePlainGoalResponse, parsePlainTermGoal } from "../core/goals";
import { LeanSession, type SessionSnapshot } from "../core/session";
import { definitionTargets, decodeSemanticTokens, stepDiagnostic, uriToPath, type SemanticLegend } from "../core/lsp";
import { statusLine, type StatusLine } from "../core/statusText";
import type { Diagnostic, LayoutMode, LiveDecl, PlainGoal, Position } from "../types";
import { applyDiagnostics, diagnosticsGutter } from "../editor/diagnostics";
import { leanCompletion } from "../editor/completion";
import type { LeanEditorHost } from "../editor/host";
import { leanHover } from "../editor/hover";
import { leanSyntax } from "../editor/leanLanguage";
import { flashLine, lineFlashField } from "../editor/lineFlash";
import { changesToLsp, offsetToPos, posToOffset, rangeToOffsets } from "../editor/lspConvert";
import { leanMarkers, setProcessing, setSorryLines } from "../editor/markers";
import { leanNavigation } from "../editor/navigation";
import { createSearchPanel } from "../editor/searchPanel";
import { buildSemanticDecorations, semanticTokensExtension, setSemanticDecorations } from "../editor/semanticTokens";
import { unicodeInput } from "../editor/unicodeInput";
import type { InfoviewEditorActions } from "../infoview/host";
import type LeanPanePlugin from "../main";
import { GoalsPane } from "./GoalsPane";
import { InfoviewController } from "./InfoviewController";
import { MessagesDrawer } from "./MessagesDrawer";

/** Marks transactions that load text from disk (not typed by the user). */
const External = Annotation.define<boolean>();

export const LAYOUT_ICONS: Record<LayoutMode, string> = { split: "columns-2", editor: "file-code", goals: "target" };
const LAYOUT_LABELS: Record<LayoutMode, string> = { split: "Split", editor: "Editor only", goals: "Goals only" };

export interface WorkbenchOptions {
  plugin: LeanPanePlugin;
  /** The view's content element. */
  el: HTMLElement;
  /** Lifetime owner for rendered Markdown. */
  component: Component;
  readOnly: boolean;
  /** The user typed in the editor (not a load from disk). */
  onUserEdit?(): void;
  /** Mod+S */
  onSaveKey?(): void;
  /** Status, counts or declarations changed. */
  onChanged?(): void;
  /** The blueprint references of the declaration at the cursor changed. */
  onBlueprintRefs?(refs: BlueprintRef[]): void;
}

export class LeanWorkbench {
  readonly plugin: LeanPanePlugin;
  private readonly o: WorkbenchOptions;
  private rootEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private editorPane!: HTMLElement;
  private dividerEl!: HTMLElement;
  private goals!: GoalsPane;
  private drawer!: MessagesDrawer;
  private editor!: EditorView;
  private readonly wrapComp = new Compartment();
  private resizeObs: ResizeObserver | null = null;
  private ratioTimer: number | null = null;
  private layout: LayoutMode;
  private ratio: number;

  private session: LeanSession | null = null;
  private sessionOff: Array<() => void> = [];
  private filePath: string | null = null;
  private contextPath: string | null = null;
  private infoview: InfoviewController | null = null;
  private goalAbort: AbortController | null = null;
  private goalTimer: number | null = null;
  private cursorTimer: number | null = null;
  private semAbort: AbortController | null = null;
  private lastEngineKey: { root: string; file: string } | null = null;
  private lastDeclName: string | null = null;
  private blueprintRefs: BlueprintRef[] = [];
  private lastGoto = { at: 0, offset: -1 };
  private destroyed = false;
  private disposers: Array<() => void> = [];
  private pendingReveal: { line: number; col?: number } | null = null;

  constructor(o: WorkbenchOptions) {
    this.o = o;
    this.plugin = o.plugin;
    this.layout = o.plugin.settings.layout;
    this.ratio = o.plugin.settings.splitRatio;
  }

  // ------------------------------------------------------------------ construction
  mount(): void {
    const el = this.o.el;
    el.empty();
    el.addClass("leanpane-view");
    this.rootEl = el.createDiv({ cls: "lp-root" });
    this.mainEl = this.rootEl.createDiv({ cls: "lp-main" });
    this.editorPane = this.mainEl.createDiv({ cls: "lp-editor-pane" });
    this.dividerEl = this.mainEl.createDiv({ cls: "lp-divider", attr: { "aria-label": "Drag to resize, double-click to reset" } });
    this.goals = new GoalsPane(this.mainEl);
    this.goals.el.addClass("lp-goals-pane");
    this.drawer = new MessagesDrawer(this.rootEl, {
      onSelect: (d) => this.wbRevealDiagnostic(d),
      onClose: () => this.setMessagesOpen(false),
      serverLog: () => this.session?.stderrTail(120) ?? [],
    });
    this.editor = new EditorView({ state: this.wbMakeState(""), parent: this.editorPane });
    this.wbSetupDivider();
    this.applySettings();
    this.wbApplyLayout();
    this.drawer.setOpen(this.plugin.settings.messagesOpen);

    this.resizeObs = new ResizeObserver(() => this.rootEl.toggleClass("is-narrow", this.rootEl.clientWidth > 0 && this.rootEl.clientWidth < 560));
    this.resizeObs.observe(this.rootEl);

    const ws = this.plugin.app.workspace;
    const ref = ws.on("css-change", () => this.infoview?.refreshTheme());
    this.disposers.push(() => ws.offref(ref));
    this.plugin.registerWorkbench(this);
    this.wbStartInfoview();
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
    this.infoview?.dispose();
    this.infoview = null;
    if (this.ratioTimer) window.clearTimeout(this.ratioTimer);
    if (this.goalTimer) window.clearTimeout(this.goalTimer);
    if (this.cursorTimer) window.clearTimeout(this.cursorTimer);
    this.resizeObs?.disconnect();
    for (const d of this.disposers.splice(0)) d();
    this.plugin.unregisterWorkbench(this);
    this.editor?.destroy();
    this.o.el.empty();
  }

  // ------------------------------------------------------------------ editor
  getEditor(): EditorView {
    return this.editor;
  }
  getText(): string {
    return this.editor.state.doc.toString();
  }

  private wbHost(): LeanEditorHost {
    return {
      request: async <T>(method: string, params: any, signal?: AbortSignal): Promise<T | null> => {
        const s = this.session;
        if (!s || s.currentPhase !== "running") return null;
        try {
          return await s.request<T>(method, params, signal);
        } catch {
          return null;
        }
      },
      uri: () => this.session?.uri ?? "",
      hoverEnabled: () => this.plugin.settings.showHover && this.session?.currentPhase === "running",
      renderMarkdown: (md, el) => {
        MarkdownRenderer.render(this.plugin.app, md, el, this.filePath ?? "", this.o.component).catch(() => el.setText(md));
      },
      gotoDefinition: (offset, newLeaf) => void this.gotoDefinition(offset, newLeaf),
      unicode: () => (this.plugin.settings.unicodeInput ? this.plugin.unicode() : null),
    };
  }

  private wbMakeState(doc: string): EditorState {
    const host = this.wbHost();
    const readOnly = this.o.readOnly;
    const keys = keymap.of([
      { key: "Mod-s", run: () => (this.o.onSaveKey?.(), true) },
      { key: "Mod-f", run: openSearchPanel, scope: "editor search-panel" },
      { key: "Mod-/", run: toggleLineComment },
    ]);
    const extensions: Extension[] = [
      leanMarkers(),
      lineNumbers(),
      diagnosticsGutter(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", '"'] } }]),
      indentUnit.of("  "),
      EditorState.tabSize.of(2),
      EditorState.readOnly.of(readOnly),
      search({ top: true, createPanel: createSearchPanel }),
      this.wrapComp.of(EditorView.lineWrapping),
      leanSyntax(),
      semanticTokensExtension(),
      lineFlashField,
      leanHover(host),
      leanCompletion(host),
      unicodeInput(() => host.unicode()),
      leanNavigation(host),
      keys,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
      EditorView.updateListener.of((u) => this.wbOnUpdate(u)),
    ];
    return EditorState.create({ doc, extensions });
  }

  private wbOnUpdate(u: ViewUpdate): void {
    if (u.docChanged) {
      const session = this.session;
      if (session) {
        // one LSP change list per transaction, in order
        for (const tr of u.transactions) if (tr.docChanged) session.edit(changesToLsp(tr.startState.doc, tr.changes), tr.state.doc.toString());
      }
      if (!u.transactions.some((t) => t.annotation(External))) this.o.onUserEdit?.();
    }
    if (u.selectionSet || u.docChanged) this.wbOnCursor();
  }

  /** Replace the document (file loaded or changed on disk). `clear`: a different file/state, history is reset. */
  setText(data: string, clear: boolean): void {
    if (!this.editor) return;
    if (clear) {
      this.editor.setState(this.wbMakeState(data));
      this.wbReapplyDecorations();
    } else if (data !== this.editor.state.doc.toString()) {
      const sel = this.editor.state.selection.main;
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: data },
        selection: { anchor: Math.min(sel.head, data.length) },
        annotations: [External.of(true), Transaction.addToHistory.of(false)],
      });
    }
    if (this.pendingReveal) {
      const r = this.pendingReveal;
      this.pendingReveal = null;
      this.revealLine(r.line, r.col);
    }
  }

  /** Move the cursor to a 1-based line/column, scroll it to the middle and flash the line. */
  revealLine(line: number, col?: number): void {
    if (!this.editor) return;
    const doc = this.editor.state.doc;
    if (doc.length === 0 && this.filePath) {
      this.pendingReveal = { line, col };
      return;
    }
    const n = Math.min(Math.max(1, line), doc.lines);
    const l = doc.line(n);
    const pos = Math.min(l.from + Math.max(0, (col ?? 1) - 1), l.to);
    this.editor.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    flashLine(this.editor, n);
    this.editor.focus();
  }
  /** Reveal a position whose file may not be loaded yet. */
  queueReveal(line: number, col?: number): void {
    this.pendingReveal = { line, col };
  }
  focusEditor(): void {
    this.editor?.focus();
  }

  insertAtCursor(text: string): void {
    const r = this.editor.state.selection.main;
    this.editor.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length }, userEvent: "input" });
    this.editor.focus();
  }

  applySettings(): void {
    const s = this.plugin.settings;
    const el = this.o.el;
    el.style.setProperty("--lp-font-size", `${s.fontSize}px`);
    el.toggleClass("lp-follow-theme", s.syntaxColours === "theme");
    if (!s.semanticTokens && this.editor) this.editor.dispatch({ effects: setSemanticDecorations.of(buildSemanticDecorations(this.editor.state.doc, [])) });
    else if (s.semanticTokens && this.session?.currentPhase === "running") void this.wbRefreshSemanticTokens();
  }

  private wbReapplyDecorations(): void {
    const snap = this.session?.snapshot();
    if (snap) this.wbApplySnapshotToEditor(snap, true);
  }

  // ------------------------------------------------------------------ session
  hasFile(): boolean {
    return this.filePath !== null;
  }
  currentFile(): string | null {
    return this.filePath;
  }
  getSession(): LeanSession | null {
    return this.session;
  }

  /** Start Lean for this file. Returns immediately after the session object exists; progress is reported through events. */
  attach(filePath: string, contextPath?: string): Promise<void> {
    this.detach();
    this.filePath = filePath;
    this.contextPath = contextPath ?? filePath;
    const session = this.plugin.createSession(filePath, (method, params) => this.infoview?.sentClientNotification(method, params));
    this.session = session;
    this.sessionOff.push(
      session.on((e) => {
        if (this.session !== session || this.destroyed) return;
        if (e === "phase") this.wbOnPhase();
        else if (e === "diagnostics") this.wbOnDiagnostics();
        else if (e === "progress") this.wbOnProgress();
        else if (e === "decls") this.wbOnDecls();
        else if (e === "running") this.wbOnRunning();
      }),
    );
    this.wbOnPhase();
    return session.open(this.contextPath, () => this.getText());
  }

  /** didClose and release the server. */
  detach(): void {
    const s = this.session;
    if (!s) return;
    for (const off of this.sessionOff.splice(0)) off();
    this.goalAbort?.abort();
    this.semAbort?.abort();
    if (this.lastEngineKey) this.plugin.statusEngine.setLive(this.lastEngineKey.root, this.lastEngineKey.file, null);
    this.lastEngineKey = null;
    s.close();
    this.session = null;
    this.filePath = null;
    if (this.editor) {
      this.editor.dispatch({ effects: [setProcessing.of([]), setSorryLines.of([])] });
      applyDiagnostics(this.editor, []);
    }
    this.drawer?.set([]);
    this.infoview?.serverStopped("file closed");
    this.lastDeclName = null;
    this.wbSetBlueprintRefs([]);
    this.o.onChanged?.();
  }

  save(): void {
    this.session?.save();
  }

  restartFile(): void {
    if (!this.session) return;
    this.session.restartFile(this.getText());
    new Notice("LeanPane: restarting the file.", 1500);
  }
  async restartServer(): Promise<void> {
    await this.session?.restartServer();
  }

  // ------------------------------------------------------------------ session events
  private wbOnPhase(): void {
    const snap = this.session?.snapshot();
    if (!snap) return;
    switch (snap.phase) {
      case "preparing":
        this.goals.showCard(GoalsPane.makeCard({ icon: "loader", title: snap.message.startsWith("Preparing") ? "Preparing Lean" : "Starting Lean", lines: [snap.message, "You can already edit; goals and errors appear when Lean is ready."] }));
        break;
      case "restarting":
        this.goals.showCard(GoalsPane.makeCard({ icon: "loader", title: snap.message || "Restarting Lean…" }));
        this.infoview?.serverStopped(snap.message);
        break;
      case "no-lean":
        this.goals.showCard(
          GoalsPane.makeCard({
            icon: "circle-alert",
            title: "Lean was not found",
            lines: [
              "LeanPane needs Lean installed through elan (lake and lean on your PATH or in ~/.elan/bin).",
              "Install elan from https://github.com/leanprover/elan, restart Obsidian if it was already installed (a GUI app may not see your shell PATH), or set the elan folder in Settings → LeanPane.",
            ],
            buttons: [{ text: "Re-check", cta: true, onClick: () => void this.wbRecheck() }],
          }),
        );
        break;
      case "untrusted":
        this.goals.showCard(
          GoalsPane.makeCard({
            icon: "shield-alert",
            title: "This Lean project is not trusted",
            lines: ["LeanPane did not start Lean because the project was not trusted."],
            buttons: [{ text: "Trust and start Lean", cta: true, onClick: () => void this.wbReattach() }],
          }),
        );
        break;
      case "failed":
        this.goals.showCard(
          GoalsPane.makeCard({
            icon: "circle-x",
            title: "Lean stopped",
            lines: [snap.error ?? "The Lean server keeps crashing."],
            pre: this.session?.stderrTail(15).join("\n") || undefined,
            buttons: [
              { text: "Restart Lean server", cta: true, onClick: () => void this.wbReattach(true) },
              { text: "Show server log", onClick: () => this.drawer.showServerLog() },
            ],
          }),
        );
        this.infoview?.serverStopped(snap.error);
        break;
      default:
        this.goals.showCard(null);
    }
    this.drawer.refreshServerLog();
    this.o.onChanged?.();
  }

  private async wbRecheck(): Promise<void> {
    await this.plugin.recheckElan();
    await this.wbReattach();
  }
  private async wbReattach(restartServer = false): Promise<void> {
    const file = this.filePath;
    if (!file) return;
    if (restartServer && this.session?.server) {
      await this.session.restartServer();
      return;
    }
    await this.attach(file, this.contextPath ?? file);
  }

  private wbOnDiagnostics(): void {
    const snap = this.session?.snapshot();
    if (!snap) return;
    this.wbApplySnapshotToEditor(snap, false);
    this.drawer.set(snap.diagnostics);
    this.wbUpdateCounts();
    this.o.onChanged?.();
  }

  private wbApplySnapshotToEditor(snap: SessionSnapshot, force: boolean): void {
    if (!this.editor) return;
    applyDiagnostics(this.editor, snap.diagnostics);
    this.editor.dispatch({ effects: [setSorryLines.of(snap.sorryLines), setProcessing.of(this.wbProcessingSpans(snap))] });
    void force;
  }

  private wbProcessingSpans(snap: SessionSnapshot): Array<{ from: number; to: number }> {
    return snap.processing.map((p) => {
      const to = p.range.end.character === 0 && p.range.end.line > p.range.start.line ? p.range.end.line - 1 : p.range.end.line;
      return { from: p.range.start.line, to };
    });
  }

  private wbOnProgress(): void {
    const snap = this.session?.snapshot();
    if (!snap) return;
    this.editor.dispatch({ effects: setProcessing.of(this.wbProcessingSpans(snap)) });
    if (snap.processing.length === 0) this.wbScheduleGoals(0);
    this.o.onChanged?.();
  }

  private wbOnDecls(): void {
    const snap = this.session?.snapshot();
    const s = this.session;
    if (!snap || !s) return;
    const root = snap.project?.root;
    if (root && this.filePath) {
      this.plugin.statusEngine.setLive(root, this.filePath, snap.decls);
      this.lastEngineKey = { root, file: this.filePath };
    }
    this.wbOnCursor();
    void this.wbRefreshSemanticTokens();
    this.o.onChanged?.();
  }

  private wbOnRunning(): void {
    const s = this.session;
    if (!s) return;
    const init = s.initializeResult();
    if (init) this.infoview?.serverRestarted(init);
    this.wbOnCursor();
    this.wbScheduleGoals(0);
    this.o.onChanged?.();
  }

  private wbUpdateCounts(): void {
    this.o.onChanged?.();
  }

  // ------------------------------------------------------------------ status
  status(): StatusLine {
    return statusLine(this.session?.snapshot() ?? null, !!this.session?.project);
  }
  snapshot(): SessionSnapshot | null {
    return this.session?.snapshot() ?? null;
  }
  messageCounts(): { error: number; warning: number; info: number } {
    return this.drawer?.counts() ?? { error: 0, warning: 0, info: 0 };
  }
  decls(): LiveDecl[] {
    return this.session?.snapshot().decls ?? [];
  }
  declAtCursor(): LiveDecl | null {
    const line = this.editor.state.doc.lineAt(this.editor.state.selection.main.head).number - 1;
    for (const d of this.decls()) if (d.range.start.line <= line && line <= d.range.end.line) return d;
    return null;
  }
  projectRoot(): string | null {
    return this.session?.project?.root ?? null;
  }

  // ------------------------------------------------------------------ cursor, goals, blueprint link
  private wbOnCursor(): void {
    if (this.cursorTimer) window.clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = null;
      if (this.destroyed || !this.session) return;
      const head = this.editor.state.selection.main.head;
      this.infoview?.setCursor(this.session.uri, offsetToPos(this.editor.state.doc, head));
      this.wbScheduleGoals(100);
      const d = this.declAtCursor();
      const name = d?.name ?? null;
      if (name !== this.lastDeclName) {
        this.lastDeclName = name;
        void this.wbUpdateBlueprintLink(name);
      }
    }, 60);
  }

  private wbScheduleGoals(ms: number): void {
    if (this.goalTimer) window.clearTimeout(this.goalTimer);
    this.goalTimer = window.setTimeout(() => {
      this.goalTimer = null;
      void this.wbRefreshPlainGoals();
    }, ms);
  }

  private async wbRefreshPlainGoals(): Promise<void> {
    const s = this.session;
    if (!s || this.destroyed) return;
    if (this.goals.getMode() === "interactive") return;
    if (s.currentPhase !== "running") {
      this.goals.showMessage("Goals appear here once Lean is running.");
      return;
    }
    this.goalAbort?.abort();
    const ac = new AbortController();
    this.goalAbort = ac;
    const pos: Position = offsetToPos(this.editor.state.doc, this.editor.state.selection.main.head);
    const params = { textDocument: { uri: s.uri }, position: pos };
    const ask = (method: string): Promise<any> => s.request(method, params, ac.signal).catch(() => null);
    const [g, t] = await Promise.all([ask("$/lean/plainGoal"), ask("$/lean/plainTermGoal")]);
    if (ac.signal.aborted || this.destroyed || this.session !== s) return;
    const goals: PlainGoal[] = parsePlainGoalResponse(g);
    const term = parsePlainTermGoal(t);
    this.goals.showPlain(goals, term);
  }

  private async wbUpdateBlueprintLink(name: string | null): Promise<void> {
    if (!name) return this.wbSetBlueprintRefs([]);
    const refs = await this.plugin.blueprintRefs(name);
    if (this.lastDeclName === name && !this.destroyed) this.wbSetBlueprintRefs(refs);
  }
  private wbSetBlueprintRefs(refs: BlueprintRef[]): void {
    this.blueprintRefs = refs;
    this.o.onBlueprintRefs?.(refs);
  }
  /** Re-evaluate the blueprint link (TeXPane appeared/disappeared or its blueprint changed). */
  refreshBlueprintLink(): void {
    void this.wbUpdateBlueprintLink(this.lastDeclName);
  }
  getBlueprintRefs(): BlueprintRef[] {
    return this.blueprintRefs;
  }
  async jumpToBlueprint(): Promise<void> {
    const refs = this.blueprintRefs;
    if (refs.length === 0) {
      new Notice("LeanPane: the blueprint does not mention this declaration.");
      return;
    }
    const api = this.plugin.texpaneApi();
    if (!api) return;
    if (refs.length === 1) {
      await api.openLocation(refs[0].file, refs[0].line);
      return;
    }
    const menu = new Menu();
    for (const r of refs) menu.addItem((i) => i.setTitle(`${r.label} (${r.file}:${r.line})`).setIcon("book-open").onClick(() => void api.openLocation(r.file, r.line)));
    const c = this.editor.coordsAtPos(this.editor.state.selection.main.head);
    menu.showAtPosition({ x: c?.left ?? 100, y: c?.bottom ?? 100 });
  }

  // ------------------------------------------------------------------ semantic tokens
  private async wbRefreshSemanticTokens(): Promise<void> {
    const s = this.session;
    if (!s || !this.plugin.settings.semanticTokens || s.currentPhase !== "running") return;
    const legend = (s.server?.initializeResult?.capabilities as { semanticTokensProvider?: { legend?: SemanticLegend } } | undefined)?.semanticTokensProvider?.legend;
    if (!legend) return;
    this.semAbort?.abort();
    const ac = new AbortController();
    this.semAbort = ac;
    s.flush();
    const doc0 = this.editor.state.doc;
    const v0 = s.version();
    try {
      const res = await s.request<{ data?: number[] } | null>("textDocument/semanticTokens/full", { textDocument: { uri: s.uri } }, ac.signal);
      if (ac.signal.aborted || this.destroyed || this.session !== s || this.editor.state.doc !== doc0 || s.version() !== v0 || !res?.data) return;
      this.editor.dispatch({ effects: setSemanticDecorations.of(buildSemanticDecorations(doc0, decodeSemanticTokens(res.data, legend))) });
    } catch {
      /* semantic tokens are optional */
    }
  }

  // ------------------------------------------------------------------ navigation
  /** Go to the definition of the identifier at `offset`. Guarded against the F12 key arriving through two routes. */
  async gotoDefinition(offset: number, newLeaf: boolean): Promise<void> {
    const now = Date.now();
    if (now - this.lastGoto.at < 200 && this.lastGoto.offset === offset) return;
    this.lastGoto = { at: now, offset };
    const s = this.session;
    if (!s || s.currentPhase !== "running") {
      new Notice("LeanPane: Lean is not running yet.");
      return;
    }
    let res: unknown;
    try {
      res = await s.request("textDocument/definition", { textDocument: { uri: s.uri }, position: offsetToPos(this.editor.state.doc, offset) });
    } catch (e) {
      new Notice(`LeanPane: go to definition failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const targets = definitionTargets(res);
    if (targets.length === 0) {
      new Notice("LeanPane: no definition found here.", 2500);
      return;
    }
    const t = targets[0];
    const path = uriToPath(t.uri);
    if (path && this.filePath && path === this.filePath) {
      const { from } = rangeToOffsets(this.editor.state.doc, t.range);
      this.editor.dispatch({ selection: EditorSelection.cursor(from), effects: EditorView.scrollIntoView(from, { y: "center" }) });
      flashLine(this.editor, t.range.start.line + 1);
      this.editor.focus();
      return;
    }
    await this.plugin.openLeanUri(t.uri, t.range.start, { newLeaf: true, context: this.contextPath ?? this.filePath ?? undefined, split: newLeaf });
  }

  private wbRevealDiagnostic(d: Diagnostic): void {
    const doc = this.editor.state.doc;
    const { from } = rangeToOffsets(doc, d.range);
    this.editor.dispatch({ selection: EditorSelection.cursor(from), effects: EditorView.scrollIntoView(from, { y: "center" }) });
    flashLine(this.editor, d.range.start.line + 1);
    this.editor.focus();
  }

  /** F8 / Shift+F8 */
  nextMessage(dir: 1 | -1): void {
    const snap = this.session?.snapshot();
    if (!snap || snap.diagnostics.length === 0) {
      new Notice("LeanPane: no messages.", 1500);
      return;
    }
    const pos = offsetToPos(this.editor.state.doc, this.editor.state.selection.main.head);
    const i = stepDiagnostic(snap.diagnostics, pos, dir);
    if (i >= 0) this.wbRevealDiagnostic(snap.diagnostics[i]);
  }

  // ------------------------------------------------------------------ infoview
  private wbEditorActions(): InfoviewEditorActions {
    return {
      insertText: async (_uri, text, kind, pos) => {
        const doc = this.editor.state.doc;
        const at = pos ? posToOffset(doc, pos) : this.editor.state.selection.main.head;
        if (kind === "above") {
          const line = doc.lineAt(at);
          const indent = /^\s*/.exec(line.text)?.[0] ?? "";
          this.editor.dispatch({ changes: { from: line.from, insert: `${indent}${text}\n` }, userEvent: "input" });
        } else {
          this.editor.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input" });
        }
      },
      applyEdit: async (edit) => {
        this.applyWorkspaceEdit(edit);
      },
      showDocument: async (uri, selection) => {
        const path = uriToPath(uri);
        if (path && path === this.filePath && selection) {
          const { from, to } = rangeToOffsets(this.editor.state.doc, selection);
          this.editor.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
          this.editor.focus();
          return;
        }
        await this.plugin.openLeanUri(uri, selection?.start, { newLeaf: true, context: this.contextPath ?? this.filePath ?? undefined });
      },
      restartFile: async () => this.restartFile(),
      copyToClipboard: async (text) => {
        await navigator.clipboard.writeText(text);
      },
    };
  }

  /** Apply the parts of an LSP WorkspaceEdit that concern this document. Returns whether anything was applied. */
  applyWorkspaceEdit(edit: unknown): boolean {
    const uri = this.session?.uri;
    if (!uri) return false;
    const e = edit as { changes?: Record<string, any[]>; documentChanges?: Array<{ textDocument?: { uri: string }; edits?: any[] }> } | null;
    const edits: any[] = [];
    for (const [u, list] of Object.entries(e?.changes ?? {})) if (u === uri || uriToPath(u) === this.filePath) edits.push(...list);
    for (const dc of e?.documentChanges ?? []) if (dc.textDocument && (dc.textDocument.uri === uri || uriToPath(dc.textDocument.uri) === this.filePath)) edits.push(...(dc.edits ?? []));
    if (edits.length === 0 || this.o.readOnly) return false;
    const doc = this.editor.state.doc;
    const changes = edits.map((te) => {
      const { from, to } = rangeToOffsets(doc, te.range);
      return { from, to, insert: String(te.newText ?? "") };
    });
    this.editor.dispatch({ changes, userEvent: "input" });
    return true;
  }

  private wbStartInfoview(): void {
    this.infoview = new InfoviewController({
      container: this.goals.infoviewEl,
      getServer: () => this.session?.server ?? null,
      editor: this.wbEditorActions(),
      onMode: (mode) => {
        this.goals.setMode(mode);
        if (mode === "plain") this.wbScheduleGoals(0);
      },
      log: (m) => this.plugin.log(m),
      seed: () => {
        const s = this.session;
        if (!s) return [];
        const snap = s.snapshot();
        return [
          { method: "textDocument/publishDiagnostics", params: { uri: s.uri, version: s.version(), diagnostics: snap.diagnostics } },
          { method: "$/lean/fileProgress", params: { textDocument: { uri: s.uri, version: s.version() }, processing: snap.processing } },
        ];
      },
    });
    this.goals.setMode("plain");
    if (this.plugin.settings.goalView === "interactive" && !this.o.readOnly) void this.infoview.start();
  }

  // ------------------------------------------------------------------ layout
  getLayout(): LayoutMode {
    return this.layout;
  }
  setLayout(l: LayoutMode): void {
    this.layout = l;
    this.plugin.settings.layout = l;
    void this.plugin.saveSettings();
    this.wbApplyLayout();
  }
  cycleLayout(): void {
    const order: LayoutMode[] = ["split", "editor", "goals"];
    this.setLayout(order[(order.indexOf(this.layout) + 1) % order.length]);
  }
  toggleGoals(): void {
    this.setLayout(this.layout === "split" ? "editor" : "split");
  }
  toggleMessages(): void {
    this.setMessagesOpen(!this.drawer.isOpen());
  }
  setMessagesOpen(open: boolean): void {
    this.drawer.setOpen(open);
    this.plugin.settings.messagesOpen = open;
    void this.plugin.saveSettings();
    this.o.onChanged?.();
  }
  showServerLog(): void {
    this.drawer.showServerLog();
    this.plugin.settings.messagesOpen = true;
    this.o.onChanged?.();
  }
  isMessagesOpen(): boolean {
    return this.drawer.isOpen();
  }

  layoutMenu(e: MouseEvent): void {
    const m = new Menu();
    for (const id of ["split", "editor", "goals"] as LayoutMode[]) {
      m.addItem((i) => i.setTitle(LAYOUT_LABELS[id]).setIcon(LAYOUT_ICONS[id]).setChecked(this.layout === id).onClick(() => this.setLayout(id)));
    }
    m.showAtMouseEvent(e);
  }

  private wbApplyLayout(): void {
    for (const l of ["split", "editor", "goals"]) this.rootEl.toggleClass(`layout-${l}`, l === this.layout);
    this.wbApplyRatio();
  }
  private wbApplyRatio(): void {
    this.editorPane.style.flex = `${this.ratio} 1 0`;
    this.goals.el.style.flex = `${1 - this.ratio} 1 0`;
  }

  private wbSetupDivider(): void {
    const d = this.dividerEl;
    d.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      d.addClass("is-dragging");
      const move = (ev: PointerEvent): void => {
        const rect = this.mainEl.getBoundingClientRect();
        const vertical = this.rootEl.hasClass("is-narrow");
        const raw = vertical ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width;
        this.ratio = Math.min(0.85, Math.max(0.15, raw));
        this.wbApplyRatio();
      };
      const up = (): void => {
        d.removeClass("is-dragging");
        d.removeEventListener("pointermove", move);
        d.removeEventListener("pointerup", up);
        d.removeEventListener("pointercancel", up);
        this.wbSaveRatio();
      };
      d.addEventListener("pointermove", move);
      d.addEventListener("pointerup", up);
      d.addEventListener("pointercancel", up);
    });
    d.addEventListener("dblclick", () => {
      this.ratio = 0.55;
      this.wbApplyRatio();
      this.wbSaveRatio();
    });
  }
  private wbSaveRatio(): void {
    this.plugin.settings.splitRatio = this.ratio;
    if (this.ratioTimer) window.clearTimeout(this.ratioTimer);
    this.ratioTimer = window.setTimeout(() => void this.plugin.saveSettings(), 400);
  }

  /** Small helper for the view: header button state. */
  static decorateMessagesButton(btn: HTMLElement | undefined, counts: { error: number; warning: number }): void {
    if (!btn) return;
    btn.setAttr("data-count", String(counts.error + counts.warning));
    btn.toggleClass("has-errors", counts.error > 0);
    btn.toggleClass("has-warnings", counts.error === 0 && counts.warning > 0);
    btn.setAttr("aria-label", `Messages: ${counts.error} errors, ${counts.warning} warnings`);
  }
}
