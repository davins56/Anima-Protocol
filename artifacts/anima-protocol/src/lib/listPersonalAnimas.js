import { base44 } from "@/api/base44Client";

/**
 * A personal Anima (the companion Customise Anima shapes), as opposed to a
 * roster Character from a franchise. Onboarding and the Animas page write
 * `Anima` rows; Companion Generator writes `Character` with
 * `creation_method: "ai_prompt"`; some older seed paths wrote `Character`
 * with `_isAnima`.
 */
export function isPersonalAnimaRecord(row) {
  if (!row || typeof row !== "object") return false;
  if (row._isAnima === true) return true;
  const category = String(row.category || "").toLowerCase();
  if (category === "anima-construct" || category === "anima") return true;
  const method = String(row.creation_method || "").toLowerCase();
  return method === "ai_prompt";
}

export function companionStoreEntity(row) {
  if (row?._storeEntity === "Character") return "Character";
  if (row?._storeEntity === "Anima") return "Anima";
  return "Anima";
}

/** Deep-link into Customise Anima look for a newly created companion. */
export function companionLookHref(id) {
  if (!id) return "/customise-anima?tab=look";
  return `/customise-anima?anima=${encodeURIComponent(id)}&tab=look`;
}

export async function updateCompanionRecord(row, patch) {
  const entity = companionStoreEntity(row);
  return base44.entities[entity].update(row.id, patch);
}

function createdMs(row) {
  const raw = row?.created_date || row?.createdAt || row?.updated_date || 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function tagCompanionRow(row, storeEntity) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    _storeEntity: storeEntity,
    _isAnima: storeEntity === "Anima" ? true : row._isAnima === true,
  };
}

/**
 * Merge Anima rows with look-customizable Character rows.
 *
 * Previously this returned Anima.list as soon as any Anima existed (typical
 * after onboarding Serenity), so a companion created via Companion Generator
 * never appeared in Customise Anima.
 */
export function mergePersonalCompanions(animas, characters) {
  const animaRows = (Array.isArray(animas) ? animas : [])
    .filter(Boolean)
    .map((row) => tagCompanionRow(row, "Anima"));
  const seen = new Set(animaRows.map((row) => row.id).filter(Boolean));
  const extras = (Array.isArray(characters) ? characters : [])
    .filter((row) => row && isPersonalAnimaRecord(row) && !seen.has(row.id))
    .map((row) => tagCompanionRow(row, "Character"));
  return [...animaRows, ...extras].sort((a, b) => createdMs(b) - createdMs(a));
}

export async function listPersonalAnimas(limit = 100) {
  const animas = await base44.entities.Anima.list("-created_date", limit);
  const characters = await base44.entities.Character.list(
    "-created_date",
    limit,
  ).catch(() => []);
  return mergePersonalCompanions(animas, characters);
}

/**
 * Same selection order as Customise Anima:
 * `?anima=` / requested id, else assigned_user === me.email, else first row.
 */
export function selectPersonalAnima(rows, requestedId, me) {
  const list = Array.isArray(rows) ? rows : [];
  if (requestedId) {
    const match = list.find((a) => a && a.id === requestedId);
    if (match) return match;
  }
  if (me?.email) {
    const assigned = list.find((a) => a && a.assigned_user === me.email);
    if (assigned) return assigned;
  }
  return list[0] || null;
}
