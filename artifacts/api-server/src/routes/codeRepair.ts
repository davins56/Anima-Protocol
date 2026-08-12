import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../lib/rateLimit";
import { analyzeCodeRepairInput } from "../lib/codeRepair";
import { getLlmRoutingStatus } from "../lib/llmFailover";

const router: IRouter = Router();

router.use(createRateLimit({ name: "code-repair", max: 20, windowMs: 60_000 }));

router.post("/analyze", (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as {
    issue?: unknown;
    context?: Record<string, unknown>;
  };
  const issue = String(body.issue ?? "").trim();
  if (!issue) {
    res.status(400).json({ error: "issue is required" });
    return;
  }

  const routing = getLlmRoutingStatus("standard");
  const analysis = analyzeCodeRepairInput({
    issue,
    context: body.context,
    diagnostics: {
      openrouterConfigured: routing.openrouter.configured,
      openrouterEnv: routing.openrouter.env,
      openrouterModel: routing.openrouter.model,
      openrouterIsFreeTier: routing.openrouter.isFreeTier,
    },
  });

  res.json({
    ...analysis,
    diagnostics: {
      openrouter: {
        configured: routing.openrouter.configured,
        env: routing.openrouter.env,
        model: routing.openrouter.model,
        isFreeTier: routing.openrouter.isFreeTier,
        creditFallback: routing.openrouter.creditFallback,
      },
    },
  });
});

export default router;
