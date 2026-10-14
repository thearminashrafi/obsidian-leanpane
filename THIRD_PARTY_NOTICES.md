# Third-party notices

LeanPane is MIT licensed (see [LICENSE](LICENSE)). The released `main.js` bundles the following third-party software.
Each component keeps its own licence; the full licence texts are in the packages' repositories and in the npm tarballs.

## Lean infoview (interactive goal view)

| Package | Version | Licence |
| --- | --- | --- |
| `@leanprover/infoview` | 0.13.0 | Apache-2.0 |
| `@leanprover/infoview-api` | 0.13.0 | Apache-2.0 |
| `@leanprover/unicode-input` | 0.1.12 | Apache-2.0 |

Copyright the Lean FRO and the `vscode-lean4` contributors. Source: <https://github.com/leanprover/vscode-lean4>.
Licensed under the Apache License, Version 2.0 (<https://www.apache.org/licenses/LICENSE-2.0>); the software is distributed
on an "AS IS" basis, without warranties or conditions of any kind. LeanPane embeds the infoview's compiled JavaScript and CSS
unchanged (including the Codicons font, MIT, Copyright (c) Microsoft Corporation) and runs it inside a sandboxed iframe.
The infoview's own runtime dependencies are bundled with it: React and React DOM (MIT, Copyright (c) Meta Platforms, Inc.),
`es-module-shims` (MIT, Copyright (c) Guy Bedford), and the other packages listed in its distribution.

## Language-server plumbing

| Package | Licence |
| --- | --- |
| `vscode-jsonrpc`, `vscode-languageserver-protocol` (and their types packages) | MIT, Copyright (c) Microsoft Corporation |

## Editor

| Package | Licence |
| --- | --- |
| `@codemirror/*` (autocomplete, commands, language, legacy-modes, lint, search, state, view) | MIT, Copyright (c) Marijn Haverbeke and others |
| `@lezer/*` (common, highlight, lr) | MIT, Copyright (c) Marijn Haverbeke and others |

CodeMirror is also provided by Obsidian at run time; the packages above are used for type information and for the parts
that are not shared with Obsidian.

## Lean itself

LeanPane does not include Lean, Lake, elan or Mathlib. They are separate programs installed by the user, under their own
licences (Lean 4 and elan: Apache-2.0; Mathlib: Apache-2.0).
