import { defineConfig } from "vitest/config";

// Offline chat-mind eval. Pure (no Postgres); calls Workers AI only when
// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set.
export default defineConfig({
  test: {
    include: ["eval/**/*.eval.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 180000,
  },
});
