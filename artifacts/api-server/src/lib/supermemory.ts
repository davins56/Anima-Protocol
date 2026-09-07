/**
 * Best-effort supermemory.ai dual-write / recall for companion facts.
 *
 * Postgres CharacterMemory / companion_memories remains the source of truth.
 * When SUPERMEMORY_API_KEY is set, distilled facts are also written to
 * supermemory and search hits can be merged into the prompt. Failures never
 * block chat — the local log still answers.
 *
 * Canonical API (https://supermemory.ai/docs):
 *   Authorization: Bearer $SUPERMEMORY_API_KEY
 *   Write:  POST /v4/memories
 *   Search: POST /v4/search
 *   Scope:  containerTag (singular) in the JSON body
 */

export interface SupermemoryHit {
  text: string;
  score: number;
  characterId?: string;
  category?: string;
}

export interface SupermemoryWriteFact {
  text: string;
  category?: string;
  factId?: string;
  sessionId?: string;
}

const DEFAULT_BASE = "https://api.supermemory.ai";
const DEFAULT_TIMEOUT_MS = 2500;

export function supermemoryApiKey(): string {
  return (process.env.SUPERMEMORY_API_KEY || "").trim();
}

export function isSupermemoryEnabled(): boolean {
  if (!supermemoryApiKey()) return false;
  const flag = (process.env.ANIMA_SUPERMEMORY_ENABLED || "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  return true;
}

export function supermemoryBaseUrl(): string {
  return (
    process.env.ANIMA_SUPERMEMORY_BASE_URL ||
    process.env.SUPERMEMORY_BASE_URL ||
    DEFAULT_BASE
  )
    .trim()
    .replace(/\/+$/, "");
}

/** containerTag allows [a-zA-Z0-9_:-], max 100. Clerk ids already match. */
export function companionContainerTag(
  userId: string,
  characterId?: string,
): string {
  const clean = (value: string) =>
    value.replace(/[^a-zA-Z0-9_:-]/g, "_").replace(/_+/g, "_").slice(0, 60);
  const user = clean(userId || "anon") || "anon";
  if (!characterId) return `anima-user-${user}`.slice(0, 100);
  return `anima-${user}-${clean(characterId)}`.slice(0, 100);
}

function timeoutMs(): number {
  const raw = Number(process.env.ANIMA_SUPERMEMORY_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 200) return Math.min(8000, raw);
  return DEFAULT_TIMEOUT_MS;
}

async function supermemoryFetch(
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown | null> {
  const key = supermemoryApiKey();
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetchImpl(`${supermemoryBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function writeCompanionFactsToSupermemory(opts: {
  userId: string;
  characterId: string;
  facts: SupermemoryWriteFact[];
  fetchImpl?: typeof fetch;
}): Promise<number> {
  if (!isSupermemoryEnabled()) return 0;
  const facts = opts.facts
    .map((f) => ({
      ...f,
      text: (f.text || "").trim(),
    }))
    .filter((f) => f.text.length > 0)
    .slice(0, 100);
  if (facts.length === 0) return 0;

  const payload = {
    containerTag: companionContainerTag(opts.userId, opts.characterId),
    memories: facts.map((f) => ({
      content: f.text.slice(0, 10000),
      isStatic: true,
      metadata: {
        source: "anima-character-memory",
        character_id: opts.characterId,
        category: f.category || "general",
        ...(f.factId ? { fact_id: f.factId } : {}),
        ...(f.sessionId ? { session_id: f.sessionId } : {}),
      },
    })),
  };

  const data = await supermemoryFetch(
    "/v4/memories",
    payload,
    opts.fetchImpl,
  );
  return data ? facts.length : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function collectHitText(row: Record<string, unknown>): string {
  const direct = [row.memory, row.content, row.text, row.chunk]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find(Boolean);
  if (direct) return direct;
  const chunks = row.chunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      const rec = asRecord(chunk);
      const text =
        (typeof rec?.content === "string" && rec.content.trim()) ||
        (typeof rec?.text === "string" && rec.text.trim()) ||
        "";
      if (text) return text;
    }
  }
  return "";
}

function parseHits(data: unknown): SupermemoryHit[] {
  const root = asRecord(data);
  if (!root) return [];
  const rows = [root.results, root.memories, root.data].find(Array.isArray) as
    | unknown[]
    | undefined;
  if (!rows) return [];
  const hits: SupermemoryHit[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const text = collectHitText(rec);
    if (!text) continue;
    const meta = asRecord(rec.metadata) || {};
    const scoreRaw = rec.score ?? rec.similarity ?? rec.relevance;
    const score =
      typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : 0.6;
    hits.push({
      text,
      score,
      characterId:
        typeof meta.character_id === "string" ? meta.character_id : undefined,
      category: typeof meta.category === "string" ? meta.category : undefined,
    });
  }
  return hits;
}

export async function searchCompanionFactsFromSupermemory(opts: {
  userId: string;
  characterId?: string;
  query: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<SupermemoryHit[]> {
  if (!isSupermemoryEnabled()) return [];
  const query = opts.query.trim();
  if (!query) return [];
  const limit = Math.max(1, Math.min(24, opts.limit ?? 8));
  const data = await supermemoryFetch(
    "/v4/search",
    {
      q: query.slice(0, 2000),
      containerTag: companionContainerTag(opts.userId, opts.characterId),
      limit,
      threshold: 0.5,
      searchMode: "memories",
    },
    opts.fetchImpl,
  );
  return parseHits(data).slice(0, limit);
}

export function mergeRemoteFactsIntoMemories<
  T extends { characterId: string; facts?: unknown[] },
>(
  memories: T[],
  hits: SupermemoryHit[],
  fallbackCharacterId?: string,
): T[] {
  if (hits.length === 0) return memories;
  const seen = new Set<string>();
  for (const memory of memories) {
    for (const raw of memory.facts || []) {
      const text =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object"
            ? String((raw as { text?: unknown; fact?: unknown }).text ||
                (raw as { fact?: unknown }).fact ||
                "")
            : "";
      const key = text.toLowerCase().replace(/\s+/g, " ").trim();
      if (key) seen.add(key);
    }
  }

  const extras = new Map<string, Record<string, unknown>[]>();
  for (const hit of hits) {
    const key = hit.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const characterId = hit.characterId || fallbackCharacterId || "";
    if (!characterId) continue;
    const list = extras.get(characterId) || [];
    list.push({
      type: hit.category || "factual",
      text: hit.text,
      source: "supermemory",
    });
    extras.set(characterId, list);
  }
  if (extras.size === 0) return memories;

  const next = memories.map((memory) => {
    const add = extras.get(memory.characterId);
    if (!add?.length) return memory;
    extras.delete(memory.characterId);
    return {
      ...memory,
      facts: [...(memory.facts || []), ...add],
    };
  });
  for (const [characterId, facts] of extras) {
    next.push({ characterId, facts } as T);
  }
  return next;
}
