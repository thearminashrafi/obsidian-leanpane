# Interactive goal view — findings and plan (milestone L3)

Verified on 13 Oct 2026 against `@leanprover/infoview@0.13.0` / `@leanprover/infoview-api@0.13.0` (both Apache-2.0),
Lean 4.25.1, and a headless Chromium 141 (Electron in current Obsidian ships a comparable Chromium).

## What the npm package contains (`node_modules/@leanprover/infoview/dist/`)

| File | Size | Role |
| --- | --- | --- |
| `index.production.min.js` | 2,392,788 B (≈ 770 KB gzip) | The infoview React app, an **ES module** with bare imports `react`, `react-dom`, `react/jsx-runtime`. Exports `renderInfoview` and the widget API. |
| `react.production.min.js`, `react-dom.production.min.js`, `react-jsx-runtime.production.min.js` | 8 KB / 134 KB / 1 KB | React 18 as ES modules (so user widgets can `import` them). |
| `loader.production.min.js` | 42 KB | Bundles **es-module-shims** (shim mode) and exports `loadRenderInfoview(imports, [editorApi, rootDiv], next)`; it calls `importShim.addImportMap({imports})` then `importShim("@leanprover/infoview")`. `@leanprover/infoview/loader` is *bundleable*; `@leanprover/infoview` itself must **not** be bundled (the import map / dynamic `import` must stay, because Lean user widgets import it at run time). |
| `index.css` | 158 KB | All styles. Uses VS Code theme variables (see below). References `./codicon.ttf` via `url()`. |
| `codicon.ttf` | 90 KB | Icon font used by the CSS. |
| `*.d.ts`, `infoview/*.d.ts`, `esm-shims/*.d.ts` | small | Types. |

`package.json` `exports` only exposes `.`, `./loader` and `./package.json`; deep paths (`dist/index.css`) are not importable, so the esbuild plugin resolves `dist/` through `require.resolve("@leanprover/infoview/package.json")`.
`@leanprover/infoview-api` (types + the `EditorApi`/`InfoviewApi` interfaces + RPC types) is types-only for us.
The Lean unicode table is `@leanprover/unicode-input@0.1.12` (`dist/abbreviations.json`, 1857 entries) — pure `AbbreviationProvider` class; the package root also imports `vscode`, so only `dist/AbbreviationProvider` is imported.

## Hosting plan (offline, no network)

Implemented in `esbuild.config.mjs` (virtual module `virtual:infoview-assets`) and `src/infoview/*`:

1. **Build time** — esbuild inlines into `main.js` as strings: `infoviewJs`, `reactJs`, `reactDomJs`, `jsxRuntimeJs`, `css` (with `codicon.ttf` turned into a `data:font/ttf;base64,` URI) and `webviewJs` = our own iframe bootstrap (`src/infoview/webview.ts`, bundled as an IIFE; it bundles `@leanprover/infoview/loader` and `rpc.ts`). `main.js` grows from ~100 KB to **≈ 2.8 MB**. No extra release assets are needed (self-contained `main.js`).
2. **Run time** — the goals pane creates `<iframe sandbox="allow-scripts" srcdoc="…">`. `srcdoc` contains only a tiny HTML shell with `<div id="react_root">` and the `webviewJs` script. **No `allow-same-origin`**: the iframe gets an opaque origin, so code running there (including Lean *user widgets* loaded from the project, which is arbitrary JS) cannot touch Obsidian's DOM, `require`, or the vault.
3. The parent then `postMessage`s the module sources (`{type:"init", assets, themeCss}`) to the iframe (~2.6 MB structured clone, fine). Inside, `webview.ts` turns each module into a **Blob URL** (`URL.createObjectURL(new Blob([src],{type:"text/javascript"}))`), builds the import map `{ "@leanprover/infoview", "react", "react/jsx-runtime", "react-dom" } → blob URLs`, injects the CSS in a `<style>`, and calls `loadRenderInfoview(imports, [editorApi, div], cb)`.
4. **Messaging** — the protocol of `vscode-lean4` is reused unchanged (`src/infoview/rpc.ts`, copied from `vscode-lean4/src/rpc.ts`): a small `Rpc` class over `postMessage` with `{kind:"initialize"/"initialized"}` handshake and `{seqNum,name,args}` calls. The iframe exposes `InfoviewApi` (`initialize`, `serverRestarted`, `serverStopped`, `changedCursorLocation`, `gotServerNotification`, `sentClientNotification`, `changedInfoviewConfig`, `requestedAction`, `clickedContextMenu`, …); the host (`src/view/…`, lead-owned) exposes `EditorApi` as `EditorRpcApi` (requests are split into `startClientRequest`/`awaitClientRequest`/`cancelClientRequest` so they are serialisable; `editorApiOfRpc` rebuilds the real `EditorApi` in the iframe). **Origin check:** with an opaque origin `event.origin` is `"null"`, so the host accepts only messages whose `event.source === iframe.contentWindow` (and the iframe only those whose `source === parent`); host→iframe posts use target origin `"*"`.
5. **Theming** — the infoview CSS reads `--vscode-*` variables. Used ones (grep of `index.css` and the bundle): `--vscode-editor-background/foreground/font-family/font-size/font-weight/line-height`, `--vscode-font-family/size/weight`, `--vscode-foreground`, `--vscode-editorHoverWidget-background/foreground/border`, `--vscode-editorWidget-border`, `--vscode-editor-selectionBackground`, `--vscode-editor-findMatchBackground`, `--vscode-diffEditor-insertedTextBackground/Border`, `--vscode-diffEditor-removedTextBackground/Border`, `--vscode-textCodeBlock-background`, `--vscode-dropdown-*`, `--vscode-button-*`, `--vscode-badge-*`, `--vscode-errorForeground`, `--vscode-focusBorder`, `--vscode-icon-foreground`, `--vscode-disabledForeground`, `--vscode-widget-shadow`, `--vscode-editorGroup-border`, `--vscode-editor-inlineValuesForeground`, `--vscode-lean4-infoView*`. The host reads the *computed* Obsidian values (`--background-primary`, `--text-normal`, `--font-monospace`, `--background-modifier-border`, `--text-error`, …) with `getComputedStyle(document.body)` and posts a `:root{--vscode-…: value}` stylesheet to the iframe on load and on `css-change` (theme switch). Colours are resolved to concrete values because CSS variables do not cross the iframe boundary.
6. **Fallback** — if the iframe bootstrap fails (no `ready` message within a few seconds, `error` message, or the setting is "Plain"), the goals pane shows the plain-goal view (`$/lean/plainGoal`, `src/core/goals.ts`). Editing never depends on the infoview.

## Spike result (done in this stage)

`docs/spikes/infoview-iframe-{entry.ts,run.mjs}.txt`: a sandboxed `srcdoc` iframe (**with and without** `allow-same-origin`), Blob-URL import map, bundled loader, stub `EditorApi`. Result in Chromium 141: the infoview loads offline, renders, and immediately calls `createRpcSession`, `subscribe*Notifications` and `sendClientRequest` on the host — i.e. the architecture works. One gotcha found: `serverRestarted` must receive an `InitializeResult` whose `serverInfo.version` parses as a Lean version (`"4.25.1"`), otherwise the infoview throws "cannot parse Lean server version". Lean's real `initialize` result satisfies this.

## Host-side work (stage 3)

- `EditorApi` implementation over the project's `LeanServer`: `sendClientRequest` (+ cancellation), `sendClientNotification`, ref-counted `subscribeServerNotifications`/`subscribeClientNotifications` (forwarded to the iframe with `gotServerNotification`/`sentClientNotification`), `copyToClipboard`, `insertText`, `applyEdit`, `showDocument`, `restartFile`, `createRpcSession` (`$/lean/rpc/connect`; keep-alive `$/lean/rpc/keepAlive` every ~10 s; `closeRpcSession`), `saveConfig`.
- Drive `InfoviewApi`: `initialize(location)` once, `serverRestarted(initializeResult)` after each (re)start, `serverStopped(reason)`, `changedCursorLocation` on every selection change, `changedInfoviewConfig`, plus replay of the current diagnostics (`gotServerNotification("textDocument/publishDiagnostics")`) and `$/lean/fileProgress` when the iframe (re)loads.
- Reference hosts: `vscode-lean4/vscode-lean4/src/infoview.ts` + `webview/index.ts`, `lean4web` (`client/src/Infoview.tsx`-style non-VS Code host) — cloned under `/home/claude/leanpane-build/ref/`.

## Risks

- **Bundle size** 2.8 MB `main.js` (parse cost once at plugin load; acceptable, could be lazy-loaded from a second file later). Not a blocker.
- **Obsidian's Electron version** is not testable here; the spike used Chromium 141. Blob-URL module loading, `srcdoc` and sandbox attributes are long-standing features; the only exotic piece is es-module-shims shim mode (works in the spike).
- **Lean user widgets** (Mathlib/ProofWidgets) fetch JS through RPC and `import()` it inside the iframe via `importShim` + blob URLs created inside the iframe — works the same way as in the spike; not exercised without Mathlib.
- **Licences**: infoview (Apache-2.0) is bundled into `main.js` → ship a `THIRD_PARTY_NOTICES.md` and mention it in the README (stage 3).
