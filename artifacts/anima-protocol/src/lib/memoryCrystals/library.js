// @ts-check
/**
 * Profile-scoped Memory Crystal type unlocks.
 *
 * Types can be marked attainable. Individual crystals still form from chat.
 */

import { MEMORY_CRYSTAL_TYPE_IDS } from "./types.js";

/**
 * @param {unknown} raw
 * @param {number} catalogSize
 */
export function storedCrystalTypesAreFull(raw, catalogSize) {
  if (!raw || typeof raw !== "object") return false;
  const data = /** @type {{ granted_all_types?: boolean, unlocked_types?: unknown }} */ (raw);
  const unlocked = Array.isArray(data.unlocked_types) ? data.unlocked_types : [];
  return data.granted_all_types === true && unlocked.length >= catalogSize;
}

/**
 * @param {Record<string, unknown>} [saved]
 * @param {{ grantAllTypes?: boolean }} [opts]
 */
export function defaultMemoryCrystalTypes(saved = {}, opts = {}) {
  const grantAll = opts.grantAllTypes === true;
  return {
    version: 1,
    unlocked_types: grantAll ? [...MEMORY_CRYSTAL_TYPE_IDS] : [],
    granted_all_types: grantAll,
  };
}

/**
 * @param {unknown} raw
 * @param {{ grantAllTypes?: boolean }} [opts]
 */
export function normalizeMemoryCrystalTypes(raw, opts = {}) {
  if (!raw || typeof raw !== "object") return defaultMemoryCrystalTypes({}, opts);
  const data = /** @type {Record<string, unknown>} */ (raw);
  const catalog = MEMORY_CRYSTAL_TYPE_IDS;
  const rawTypes = Array.isArray(data.unlocked_types) ? data.unlocked_types : [];
  let unlocked = [
    ...new Set(rawTypes.filter((id) => typeof id === "string" && catalog.includes(id))),
  ];
  const grantAll =
    opts.grantAllTypes === true ||
    data.granted_all_types === true ||
    unlocked.length >= catalog.length;
  if (grantAll) unlocked = [...catalog];
  return {
    version: 1,
    unlocked_types: unlocked,
    granted_all_types: grantAll,
  };
}
