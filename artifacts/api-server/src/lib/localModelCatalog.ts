// What the self-hosted Anima LLM endpoint *actually* serves.
//
// The configured tag (ANIMA_OLLAMA_MODEL_STANDARD, default `anima-chat`) and
// the model the host really has loaded drift apart constantly in practice:
//
//   - `ollama create anima-chat -f Modelfile.anima-chat` was never run on the
//     box, so it only serves the base weights (`qwen2.5:3b`).
//   - Ollama registered the tag as `anima-chat:latest` and the gateway in
//     front of it does not do the implicit `:latest` resolution Ollama does.
//   - ANIMA_LOCAL_LLM_BASE_URL points at a vLLM host serving a HF repo id,
//     or at some other OpenAI-compatible gateway with its own model names.
//
// Every one of those produces the same dead end for the user: a 404 like
// "The model `anima-chat` does not exist or you do not have access to it",
// on every single turn, forever, because nothing in the request path ever
// asks the server what it can actually run.
//
// This module asks. `/v1/models` is part of the OpenAI-compatible surface
// that Ollama, vLLM and llama.cpp all implement, so one cheap (cached) call
// turns an unrecoverable 404 into a working turn on whatever model is there.

import type OpenAI from "openai";
import { localLlmBaseUrl } from "./openaiClient";

/** How long a successful `/v1/models` listing is trusted. */
const CATALOG_TTL_MS = 60_000;
/** Shorter TTL after a failed listing so a booting host recovers quickly. */
const CATALOG_ERROR_TTL_MS = 10_000;
/**
 * How long a "configured tag X → really serve Y" substitution sticks. Long
 * enough that a chat session never re-pays the 404 round trip, short enough
 * that fixing the host (creating the real `anima-chat` tag) takes effect
 * without a redeploy.
 */
const SUBSTITUTION_TTL_MS = 10 * 60_000;
/** Hard deadline on the discovery call so it can never hang a chat turn. */
const CATALOG_TIMEOUT_MS = 5_000;

/**
 * Model ids that are served over the same OpenAI-compatible API but cannot
 * hold a conversation. Picking one of these as a chat substitute would turn
 * a clear 404 into a confusing garbage reply, which is strictly worse.
 */
const NON_CHAT_MODEL_RE =
  /(embed|embedding|nomic|bge-|gte-|e5-|rerank|whisper|tts|voice|dall-?e|clip|moderation|stable-?diffusion|sdxl|flux)/i;

/** Open-weight families this project actually ships against (see lib/llm/src/registry.ts). */
const KNOWN_CHAT_FAMILY_RE = /(qwen|ministral|mistral|llama|phi|gemma|deepseek|hermes|olmo)/i;

interface CatalogEntry {
  models: string[];
  ok: boolean;
  error: string | null;
  expiresAt: number;
}

interface Substitution {
  model: string;
  expiresAt: number;
}

const catalogByBaseUrl = new Map<string, CatalogEntry>();
const substitutions = new Map<string, Substitution>();

function cacheKey(): string {
  return localLlmBaseUrl() ?? "(unconfigured)";
}

/** Ollama reports `anima-chat:latest`; operators write `anima-chat`. Same model. */
function normalizeModelId(id: string): string {
  return id.trim().toLowerCase().replace(/:latest$/, "");
}

/**
 * Read the model ids out of whatever `/v1/models` returned. The OpenAI SDK
 * gives back a page object, but self-hosted servers vary enough that it is
 * worth accepting a bare array or an async-iterable page too.
 */
async function extractModelIds(page: unknown): Promise<string[]> {
  const ids: string[] = [];
  const push = (entry: unknown) => {
    if (!entry) return;
    const id =
      typeof entry === "string"
        ? entry
        : typeof (entry as { id?: unknown }).id === "string"
          ? ((entry as { id: string }).id)
          : null;
    if (id && id.trim()) ids.push(id.trim());
  };

  if (Array.isArray(page)) {
    page.forEach(push);
    return ids;
  }
  const data = (page as { data?: unknown })?.data;
  if (Array.isArray(data)) {
    data.forEach(push);
    return ids;
  }
  if (page && typeof (page as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
    for await (const entry of page as AsyncIterable<unknown>) push(entry);
  }
  return ids;
}

export interface LocalModelCatalog {
  /** Model ids the endpoint reports, in the order it reported them. */
  models: string[];
  /** False when `/v1/models` errored or the server does not implement it. */
  ok: boolean;
  /** Secret-free reason the listing failed, when it did. */
  error: string | null;
  /** True when this came from the TTL cache rather than a fresh call. */
  cached: boolean;
}

/**
 * List the models the configured endpoint serves, cached per base URL.
 * Never throws — a host that does not implement `/v1/models` (some llama.cpp
 * builds) just yields an empty catalog and the caller carries on.
 */
export async function listLocalModels(
  client: OpenAI,
  opts: { force?: boolean } = {},
): Promise<LocalModelCatalog> {
  const key = cacheKey();
  const now = Date.now();
  const cached = catalogByBaseUrl.get(key);
  if (!opts.force && cached && cached.expiresAt > now) {
    return { models: cached.models, ok: cached.ok, error: cached.error, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const page = await client.models.list({ signal: controller.signal });
    const models = await extractModelIds(page);
    catalogByBaseUrl.set(key, {
      models,
      ok: true,
      error: null,
      expiresAt: now + CATALOG_TTL_MS,
    });
    return { models, ok: true, error: null, cached: false };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 160);
    catalogByBaseUrl.set(key, {
      models: [],
      ok: false,
      error,
      expiresAt: now + CATALOG_ERROR_TTL_MS,
    });
    return { models: [], ok: false, error, cached: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rank how good a substitute `candidate` is for the model the operator asked
 * for. Higher is better; a negative score means "never pick this".
 */
function scoreCandidate(preferred: string, candidate: string): number {
  const want = normalizeModelId(preferred);
  const have = normalizeModelId(candidate);
  if (!have) return -1;
  // An embedding / image / audio model can answer the HTTP call but not the user.
  if (NON_CHAT_MODEL_RE.test(have)) return -1;
  if (want && have === want) return 1000;
  // `anima-chat` vs `anima-chat-q4` vs `anima-chat:8b` — same model, retagged.
  if (want && (have.startsWith(want) || want.startsWith(have))) return 900;
  // Anything the operator branded as ours is a better guess than a base model.
  if (/^anima/.test(have)) return 800;
  // The open-weight families this project is actually built and tested on.
  if (KNOWN_CHAT_FAMILY_RE.test(have)) return 600;
  // Unknown but plausibly a chat model — better than failing the turn.
  return 100;
}

/**
 * Best available stand-in for `preferred`, or null when the endpoint serves
 * nothing usable for chat. Stable: equal-scoring ids keep the server's order,
 * so the same host keeps resolving to the same model turn after turn.
 */
export function chooseLocalModel(preferred: string, available: string[]): string | null {
  let best: { model: string; score: number } | null = null;
  for (const candidate of available) {
    const score = scoreCandidate(preferred, candidate);
    if (score < 0) continue;
    if (!best || score > best.score) best = { model: candidate.trim(), score };
  }
  return best?.model ?? null;
}

/**
 * Remember that `preferred` is not served here and `actual` is what worked.
 * The next turn goes straight to `actual` instead of re-earning the 404 —
 * this is what makes replies consistent rather than "sometimes slow, always
 * one wasted round trip".
 */
export function rememberModelSubstitution(preferred: string, actual: string): void {
  if (!preferred || !actual || normalizeModelId(preferred) === normalizeModelId(actual)) return;
  substitutions.set(`${cacheKey()}::${normalizeModelId(preferred)}`, {
    model: actual,
    expiresAt: Date.now() + SUBSTITUTION_TTL_MS,
  });
}

/** The remembered stand-in for `preferred`, if one is still fresh. */
export function getRememberedModel(preferred: string): string | null {
  const key = `${cacheKey()}::${normalizeModelId(preferred)}`;
  const hit = substitutions.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    substitutions.delete(key);
    return null;
  }
  return hit.model;
}

/** Drop a remembered stand-in that has itself stopped working. */
export function forgetModelSubstitution(preferred: string): void {
  substitutions.delete(`${cacheKey()}::${normalizeModelId(preferred)}`);
}

/**
 * Operator-facing explanation of a model 404 that names the fix. The old
 * message ("The model `anima-chat` does not exist or you do not have access
 * to it") is true but tells nobody what to do about it.
 */
export function describeModelMismatch(preferred: string, available: string[]): string {
  const host = (() => {
    const base = localLlmBaseUrl();
    if (!base) return "the configured endpoint";
    try {
      return new URL(base).host;
    } catch {
      return "the configured endpoint";
    }
  })();

  if (!available.length) {
    return (
      `The Anima LLM at ${host} does not serve a model named "${preferred}", and it reported no models at all. ` +
      `Check that the host is running and has weights loaded — on Ollama: ` +
      `\`ollama create ${preferred} -f scripts/llm/Modelfile.anima-chat\`. See docs/custom-llm.md.`
    );
  }

  const shown = available.slice(0, 10).join(", ");
  const more = available.length > 10 ? `, +${available.length - 10} more` : "";
  return (
    `The Anima LLM at ${host} does not serve a model named "${preferred}". ` +
    `It serves: ${shown}${more}. ` +
    `Either create the expected tag (\`ollama create ${preferred} -f scripts/llm/Modelfile.anima-chat\`) ` +
    `or point ANIMA_OLLAMA_MODEL_LIGHT/_STANDARD/_HEAVY at one of the ids above, then redeploy. See docs/custom-llm.md.`
  );
}

/** Test helper — clears discovery + substitution state between cases. */
export function resetLocalModelCatalogForTests(): void {
  catalogByBaseUrl.clear();
  substitutions.clear();
}
