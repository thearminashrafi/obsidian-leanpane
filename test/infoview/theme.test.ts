import { describe, expect, it } from "vitest";
import { buildTheme, isDarkColor, parseColor, THEME_MAP, withAlpha } from "../../src/infoview/theme";

describe("theme mapping", () => {
  const values: Record<string, string> = {
    "--background-primary": "rgb(30, 30, 46)",
    "--text-normal": "#cdd6f4",
    "--font-monospace": "Fira Code, monospace",
    "--code-size": "13px",
    "--color-green": "rgb(0, 200, 0)",
    "--text-error": "rgb(255, 0, 0)",
    "--interactive-accent": "rgb(127, 109, 242)",
  };
  const read = (n: string) => values[n] ?? "";

  it("maps Obsidian variables to --vscode-* with concrete values", () => {
    const t = buildTheme(read);
    expect(t.vars["editor-background"]).toBe("rgb(30, 30, 46)");
    expect(t.vars["editor-foreground"]).toBe("#cdd6f4");
    expect(t.vars["foreground"]).toBe("#cdd6f4");
    expect(t.vars["editor-font-family"]).toBe("Fira Code, monospace");
    expect(t.vars["editor-font-size"]).toBe("13px");
    expect(t.vars["button-background"]).toBe("rgb(127, 109, 242)");
    expect(t.css).toContain("--vscode-editor-background:rgb(30, 30, 46);");
    expect(Object.values(t.vars).some((v) => v.includes("var("))).toBe(false);
  });
  it("uses fallbacks for unavailable variables and applies alpha to diff colours", () => {
    const t = buildTheme(read);
    expect(t.vars["disabledForeground"]).toBe("#8c8c8c");
    expect(t.vars["diffEditor-insertedTextBackground"]).toBe("rgba(0, 200, 0, 0.25)");
    expect(t.vars["diffEditor-removedTextBackground"]).toBe("rgba(255, 0, 0, 0.25)");
  });
  it("covers every variable the infoview CSS names that is not purely decorative", () => {
    const names = new Set([...THEME_MAP.map((e) => e.name)]);
    for (const n of ["editor-background", "editor-foreground", "editorHoverWidget-background", "editorHoverWidget-border", "editor-selectionBackground", "textCodeBlock-background", "button-background", "errorForeground", "focusBorder", "lean4-infoView\\.turnstile"]) {
      expect(names.has(n)).toBe(true);
    }
  });
  it("detects dark vs light from the background unless hinted", () => {
    expect(buildTheme(read).dark).toBe(true);
    expect(buildTheme((n) => (n === "--background-primary" ? "#ffffff" : "")).dark).toBe(false);
    expect(buildTheme(read, false).css).toContain("color-scheme:light");
  });
  it("parses and blends colours", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("rgb(1 2 3 / 50%)")?.a).toBeCloseTo(0.5);
    expect(parseColor("hotpink")).toBeNull();
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(withAlpha("hotpink", 0.5)).toContain("color-mix");
    expect(isDarkColor("#000")).toBe(true);
    expect(isDarkColor("#fff")).toBe(false);
  });
});
