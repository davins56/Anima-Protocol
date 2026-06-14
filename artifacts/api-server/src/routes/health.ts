import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!process.env.CLERK_SECRET_KEY) throw new Error("Missing CLERK_SECRET_KEY");

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
export * from "./admin";
export * from "./characterImage";
export * from "./chat";
export * from "./elevenlabs";
export * from "./openai";
export * from "./store";
export * from "./storage";

//# sourceMappingURL=health.js.map
