/**
 * Templates for new Lean files/projects and the blueprint skeleton. Pure strings, no I/O. TASK: docs/tasks/10-templates.md
 */
import type { TemplateFile } from "../types";

export function sanitizeProjectName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function libNameFor(projectName: string): string {
  const joined = projectName
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")
    .replace(/[^A-Za-z0-9_]/g, "");
  if (joined === "") return "Project";
  return /^[0-9]/.test(joined) ? `Project${joined}` : joined;
}

export function lakeNewArgs(o: { name: string; mathlib: boolean }): string[] {
  return o.mathlib ? ["+leanprover-community/mathlib4:lean-toolchain", "new", o.name, "math"] : ["new", o.name];
}

export const MATHLIB_CACHE_ARGS: string[] = ["exe", "cache", "get"];

export function newLeanFileContent(fileName: string): string {
  const title = fileName.replace(/\.lean$/, "");
  return `/-!\n# ${title}\n\n-/\n`;
}

export function uniqueFileName(base: string, ext: string, exists: (name: string) => boolean): string {
  let candidate = `${base}.${ext}`;
  for (let n = 2; exists(candidate); n++) candidate = `${base} ${n}.${ext}`;
  return candidate;
}

export interface StarterLeanFile {
  /** Relative to the project root, "/" separators. */
  path: string;
  /** Lean module name, e.g. "Demo.Starter". */
  module: string;
  content: string;
  /** Unqualified theorem name inside namespace <lib>. */
  theoremName: string;
}

export function starterLeanFile(libName: string): StarterLeanFile {
  const theoremName = "starter_add_zero";
  const content = [
    `namespace ${libName}`,
    "",
    "/-- Starter theorem linked to the blueprint lemma `lem:starter`. Replace `sorry` with a proof. -/",
    `theorem ${theoremName} (n : Nat) : n + 0 = n := by`,
    "  sorry",
    "",
    `end ${libName}`,
    "",
  ].join("\n");
  return { path: `${libName}/Starter.lean`, module: `${libName}.Starter`, content, theoremName };
}

const LATEX_SPECIAL: Record<string, string> = {
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "\\": "\\textbackslash{}",
};

/** Single pass, so replacement text is never re-escaped. */
function latexEscape(s: string): string {
  return s.replace(/[&%$#_{}~^\\]/g, (c) => LATEX_SPECIAL[c]);
}

export function blueprintFiles(o: { projectName: string; libName: string; title?: string }): TemplateFile[] {
  const title = latexEscape(o.title ?? `${o.projectName} blueprint`);
  const lib = o.libName;

  return [
    {
      path: "blueprint/src/print.tex",
      content: String.raw`\documentclass[a4paper]{report}
\input{macros/common}
\input{macros/print}

\title{${title}}
\author{}

\begin{document}
\maketitle
\tableofcontents
\input{content}
\end{document}
`,
    },
    {
      path: "blueprint/src/web.tex",
      content: String.raw`\documentclass{report}
\input{macros/common}
\input{macros/web}

\title{${title}}
\author{}

\begin{document}
\maketitle
\input{content}
\end{document}
`,
    },
    {
      path: "blueprint/src/macros/common.tex",
      content: String.raw`\usepackage{amssymb, amsmath, amsthm, mathtools}
\usepackage[colorlinks=true, allcolors=blue]{hyperref}

\theoremstyle{plain}
\newtheorem{theorem}{Theorem}[chapter]
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{corollary}[theorem]{Corollary}

\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
`,
    },
    {
      path: "blueprint/src/macros/print.tex",
      content: String.raw`% Blueprint macros are only meaningful for the web build; in the printed PDF they do nothing.
\providecommand{\lean}[1]{}
\providecommand{\leanok}{}
\providecommand{\uses}[1]{}
\providecommand{\mathlibok}{}
\providecommand{\notready}{}
\providecommand{\proves}[1]{}
\providecommand{\discussion}[1]{}
`,
    },
    {
      path: "blueprint/src/macros/web.tex",
      content: String.raw`% Used by leanblueprint's web build (plasTeX). Fill in the URLs of your repository.
\usepackage[showmore, dep_graph]{blueprint}
% \home{https://github.com/<user>/<repo>}
% \github{https://github.com/<user>/<repo>}
% \dochome{https://<user>.github.io/<repo>/docs}
`,
    },
    {
      path: "blueprint/src/content.tex",
      content: String.raw`\chapter{Introduction}

\begin{lemma}[Adding zero]
  \label{lem:starter}
  \lean{${lib}.starter_add_zero}
  For every natural number $n$ we have $n + 0 = n$.
\end{lemma}

\begin{proof}
  By the definition of addition.
\end{proof}
`,
    },
  ];
}
