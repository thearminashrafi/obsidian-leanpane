import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests of src/infoview (pure pieces + the host against a fake DOM/iframe). Run: npx vitest run -c test/infoview/vitest.config.ts
export default defineConfig({
  resolve: { alias: { "virtual:infoview-assets": fileURLToPath(new URL("./assets-stub.ts", import.meta.url)) } },
  test: { name: "infoview", include: ["test/infoview/**/*.test.ts"], root: fileURLToPath(new URL("../..", import.meta.url)) },
});
