import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai/index";
import openaiFunctionsRouter from "./openai/functions";
import elevenLabsRouter from "./elevenlabs";
import characterImageRouter from "./characterImage";
import storeRouter from "./store";
import storageRouter from "./storage";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/openai", openaiRouter);
router.use("/openai", openaiFunctionsRouter);
router.use(elevenLabsRouter);
router.use(characterImageRouter);
router.use("/chat", chatRouter);
router.use("/store", storeRouter);
router.use(storageRouter);

router.get("/placeholder/:w/:h", (req, res) => {
  const w = Math.min(Number(req.params.w) || 150, 1200);
  const h = Math.min(Number(req.params.h) || 150, 1200);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#1a1a2e"/><text x="50%" y="50%" font-family="monospace" font-size="12" fill="#22d3ee" text-anchor="middle" dominant-baseline="middle">${w}×${h}</text></svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

export default router;
