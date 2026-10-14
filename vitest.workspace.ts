import { defineWorkspace } from "vitest/config";
import { fileURLToPath } from "node:url";
import { PENDING } from "./test/pending";

const alias = { obsidian: fileURLToPath(new URL("./test/stubs/obsidian.ts", import.meta.url)) };
const common = { testTimeout: 60000, hookTimeout: 60000 };

/**
 * - unit:  fast tests (no Lean needed). `npm test` = the build gate.
 * - lean:  real-Lean integration tests (skip themselves when elan/lake is missing). `npm run test:lean`.
 * - tasks: tests of modules still owned by workers (listed in test/pending.ts). Expected to fail until the module is done;
 *          the integration stage empties PENDING so everything runs in unit/lean.
 */
export default defineWorkspace([
  { resolve: { alias }, test: { name: "unit", include: ["test/unit/**/*.test.ts"], exclude: PENDING, ...common } },
  { resolve: { alias }, test: { name: "lean", include: ["test/lean/**/*.test.ts"], exclude: PENDING, ...common } },
  { resolve: { alias }, test: { name: "tasks", include: PENDING.length ? PENDING : ["test/__none__/**"], ...common } },
]);
