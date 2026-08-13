import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/imageUploads.test.ts",
      // Was "test/llmEnsemble.test.ts" — no such file, so vitest silently ran
      // nothing for the ensemble path.
      "test/consumeLlmStream.test.ts",
      "test/localEnsemble.test.ts",
      "test/llmFailover.test.ts",
      "test/localLlmLive.test.ts",
      "test/localModelCatalog.test.ts",
      "test/modelRouter.test.ts",
      "test/openaiClientKey.test.ts",
      "test/openaiClientCloudHost.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
  },
});
