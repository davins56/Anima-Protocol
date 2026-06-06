/**
 * Vercel serverless entry for the Express api-server.
 * vercel.json rewrites /api/* here; Express handles routing under /api.
 * The bundle is copied to ./server.mjs during api-server build.
 */
import app from "./server.mjs";

export default app;
