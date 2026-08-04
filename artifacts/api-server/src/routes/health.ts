import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getConfiguredProviderName, getProviderFallbackChain } from "../lib/modelProvider";

const router: IRouter = Router();

if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!process.env.CLERK_SECRET_KEY) throw new Error("Missing CLERK_SECRET_KEY");

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  const fallbackChain = getProviderFallbackChain();
  res.json({
    ...data,
    provider: {
      configured: getConfiguredProviderName(),
      fallback_chain: fallbackChain.providers,
      mock_available: fallbackChain.providers.includes("mock"),
    },
  });
});

export default router;
