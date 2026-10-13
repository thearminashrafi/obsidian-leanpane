# LeanPane + TeXPane integration — build spec

This is the authoritative build spec. It condenses the approved plan ("LeanPane — Lean 4 in Obsidian: Plan", 13 Oct 2026). Where anything is unclear, prefer: native Obsidian look, works without Mathlib, nothing breaks when only one plugin is installed.

## 1. Decisions (fixed)

| Topic | Decision |
| --- | --- |
| Product | **LeanPane**: a separate Obsidian desktop plugin that edits `.lean` files with live goals and errors from the user's installed Lean (elan + lake). Plugin id `leanpane`, name `LeanPane`, author `Armin Ashrafi`, MIT, `isDesktopOnly: true`, `minAppVersion: "1.8.0"`, version `0.1.0`. |
| Natural-language proofs | LaTeX in **TeXPane** (existing plugin), written blueprint-style: `\lean{A.b, C}`, `\leanok`, `\uses{lbl1, lbl2}`, `\mathlibok`, `\notready`, `\proves{lbl}`, `\discussion{n}` — compatible with leanblueprint. |
| Coupling | Each plugin exposes a small versioned API (section 6). TeXPane never starts Lean. Each plugin works fully alone; integration features appear when both are enabled, and disappear cleanly when one is disabled. "Seamless" = no configuration needed: TeXPane finds the Lean project by walking up from the .tex file to the nearest `lakefile.toml`/`lakefile.lean` (override: `% !LEAN project = <relative path>` magic comment in the root .tex). |
| Source of truth for progress | Lean, not hand-typed `\leanok`. |
| Mathlib | Optional everywhere. Everything must work in a project without Mathlib. |
| Goal view | Interactive (official `@leanprover/infoview`, as in VS Code) in the first release, isolated in an iframe; plain-text goals (`$/lean/plainGoal`) are the fallback and the first thing built. |
| Look | Native Obsidian: theme CSS variables only (no hard-coded colours except a clearly delimited syntax-token block, as TeXPane does), Lucide icons via `setIcon`, `addAction` header buttons, `Setting` API, `Menu`, `Modal`/`FuzzySuggestModal`, `Notice`. Reuse TeXPane's patterns and styling conventions (read its source). |
| Platform | macOS (Apple Silicon) first; OS-agnostic code (Node `path`, no hard-coded separators, process-tree kill per OS, `Mod` in hotkeys). |
| Repo | `thearminashrafi/obsidian-leanpane` (public). TeXPane repo `thearminashrafi/obsidian-texpane` already exists. |

## 2. Environment for the build agents

- LeanPane repo: `/home/claude/leanpane-build/obsidian-leanpane` (create; `git init -b main`; set `user.name "Armin Ashrafi"`, `user.email "239044281+thearminashrafi@users.noreply.github.com"`).
- TeXPane repo: `/home/claude/texpane-build/texpane` (branch `main`, remote `origin` set). Do NOT push either repo; the orchestrator pushes. Commit with messages ending in exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012vqixTM8az4ZrffUiJo1fs
  ```
- Lean is installed for tests: `export PATH=$HOME/.elan/bin:$PATH`; toolchain `v4.25.1` (also linked as `leanprover/lean4:v4.25.1`), `lake new <name>` works offline and `lake serve` works. Lean's own download host (release.lean-lang.org) is BLOCKED here, so never let a test depend on downloading a toolchain; fixture projects must use `lean-toolchain` = `leanprover/lean4:v4.25.1`. GitHub and the npm registry are reachable. Mathlib cache download is probably not possible here: Mathlib tests must be skipped automatically when unavailable.
- No Obsidian here. Compile against the `obsidian` npm typings; unit/integration-test everything in `src/core/` (which must never import `obsidian`). A vitest alias may stub `obsidian` for editor-level tests (TeXPane already does this in `test/stubs/obsidian.ts`).
- Node 22, npm OK. Keep bundles reasonable; report `main.js` size.

## 3. LeanPane features (first release)

### Workspace view (`.lean` files)
- One tab per file, laid out like TeXPane: CodeMirror 6 editor (left; use Obsidian's own `@codemirror/*` instances — externals as in TeXPane's esbuild config) | goals pane (right) | messages drawer (bottom). Draggable divider, layout modes split / editor / goals, remembered.
- Editor: Lean highlighting (StreamLanguage fallback tokenizer + LSP semantic tokens as decorations), line numbers, bracket matching, active line, error/warning/info squiggles from diagnostics, gutter progress bar for `$/lean/fileProgress` ranges, orange marker on lines containing `sorry` warnings, Unicode abbreviation input (`\to` + space/Tab → `→`; table from the Lean maintainers' npm package — verify its exact name, e.g. `@leanprover/unicode-input`, and bundle its abbreviation table), hover (types/docs from `textDocument/hover`), Mod+click / F12 go to definition (open target in LeanPane; files outside the vault, e.g. toolchain or package sources, open read-only in a LeanPane view), completion from the server.
- Goals pane: interactive infoview (iframe) with fallback to plain goals + expected type. Plain goals must be correct and readable (hypotheses, `⊢` goal, one block per goal) using Obsidian fonts/colours.
- Messages drawer: errors, warnings, info (`#check`/`#eval` output), click to jump; F8 / Shift+F8 next/previous; same look as TeXPane's log drawer.
- Header actions: Restart file, Layout, Toggle messages, Blueprint link (visible when TeXPane references the declaration at the cursor). More-options menu: Restart Lean server, Build project, Fetch Mathlib cache (Mathlib projects only).
- Status bar: Starting… / Checking 42% / Ready / Error · Lean version · number of `sorry`s in file.
- Outline view (sidebar `ItemView`): declarations in the file from `documentSymbol`, with status icons (proved / sorry / error) and a mark for declarations the blueprint doesn't mention (when TeXPane present).
- Commands (all rebindable; default hotkeys only where they don't collide with Obsidian defaults): Restart file, Restart Lean server, Build project, Fetch Mathlib cache, New Lean project, New Lean file, Toggle goals pane (Mod+Alt+G), Toggle messages (Mod+Alt+L), Jump to blueprint (Mod+Alt+B), Go to definition (F12), Next/previous message (F8/Shift+F8), Add to blueprint.
- File explorer context menu: New Lean file, New Lean project.

### Server management
- One `lake serve` per Lean project (root = nearest folder upward containing `lakefile.toml` or `lakefile.lean`). A `.lean` file outside any project: run `lean --server` with the default toolchain; status bar says "no project".
- Spawn with `shell:false`, cwd = project root, PATH prepended with elan bin dir (settings override → `~/.elan/bin` → PATH; Windows `%USERPROFILE%\.elan\bin`), discovered at startup and via a Re-check button in settings showing `elan --version`, `lake --version` and installed toolchains.
- JSON-RPC over stdio with `vscode-jsonrpc` (node build). Incremental `didChange` with ~300 ms debounce, versions tracked; `didOpen`/`didClose` with the view lifecycle; cancel stale goal requests when the cursor moves.
- Crash restart with backoff 1 s / 5 s / 30 s; after 3 crashes show an error card with the last stderr lines. Idle shutdown after N minutes with no open file (setting, default 10). Kill the process tree on plugin unload and when Obsidian quits (TeXPane's `killTree` approach: detached process group on POSIX, `taskkill /T /F` on Windows).
- Trust prompt: first time LeanPane would start a server for a project, a modal asks "Trust this Lean project?" (lakefiles and Lean files can run code). Remembered per project path in settings.
- Elan downloading a missing toolchain on first start: show "Preparing Lean (may download version X)…" rather than looking frozen; parse `lean-toolchain`.

### Interactive goal view (milestone L3)
- Use `@leanprover/infoview` from npm (verify the current version and its `dist/` contents: it ships ES module builds and a loader; React/ReactDOM come from its own dist or from npm — check). Host it in an `<iframe srcdoc>` inside the goals pane so its React and CSS never touch Obsidian's. Make the infoview code available without network: inline the required dist files into `main.js` as strings at build time and expose them inside the iframe via Blob URLs + an import map (es-module-shims if needed), or another self-contained approach that works inside Obsidian's Electron renderer offline.
- Implement the host side of `EditorApi` (from `@leanprover/infoview-api`): `sendClientRequest`, `sendClientNotification`, `subscribeServerNotifications`/`unsubscribe…` (ref-counted), `subscribeClientNotifications`/`unsubscribe…`, `copyToClipboard`, `insertText`, `applyEdit`, `showDocument`, `restartFile`, `createRpcSession` (`$/lean/rpc/connect`, keep-alive `$/lean/rpc/keepAlive` every ~10 s), `closeRpcSession`, `saveConfig`. Drive `InfoviewApi`: `initialize`, `serverRestarted`, `serverStopped`, `changedCursorLocation`, `gotServerNotification`, `sentClientNotification`, `changedInfoviewConfig`. Bridge via `postMessage` with origin checks. Reference hosts to read: `leanprover/vscode-lean4` (`vscode-lean4/src/infoview.ts`, `lean4-infoview/src/loader.ts`) and `leanprover-community/lean4web` (non-VS Code host).
- Map infoview CSS variables (it expects VS Code theme variables like `--vscode-editor-background`) to Obsidian variables, re-applied on theme change.
- Fallback: if loading fails or the setting says Plain, show plain goals. Never break editing.

### New Lean project
- Modal: name, add Mathlib (off), add blueprint (on). Without Mathlib: `lake new <name>` in the chosen vault folder. With Mathlib: `lake +leanprover-community/mathlib4:lean-toolchain new <name> math`, then `lake exe cache get`, live output in a cancellable progress modal. Blueprint: `blueprint/src/` with `content.tex`, `print.tex` (compilable by TeXPane with pdfLaTeX: defines blueprint macros as no-ops via `macros/print.tex`), `web.tex`, `macros/common.tex`, `macros/print.tex`, `macros/web.tex`, plus a starter lemma linked to a starter Lean theorem with `sorry`. Then open the main `.lean` file and `content.tex` side by side.
- New Lean file: `Untitled.lean` with a module docstring, in the current folder.

### Declaration status engine (L5)
States: `missing | error | stated | proved-with-sorry-deps | proved | mathlib | unknown`.
1. **Live** (open files): diagnostics + `documentSymbol` ranges → per-declaration state (error diagnostic inside → `error`; "declaration uses 'sorry'" warning → `stated`).
2. **Whole project** (after `lake build`, or on demand): generate a temporary Lean file in the OS temp dir that imports the project's modules and, for a list of names, prints one JSON line per name: exists, module, file, line (via declaration ranges), kind, pretty-printed type (`ppExpr` of the type, truncated), whether its own value contains `sorryAx`, whether `sorryAx` is among `collectAxioms` (transitive). Run with `lake env lean <tmpfile>` from the project root, parse stdout. Map: not found → `missing`; own sorry → `stated`; transitive sorry only → `proved-with-sorry-deps`; module under `Mathlib.` → `mathlib`; else `proved`. Must compile against Lean 4.25.1 (test it here) and avoid fragile internals.
3. Combine (live wins for open files), cache per project, emit status-changed events. Refresh: after Build project, after saving a `.lean` file (debounced; only live part unless a build is requested), on demand from TeXPane.

## 4. TeXPane changes (repo `/home/claude/texpane-build/texpane`, bump to 0.2.0)

- `src/core/blueprint.ts` (pure, tested): parse a project's `.tex` files (root + `\input`/`\include` files via the existing indexers) into nodes: `{label, env (theorem|lemma|proposition|corollary|definition|…), title?, file, line, endLine, lean: string[], leanok: boolean, mathlibok, notready, uses: string[] (statement), proofUses: string[], proofLeanok: boolean}`; the following `\begin{proof}` attaches to the previous statement (or `\proves{label}`). Robust to comments, multi-line macro args, multiple names in `\lean{a, b}`.
- Blueprint macro fallbacks: when the document doesn't define them, the shadow build provides `\providecommand` no-op definitions for `\lean`, `\leanok`, `\uses`, `\mathlibok`, `\notready`, `\proves`, `\discussion` (same mechanism as the `\obsidian` support macros: on the `\documentclass` line, line numbers unchanged). Test with a real pdflatex compile.
- When LeanPane is present (feature-detected via its API, re-checked when plugins load/unload):
  - `\lean{Name}` chips (like `\obsidian{}` chips) coloured by status using leanblueprint semantics mapped to Obsidian colour variables; hover shows status + Lean type signature; Mod+click opens the declaration in LeanPane. Without LeanPane: chips show neutral style, hover says LeanPane isn't installed.
  - Completion inside `\lean{` from `listDeclarations`.
  - Mismatch diagnostics in the log drawer + editor: `\leanok` but Lean says not proved; proved but no `\leanok`; `\lean{X}` missing in Lean. Each with a quick fix (add/remove `\leanok`). Setting "Sync \leanok automatically" (off).
  - Progress panel (`ItemView`, command "Open blueprint progress"): dependency graph from `\uses` (statement + proof uses) laid out left→right by layers (bundle `@dagrejs/dagre` or a small layered layout you write), nodes coloured by status, legend, totals ("18 of 31 proved"), filters (all / ready to prove = all deps proved & own proof not proved / blocked / not formalized), click → jump to LaTeX, double-click → open Lean. List view fallback for narrow panes. Native colours only.
  - "Formalize this" command: cursor in a theorem-like env → pick/create a `.lean` file in the project → LeanPane creates `theorem <name> : sorry := by sorry` (name from label, e.g. `lem:bound` → `lem_bound`, user can edit in a prompt) with the LaTeX statement as a `/-- … -/` docstring; TeXPane inserts `\lean{<name>}` after `\label`.
- TeXPane exposes its API (section 6). Add `.github/release-notes.md` for 0.2.0, update `manifest.json`/`versions.json`/`package.json` version to 0.2.0, README section "Lean integration (with LeanPane)".
- Don't regress anything: all existing TeXPane tests must pass.

## 5. LeanPane in LeanPane-only mode
Everything in section 3 works with TeXPane absent; blueprint-related UI hidden.

## 6. Cross-plugin API (versioned; the only coupling)

Access: `(app as any).plugins?.plugins?.["leanpane"]?.api` and `…["texpane"]?.api`. Never cache the plugin object across plugin enable/disable; look it up through a getter each time, and listen to a workspace event for readiness: each plugin calls `app.workspace.trigger("leanpane:api-ready")` / `"texpane:api-ready"` on load (after layout ready) and `"…:api-unload"` on unload. Put the shared TypeScript interface in a file copied verbatim into both repos (`src/integration/api-types.ts`), with `API_VERSION = 1`; consumers check `api.version === 1` (accept same major only).

LeanPane API v1:
```ts
interface LeanPaneApiV1 {
  version: 1;
  projectForPath(vaultPath: string): Promise<LeanProjectInfo | null>; // walks up to lakefile
  getStatus(projectRoot: string, names: string[], opts?: { refresh?: boolean }): Promise<Record<string, DeclStatus>>;
  listDeclarations(projectRoot: string, prefix?: string): Promise<DeclSummary[]>;
  openDeclaration(projectRoot: string, name: string, opts?: { newLeaf?: boolean }): Promise<boolean>;
  createStub(projectRoot: string, req: { file: string; name: string; docstring: string }): Promise<{ file: string; line: number }>;
  onStatusChanged(cb: (projectRoot: string, names: string[] | "all") => void): () => void;
}
interface LeanProjectInfo { root: string /* vault-relative */; absRoot: string; toolchain: string; usesMathlib: boolean; }
type DeclState = "missing" | "error" | "stated" | "proved-with-sorry-deps" | "proved" | "mathlib" | "unknown";
interface DeclStatus { name: string; state: DeclState; file?: string; line?: number; kind?: string; signature?: string; source: "live" | "build" | "none"; updatedAt: number; }
interface DeclSummary { name: string; kind: string; file: string; line: number; }
```
TeXPane API v1:
```ts
interface TeXPaneApiV1 {
  version: 1;
  blueprintRefs(leanName: string): Promise<BlueprintRef[]>; // across open/known blueprint projects
  openLocation(file: string, line: number): Promise<void>;
  addBlueprintEntry(req: { texFile: string; env: string; label: string; leanName: string; statement: string }): Promise<{ file: string; line: number }>;
  onBlueprintChanged(cb: () => void): () => void;
}
interface BlueprintRef { file: string; line: number; label: string; env: string; title?: string; leanok: boolean; }
```

## 7. Milestones and gates
L0 server plumbing → L1 editor → L2 plain goals & navigation → L3 interactive infoview → L4 projects → L5 status engine & API → L6 TeXPane integration → L7 progress panel. Gates per milestone: `npx tsc --noEmit` clean, `npm run build` clean, `npx vitest run` green, colour lint (copy TeXPane's `lint:colors` approach). Real-Lean integration tests (fixtures under `test/fixtures/lean/` built with lake here): server initialize, open file → diagnostics incl. sorry warning, plainGoal at a tactic position, documentSymbol, status query over 5 names (missing, error, stated, proved-with-sorry-deps, proved), process cleanup. TeXPane: blueprint parser unit tests, macro-fallback compile test, integration-module tests with a fake LeanPane API.

## 8. Deliverables
- LeanPane repo: source, tests, fixtures, `README.md` (what, install, requirements: elan; usage; TeXPane integration; settings; troubleshooting incl. macOS PATH; known limitations), `LICENSE` (MIT, Copyright (c) 2026 Armin Ashrafi), `.github/workflows/release.yml` + `.github/release-notes.md` (copy TeXPane's workflow: publishes a release when the manifest version has no release yet; assets main.js, manifest.json, styles.css — plus any extra asset the plugin needs at runtime, but prefer a self-contained main.js), `scripts/add-leanpane.sh` (copy of TeXPane's `scripts/add-texpane.sh` adapted to id `leanpane`), `docs/MANUAL_TEST.md` (macOS checklist per milestone), `versions.json`, `.gitignore` (node_modules, main.js, release/, *.map, data.json).
- TeXPane repo: changes from section 4, version 0.2.0, tests, README, release notes.
- Both: `release/` with the three files from the final build.
