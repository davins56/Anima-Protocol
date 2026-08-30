// @ts-check
/**
 * Profile-scoped Echo Key collection (story-mode view of the library).
 *
 * Operators hold the full Codex (family rows, featured resonance, and canon
 * novel keys). The Resonance Array stays 30 slots. Story mode is flavor —
 * it does not gate ownership. `granted_full_library` is always true.
 */

import { ECHO_KEY_BY_ID } from "./catalog.js";
import { normalizeEchoLibrary, starterEchoFolder, validateEchoFolder } from "./rules.js";

/**
 * @typedef {{ id: string, code: string }} EchoSlot
 * @typedef {{ id: string, name: string, slots: EchoSlot[] }} EchoFolder
 * @typedef {{
 *   owned: string[],
 *   folders: EchoFolder[],
 *   active_folder_id: string,
 *   granted_full_library: boolean,
 *   discoveries: object[],
 *   evolutions: Record<string, number>,
 *   sites_attuned: Record<string, string>,
 *   fusion_log: object[],
 *   library: ReturnType<typeof normalizeEchoLibrary>,
 * }} EchoKeyAccount
 */

export const DEFAULT_FOLDER_ID = "folder-1";

/**
 * @param {unknown} raw
 * @returns {EchoKeyAccount}
 */
export function normalizeEchoKeyAccount(raw) {
  const lib = normalizeEchoLibrary(raw);
  return {
    owned: lib.owned_ids,
    folders: [
      {
        id: DEFAULT_FOLDER_ID,
        name: "Resonance Array 1",
        slots: lib.folder,
      },
    ],
    active_folder_id: DEFAULT_FOLDER_ID,
    granted_full_library: !!lib.granted_full_library,
    discoveries: lib.discoveries || [],
    evolutions: lib.evolutions || {},
    sites_attuned: lib.sites_attuned || {},
    fusion_log: lib.fusion_log || [],
    library: lib,
  };
}

/**
 * @param {EchoKeyAccount} account
 * @param {string} id
 * @param {{ source?: string, site?: string | null, outdoor?: boolean, at?: string }} [meta]
 */
export function grantOwnedKey(account, id, meta = {}) {
  if (!ECHO_KEY_BY_ID[id]) return account;
  if (account.owned.includes(id)) return account;
  const discovery = {
    id,
    source: meta.source || "virtual",
    site: typeof meta.site === "string" ? meta.site : null,
    at: meta.at || new Date().toISOString(),
    outdoor: meta.outdoor === true,
  };
  const owned = [...account.owned, id];
  const discoveries = [...(account.discoveries || []), discovery];
  const library = {
    ...account.library,
    owned_ids: owned,
    discoveries,
  };
  return {
    ...account,
    owned,
    discoveries,
    library,
  };
}

/**
 * @param {EchoKeyAccount} account
 */
export function activeEchoFolder(account) {
  return account.folders.find((f) => f.id === account.active_folder_id) || account.folders[0];
}

/**
 * @param {EchoKeyAccount} account
 * @param {string} folderId
 * @param {EchoSlot[]} slots
 */
export function setFolderSlots(account, folderId, slots) {
  const check = validateEchoFolder(slots);
  if (!check.ok) {
    return { ok: false, errors: check.errors, account };
  }
  const folders = account.folders.map((f) => (f.id === folderId ? { ...f, slots } : f));
  const library = { ...account.library, folder: slots };
  return {
    ok: true,
    errors: [],
    account: { ...account, folders, library },
  };
}

/**
 * @param {EchoKeyAccount} account
 */
export function accountToLibrary(account) {
  return {
    ...account.library,
    owned_ids: account.owned,
    folder: account.folders[0]?.slots || starterEchoFolder(),
    granted_full_library: account.granted_full_library,
    discoveries: account.discoveries,
    evolutions: account.evolutions,
    sites_attuned: account.sites_attuned,
    fusion_log: account.fusion_log,
  };
}
