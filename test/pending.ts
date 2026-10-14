/**
 * Test files whose module is still owned by a worker task (docs/tasks). They are excluded from the `unit`/`lean`
 * projects and run in the `tasks` project instead (`npm run test:tasks`). When a task is done and integrated,
 * remove its test file from this list.
 */
export const PENDING: string[] = [
  "test/unit/server.fake.test.ts",
  "test/lean/server.test.ts",
  "test/unit/elan.test.ts",
  "test/lean/elan.real.test.ts",
  "test/unit/projects.test.ts",
  "test/unit/documents.test.ts",
  "test/unit/liveStatus.test.ts",
  "test/unit/goals.test.ts",
  "test/unit/statusQuery.test.ts",
  "test/lean/statusQuery.test.ts",
  "test/unit/leanLanguage.test.ts",
  "test/unit/templates.test.ts",
];
