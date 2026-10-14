# LeanPane user guide

LeanPane lets you write and check Lean 4 inside Obsidian. This guide takes you from nothing installed to a working proof, then covers everyday use.

> **Status: beta.** The plugin is tested automatically, including against a real Lean server, but it is young. Expect rough edges and please [report them](https://github.com/thearminashrafi/obsidian-leanpane/issues/new/choose).

## 1. What you need

| Need | Notes |
| --- | --- |
| Obsidian 1.8 or newer, **desktop** | macOS, Linux and Windows. Mobile is not supported (Lean runs as a local program). |
| **Lean 4 through elan** | LeanPane never installs Lean for you. |
| (optional) TeXPane | The LaTeX plugin, for blueprint-style work. |

### Install Lean (once)

macOS / Linux, in a terminal:

```bash
curl https://elan.lean-lang.org/elan-init.sh -sSf | sh
```

Windows: follow <https://lean-lang.org/install/>. Afterwards `lake --version` should work in a new terminal. Official instructions: <https://lean-lang.org/install/>.

## 2. Install the plugin

Obsidian's plugin browser does not list LeanPane yet, so install it in one of two ways.

**A. With BRAT (easiest, and updates itself)**
1. In Obsidian: Settings → Community plugins → Browse → install **Obsidian42 - BRAT**, and enable it.
2. Command palette → "BRAT: Add a beta plugin for testing".
3. Paste `thearminashrafi/obsidian-leanpane`, choose the latest version, and add.
4. Settings → Community plugins → enable **LeanPane**.

**B. By hand**
1. Open the [latest release](https://github.com/thearminashrafi/obsidian-leanpane/releases/latest) and download `main.js`, `manifest.json` and `styles.css`.
2. In your vault create the folder `.obsidian/plugins/leanpane/` and put the three files in it. (Hidden folder: on macOS press Cmd+Shift+. in Finder to show it.)
3. Restart Obsidian, then Settings → Community plugins → enable **LeanPane**.

**Several vaults on macOS/Linux:** `scripts/add-leanpane.sh "/path/to/Vault A" "/path/to/Vault B"` keeps one shared copy linked into each vault (see the README).

### Check that Lean was found
Settings → LeanPane → "Lean installation" shows the detected `elan`, `lake` and toolchains. If it says *not found* (common on macOS when Obsidian was started from the Dock), put the folder that contains `lake` (usually `~/.elan/bin`) into **Elan folder** and press **Re-check**.

## 3. Your first project (5 minutes)

1. Click the **λ** button in the left ribbon. The **Lean projects** panel opens.
2. Click **New → New Lean project**. Give it a name (letters, digits, `-`, `_`). Leave *Mathlib* off for now. Click Create. The first creation can take a minute (Lean may download a toolchain).
3. The project's main `.lean` file opens: the editor on the left, the **goals** on the right.
4. Type this and put the cursor after `by`:

   ```lean
   theorem and_swap (p q : Prop) (h : p ∧ q) : q ∧ p := by
     sorry
   ```
5. The goals pane shows `⊢ q ∧ p`. Replace `sorry` with `exact ⟨h.2, h.1⟩`. The goals disappear ("no goals") and the `sorry` warning goes away: the theorem is proved.

Type symbols with `\`: `\to` then Space gives `→`, `\forall` gives `∀`, `\alpha` gives `α`.

### Trust
The first time LeanPane runs Lean for a project it asks **"Trust this project?"**. Lean projects can run arbitrary code (lakefiles, `#eval`), so only trust projects you wrote or reviewed. Projects you create from LeanPane are trusted automatically. Change your mind under Settings → LeanPane → Trusted projects.

## 4. Everyday use

### The Lean projects panel (λ in the ribbon)
Lists every folder with a `lakefile.toml`/`lakefile.lean` and your loose `.lean` files.
- **New** → Lean project or Lean file, created in the *Lean projects folder* (Settings; default `Lean`).
- Click a project to expand it; click a file to open it.
- Right-click a project: open, new file, **trust**, **build**, **fetch Mathlib cache**, reveal, **delete**. Right-click a file: open, reveal, delete. Deleting asks first and moves things to the trash.
- The *not trusted* tag marks projects that LeanPane will not run until you trust them.

### Editing
- **Goals pane**: shows goals at the cursor. Interactive mode is the VS Code infoview (hover terms, click to expand); switch to *Plain* in settings if you prefer text. The layout button cycles split / editor / goals.
- **Messages drawer** (Cmd/Ctrl+Alt+L): errors, warnings, info and the server log. F8 / Shift+F8 step through them.
- **Go to definition**: F12 or Cmd/Ctrl+click. Files outside the vault open read-only.
- **Outline**: command "Open Lean outline" lists declarations with proved / `sorry` / error icons.
- **Status bar**: Lean version, server state and the number of `sorry`s; click for restart options.

### Mathlib
Create the project with *Mathlib* ticked (LeanPane downloads the compiled library, which is several GB and takes a while), or in an existing project use **Fetch Mathlib cache**. Without the cache the first `import Mathlib` is very slow.

### Commands (Ctrl/Cmd+P)
Restart file, Restart Lean server, Build project, Fetch Mathlib cache, New Lean project/file, Open Lean projects, Open Lean outline, Toggle goals (Mod+Alt+G), Toggle messages (Mod+Alt+L), Cycle layout, Go to definition, Next/Previous message, Trust this project, Re-check Lean.

## 5. Working with LaTeX (blueprints)

Install [TeXPane](https://github.com/thearminashrafi/obsidian-texpane) 0.2.0 or newer and both plugins find each other automatically. Then:
- Write theorems in LaTeX and tag them: `\lean{and_swap}`, `\leanok`, `\uses{lem:a}` (leanblueprint vocabulary).
- In the LaTeX editor each `\lean{...}` becomes a chip: green proved, yellow depends on `sorry`, orange stated, red error, cyan Mathlib.
- TeXPane warns when `\leanok` and Lean disagree and offers fixes. "Open blueprint progress" draws the dependency graph. "Formalize this" creates the Lean stub for a LaTeX theorem.
- When creating a Lean project, tick *blueprint* to get a ready-made skeleton.

## 6. Settings reference
See the table in the [README](../README.md#settings).

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Lean not found" | Set **Elan folder** (`~/.elan/bin`), press Re-check. Restart Obsidian after installing elan. |
| Nothing happens when opening a `.lean` file | The project is not trusted: answer the prompt, or right-click the project in the panel → Trust. |
| First open is very slow | elan is downloading the toolchain, or Mathlib needs **Fetch Mathlib cache**. Watch the progress window / server log. |
| Goal pane blank | Settings → Goal view → Plain. Check the Server log tab. |
| Errors that do not go away after editing the lakefile or toolchain | Command "Restart Lean server". |
| Orphan `lean` processes after a crash | End `lake serve` / `lean --server` in Activity Monitor / Task Manager. |
| The panel does not list my project | It needs a `lakefile.toml` or `lakefile.lean` in a non-hidden folder of the vault. Press Refresh. |

## 8. Reporting problems
Open an issue and include: operating system, Obsidian and LeanPane versions, `lake --version`, what you did, and the output of the developer console (Cmd/Ctrl+Shift+I) if it shows red errors mentioning LeanPane. Please do not include private proofs you cannot share.

## 9. Privacy and safety
LeanPane makes no network requests itself. Lean/elan/lake (which you installed) may download toolchains and Mathlib. LeanPane runs Lean only for projects you trusted. Everything stays on your computer.
