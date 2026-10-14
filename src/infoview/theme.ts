/**
 * Obsidian -> infoview theme mapping. The infoview CSS reads `--vscode-*` variables; CSS variables do not cross the
 * iframe boundary, so the host resolves Obsidian's variables to concrete values and sends a `:root{...}` stylesheet.
 * Pure (no DOM) except for `makeDomResolver`.
 */

export type ThemeKind = "color" | "font" | "size" | "raw";
/** Reads a (possibly derived) Obsidian CSS value; returns "" when unavailable. */
export type ThemeReader = (obsidianVar: string, kind: ThemeKind) => string;

interface Entry {
  /** CSS variable name without the leading `--vscode-`. */
  name: string;
  /** Obsidian CSS variable names tried in order. */
  from: string[];
  kind: ThemeKind;
  fallback: string;
  /** Wrap the resolved colour in this alpha (0..1). */
  alpha?: number;
}

const GREEN = ["--color-green", "--text-success"];
const RED = ["--color-red", "--text-error"];

export const THEME_MAP: readonly Entry[] = [
  { name: "editor-background", from: ["--background-primary"], kind: "color", fallback: "#1e1e1e" },
  { name: "editor-foreground", from: ["--text-normal"], kind: "color", fallback: "#d4d4d4" },
  { name: "foreground", from: ["--text-normal"], kind: "color", fallback: "#d4d4d4" },
  { name: "panel-background", from: ["--background-primary"], kind: "color", fallback: "#1e1e1e" },
  { name: "sideBar-background", from: ["--background-secondary"], kind: "color", fallback: "#252526" },
  { name: "sideBarSectionHeader-background", from: ["--background-secondary"], kind: "color", fallback: "#252526" },
  { name: "sideBarTitle-foreground", from: ["--text-muted"], kind: "color", fallback: "#bbbbbb" },
  { name: "editor-font-family", from: ["--font-monospace", "--font-monospace-default"], kind: "font", fallback: "monospace" },
  { name: "editor-font-size", from: ["--code-size", "--font-text-size"], kind: "size", fallback: "14px" },
  { name: "font-family", from: ["--font-interface", "--font-text"], kind: "font", fallback: "sans-serif" },
  { name: "font-size", from: ["--font-ui-small", "--font-text-size"], kind: "size", fallback: "13px" },
  { name: "editorHoverWidget-background", from: ["--background-secondary", "--background-primary"], kind: "color", fallback: "#252526" },
  { name: "editorHoverWidget-foreground", from: ["--text-normal"], kind: "color", fallback: "#d4d4d4" },
  { name: "editorHoverWidget-border", from: ["--background-modifier-border"], kind: "color", fallback: "#454545" },
  { name: "editorWidget-border", from: ["--background-modifier-border"], kind: "color", fallback: "#454545" },
  { name: "editorGroup-border", from: ["--background-modifier-border"], kind: "color", fallback: "#444444" },
  { name: "widget-border", from: ["--background-modifier-border"], kind: "color", fallback: "#454545" },
  { name: "menu-background", from: ["--background-secondary", "--background-primary"], kind: "color", fallback: "#252526" },
  { name: "menu-foreground", from: ["--text-normal"], kind: "color", fallback: "#cccccc" },
  { name: "menu-border", from: ["--background-modifier-border"], kind: "color", fallback: "#454545" },
  { name: "menu-selectionBackground", from: ["--interactive-accent"], kind: "color", fallback: "#094771" },
  { name: "menu-selectionForeground", from: ["--text-on-accent"], kind: "color", fallback: "#ffffff" },
  { name: "menu-separatorBackground", from: ["--background-modifier-border"], kind: "color", fallback: "#454545" },
  { name: "editor-selectionBackground", from: ["--text-selection"], kind: "color", fallback: "#264f78" },
  { name: "editor-findMatchBackground", from: ["--text-highlight-bg"], kind: "color", fallback: "#515c6a" },
  { name: "editorOverviewRuler-rangeHighlightForeground", from: ["--text-highlight-bg"], kind: "color", fallback: "#515c6a" },
  { name: "diffEditor-insertedTextBackground", from: GREEN, kind: "color", fallback: "rgba(155,185,85,0.2)", alpha: 0.25 },
  { name: "diffEditor-insertedTextBorder", from: GREEN, kind: "color", fallback: "#6a9955" },
  { name: "diffEditor-removedTextBackground", from: RED, kind: "color", fallback: "rgba(255,0,0,0.2)", alpha: 0.25 },
  { name: "diffEditor-removedTextBorder", from: RED, kind: "color", fallback: "#f14c4c" },
  { name: "textCodeBlock-background", from: ["--code-background", "--background-primary-alt"], kind: "color", fallback: "#2d2d2d" },
  { name: "textPreformat-foreground", from: ["--code-normal", "--text-normal"], kind: "color", fallback: "#d7ba7d" },
  { name: "textLink-foreground", from: ["--link-color", "--text-accent"], kind: "color", fallback: "#3794ff" },
  { name: "dropdown-background", from: ["--background-modifier-form-field", "--background-primary"], kind: "color", fallback: "#3c3c3c" },
  { name: "dropdown-foreground", from: ["--text-normal"], kind: "color", fallback: "#f0f0f0" },
  { name: "dropdown-border", from: ["--background-modifier-border"], kind: "color", fallback: "#3c3c3c" },
  { name: "settings-dropdownBackground", from: ["--background-modifier-form-field", "--background-primary"], kind: "color", fallback: "#3c3c3c" },
  { name: "settings-dropdownForeground", from: ["--text-normal"], kind: "color", fallback: "#f0f0f0" },
  { name: "settings-dropdownBorder", from: ["--background-modifier-border"], kind: "color", fallback: "#3c3c3c" },
  { name: "settings-dropdownListBorder", from: ["--background-modifier-border"], kind: "color", fallback: "#454545" },
  { name: "settings-textInputBackground", from: ["--background-modifier-form-field", "--background-primary"], kind: "color", fallback: "#3c3c3c" },
  { name: "settings-textInputForeground", from: ["--text-normal"], kind: "color", fallback: "#cccccc" },
  { name: "settings-textInputBorder", from: ["--background-modifier-border"], kind: "color", fallback: "#3c3c3c" },
  { name: "settings-checkboxBackground", from: ["--background-modifier-form-field", "--background-primary"], kind: "color", fallback: "#3c3c3c" },
  { name: "settings-checkboxForeground", from: ["--text-normal"], kind: "color", fallback: "#f0f0f0" },
  { name: "settings-checkboxBorder", from: ["--background-modifier-border"], kind: "color", fallback: "#3c3c3c" },
  { name: "settings-headerBorder", from: ["--background-modifier-border"], kind: "color", fallback: "#444444" },
  { name: "button-background", from: ["--interactive-accent"], kind: "color", fallback: "#0e639c" },
  { name: "button-foreground", from: ["--text-on-accent"], kind: "color", fallback: "#ffffff" },
  { name: "button-hoverBackground", from: ["--interactive-accent-hover"], kind: "color", fallback: "#1177bb" },
  { name: "button-border", from: ["--background-modifier-border"], kind: "color", fallback: "transparent" },
  { name: "button-secondaryBackground", from: ["--interactive-normal"], kind: "color", fallback: "#3a3d41" },
  { name: "button-secondaryForeground", from: ["--text-normal"], kind: "color", fallback: "#ffffff" },
  { name: "button-secondaryHoverBackground", from: ["--interactive-hover"], kind: "color", fallback: "#45494e" },
  { name: "badge-background", from: ["--interactive-accent"], kind: "color", fallback: "#4d4d4d" },
  { name: "badge-foreground", from: ["--text-on-accent"], kind: "color", fallback: "#ffffff" },
  { name: "activityBarBadge-background", from: ["--interactive-accent"], kind: "color", fallback: "#007acc" },
  { name: "activityBarBadge-foreground", from: ["--text-on-accent"], kind: "color", fallback: "#ffffff" },
  { name: "errorForeground", from: ["--text-error"], kind: "color", fallback: "#f48771" },
  { name: "inputValidation-errorBackground", from: RED, kind: "color", fallback: "#5a1d1d", alpha: 0.2 },
  { name: "inputValidation-errorBorder", from: RED, kind: "color", fallback: "#be1100" },
  { name: "focusBorder", from: ["--interactive-accent"], kind: "color", fallback: "#007fd4" },
  { name: "progressBar-background", from: ["--interactive-accent"], kind: "color", fallback: "#0e70c0" },
  { name: "icon-foreground", from: ["--icon-color", "--text-muted"], kind: "color", fallback: "#c5c5c5" },
  { name: "disabledForeground", from: ["--text-faint"], kind: "color", fallback: "#8c8c8c" },
  { name: "input-placeholderForeground", from: ["--text-faint"], kind: "color", fallback: "#8c8c8c" },
  { name: "editor-inlineValuesForeground", from: ["--text-muted"], kind: "color", fallback: "#7f7f7f" },
  { name: "list-hoverBackground", from: ["--background-modifier-hover"], kind: "color", fallback: "#2a2d2e" },
  { name: "list-hoverForeground", from: ["--text-normal"], kind: "color", fallback: "#cccccc" },
  { name: "list-activeSelectionBackground", from: ["--interactive-accent"], kind: "color", fallback: "#094771" },
  { name: "list-activeSelectionForeground", from: ["--text-on-accent"], kind: "color", fallback: "#ffffff" },
  { name: "list-inactiveSelectionBackground", from: ["--background-modifier-hover"], kind: "color", fallback: "#37373d" },
  { name: "list-inactiveSelectionForeground", from: ["--text-normal"], kind: "color", fallback: "#cccccc" },
  { name: "list-focusBackground", from: ["--background-modifier-hover"], kind: "color", fallback: "#062f4a" },
  { name: "list-focusForeground", from: ["--text-normal"], kind: "color", fallback: "#cccccc" },
  { name: "list-highlightForeground", from: ["--text-accent"], kind: "color", fallback: "#2aaaff" },
  { name: "list-focusHighlightForeground", from: ["--text-accent"], kind: "color", fallback: "#2aaaff" },
  { name: "toolbar-hoverBackground", from: ["--background-modifier-hover"], kind: "color", fallback: "#5a5d5e" },
  { name: "toolbar-activeBackground", from: ["--background-modifier-active-hover", "--background-modifier-hover"], kind: "color", fallback: "#63666b" },
  { name: "scrollbarSlider-background", from: ["--background-modifier-border"], kind: "color", fallback: "#79797966" },
  { name: "scrollbarSlider-hoverBackground", from: ["--background-modifier-border-hover"], kind: "color", fallback: "#646464b3" },
  { name: "scrollbarSlider-activeBackground", from: ["--background-modifier-border-focus"], kind: "color", fallback: "#bfbfbf66" },
  { name: "panelTitle-activeForeground", from: ["--text-normal"], kind: "color", fallback: "#e7e7e7" },
  { name: "panelTitle-inactiveForeground", from: ["--text-muted"], kind: "color", fallback: "#e7e7e799" },
  { name: "panelTitle-activeBorder", from: ["--interactive-accent"], kind: "color", fallback: "#e7e7e7" },
  { name: "tree-indentGuidesStroke", from: ["--background-modifier-border"], kind: "color", fallback: "#585858" },
  { name: "tree-inactiveIndentGuidesStroke", from: ["--background-modifier-border"], kind: "color", fallback: "#58585860" },
  { name: "lean4-infoView\\.goalCount", from: ["--text-muted"], kind: "color", fallback: "#8c8c8c" },
  { name: "lean4-infoView\\.turnstile", from: ["--text-accent", "--interactive-accent"], kind: "color", fallback: "#569cd6" },
  { name: "lean4-infoView\\.caseLabel", from: GREEN, kind: "color", fallback: "#6a9955" },
];

/** Constant (non-derived) variables. */
const CONSTANTS: Record<string, string> = {
  "editor-font-weight": "normal",
  "editor-line-height": "1.4",
  "editor-font-feature-settings": "normal",
  "font-weight": "normal",
  "widget-shadow": "rgba(0, 0, 0, 0.36)",
  contrastBorder: "transparent",
  "scrollbar-shadow": "transparent",
  "sash-hoverBorder": "transparent",
  "list-focusOutline": "transparent",
  "list-inactiveFocusOutline": "transparent",
  "list-focusAndSelectionOutline": "transparent",
  "list-inactiveFocusBackground": "transparent",
  "list-activeSelectionIconForeground": "currentColor",
  "list-inactiveSelectionIconForeground": "currentColor",
  "menu-selectionBorder": "transparent",
  "keybindingTable-headerBackground": "transparent",
  "keybindingTable-rowsBackground": "transparent",
};

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)` (comma or space syntax). Null when not understood. */
export function parseColor(c: string): { r: number; g: number; b: number; a: number } | null {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[5] ? +m[4] / 100 : +m[4] };
  return null;
}

/** `colour` with its alpha multiplied by `alpha`; falls back to a `color-mix` expression for unparseable input. */
export function withAlpha(colour: string, alpha: number): string {
  const p = parseColor(colour);
  if (!p) return `color-mix(in srgb, ${colour} ${Math.round(alpha * 100)}%, transparent)`;
  const a = Math.round(p.a * alpha * 1000) / 1000;
  return `rgba(${Math.round(p.r)}, ${Math.round(p.g)}, ${Math.round(p.b)}, ${a})`;
}

/** Perceived luminance < 0.5 => dark. */
export function isDarkColor(colour: string): boolean {
  const p = parseColor(colour);
  if (!p) return true;
  return (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255 < 0.5;
}

export interface ThemeResult {
  /** Stylesheet text: `:root{ --vscode-…: value; … }` plus a few base rules. */
  css: string;
  dark: boolean;
  vars: Record<string, string>;
}

/** Build the theme stylesheet. `read` returns concrete values for Obsidian variables ("" if unset). */
export function buildTheme(read: ThemeReader, darkHint?: boolean): ThemeResult {
  const vars: Record<string, string> = { ...CONSTANTS };
  for (const e of THEME_MAP) {
    let value = "";
    for (const v of e.from) {
      value = read(v, e.kind).trim();
      if (value) break;
    }
    if (!value) value = e.fallback;
    else if (e.alpha !== undefined) value = withAlpha(value, e.alpha);
    vars[e.name] = value;
  }
  const dark = darkHint ?? isDarkColor(vars["editor-background"]);
  const decls = Object.entries(vars)
    .map(([k, v]) => `--vscode-${k}:${v};`)
    .join("");
  const css =
    `:root{${decls}color-scheme:${dark ? "dark" : "light"};}` +
    `html,body{margin:0;padding:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);` +
    `font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);}`;
  return { css, dark, vars };
}

/** Reader backed by computed styles of `body`: values are resolved to concrete colours / lengths via a probe element. */
export function makeDomResolver(body: HTMLElement): { read: ThemeReader; dispose(): void } {
  const doc = body.ownerDocument;
  const view = doc.defaultView ?? window;
  const probe = doc.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;";
  body.appendChild(probe);
  const bodyStyle = view.getComputedStyle(body);
  const read: ThemeReader = (name, kind) => {
    const raw = bodyStyle.getPropertyValue(name).trim();
    if (!raw) return "";
    if (kind === "raw") return raw;
    const prop = kind === "color" ? "color" : kind === "font" ? "fontFamily" : "fontSize";
    // Reset, then assign through var() so the engine resolves nested var()/hsl()/color-mix() for us.
    probe.style.cssText = "position:absolute;visibility:hidden;width:0;height:0;overflow:hidden;";
    (probe.style as unknown as Record<string, string>)[prop] = `var(${name})`;
    const resolved = view.getComputedStyle(probe).getPropertyValue(kind === "color" ? "color" : kind === "font" ? "font-family" : "font-size").trim();
    return resolved || raw;
  };
  return { read, dispose: () => probe.remove() };
}
