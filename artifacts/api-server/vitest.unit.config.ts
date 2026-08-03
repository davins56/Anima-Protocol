import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/imageUploads.test.ts",
      "test/llmFailover.test.ts",
      "test/modelRouter.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
  },
});
