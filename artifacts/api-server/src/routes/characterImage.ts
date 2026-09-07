import { Router } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";

const router = Router();
// Scope the limiter to this router's own path. This router is mounted without a
// path prefix, so an unscoped `router.use(rateLimit)` would run for every /api
// request passing through (e.g. /api/store/*) and exhaust the shared IP budget.
router.use("/character-image", rateLimit);
router.use("/character-image", (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

const WIKI_HEADERS = { "User-Agent": "AnimaProtocol/1.0 (character portrait lookup)" };
/** Cap each Wikipedia hop so a missing original (e.g. Alyndra) cannot hang the Worker. */
export const WIKI_FETCH_TIMEOUT_MS = 2500;
/** Whole-lookup ceiling across sequential Wikipedia hops. */
export const CHARACTER_IMAGE_LOOKUP_BUDGET_MS = 6000;

async function wikiFetch(url: string): Promise<Response | null> {
  try {
    const r = await fetch(url, {
      headers: WIKI_HEADERS,
      signal: AbortSignal.timeout(WIKI_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    return r;
  } catch {
    return null;
  }
}

// Find the best-matching Wikipedia article title for a free-text query.
async function wikiSearchTitle(query: string): Promise<string | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
    `&srlimit=1&format=json&origin=*`;
  const r = await wikiFetch(url);
  if (!r) return null;
  const data: any = await r.json();
  return data?.query?.search?.[0]?.title || null;
}

// True when an article title plausibly refers to the character itself, not a
// fallback franchise/show page. Wikipedia search often resolves a minor
// character (e.g. "Asami Sato") to the parent work ("The Legend of Korra"),
// whose lead image is a logo — returning that produces a wrong/ugly avatar. We
// require the resolved title to share a distinctive token with the character's
// name before trusting its image.
export function titleMatchesName(title: string, name: string): boolean {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (!tokens.length) return true;
  const t = title.toLowerCase();
  return tokens.some((tok) => t.includes(tok));
}

// Pull the lead image for an article via the REST summary endpoint. Unlike the
// PageImages API (which only returns freely-licensed Commons images and so
// misses almost every fictional character), the REST summary returns the
// article's actual lead image, including fair-use character art.
async function wikiImageForTitle(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title,
  )}`;
  const r = await wikiFetch(url);
  if (!r) return null;
  const data: any = await r.json();
  return data?.originalimage?.source || data?.thumbnail?.source || null;
}

// GET /api/character-image?name=...&universe=...
// Searches the web (Wikipedia) for a representative photo of a character.
// Returns { url } (string or null). Auth is 401; missing name is 400;
// lookup misses and Wikipedia failures are 200 { url: null }.
router.get("/character-image", async (req, res) => {
  const name = String(req.query.name || "").trim();
  const universe = String(req.query.universe || "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required", url: null });
    return;
  }

  // Try most-specific queries first, then fall back to the bare name.
  const queries = [
    universe ? `${name} ${universe}` : null,
    universe ? `${name} (${universe} character)` : null,
    `${name} character`,
    name,
  ].filter(Boolean) as string[];

  try {
    const tried = new Set<string>();
    const deadline = Date.now() + CHARACTER_IMAGE_LOOKUP_BUDGET_MS;
    for (const q of queries) {
      if (Date.now() > deadline) break;
      const title = await wikiSearchTitle(q);
      if (!title || tried.has(title)) continue;
      tried.add(title);
      // Skip pages that resolved to the franchise/show rather than the
      // character (their lead image is a logo, not a portrait).
      if (!titleMatchesName(title, name)) continue;
      const img = await wikiImageForTitle(title);
      if (img) {
        res.json({ url: img, title, source: "wikipedia" });
        return;
      }
    }
    res.json({ url: null });
  } catch {
    // Missing / original names must not 502 the look hub. Treat lookup
    // failure as "no photo" so Upload Photo / Generate Look stay available.
    res.json({ url: null });
  }
});

export default router;
