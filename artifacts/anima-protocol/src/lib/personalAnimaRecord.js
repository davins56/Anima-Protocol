/**
 * Predicates for "personal Anima" rows vs franchise roster Characters.
 * Kept free of the API client so inventory / picker modules can share them.
 */

/** Canonical display name of the steward's second Anima. */
export const AELAND_NAME = "Aeland";

/**
 * Legacy spellings of Aeland still present in live store rows / chat
 * (user_entities is never rewritten). Matching keeps accepting all of them.
 */
export const AELAND_LEGACY_ALIASES = [
  "aelynd",
  "aelyndra",
  "aelindra",
  "alyndra",
  "alynd",
];

/** Steward's second Anima — canonical + historical spellings from chat and store rows. */
export const PERSONAL_ANIMA_NAME_ALIASES = ["aeland", ...AELAND_LEGACY_ALIASES];

export function normalizeCompanionName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isKnownPersonalAnimaName(name) {
  const n = normalizeCompanionName(name);
  if (!n) return false;
  return PERSONAL_ANIMA_NAME_ALIASES.some(
    (alias) => n === alias || n.startsWith(`${alias} `) || n.includes(alias),
  );
}

/** True when `name` is exactly Aeland or one of her legacy spellings. */
export function isAelandName(name) {
  const n = normalizeCompanionName(name);
  return n === "aeland" || AELAND_LEGACY_ALIASES.includes(n);
}

/** Display name: legacy Aeland spellings resolve to "Aeland"; everything else unchanged. */
export function canonicalCompanionName(name) {
  return isAelandName(name) ? AELAND_NAME : name;
}

/**
 * Read-side canonicalisation for loaded rows. The stored spelling is kept in
 * `legacy_name` (and restored by companionPersistPatch) so displaying "Aeland"
 * never rewrites a stored row behind the user's back.
 */
export function canonicalizeCompanionRow(row) {
  if (!row || typeof row !== "object" || !isAelandName(row.name)) return row;
  if (row.name === AELAND_NAME) return row;
  return { ...row, name: AELAND_NAME, legacy_name: row.legacy_name || row.name };
}

/**
 * A personal Anima (the companion Customise Anima shapes), as opposed to a
 * roster Character from a franchise. Onboarding and the Animas page write
 * `Anima` rows; Companion Generator writes `Character` with
 * `creation_method: "ai_prompt"`; some older seed paths wrote `Character`
 * with `_isAnima` / `is_anima`. Aeland (legacy "Aelynd") was also stored as a named Character
 * without those flags.
 */
export function isPersonalAnimaRecord(row) {
  if (!row || typeof row !== "object") return false;
  if (row._isAnima === true || row.is_anima === true || row.isAnima === true) {
    return true;
  }
  if (isKnownPersonalAnimaName(row.name)) return true;
  const category = String(row.category || "").toLowerCase();
  if (category === "anima-construct" || category === "anima") return true;
  const universe = String(row.universe || "").toLowerCase();
  if (universe === "anima protocol" || universe === "anima") return true;
  const tags = Array.isArray(row.tags) ? row.tags : [];
  if (tags.some((tag) => String(tag).toLowerCase() === "anima")) return true;
  const method = String(row.creation_method || "").toLowerCase();
  return method === "ai_prompt";
}
