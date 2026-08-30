// @ts-check
/**
 * Profile-scoped Echo Key collection.
 *
 * Stored on the Clerk user profile as `echo_keys` via `/api/store/profile`.
 * New operators start with a handful of Echo Shards. The rest of the 800-key
 * Codex is found, synthesised, or evolved — never handed over on first visit.
 *
 * Profiles that already have `granted_full_library` keep that collection
 * (legacy testers). New profiles do not.
 */

import { allEchoKeyIds, ECHO_KEY_BY_ID, ECHO_KEY_LIBRARY_SIZE } from "./catalog.js";
import { starterEchoFolder, starterOwnedIds, validateEchoFolder } from "./rules.js";

/**
 * @typedef {{ id: string, code: string }} EchoSlot
 * @typedef {{ id: string, name: string, slots: EchoSlot[] }} EchoFolder
 * @typedef {{
 *   id: string,
 *   source: string,
 *   site: string | null,
 *   at: string,
 *   outdoor: boolean,
 * }} EchoDiscovery
 * @typedef {{
 *   owned: string[],
 *   folders: EchoFolder[],
 *   active_folder_id: string,
 *   granted_full_library: boolean,
 *   discoveries: EchoDiscovery[],
 *   evolutions: Record<string, number>,
 *   sites_attuned: Record<string, string>,
 *   fusion_log: { result: string, ingredients: string[], at: string }[],
 * }} EchoKeyAccount
 */

export const DEFAULT_FOLDER_ID = "folder-1";

/**
 * @param {unknown} raw
 * @returns {EchoDiscovery[]}
 */
function normalizeDiscoveries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const rec = /** @type {Record<string, unknown>} */ (row);
      return {
        id: String(rec.id || ""),
        source: String(rec.source || "virtual"),
        site: typeof rec.site === "string" ? rec.site : null,
        at: typeof rec.at === "string" ? rec.at : "",
        outdoor: rec.outdoor === true,
      };
    })
    .filter((row) => row.id);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, number>}
 */
function normalizeEvolutions(raw) {
  if (!raw || typeof raw !== "object") return {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const [id, n] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    const value = Number(n);
    if (Number.isFinite(value) && value > 0) out[id] = value;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function normalizeSites(raw) {
  if (!raw || typeof raw !== "object") return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [id, stamp] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (typeof stamp === "string" && stamp) out[id] = stamp;
  }
  return out;
}

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

  const legacyFull =
    src.granted_full_library === true || owned.length >= ECHO_KEY_LIBRARY_SIZE;
  if (legacyFull) {
    owned = catalog;
  } else if (owned.length === 0) {
    owned = starterOwnedIds();
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
        name: "Resonance Array 1",
        slots: starterEchoFolder(),
      },
    ];
  }

  folders = folders.map((folder) => {
    if (validateEchoFolder(folder.slots).ok) return folder;
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
    granted_full_library: legacyFull,
    discoveries: normalizeDiscoveries(src.discoveries),
    evolutions: normalizeEvolutions(src.evolutions),
    sites_attuned: normalizeSites(src.sites_attuned),
    fusion_log: Array.isArray(src.fusion_log)
      ? src.fusion_log.filter((row) => row && typeof row === "object")
      : [],
  };
}

/**
 * @param {EchoKeyAccount} account
 * @param {string} id
 * @param {{ source?: string, site?: string | null, outdoor?: boolean, at?: string }} [meta]
 * @returns {EchoKeyAccount}
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
  return {
    ...account,
    owned: [...account.owned, id],
    discoveries: [...(account.discoveries || []), discovery],
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
