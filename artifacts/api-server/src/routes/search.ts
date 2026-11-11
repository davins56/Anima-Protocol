/**
 * /api/search — companion web search (server-side provider, filtered, audited).
 *   GET  /status?character_id=   → { enabled, remaining, ... } (drives the chat icon / slash command)
 *   POST /                        { character_id, query, save_as_memory? } → { status, audit_id, results, remaining }
 * The next chat turn passes metadata.web_search_audit_id; the server rebuilds the
 * context from its audit row, so the client can't inject text as "search results".
 */
import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, inArray } from "drizzle-orm";
import { asObject, db, userEntities } from "@workspace/db";
import { createRateLimit } from "../lib/rateLimit";
import { runCompanionSearch, searchStatus } from "../lib/search/searchService";

const router: IRouter = Router();
const burst = createRateLimit({ name: "web-search", max: 10 });

async function ownedCompanion(userId: string, characterId: string): Promise<{ name: string } | null> {
  const [row] = await db
    .select()
    .from(userEntities)
    .where(and(eq(userEntities.userId, userId), inArray(userEntities.entityName, ["Character", "Anima"]), eq(userEntities.entityId, characterId)))
    .limit(1);
  if (!row) return null;
  return { name: String(asObject(row.data).name || "") };
}

function charId(req: Request): string {
  const v = String((req.method === "GET" ? req.query.character_id : (req.body ?? {}).character_id) || "").slice(0, 120);
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : "";
}

router.get("/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return void res.status(401).json({ error: "Unauthorized" });
  const id = charId(req);
  if (!id) return void res.status(400).json({ error: "character_id required" });
  try {
    const c = await ownedCompanion(userId, id);
    if (!c) return void res.status(404).json({ error: "Companion not found" });
    res.json(await searchStatus(userId, id, c.name));
  } catch (err) {
    console.warn("[search] status failed:", (err as Error)?.message);
    res.json({ enabled: false, flag: false, provider_configured: false, daily_limit: 0, remaining: 0, degraded: true });
  }
});

router.post("/", burst, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return void res.status(401).json({ error: "Unauthorized" });
  const id = charId(req);
  if (!id) return void res.status(400).json({ error: "character_id required" });
  try {
    const c = await ownedCompanion(userId, id);
    if (!c) return void res.status(404).json({ error: "Companion not found" });
    const out = await runCompanionSearch({
      userId,
      characterId: id,
      characterName: c.name,
      query: (req.body ?? {}).query,
      saveAsMemory: (req.body ?? {}).save_as_memory === true,
    });
    const code = out.status === "rate_limited" ? 429 : out.status === "disabled" ? 403 : out.status === "not_configured" ? 503 : out.status === "query_blocked" ? 422 : 200;
    res.status(code).json({ status: out.status, audit_id: out.auditId, results: out.results, remaining: out.remaining, reasons: out.reasons });
  } catch (err) {
    console.warn("[search] failed:", (err as Error)?.message);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
