// Chat's side of the own model: should this turn be written on the device,
// write it, and afterwards ask for the turn to become a lesson.
import { animaApi } from "@/api/animaApi";
import { ensureOwnModel, ownModelHistory } from "./client.js";

// A newer model version or a flipped switch reaches open tabs within this.
// (A version that was replaced 404s and forces a fresh read at once.)
const CONFIG_TTL_MS = 5 * 60_000;
let cached = null;
let cachedAt = 0;
let inflight = null;

/**
 * GET /api/model/config, cached for a few minutes. Null when it can't be
 * read (not cached, so the next turn asks again).
 */
export async function loadOwnModelConfig({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < CONFIG_TTL_MS) return cached;
  if (!force && inflight) return inflight;
  const request = animaApi.model
    .config()
    .then((config) => {
      cached = config || null;
      cachedAt = Date.now();
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** Forget the cached config so the next chat turn reads the switches again. */
export function clearOwnModelConfig() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}

const fetchChunk = (version, idx) => animaApi.model.chunk(version, idx);

/**
 * Write this turn's reply with the own model, when it answers this account.
 * Resolves `null` when the normal Anima chain should reply instead; throws
 * when the model should have replied but couldn't (the caller falls back).
 *
 * @param {{ messages: object[], onDelta?: (text: string) => void, onLoading?: () => void }} args
 * @returns {Promise<{ reply: string, version: number, learning: boolean } | null>}
 */
export async function writeOwnModelReply({ messages, onDelta, onLoading }) {
  let config = await loadOwnModelConfig();
  if (!config?.enabled || !config.model) return null;
  let runner;
  try {
    onLoading?.();
    runner = await ensureOwnModel(config.model, fetchChunk);
  } catch (err) {
    // The trainer may have published a newer version (older chunks are
    // dropped): look again once.
    if (err?.status !== 404) throw err;
    config = await loadOwnModelConfig({ force: true });
    if (!config?.enabled || !config.model) return null;
    runner = await ensureOwnModel(config.model, fetchChunk);
  }
  const { text } = await runner.generate(ownModelHistory(messages), { onDelta });
  return { reply: text, version: config.model.version, learning: Boolean(config.learning) };
}

/**
 * After an own-model turn, let the model learn what Anima would have said.
 * Fire-and-forget: the server checks consent, the turn and the mode.
 */
export function queueOwnModelLesson({ turnId, messages }) {
  if (!turnId) return;
  animaApi.model
    .autoLesson({ turnId, context: ownModelHistory(messages) })
    .catch(() => {});
}
