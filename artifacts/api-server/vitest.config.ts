import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.ts"],
    environment: "node",
    // The store router talks to the real Postgres DB; keep tests serial so the
    // per-user cleanup in one file can't race another, and give DB round-trips
    // a generous timeout.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
