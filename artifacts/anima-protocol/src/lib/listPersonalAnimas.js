import { awaitCompanionStoreAuth, base44 } from "@/api/base44Client";

export { awaitCompanionStoreAuth };
import {
  isKnownPersonalAnimaName,
  isPersonalAnimaRecord,
  PERSONAL_ANIMA_NAME_ALIASES,
} from "@/lib/personalAnimaRecord";

export {
  isKnownPersonalAnimaName,
  isPersonalAnimaRecord,
  PERSONAL_ANIMA_NAME_ALIASES,
} from "@/lib/personalAnimaRecord";

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

/**
 * Load a companion from Anima or Character. Generator-created rows live in
 * Character, so Anima-only lookups show "not found" after the picker selects
 * them.
 */
export async function loadCompanionRecord(id, preferredEntity) {
  if (!id) return null;
  const first = preferredEntity === "Character" ? "Character" : "Anima";
  const second = first === "Character" ? "Anima" : "Character";
  for (const entity of [first, second]) {
    const rows = await base44.entities[entity]
      .list("-created_date", 100)
      .catch(() => []);
    const found = (rows || []).find((row) => row && row.id === id);
    if (found) return tagCompanionRow(found, entity);
  }
  return null;
}

/** Strip picker-only flags so they are not written back to the store. */
export function companionPersistPatch(form) {
  if (!form || typeof form !== "object") return {};
  const { _storeEntity, _isAnima, _bundled, ...rest } = form;
  return rest;
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
  const seen = new Set();
  const animaRows = [];
  for (const row of Array.isArray(animas) ? animas : []) {
    if (!row) continue;
    if (row.id && seen.has(row.id)) continue;
    if (row.id) seen.add(row.id);
    animaRows.push(tagCompanionRow(row, "Anima"));
  }
  const extras = [];
  for (const row of Array.isArray(characters) ? characters : []) {
    if (!row || !isPersonalAnimaRecord(row)) continue;
    if (row.id && seen.has(row.id)) continue;
    if (row.id) seen.add(row.id);
    extras.push(tagCompanionRow(row, "Character"));
  }
  return [...animaRows, ...extras].sort((a, b) => createdMs(b) - createdMs(a));
}

async function listByNameSearch(entity, name, limit) {
  return base44.entities[entity]
    .list("-created_date", limit, { search: { name } })
    .catch(() => []);
}

/**
 * Load personal companions from Anima + Character.
 *
 * Character.list(limit) is newest-first. A second Anima stored as an older
 * Character (Aelynd without `ai_prompt`) can fall past a 100-row roster cap.
 * Also query `creation_method` and known name aliases across the whole store.
 */
export async function listPersonalAnimas(limit = 500) {
  // queryEntity waits for Clerk once, then storeFetch uses that token with
  // a fresh 8s abort. Do not stack awaitCompanionStoreAuth(8s) here.
  // Primary Anima.list must throw so Customise Anima can classify
  // timeout / database / misconfigured failures. Recovery queries are
  // best-effort and must not hide that error.
  const animas = await base44.entities.Anima.list("-created_date", limit);
  const characters = await base44.entities.Character.list(
    "-created_date",
    limit,
  ).catch(() => []);
  const [prompted, ...namedCharacters] = await Promise.all([
    base44.entities.Character.filter(
      { creation_method: "ai_prompt" },
      "-created_date",
      limit,
    ).catch(() => []),
    ...PERSONAL_ANIMA_NAME_ALIASES.map((name) =>
      listByNameSearch("Character", name, 20),
    ),
  ]);
  return mergePersonalCompanions(animas, [
    ...(characters || []),
    ...(prompted || []),
    ...namedCharacters.flat(),
  ]);
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
