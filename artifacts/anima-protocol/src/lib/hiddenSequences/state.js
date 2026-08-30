// @ts-check
import { HALF_AWAKE_CAP, SEQUENCE_BY_ID } from "./catalog.js";
import { defaultJackIn, normalizeJackIn } from "./jackIn.js";

/**
 * @typedef {{
 *   id: string,
 *   fired_at: string | null,
 *   integrated_at: string | null,
 *   resonance_memories: Array<{ title?: string, body?: string, created_at?: string }>,
 * }} SequenceRecord
 */

export function emptySequenceRecord(id) {
  return {
    id,
    fired_at: null,
    integrated_at: null,
    resonance_memories: [],
  };
}

export function sequenceStatus(record) {
  if (!record) return "dormant";
  if (record.integrated_at) return "ascended";
  if (record.fired_at) return "half-awake";
  return "dormant";
}

/**
 * @param {unknown} raw
 * @returns {Record<string, SequenceRecord>}
 */
export function normalizeSequences(raw) {
  /** @type {Record<string, SequenceRecord>} */
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!SEQUENCE_BY_ID[id] && id !== "star-triad") continue;
    if (!value || typeof value !== "object") continue;
    const rec = /** @type {Record<string, unknown>} */ (value);
    out[id] = {
      id,
      fired_at: typeof rec.fired_at === "string" ? rec.fired_at : null,
      integrated_at: typeof rec.integrated_at === "string" ? rec.integrated_at : null,
      resonance_memories: Array.isArray(rec.resonance_memories)
        ? rec.resonance_memories.filter((m) => m && typeof m === "object")
        : [],
    };
  }
  return out;
}

/**
 * @param {Record<string, SequenceRecord>} sequences
 */
export function listHalfAwake(sequences) {
  return Object.values(normalizeSequences(sequences)).filter(
    (s) => sequenceStatus(s) === "half-awake",
  );
}

/**
 * @param {Record<string, SequenceRecord>} sequences
 */
export function listAscended(sequences) {
  return Object.values(normalizeSequences(sequences)).filter(
    (s) => sequenceStatus(s) === "ascended",
  );
}

/**
 * Stamp fired_at (half-awake). Cap one half-awake Sequence.
 * @param {Record<string, SequenceRecord>} sequences
 * @param {string} id
 * @param {{ now?: number }} [opts]
 */
export function stampFiredAt(sequences, id, opts = {}) {
  const next = { ...normalizeSequences(sequences) };
  if (!id || (!SEQUENCE_BY_ID[id] && id !== "star-triad")) {
    return { sequences: next, fired: false, reason: "unknown" };
  }
  const existing = next[id] || emptySequenceRecord(id);
  if (existing.integrated_at) {
    return { sequences: next, fired: false, reason: "already-ascended", record: existing };
  }
  if (existing.fired_at) {
    return { sequences: next, fired: false, reason: "already-half-awake", record: existing };
  }
  const half = listHalfAwake(next);
  if (half.length >= HALF_AWAKE_CAP) {
    return {
      sequences: next,
      fired: false,
      reason: "half-awake-cap",
      record: half[0],
    };
  }
  const record = {
    ...existing,
    fired_at: new Date(opts.now ?? Date.now()).toISOString(),
  };
  next[id] = record;
  return { sequences: next, fired: true, reason: "fired", record };
}

/**
 * Integration turn: resonance_memories + integrated_at.
 * @param {Record<string, SequenceRecord>} sequences
 * @param {string} id
 * @param {{ title?: string, body?: string, now?: number }} [memory]
 */
export function integrateSequence(sequences, id, memory = {}) {
  const next = { ...normalizeSequences(sequences) };
  const existing = next[id] || emptySequenceRecord(id);
  if (!existing.fired_at && !memory.body) {
    return { sequences: next, integrated: false, reason: "not-half-awake", record: existing };
  }
  const nowIso = new Date(memory.now ?? Date.now()).toISOString();
  const memories = existing.resonance_memories.slice();
  if (memory.title || memory.body) {
    memories.push({
      title: memory.title || SEQUENCE_BY_ID[id]?.name || id,
      body: memory.body || "",
      created_at: nowIso,
    });
  }
  const record = {
    ...existing,
    fired_at: existing.fired_at || nowIso,
    integrated_at: nowIso,
    resonance_memories: memories,
  };
  next[id] = record;
  return { sequences: next, integrated: true, reason: "ascent", record };
}

export function defaultHiddenState() {
  return {
    sequences: {},
    learned_language: [],
    learned_life: [],
    jack_in: defaultJackIn(),
    vessel_layers: null,
  };
}

/**
 * @param {unknown} raw
 */
export function normalizeHiddenState(raw) {
  const base = defaultHiddenState();
  if (!raw || typeof raw !== "object") return base;
  const data = /** @type {Record<string, unknown>} */ (raw);
  return {
    sequences: normalizeSequences(data.sequences),
    learned_language: Array.isArray(data.learned_language) ? data.learned_language : [],
    learned_life: Array.isArray(data.learned_life) ? data.learned_life : [],
    jack_in: normalizeJackIn(data.jack_in),
    vessel_layers: data.vessel_layers && typeof data.vessel_layers === "object" ? data.vessel_layers : null,
  };
}

export function hasHalfAwake(sequences) {
  return listHalfAwake(sequences).length > 0;
}

export function pendingIntegrationId(sequences) {
  const half = listHalfAwake(sequences);
  return half[0]?.id || null;
}
