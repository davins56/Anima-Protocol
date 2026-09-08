/**
 * Predicates for "personal Anima" rows vs franchise roster Characters.
 * Kept free of the API client so inventory / picker modules can share them.
 */

/** Steward's second Anima — historical spellings from chat and store rows. */
export const PERSONAL_ANIMA_NAME_ALIASES = [
  "aelynd",
  "aelyndra",
  "aelindra",
  "alyndra",
  "alynd",
];

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

/**
 * A personal Anima (the companion Customise Anima shapes), as opposed to a
 * roster Character from a franchise. Onboarding and the Animas page write
 * `Anima` rows; Companion Generator writes `Character` with
 * `creation_method: "ai_prompt"`; some older seed paths wrote `Character`
 * with `_isAnima` / `is_anima`. Aelynd was also stored as a named Character
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
