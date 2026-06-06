/**
 * Vercel serverless entry for the Express api-server.
 * vercel.json rewrites /api/* here; Express handles routing under /api.
 */
import app from "../artifacts/api-server/dist/vercel.mjs";

export default app;
