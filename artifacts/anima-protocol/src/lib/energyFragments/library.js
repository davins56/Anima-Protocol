// @ts-check
/**
 * Profile-scoped Energy Fragment collection.
 *
 * Operators start with the research Folder's starter handful. The Protocol
 * steward (Dàvīn) is granted every catalog id. The 30-slot Folder stays a
 * Folder — never dump the full library into combat slots.
 */

import { ENERGY_FRAGMENTS, FRAGMENT_BY_ID } from "./catalog.js";
import { starterFolder, validateFolder } from "./rules.js";

export function starterOwnedIds() {
  return [...new Set(starterFolder().map((slot) => slot.id))].filter(
    (id) => FRAGMENT_BY_ID[id],
  );
}

export function catalogOwnedIds() {
  return ENERGY_FRAGMENTS.map((f) => f.id);
}

/**
 * @param {unknown} raw
 * @param {number} catalogSize
 */
export function storedFragmentLibraryIsFull(raw, catalogSize) {
  if (!raw || typeof raw !== "object") return false;
  const data = /** @type {{ granted_full_library?: boolean, owned_ids?: unknown, owned?: unknown }} */ (raw);
  const owned = Array.isArray(data.owned_ids)
    ? data.owned_ids
    : Array.isArray(data.owned)
      ? data.owned
      : [];
  return data.granted_full_library === true && owned.length >= catalogSize;
}

/**
 * @param {Record<string, unknown>} [saved]
 * @param {{ grantFullLibrary?: boolean }} [opts]
 */
export function defaultFragmentLibrary(saved = {}, opts = {}) {
  const folder = Array.isArray(saved.folder) && saved.folder.length
    ? saved.folder
    : starterFolder();
  const grantFull = opts.grantFullLibrary === true;
  return {
    version: 1,
    owned_ids: grantFull ? catalogOwnedIds() : starterOwnedIds(),
    folder,
    granted_full_library: grantFull,
  };
}

/**
 * @param {unknown} raw
 * @param {{ grantFullLibrary?: boolean }} [opts]
 */
export function normalizeFragmentLibrary(raw, opts = {}) {
  if (!raw || typeof raw !== "object") return defaultFragmentLibrary({}, opts);
  const data = /** @type {Record<string, unknown>} */ (raw);
  const catalogIds = catalogOwnedIds();
  const ownedRaw = Array.isArray(data.owned_ids)
    ? data.owned_ids
    : Array.isArray(data.owned)
      ? data.owned
      : [];
  let owned = [
    ...new Set(ownedRaw.filter((id) => typeof id === "string" && FRAGMENT_BY_ID[id])),
  ];
  const grantFull =
    opts.grantFullLibrary === true ||
    data.granted_full_library === true ||
    owned.length >= catalogIds.length;
  if (grantFull) owned = catalogIds;
  else if (owned.length === 0) owned = starterOwnedIds();

  const folderSource = Array.isArray(data.folder) ? data.folder : [];
  const folderSlots = folderSource
    .filter((s) => s && typeof s === "object" && FRAGMENT_BY_ID[/** @type {{id?: string}} */ (s).id])
    .map((s) => {
      const slot = /** @type {{ id: string, code?: string }} */ (s);
      const frag = FRAGMENT_BY_ID[slot.id];
      const code = slot.code && frag.codes.includes(slot.code) ? slot.code : frag.codes[0];
      return { id: frag.id, code };
    })
    .filter((s) => owned.includes(s.id));
  const folderOk = validateFolder(folderSlots).ok;
  return {
    version: 1,
    owned_ids: owned,
    folder: folderOk ? folderSlots : starterFolder(),
    granted_full_library: grantFull,
  };
}
