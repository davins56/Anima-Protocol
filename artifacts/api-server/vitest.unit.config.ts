import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/clerkDiagnostics.test.ts",
      "test/imageUploads.test.ts",
      "test/companionPhotos.test.ts",
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
      // Chat mind: pure ranking / parsing / guards / prompt sizing.
      "test/mindRecall.test.ts",
      "test/mindFactsSummary.test.ts",
      "test/mindGuards.test.ts",
      "test/mindPrompt.test.ts",
      "test/mindSharedFacts.test.ts",
      "test/mindIdentity.test.ts",
      // Long replies: hosted output room, Workers AI cap detection, clean ends.
      "test/replyCutoff.test.ts",
      // /openai/invoke must not use AsyncLocalStorage.enterWith (Workers lacks it).
      "test/invokeAsyncScope.test.ts",
      // Deleting a message: what the mind forgets (mocked pool).
      "test/mindForgetMessage.test.ts",
      "test/chatStyle.test.ts",
      "test/chatModeRegistry.test.ts",
      "test/promptBuilder.test.ts",
      "test/companionPromptBudget.test.ts",
      "test/safetyGates.test.ts",
      "test/characterResearch.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
  },
});
