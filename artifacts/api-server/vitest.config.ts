import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.ts"],
    environment: "node",
    // Creates a disposable per-run Postgres schema and points the shared pool at
    // it (via search_path) before any test imports `@workspace/db`, so tests
    // never touch the developer's working data in `public`. Dropped on teardown.
    setupFiles: ["./test/setup-db.ts"],
    // The store router talks to the real Postgres DB; keep tests serial so the
    // per-user cleanup in one file can't race another, and give DB round-trips
    // a generous timeout.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
