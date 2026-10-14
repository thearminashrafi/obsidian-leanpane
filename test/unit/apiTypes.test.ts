import { describe, expect, it } from "vitest";
import { API_VERSION, getLeanPaneApi, getTeXPaneApi } from "../../src/integration/api-types";

const appWith = (plugins: Record<string, unknown>) => ({ plugins: { plugins } });

describe("api lookup helpers", () => {
  it("find a compatible API through the plugin registry, every time", () => {
    const api = { version: API_VERSION };
    const app = appWith({ leanpane: { api }, texpane: { api } });
    expect(getLeanPaneApi(app)).toBe(api);
    expect(getTeXPaneApi(app)).toBe(api);
  });
  it("return null when absent, disabled (no api), or of another major version", () => {
    expect(getLeanPaneApi({})).toBeNull();
    expect(getLeanPaneApi(appWith({}))).toBeNull();
    expect(getLeanPaneApi(appWith({ leanpane: {} }))).toBeNull();
    expect(getLeanPaneApi(appWith({ leanpane: { api: { version: 2 } } }))).toBeNull();
    expect(getTeXPaneApi(undefined)).toBeNull();
  });
});
