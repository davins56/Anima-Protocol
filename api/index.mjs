/**
 * Vercel API entry — overwritten by `pnpm --filter @workspace/api-server run build`
 * with a self-contained Express bundle. Local fallback imports dist output.
 */
import app from "../artifacts/api-server/dist/vercel.mjs";

export default app;
