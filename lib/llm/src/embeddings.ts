/**
 * Embedding utilities for the memory & retrieval layer.
 *
 * Vectors are stored as plain number[] / JSON arrays so the stack works
 * without pgvector. Cosine similarity is computed in-process; when a local
 * OpenAI-compatible embeddings endpoint is available (vLLM, Ollama, or a
 * dedicated embed model), callers can fetch real vectors. Otherwise a
 * deterministic bag-of-words hash embedding keeps retrieval functional offline.
 */

export type EmbeddingVector = number[];

export interface EmbedRequest {
  texts: string[];
  model?: string;
}

export interface EmbedResult {
  embeddings: EmbeddingVector[];
  model: string;
  /** True when vectors came from a real embedding API. */
  semantic: boolean;
}

const DEFAULT_HASH_DIM = 256;

/** Cosine similarity in [-1, 1]. Returns 0 for zero / mismatched vectors. */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** L2-normalize a vector (mutates a copy). */
export function normalizeVector(v: EmbeddingVector): EmbeddingVector {
  let norm = 0;
  for (const x of v) norm += x * x;
  if (norm === 0) return v.slice();
  const scale = 1 / Math.sqrt(norm);
  return v.map((x) => x * scale);
}

/**
 * Deterministic hashed bag-of-words embedding. Useful for tests and as a
 * fallback when no embedding endpoint is configured. Not a substitute for a
 * real semantic model in production, but keeps the retrieval path wired.
 */
export function hashEmbed(text: string, dim = DEFAULT_HASH_DIM): EmbeddingVector {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;
  for (const token of tokens) {
    const h = fnv1a(token);
    const idx = h % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign;
  }
  return normalizeVector(vec);
}

export function hashEmbedBatch(texts: string[], dim = DEFAULT_HASH_DIM): EmbeddingVector[] {
  return texts.map((t) => hashEmbed(t, dim));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Call an OpenAI-compatible `/v1/embeddings` endpoint.
 * Returns null when the endpoint is unreachable or misconfigured so callers
 * can fall back to hash embeddings.
 */
export async function fetchOpenAIEmbeddings(
  texts: string[],
  opts: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<EmbedResult | null> {
  if (texts.length === 0) {
    return { embeddings: [], model: opts.model || "none", semantic: false };
  }

  const baseUrl = (
    opts.baseUrl ||
    process.env.ANIMA_EMBEDDINGS_BASE_URL ||
    process.env.ANIMA_LOCAL_LLM_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (!baseUrl) return null;

  const model =
    opts.model ||
    process.env.ANIMA_EMBEDDINGS_MODEL?.trim() ||
    "text-embedding-3-small";
  const apiKey =
    opts.apiKey ||
    process.env.ANIMA_LOCAL_LLM_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "local";
  const fetchImpl = opts.fetchImpl || fetch;

  try {
    const res = await fetchImpl(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
      model?: string;
    };
    const rows = Array.isArray(data.data) ? data.data : [];
    const embeddings = rows
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => (Array.isArray(row.embedding) ? row.embedding : []));
    if (embeddings.length !== texts.length) return null;
    return {
      embeddings,
      model: data.model || model,
      semantic: true,
    };
  } catch {
    return null;
  }
}

/**
 * Embed texts using a real endpoint when available, otherwise hash embeddings.
 */
export async function embedTexts(
  texts: string[],
  opts: Parameters<typeof fetchOpenAIEmbeddings>[1] = {},
): Promise<EmbedResult> {
  const remote = await fetchOpenAIEmbeddings(texts, opts);
  if (remote) return remote;
  return {
    embeddings: hashEmbedBatch(texts),
    model: "hash-bow-v1",
    semantic: false,
  };
}

/**
 * Rank candidate texts by cosine similarity to a query embedding.
 */
export function rankBySimilarity(
  query: EmbeddingVector,
  candidates: Array<{ id: string; embedding: EmbeddingVector; text?: string }>,
  topK = 12,
): Array<{ id: string; score: number; text?: string }> {
  return candidates
    .map((c) => ({
      id: c.id,
      score: cosineSimilarity(query, c.embedding),
      text: c.text,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
