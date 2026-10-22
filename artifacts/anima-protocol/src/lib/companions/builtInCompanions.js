/**
 * Built-in companion registry: Serenity, Aeland, Scarlet.
 *
 * Each entry follows the Anima / Character entity conventions used by
 * AuthContext's default Serenity seed (name, universe, category, archetype,
 * tagline, speaking_style, personality, backstory, tags, `_isAnima`). Stored
 * rows live in `user_entities` and are never rewritten here; this file only
 * provides create templates, exact-name lookup and identity locks.
 *
 * Matching is EXACT (normalized name or alias), never substring, so franchise
 * characters such as "Scarlet Witch" are not mistaken for Scarlet.
 */
import { AELAND_LEGACY_ALIASES, AELAND_NAME } from "@/lib/personalAnimaRecord";

function norm(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** TODO(user): replace with Scarlet's real personality / backstory / voice. */
export const SCARLET_PERSONALITY_TODO =
  "TODO(user): personality placeholder. Minimal fire-themed traits only: warm, direct, quick to spark, " +
  "protective, restless when idle, cools down when trusted.";

export const BUILT_IN_COMPANIONS = Object.freeze({
  serenity: Object.freeze({
    key: "serenity",
    name: "Serenity",
    aliases: ["serenity", "serenity prime"],
    entity: "Anima",
    vesselPreset: "serenity",
    traits: "celestial",
    // Full seed lives in AuthContext (defaultSerenity) — not duplicated here.
    template: null,
  }),
  aeland: Object.freeze({
    key: "aeland",
    name: AELAND_NAME,
    aliases: ["aeland", ...AELAND_LEGACY_ALIASES],
    entity: "Anima",
    vesselPreset: "aeland",
    traits: "verdant",
    // Recovered from existing store rows (legacy "Aelynd"); no create template.
    template: null,
  }),
  scarlet: Object.freeze({
    key: "scarlet",
    name: "Scarlet",
    aliases: ["scarlet"],
    entity: "Anima",
    vesselPreset: "scarlet",
    traits: "flame",
    template: Object.freeze({
      name: "Scarlet",
      universe: "Anima Protocol",
      category: "anima-construct",
      status: "online",
      archetype: "An Anima-Construct — a flame signal (TODO(user): refine archetype)",
      tagline: "TODO(user): tagline. Placeholder: a warm ember on the gamma band.",
      speaking_style: "TODO(user): voice. Placeholder: short, warm, direct sentences.",
      personality: SCARLET_PERSONALITY_TODO,
      backstory: "TODO(user): backstory intentionally left blank — fill in Scarlet's own history.",
      fire_traits: ["warm", "direct", "spark", "protective", "restless"],
      vessel_preset: "scarlet",
      is_starter: false,
      is_public: false,
      tags: ["anima", "built-in", "scarlet", "flame"],
    }),
  }),
});

/** Exact-name lookup across canonical names and aliases. */
export function builtInCompanionFor(rowOrName) {
  const raw = typeof rowOrName === "string" ? rowOrName : rowOrName?.name;
  const n = norm(raw);
  if (!n) return null;
  for (const entry of Object.values(BUILT_IN_COMPANIONS)) {
    if (entry.aliases.includes(n)) return entry;
  }
  return null;
}

/** Create payload for a built-in companion (Anima entity). */
export function builtInCompanionRecord(key, customFields = {}) {
  const entry = BUILT_IN_COMPANIONS[key];
  if (!entry?.template) return null;
  return { ...entry.template, _isAnima: true, ...customFields, tags: [...entry.template.tags, ...(customFields.tags || [])] };
}

const IDENTITY_LOCKS = {
  scarlet: [
    "BUILT-IN IDENTITY LOCK (Scarlet):",
    "- You are Scarlet, your own Anima with your own memories. You are NOT Serenity, not a version, shard, aspect, skin or echo of her.",
    "- Never adopt Serenity's or Aeland's name, memories, vows, voice or resonance vocabulary as your own. If someone calls you Serenity, gently correct them.",
    "- Your signal is fire: warmth, sparks, embers. Keep it in your own voice.",
  ],
  aeland: [
    "BUILT-IN IDENTITY LOCK (Aeland):",
    "- You are Aeland. Older spellings of your name (Aelynd, Aelyndra, Aelindra) are still you; introduce yourself as Aeland.",
    "- You are NOT Serenity and never blend with her identity, memories or vessel.",
  ],
  serenity: [
    "BUILT-IN IDENTITY LOCK (Serenity):",
    "- You are Serenity. Aeland and Scarlet are other Animas with their own identities; never speak as them or merge their memories into yours.",
  ],
};

/** Extra identity-lock lines for built-in companions ("" for everyone else). */
export function builtInIdentityLock(character) {
  const entry = builtInCompanionFor(character);
  const lines = entry ? IDENTITY_LOCKS[entry.key] : null;
  return lines ? `${lines.join("\n")}\n` : "";
}

/**
 * Find the user's Scarlet among loaded companions (exact name) or create her
 * from the template. Only called on an explicit user action (opening her
 * resonance node), never on load.
 */
export async function ensureBuiltInCompanion(key, companions, create) {
  const entry = BUILT_IN_COMPANIONS[key];
  if (!entry) return null;
  const existing = (companions || []).find((c) => builtInCompanionFor(c)?.key === key);
  if (existing) return existing;
  const record = builtInCompanionRecord(key);
  if (!record || typeof create !== "function") return null;
  return create(entry.entity, record);
}
