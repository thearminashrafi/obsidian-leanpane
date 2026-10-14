# Manual test checklist (macOS, Obsidian desktop)

Everything that touches the Obsidian UI cannot be tested headlessly. Run this list on macOS before a release, with Lean installed
through elan (`~/.elan/bin`). Use a throw-away vault. Tick each box; note the Obsidian and Lean versions at the top.

Obsidian version: ____  Lean toolchain: ____  macOS: ____

## L0 Server plumbing
- [ ] Install with `scripts/add-leanpane.sh <vault>`, enable LeanPane; no errors in the developer console.
- [ ] Open a `.lean` file in a Lake project: the trust prompt appears; Decline shows "not trusted" in the status bar and the file stays editable.
- [ ] Trust the project: status bar goes Preparing, Running, then "Ready · Lean x.y.z".
- [ ] Status bar item click opens a menu (restart file, restart server, build, open messages).
- [ ] Command "Restart Lean server" brings the server back; goals and errors return.
- [ ] Quit Obsidian (Cmd+Q) while a server runs: `pgrep -fl "lake serve|lean --server"` shows nothing afterwards.
- [ ] Leave a file idle past the idle-shutdown setting: the server stops; re-focusing starts it again.
- [ ] Launch Obsidian from the Dock (not a terminal) with elan only in `~/.elan/bin`: Lean is found. Rename `~/.elan` temporarily: the "Lean not found" state shows install help.

## L1 Editor
- [ ] Type an error: red squiggle, gutter marker, message in the drawer within about a second.
- [ ] Elaboration progress bar in the gutter while a long file is processed.
- [ ] `sorry` shows a gutter marker and a tinted line; the status bar counts sorries.
- [ ] Syntax colours follow light and dark themes; the "Colours" setting switches to theme colours.
- [ ] Unicode: `\alpha` then space gives the symbol; `\\` gives a backslash; Tab commits the first match; the leader key can be changed.
- [ ] Semantic tokens recolour identifiers after elaboration; turning the setting off removes them.
- [ ] Search panel (Cmd+F) works and matches the TeXPane look.

## L2 Goals, hover, navigation, outline
- [ ] Cursor inside a tactic block: plain goals show; hypotheses and the turnstile line are formatted.
- [ ] Hover over an identifier shows its type and docstring; the setting turns hover off.
- [ ] F12 and Cmd+click go to the definition (in the same project, in the vault, and outside the vault read-only).
- [ ] Autocomplete lists Lean completions and Unicode abbreviations.
- [ ] Outline view lists declarations and jumps to them.
- [ ] F8 / Shift+F8 step through messages.

## L3 Interactive infoview
- [ ] Goal pane shows the official infoview: expand a term, hover for types, click a hypothesis, "go to definition" from the goal.
- [ ] Switching the theme (light/dark) recolours the infoview.
- [ ] Editing while the infoview is open keeps it in sync; restarting the server refreshes it.
- [ ] Settings: Goal view "Plain" shows plain goals; if the iframe fails to load, plain goals appear with a notice.
- [ ] Layout button cycles split / editor only / goals only; the divider drags and the ratio is remembered.

## L4 Projects and files
- [ ] "New Lean project" (plain): the folder is created, the starter file opens, no trust prompt.
- [ ] "New Lean project" with Mathlib: `lake exe cache get` runs with visible progress; Cancel stops it and leaves a usable folder.
- [ ] With "blueprint" ticked: `blueprint/src/*.tex` exist and the starter theorem carries the `\lean{}` link in `content.tex`.
- [ ] Right-click a folder: "New Lean file" and "New Lean project here" work.
- [ ] "Build project" streams output; "Fetch Mathlib cache" works.

## L5 Status engine and API
- [ ] In the developer console: `app.plugins.plugins.leanpane.api.version` is `1`.
- [ ] `await api.getStatus("<project>", ["Name"])` returns `proved`, `stated`, `error`, `proved-with-sorry-deps` or `missing` as expected.
- [ ] Editing a declaration to introduce `sorry` changes its status within a couple of seconds (live), and a build fixes up dependants.
- [ ] `api.onStatusChanged` fires on edit and after Build.

## L6 TeXPane integration (needs TeXPane 0.2.0)
- [ ] `\lean{Name}` chips are coloured by status and jump to the declaration; disabling LeanPane greys them out.
- [ ] Mismatch warnings appear for `\leanok` that Lean disagrees with, with working fixes.
- [ ] "Add to blueprint" (Cmd/Ctrl+Alt+B) on a declaration inserts a labelled environment; "Formalize this" in TeXPane creates a stub in Lean and opens it.

## L7 Blueprint progress
- [ ] The dependency graph shows nodes coloured by status and refreshes on edits.

## General
- [ ] Reload Obsidian with files open: the workspace restores the `.lean` tabs and layout.
- [ ] A `.lean` file open in two panes keeps both in sync (known limitation: diagnostics are shown in the most recently opened one).
- [ ] No hard-coded colours: the plugin follows at least two community themes.
