import { defineWorkspace } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = {
  obsidian: fileURLToPath(new URL("./test/stubs/obsidian.ts", import.meta.url)),
  "virtual:infoview-assets": fileURLToPath(new URL("./test/stubs/infoview-assets.ts", import.meta.url)),
};
const common = { testTimeout: 60000, hookTimeout: 60000 };

/**
 * - unit: fast tests (no Lean needed). `npm test` = the build gate.
 * - lean: real-Lean integration tests (skip themselves when elan/lake is missing). `npm run test:lean`.
 */
export default defineWorkspace([
  { resolve: { alias }, test: { name: "unit", include: ["test/unit/**/*.test.ts"], ...common } },
  {
    resolve: { alias: { ...alias, "virtual:infoview-assets": fileURLToPath(new URL("./test/infoview/assets-stub.ts", import.meta.url)) } },
    test: { name: "infoview", include: ["test/infoview/**/*.test.ts"], ...common },
  },
  { resolve: { alias }, test: { name: "lean", include: ["test/lean/**/*.test.ts"], ...common } },
]);
