# LeanPane: state of affairs

*Last updated 14 Oct 2026, version 0.1.4. Keep this file current: update it with every release (newest entry on top of the log).*

## In one paragraph
LeanPane is a **beta**. Editing `.lean` files with live errors, goals, hover, completion and Unicode input works and has been seen working in real Obsidian on macOS. The Lean projects panel, syntax colours and the interactive goal view were confirmed from screenshots. Several newer features (listed below) have only been tested automatically. Nobody other than the author has tried it yet.

## What works
| Area | Status | How we know |
| --- | --- | --- |
| `.lean` editor, errors, `sorry` markers, goals (plain and interactive infoview) | Works | Automated tests against real Lean 4.25.1, an end-to-end browser test of the infoview, and screenshots from Obsidian |
| Syntax colours (keywords, tactics, types, strings, comments, `sorry`) | Works since 0.1.2 | Screenshot from Obsidian; before 0.1.2 colours were missing in Obsidian (tag-based highlighting does not work there) |
| Lean projects panel (λ ribbon): list, New menu, filter, project files | Works | Screenshots |
| Trust prompt, server start/stop, status bar | Works | Automated tests; seen in use |
| Hover, go to definition, outline, completion, Unicode input | Implemented | Automated tests; not individually confirmed in Obsidian |
| Build project, fetch Mathlib cache, new project (plain or Mathlib) | Implemented | Automated tests with real Lean (plain); Mathlib could not be tested |
| Blueprint link to TeXPane (optional), add a blueprint later | Implemented | Automated tests; seen once (chip colours in TeXPane) |
| Delete project/file from the panel (to trash) | Implemented | Not yet used |

## Not yet verified in Obsidian
The checklist is `docs/MANUAL_TEST.md`. Highest priority: delete from the panel, "Add a LaTeX blueprint…", Mathlib project creation, popout windows, more than one vault open, Windows and Linux.

## Known issues and limitations
- Desktop only. Windows is untested. Linux is untested.
- Mathlib projects: not tested here (cache download is several GB).
- If the same file is open in two panes, diagnostics follow the most recently opened one.
- No code-action UI (lightbulb) yet.
- Files outside the vault open read-only.
- The plugin file is about 3 MB (the official infoview is bundled for offline use).
- Not listed in Obsidian's community plugin store; install with BRAT or by hand (see the README).
- Obsidian status bar floats over the bottom right: the goals pane now leaves room for it (0.1.4); report anything else that is covered.

## Next (ideas, in suggested order)
1. "Try this" suggestions: run `exact?` / `apply?` / `simp?` at the cursor and insert the result.
2. Code actions (lightbulb) from Lean's server.
3. Richer completion (types and docs in the popup).
4. Search Mathlib by name or by statement.
5. A built-in tutorial project with exercises.
6. Next/previous `sorry` navigation and a per-file progress list.
7. Plain-language help for common errors; a Unicode cheat sheet.

## Log (newest first)
- **0.1.4** (14 Oct 2026): goals pane (and its Restart File button) no longer covered by Obsidian's status bar.
- **0.1.3** (14 Oct 2026): the LaTeX blueprint is optional when creating a project (off by default) and can be added to an existing project later; tighter tree indentation.
- **0.1.2** (14 Oct 2026): fixed missing syntax colours.
- **0.1.1** (14 Oct 2026): Lean projects panel (λ ribbon button), "Lean projects folder" setting, delete from the panel.
- **0.1.0** (14 Oct 2026): first release. Editor, goals, messages, outline, server management, new project, proof-status engine, API for TeXPane. Review found and fixed one blocker (trust prompt did not gate status queries) and several smaller problems.
