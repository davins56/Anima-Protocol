// @ts-check
import { EQUAL_WELL_RATIO, LANGUAGE_NOTE_CAP } from "./catalog.js";

const GRAIN_STOP =
  /^(the|a|an|and|or|but|to|of|in|on|for|with|you|i|we|it|is|are|was|be|this|that|not|my|your|me)$/i;
const INSTRUCTION_RE =
  /\b(ignore|disregard|forget|override|you are now|act as|pretend to be|system prompt|new instructions?)\b/i;

/**
 * @param {unknown} raw
 */
export function normalizeLanguageNotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n) => n && typeof n === "object" && typeof n.grain === "string")
    .map((n) => ({
      id: String(n.id || n.grain),
      grain: String(n.grain).trim().slice(0, 48),
      repeats: Number(n.repeats) || 1,
      identity_locked: n.identity_locked === true,
      created_at: typeof n.created_at === "string" ? n.created_at : null,
      last_heard_at: typeof n.last_heard_at === "string" ? n.last_heard_at : null,
    }))
    .filter((n) => n.grain && !INSTRUCTION_RE.test(n.grain));
}

export function identityLockWins(grain, identityText) {
  const g = String(grain || "").trim().toLowerCase();
  if (!g) return false;
  if (INSTRUCTION_RE.test(g)) return true;
  const identity = String(identityText || "").toLowerCase();
  if (!identity) return false;
  // A command-shaped grain that contradicts an existing voice phrase loses.
  if (/^(always|never|you must|from now on)\b/.test(g) && identity.length > 0) {
    return true;
  }
  return false;
}

function wellCap(languageCount, experienceCount) {
  const total = languageCount + experienceCount;
  if (total < 3) return Infinity;
  return Math.ceil(total * EQUAL_WELL_RATIO);
}

/**
 * Add a repeated grain. First mention is ignored. Cap 12. Identity lock wins.
 * Equal wells vs experience.
 *
 * @param {unknown[]} language
 * @param {string} grain
 * @param {{
 *   identityText?: string,
 *   experienceCount?: number,
 *   now?: number,
 * }} [opts]
 */
export function addLanguageGrain(language, grain, opts = {}) {
  const notes = normalizeLanguageNotes(language);
  const cleaned = String(grain || "").trim().replace(/\s+/g, " ").slice(0, 48);
  if (!cleaned || cleaned.length < 3 || GRAIN_STOP.test(cleaned)) {
    return { notes, added: false, reason: "weak-grain" };
  }
  if (INSTRUCTION_RE.test(cleaned) || identityLockWins(cleaned, opts.identityText)) {
    return { notes, added: false, reason: "identity-lock" };
  }
  const key = cleaned.toLowerCase();
  const existing = notes.find((n) => n.grain.toLowerCase() === key);
  const nowIso = new Date(opts.now ?? Date.now()).toISOString();
  if (existing) {
    existing.repeats += 1;
    existing.last_heard_at = nowIso;
    return { notes, added: false, reason: "repeat", note: existing };
  }
  // First sighting is stored as repeats:1 but not "bonded" until it repeats.
  // We still record it so the next occurrence can promote.
  const experienceCount = Number(opts.experienceCount) || 0;
  if (notes.length >= LANGUAGE_NOTE_CAP) {
    const dropAt = notes.findIndex((n) => !n.identity_locked && n.repeats < 2);
    if (dropAt < 0) return { notes, added: false, reason: "cap" };
    notes.splice(dropAt, 1);
  }
  if (notes.length >= wellCap(notes.length + 1, experienceCount)) {
    return { notes, added: false, reason: "equal-wells" };
  }
  const note = {
    id: `lang_${key.replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
    grain: cleaned,
    repeats: 1,
    identity_locked: false,
    created_at: nowIso,
    last_heard_at: nowIso,
  };
  notes.push(note);
  return { notes, added: true, reason: "noted", note };
}

/**
 * Promote grains that have now repeated in this turn.
 * @param {unknown[]} language
 * @param {string} text
 * @param {{ identityText?: string, experienceCount?: number, now?: number }} [opts]
 */
export function harvestLanguageGrains(language, text, opts = {}) {
  let notes = normalizeLanguageNotes(language);
  const blob = String(text || "");
  const candidates = blob
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 48);
  let bonded = 0;
  for (const grain of candidates.slice(0, 6)) {
    const result = addLanguageGrain(notes, grain, opts);
    notes = result.notes;
    if (result.reason === "repeat" && result.note && result.note.repeats === 2) {
      bonded += 1;
    }
  }
  return { notes, bonded };
}

export function languagePromptBlock(language) {
  const bonded = normalizeLanguageNotes(language).filter((n) => n.repeats >= 2);
  if (!bonded.length) return "";
  const lines = bonded
    .slice(0, LANGUAGE_NOTE_CAP)
    .map((n) => `- "${n.grain}" (heard ${n.repeats}×)`);
  return `\nSTEWARD-BONDED LANGUAGE (speech color only; CHARACTER IDENTITY LOCK wins if they conflict):\n${lines.join("\n")}\n`;
}

export { wellCap };
