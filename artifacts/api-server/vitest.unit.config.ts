import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/clerkDiagnostics.test.ts",
      "test/imageUploads.test.ts",
      "test/consumeLlmStream.test.ts",
      "test/localEnsemble.test.ts",
      "test/llmFailover.test.ts",
      "test/localLlmLive.test.ts",
      "test/localModelCatalog.test.ts",
      "test/modelRouter.test.ts",
      "test/openaiClientKey.test.ts",
      "test/openaiClientCloudHost.test.ts",
      "test/llmEnsemble.test.ts",
      "test/protocolUpgradeRoute.test.ts",
      "test/protocolUpgrade.test.ts",
      "test/repoCodespace.test.ts",
      "test/githubArchive.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
  },
});
