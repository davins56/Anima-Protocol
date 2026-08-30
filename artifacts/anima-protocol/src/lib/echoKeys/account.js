// @ts-check
/**
 * Profile-scoped Echo Key collection.
 *
 * Stored on the Clerk user profile as `echo_keys` via `/api/store/profile`.
 * The catalog itself is static — the profile only keeps owned ids + folders.
 */

import { allEchoKeyIds, ECHO_KEY_LIBRARY_SIZE } from "./catalog.js";
import { starterEchoFolder, validateEchoFolder } from "./rules.js";

/**
 * @typedef {{ id: string, code: string }} EchoSlot
 * @typedef {{ id: string, name: string, slots: EchoSlot[] }} EchoFolder
 * @typedef {{
 *   owned: string[],
 *   folders: EchoFolder[],
 *   active_folder_id: string,
 *   granted_full_library: boolean,
 * }} EchoKeyAccount
 */

export const DEFAULT_FOLDER_ID = "folder-1";

/**
 * @param {unknown} raw
 * @returns {EchoKeyAccount}
 */
export function normalizeEchoKeyAccount(raw) {
  const catalog = allEchoKeyIds();
  const catalogSet = new Set(catalog);
  const src = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};

  const ownedRaw = Array.isArray(src.owned) ? src.owned.filter((id) => typeof id === "string") : [];
  let owned = [...new Set(ownedRaw.filter((id) => catalogSet.has(id)))];

  const grantFull =
    src.granted_full_library === true || owned.length === 0 || owned.length >= ECHO_KEY_LIBRARY_SIZE;
  if (grantFull) {
    owned = catalog;
  }

  const ownedSet = new Set(owned);
  /** @type {EchoFolder[]} */
  let folders = [];
  if (Array.isArray(src.folders)) {
    folders = src.folders
      .filter((f) => f && typeof f === "object")
      .map((f, i) => {
        const folder = /** @type {Record<string, unknown>} */ (f);
        const slots = Array.isArray(folder.slots)
          ? folder.slots
              .filter((s) => s && typeof s === "object")
              .map((s) => {
                const slot = /** @type {Record<string, unknown>} */ (s);
                return {
                  id: String(slot.id || ""),
                  code: String(slot.code || "A"),
                };
              })
              .filter((s) => ownedSet.has(s.id))
          : [];
        return {
          id: typeof folder.id === "string" && folder.id ? folder.id : `folder-${i + 1}`,
          name: typeof folder.name === "string" && folder.name ? folder.name : `Folder ${i + 1}`,
          slots,
        };
      });
  }

  if (!folders.length) {
    folders = [
      {
        id: DEFAULT_FOLDER_ID,
        name: "Folder 1",
        slots: starterEchoFolder(),
      },
    ];
  }

  folders = folders.map((folder) => {
    if (folder.slots.length === 30 && validateEchoFolder(folder.slots).ok) return folder;
    return { ...folder, slots: starterEchoFolder() };
  });

  const active =
    typeof src.active_folder_id === "string" && folders.some((f) => f.id === src.active_folder_id)
      ? src.active_folder_id
      : folders[0].id;

  return {
    owned,
    folders,
    active_folder_id: active,
    granted_full_library: grantFull,
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
  return {
    ok: true,
    errors: [],
    account: { ...account, folders },
  };
}
