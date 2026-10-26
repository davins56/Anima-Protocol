import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/clerkDiagnostics.test.ts",
      "test/imageUploads.test.ts",
      "test/consumeLlmStream.test.ts",
      "test/chatTelemetry.test.ts",
      "test/chatFailureTypes.sync.test.ts",
      "test/chatClientFailureRoute.test.ts",
      "test/localEnsemble.test.ts",
      "test/chatStreamError.test.ts",
      "test/localLlmWarm.test.ts",
      "test/llmWarmRoute.test.ts",
      "test/llmFailover.test.ts",
      "test/wranglerConfig.test.ts",
      "test/localLlmLive.test.ts",
      "test/localModelCatalog.test.ts",
      "test/modelRouter.test.ts",
      "test/openaiClientKey.test.ts",
      "test/openaiClientCloudHost.test.ts",
      "test/protocolUpgradeRoute.test.ts",
      "test/protocolUpgrade.test.ts",
      "test/repoCodespace.test.ts",
      "test/githubArchive.test.ts",
      "test/supermemory.test.ts",
      // Pure eval-case drift check; run by .github/workflows/llm-eval.yml,
      // which has no Postgres (the default config's setup-db needs one).
      "test/identityEvals.test.ts",
      // Pure prompt helper + client/server parity; no Postgres needed.
      "test/voiceFingerprint.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
  },
});
