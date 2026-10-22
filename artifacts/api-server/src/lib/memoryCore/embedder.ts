/**
 * 768-d text embeddings for memory_events.
 *
 * Provider order (ANIMA_MEMORY_EMBED_PROVIDER = auto | local | workersai | off):
 *   local     — the self-hosted Ollama/vLLM host's OpenAI-compatible /v1/embeddings
 *               (default model nomic-embed-text, 768-d). Keeps companion text on our host,
 *               matching the fail-closed chat policy.
 *   workersai — Cloudflare Workers AI binding `@cf/baai/bge-base-en-v1.5` (768-d).
 * Never sends memory text to a third-party API. When nothing is available the
 * event is stored unembedded and recall falls back to recency + emotional weight.
 */
import { aiBinding } from "../aiBinding";
import { localLlmBaseUrl, normalizeApiKey } from "../openaiClient";

export const MEMORY_EMBED_DIM = 768;
const TIMEOUT_MS = 2500;

export type Embedding = { vector: number[]; model: string };

export type EmbedProvider = "auto" | "local" | "workersai" | "off";

export type EmbedOptions = {
  /** Override ANIMA_MEMORY_EMBED_PROVIDER (the PDF pipeline defaults to local only). */
  provider?: string;
  /** Per-request timeout for the self-hosted host. Default 2500 ms (chat path). */
  timeoutMs?: number;
};

function provider(override?: string): string {
  return (override || process.env.ANIMA_MEMORY_EMBED_PROVIDER || "auto").trim().toLowerCase();
}

async function embedLocal(texts: string[], timeoutMs = TIMEOUT_MS): Promise<Embedding[] | null> {
  const base = localLlmBaseUrl();
  if (!base) return null;
  const model = process.env.ANIMA_MEMORY_EMBED_MODEL?.trim() || "nomic-embed-text";
  const key = normalizeApiKey(process.env.ANIMA_LOCAL_LLM_API_KEY);
  const res = await fetch(`${base.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const out = body.data?.map((d) => ({ vector: d.embedding, model: `local:${model}` })) || null;
  return out && out.every((e) => e.vector?.length === MEMORY_EMBED_DIM) ? out : null;
}

async function embedWorkersAi(texts: string[]): Promise<Embedding[] | null> {
  if (!aiBinding) return null;
  const model = "@cf/baai/bge-base-en-v1.5";
  const result = (await aiBinding.run(model, { text: texts })) as { data?: number[][] };
  const out = result?.data?.map((vector) => ({ vector, model: `workersai:${model}` })) || null;
  return out && out.every((e) => e.vector?.length === MEMORY_EMBED_DIM) ? out : null;
}

export async function embedMemoryTexts(texts: string[], opts: EmbedOptions = {}): Promise<Embedding[] | null> {
  const clean = texts.map((t) => String(t || "").slice(0, 2000)).filter(Boolean);
  if (!clean.length) return null;
  const p = provider(opts.provider);
  if (p === "off") return null;
  try {
    if (p === "local" || p === "auto") {
      const local = await embedLocal(clean, opts.timeoutMs).catch(() => null);
      if (local || p === "local") return local;
    }
    if (p === "workersai" || p === "auto") return await embedWorkersAi(clean).catch(() => null);
  } catch {
    return null;
  }
  return null;
}

const QUERY_CACHE_TTL_MS = 30_000;
const QUERY_CACHE_MAX = 64;
const queryCache = new Map<string, { at: number; promise: Promise<Embedding | null> }>();

/**
 * One query embedding per (provider, text) for ~30 s. A chat turn embeds the
 * same user message for memory recall and for PDF chunk recall in parallel;
 * sharing the in-flight promise means the self-hosted host sees one request.
 */
export function embedQueryCached(text: string, opts: EmbedOptions = {}): Promise<Embedding | null> {
  const clean = String(text || "").slice(0, 2000).trim();
  if (!clean) return Promise.resolve(null);
  const key = `${provider(opts.provider)}\u0000${clean}`;
  const now = Date.now();
  const hit = queryCache.get(key);
  if (hit && now - hit.at < QUERY_CACHE_TTL_MS) return hit.promise;
  const promise = embedMemoryTexts([clean], opts)
    .then((rows) => rows?.[0] || null)
    .catch(() => null);
  queryCache.set(key, { at: now, promise });
  if (queryCache.size > QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  return promise;
}

/** Test hook. */
export function clearQueryEmbeddingCache(): void {
  queryCache.clear();
}

/** pgvector text literal. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x).toFixed(6) : "0")).join(",")}]`;
}
