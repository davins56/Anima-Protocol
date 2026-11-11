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

function provider(): string {
  return (process.env.ANIMA_MEMORY_EMBED_PROVIDER || "auto").trim().toLowerCase();
}

async function embedLocal(texts: string[]): Promise<Embedding[] | null> {
  const base = localLlmBaseUrl();
  if (!base) return null;
  const model = process.env.ANIMA_MEMORY_EMBED_MODEL?.trim() || "nomic-embed-text";
  const key = normalizeApiKey(process.env.ANIMA_LOCAL_LLM_API_KEY);
  const res = await fetch(`${base.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

export async function embedMemoryTexts(texts: string[]): Promise<Embedding[] | null> {
  const clean = texts.map((t) => String(t || "").slice(0, 2000)).filter(Boolean);
  if (!clean.length) return null;
  const p = provider();
  if (p === "off") return null;
  try {
    if (p === "local" || p === "auto") {
      const local = await embedLocal(clean).catch(() => null);
      if (local || p === "local") return local;
    }
    if (p === "workersai" || p === "auto") return await embedWorkersAi(clean).catch(() => null);
  } catch {
    return null;
  }
  return null;
}

/** pgvector text literal. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x).toFixed(6) : "0")).join(",")}]`;
}
