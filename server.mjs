/**
 * Vercel Fluid compute entry for the Express api-server.
 * Serves /api/* on the same deployment as the Vite frontend so production
 * does not depend on Replit republishes.
 */
import app from "./artifacts/api-server/dist/vercel.mjs";

export default app;
