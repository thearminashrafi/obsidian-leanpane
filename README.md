# LeanPane

> **Status: in progress.** The design is approved and the build has started, but there is no usable plugin yet. Nothing here should be installed. Progress is tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

LeanPane will be an Obsidian desktop plugin for writing Lean 4 inside your vault: a `.lean` editor with live errors, the interactive goal view (the same one VS Code uses) and a messages drawer, all driven by the Lean you already have installed (elan + lake). Mathlib is optional.

It is designed to pair with [TeXPane](https://github.com/thearminashrafi/obsidian-texpane), the LaTeX plugin. You write the natural-language proof in LaTeX, tagging each lemma with its Lean name blueprint-style (`\lean{Name}`, `\leanok`, `\uses{…}`, compatible with [leanblueprint](https://pypi.org/project/leanblueprint/)). LeanPane then reports what Lean has actually verified:

- coloured `\lean{}` chips in the LaTeX that jump to the Lean declaration
- warnings when `\leanok` disagrees with Lean
- a dependency graph of the whole blueprint, coloured by proof status
- "Formalize this", which creates a Lean stub from a LaTeX lemma

Each plugin also works on its own.

## Planned milestones

| | Milestone | Status |
| --- | --- | --- |
| L0 | Lean server plumbing (one `lake serve` per project, trust prompt, restart, cleanup) | Not started |
| L1 | `.lean` editor: diagnostics, progress, `sorry` markers, highlighting, Unicode input | Not started |
| L2 | Plain-text goals, hover, go to definition, completion, outline | Not started |
| L3 | Interactive goal view (official Lean infoview in an iframe) | Not started |
| L4 | New Lean project (plain or with Mathlib, optional blueprint), build, cache | Not started |
| L5 | Declaration status engine + cross-plugin API | Not started |
| L6 | TeXPane integration (chips, completion, mismatch fixes, Formalize this) | Not started |
| L7 | Blueprint progress panel (dependency graph) | Not started |

The full specification is in [docs/SPEC.md](docs/SPEC.md).

## License

MIT, see [LICENSE](LICENSE).
