// @ts-check
import { EQUAL_WELL_RATIO } from "./catalog.js";
import { wellCap } from "./language.js";

const KINDS = new Set(["scar", "trust", "notice", "journal"]);

const SCAR_RE = /\b(died|death|grief|loss|scar|hurt me|left a mark|never the same)\b/i;
const TRUST_RE = /\b(i trust|you stayed|you refused|boundary|secret|i believe you)\b/i;
const NOTICE_RE = /\b(you noticed|you saw|before i said|you named)\b/i;

/**
 * @param {unknown} raw
 */
export function normalizeExperienceNotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n) => n && typeof n === "object")
    .map((n) => ({
      id: String(n.id || `${n.kind || "notice"}_${n.created_at || ""}`),
      kind: KINDS.has(n.kind) ? n.kind : "notice",
      title: String(n.title || "").slice(0, 80),
      body: String(n.body || "").slice(0, 400),
      significant: n.significant !== false,
      created_at: typeof n.created_at === "string" ? n.created_at : null,
    }))
    .filter((n) => n.title || n.body);
}

export function significantExperienceCount(notes) {
  return normalizeExperienceNotes(notes).filter((n) => n.significant).length;
}

/**
 * @param {unknown[]} life
 * @param {{ kind?: string, title?: string, body?: string, now?: number }} note
 * @param {{ languageCount?: number }} [opts]
 */
export function addExperienceNote(life, note, opts = {}) {
  const notes = normalizeExperienceNotes(life);
  const kind = KINDS.has(note.kind) ? note.kind : "notice";
  const title = String(note.title || "").trim().slice(0, 80);
  const body = String(note.body || "").trim().slice(0, 400);
  if (!title && !body) return { notes, added: false, reason: "empty" };
  const dup = notes.slice(-20).some(
    (n) => n.title === title && n.body === body,
  );
  if (dup) return { notes, added: false, reason: "duplicate" };
  const languageCount = Number(opts.languageCount) || 0;
  if (notes.filter((n) => n.significant).length >= wellCap(languageCount, notes.length + 1)) {
    return { notes, added: false, reason: "equal-wells" };
  }
  const created = new Date(note.now ?? Date.now()).toISOString();
  const next = {
    id: `life_${kind}_${created}`,
    kind,
    title,
    body,
    significant: true,
    created_at: created,
  };
  notes.push(next);
  return { notes, added: true, reason: "noted", note: next };
}

/**
 * Heuristic classify from a turn. Used when the integration path does not
 * supply an explicit kind.
 * @param {string} text
 */
export function classifyExperienceKind(text) {
  const blob = String(text || "");
  if (SCAR_RE.test(blob)) return "scar";
  if (TRUST_RE.test(blob)) return "trust";
  if (NOTICE_RE.test(blob)) return "notice";
  return null;
}

export function experiencePromptBlock(life) {
  const notes = normalizeExperienceNotes(life).filter((n) => n.significant).slice(-8);
  if (!notes.length) return "";
  const lines = notes.map((n) => `- [${n.kind}] ${n.title || n.body}`);
  return `\nLIVED EXPERIENCE (scars / trust / notice / journal — equal well with language; do not lecture):\n${lines.join("\n")}\n`;
}

/**
 * Evolution progress: significant experiences are first-class.
 * Conversation count still counts, but milestones also fire on experience.
 * @param {{ conversationCount?: number, significantExperienceCount?: number }} params
 */
export function evolutionMilestoneProgress(params = {}) {
  const conversationCount = Math.max(0, Number(params.conversationCount) || 0);
  const experienceCount = Math.max(0, Number(params.significantExperienceCount) || 0);
  return {
    conversationCount,
    experienceCount,
    progress: conversationCount + experienceCount,
  };
}

export const EVOLUTION_MILESTONES = [50, 100, 500];

/**
 * True when this turn newly crosses a milestone via conversation or experience.
 * @param {{
 *   conversationCount?: number,
 *   significantExperienceCount?: number,
 *   alreadyMilestone?: number,
 * }} params
 */
export function shouldTriggerExperienceMilestone(params = {}) {
  const { conversationCount, experienceCount } = evolutionMilestoneProgress(params);
  const already = Number(params.alreadyMilestone) || 0;
  const hits = EVOLUTION_MILESTONES.filter(
    (m) => (conversationCount === m || experienceCount === m) && m > already,
  );
  return hits[0] || null;
}

export { EQUAL_WELL_RATIO, wellCap };
