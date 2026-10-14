# LeanPane

Write Lean 4 inside your Obsidian vault. LeanPane adds a `.lean` editor with live errors, an interactive goal view (the same infoview VS Code uses), a messages drawer, hover, go to definition, completion, Unicode input and an outline. It uses the Lean you already have installed (elan + lake); Mathlib is optional. Desktop only.

It is designed to pair with [TeXPane](https://github.com/thearminashrafi/obsidian-texpane), the LaTeX plugin: write the proof in LaTeX, tag each lemma with its Lean name blueprint-style (`\lean{Name}`, `\leanok`, `\uses{...}`, compatible with [leanblueprint](https://pypi.org/project/leanblueprint/)), and LeanPane reports what Lean has actually verified. Each plugin also works on its own.

## Requirements

- Obsidian 1.8 or newer, desktop (macOS, Linux, Windows). Mobile is not supported.
- [elan](https://github.com/leanprover/elan) (installs `lake` and `lean`). LeanPane never installs Lean for you; if it is missing it shows install instructions.
- Optional: a Mathlib project (`lake exe cache get` downloads the compiled library).

## Install

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/leanpane/`.
2. Enable LeanPane under Settings, Community plugins.

Or use `scripts/add-leanpane.sh "/path/to/Vault"`, which keeps one shared copy and links it into any number of vaults (`--update` refreshes it).

## Usage

Open any `.lean` file (or run **New Lean file** / **New Lean project**). The first time LeanPane starts a server for a project it asks whether you trust it, because lakefiles and Lean files can run code. Your answer is remembered per project.

- **Goals**: the right-hand pane shows the goals at the cursor. The layout button cycles split / editor only / goals only.
- **Messages**: errors, warnings and info, plus the server log. F8 / Shift+F8 step through messages.
- **Navigation**: F12 or Cmd/Ctrl+click goes to a definition (files outside the vault open read-only). The **Lean outline** view lists declarations.
- **Unicode**: type `\alpha` then space (or Tab) for symbols. `\\` is a literal backslash.
- **Projects**: **New Lean project** creates a plain or Mathlib project, optionally with a blueprint skeleton. Right-click a folder for **New Lean file** and **New Lean project here**. **Build project** and **Fetch Mathlib cache** stream their output.
- **Status bar**: shows the server state, Lean version and sorry count; click for restart actions.

Commands: restart file, restart server, build project, fetch Mathlib cache, new project, new file, toggle goals (Mod+Alt+G), toggle messages (Mod+Alt+L), cycle layout, jump to blueprint (Mod+Alt+B), add to blueprint, go to definition (F12), next / previous message (F8 / Shift+F8), open outline, re-check Lean.

## TeXPane integration

With TeXPane 0.2.0 or newer installed, `\lean{Name}` chips are coloured by real proof status and jump to the declaration, `\leanok` mismatches are flagged with fixes, and "Formalize this" creates a Lean stub. Without TeXPane LeanPane works unchanged; each plugin looks up the other fresh on every call.

LeanPane exposes `LeanPaneApiV1` as `app.plugins.plugins.leanpane.api` and triggers workspace events `leanpane:api-ready` and `leanpane:api-unload`. Conventions:

- A project root is accepted vault-relative (as in `LeanProjectInfo.root`) or absolute.
- `onStatusChanged` callbacks get the vault-relative root (`""` for a project at the vault root).
- File paths in results are vault-relative with `/` when inside the vault, otherwise absolute.
- Statuses: `missing`, `error`, `stated`, `proved-with-sorry-deps`, `proved`, `mathlib`, `unknown`. Live editor state wins for `error` and `stated`; the last build supplies dependency information.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Elan folder | auto | Folder containing `lake`/`lean`; empty means `~/.elan/bin`, then PATH |
| Idle shutdown (minutes) | 10 | Stop a project's server after no `.lean` file is open |
| Goal view | Interactive | Interactive infoview or plain text goals |
| Layout / split ratio | Split / 0.55 | Editor and goals arrangement |
| Edit debounce (ms) | 300 | Delay before edits are sent to Lean |
| Unicode input, leader, eager | on, `\`, on | Abbreviation expansion |
| Hover | on | Type information on hover |
| Semantic tokens | on | Server-provided identifier colours |
| Syntax colours | LeanPane | LeanPane palette or your theme's colours |
| Font size | 14 | Editor font size |
| Trusted projects | none | Remove entries to be asked again |

A **Re-check** button shows the detected `elan`, `lake` and installed toolchains.

## Troubleshooting

- **"Lean not found"** on macOS: apps launched from the Dock do not inherit your shell PATH. LeanPane looks in `~/.elan/bin` automatically; if elan lives elsewhere, set **Elan folder** in settings and press Re-check.
- **First open is slow**: elan may be downloading the project's toolchain, and Mathlib projects need `lake exe cache get` (use **Fetch Mathlib cache**) before the first import is fast.
- **Interactive goals blank**: switch Goal view to Plain; LeanPane does this itself if the infoview cannot load. The Server log tab in the messages drawer shows what happened.
- **Stale errors after changing the lakefile or toolchain**: run **Restart Lean server**.
- **Leftover `lean` processes**: LeanPane stops its servers when Obsidian quits; if Obsidian was killed, end `lake serve` / `lean --server` processes manually.

## Known limitations

- Desktop only. Windows is untested.
- If the same file is open in two panes, diagnostics follow the most recently opened one.
- No code-action UI yet; diagnostics are not remapped through edits made while Lean is still elaborating.
- Files outside the vault are read-only.
- The blueprint dependency graph and some TeXPane features need TeXPane 0.2.0.

## Third-party software

The interactive goal view is the official Lean infoview (`@leanprover/infoview`, Apache-2.0) bundled into `main.js` and run in a sandboxed iframe, together with `@leanprover/unicode-input` (Apache-2.0), React and es-module-shims. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

`npm install`, `npm run dev` (watch build), `npx tsc --noEmit`, `npx vitest run` (unit tests plus real-Lean tests, which skip when Lean is absent), `npm run lint:colors`. The design is in [docs/SPEC.md](docs/SPEC.md).

## License

MIT, see [LICENSE](LICENSE).
