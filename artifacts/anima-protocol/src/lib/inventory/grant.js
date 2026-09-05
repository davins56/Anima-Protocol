// @ts-check
/**
 * Steward-only grant of the attainable inventory catalog.
 *
 * Other operators keep an empty or story-earned bag. Never auto-fill theirs.
 */

import { isEchoLibrarySteward } from "../echoKeys/steward.js";
import { isPersonalAnimaRecord } from "../listPersonalAnimas.js";
import { ATTAINABLE_ITEMS, INVENTORY_LIST_LIMIT } from "./catalog.js";

/**
 * @param {unknown} user
 */
export function shouldGrantStewardInventory(user) {
  return isEchoLibrarySteward(user);
}

/**
 * @param {{ id?: string, name?: string, catalog_id?: string, narrative_triggers?: unknown }[]} existing
 * @param {typeof ATTAINABLE_ITEMS} [catalog]
 */
export function missingCatalogItems(existing, catalog = ATTAINABLE_ITEMS) {
  const have = new Set();
  for (const row of existing || []) {
    if (row?.catalog_id) have.add(row.catalog_id);
    if (row?.name) have.add(String(row.name).trim().toLowerCase());
    const triggers = Array.isArray(row?.narrative_triggers) ? row.narrative_triggers : [];
    for (const trigger of triggers) {
      if (typeof trigger === "string" && trigger.startsWith("catalog:")) {
        have.add(trigger.slice("catalog:".length));
      }
    }
  }
  return catalog.filter((item) => {
    if (have.has(item.id)) return false;
    if (have.has(item.name.trim().toLowerCase())) return false;
    return true;
  });
}

/**
 * @param {typeof ATTAINABLE_ITEMS[number]} item
 * @param {string} characterId
 * @param {string | null} [sessionId]
 */
export function catalogItemToInventoryPayload(item, characterId, sessionId = null) {
  return {
    character_id: characterId,
    session_id: sessionId,
    catalog_id: item.id,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    slot: item.slot,
    description: item.description,
    quantity: 1,
    equipped: false,
    condition: 100,
    craftable: false,
    stat_modifiers: item.stat_modifiers || {},
    effects: item.effects || [],
    trade_value: item.trade_value ?? 10,
    narrative_triggers: [
      `catalog:${item.id}`,
      ...(item.narrative_triggers || []),
    ],
  };
}

/**
 * Primary character plus Anima-linked companions. Skip bundled seed rows.
 *
 * @param {{
 *   selected?: { id?: string, _bundled?: boolean } | null,
 *   characters?: { id?: string, _bundled?: boolean, _isAnima?: boolean, category?: string, creation_method?: string }[],
 *   animas?: { id?: string, _bundled?: boolean }[],
 * }} opts
 */
export function selectStewardInventoryTargets({ selected, characters = [], animas = [] } = {}) {
  /** @type {{ id: string }[]} */
  const targets = [];
  const seen = new Set();

  /**
   * @param {{ id?: string, _bundled?: boolean } | null | undefined} row
   */
  function add(row) {
    if (!row?.id || row._bundled || seen.has(row.id)) return;
    seen.add(row.id);
    targets.push(/** @type {{ id: string }} */ (row));
  }

  add(selected || null);
  for (const row of animas) add(row);
  for (const row of characters) {
    if (row?._isAnima || isPersonalAnimaRecord(row)) add(row);
  }
  if (targets.length === 0) {
    add(characters.find((row) => row?.id && !row._bundled) || null);
  }
  return targets;
}

/**
 * @param {unknown} raw
 */
export function storedInventoryGrantIsFull(raw) {
  if (!raw || typeof raw !== "object") return false;
  const data = /** @type {{ granted_full_catalog?: boolean }} */ (raw);
  return data.granted_full_catalog === true;
}

export { INVENTORY_LIST_LIMIT };
