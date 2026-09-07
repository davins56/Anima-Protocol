import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { loadRosterCharacters } from "@/lib/loadRosterCharacters";
import {
  ATTAINABLE_ITEMS,
  INVENTORY_LIST_LIMIT,
  catalogItemToInventoryPayload,
  missingCatalogItems,
  selectStewardInventoryTargets,
  shouldGrantStewardInventory,
  storedInventoryGrantIsFull,
} from "@/lib/inventory";

/** @type {Map<string, Promise<{ added: number }>>} */
const grantLocks = new Map();

/**
 * @param {{
 *   user: object,
 *   characterId?: string | null,
 *   createItem?: (payload: object) => Promise<unknown>,
 *   listInventory?: (characterId: string) => Promise<object[]>,
 *   listRoster?: () => Promise<{ characters: object[], animas: object[] }>,
 *   persistGrant?: (settings: object) => Promise<unknown>,
 * }} opts
 */
export async function ensureStewardCatalogGrant({
  user,
  characterId = null,
  createItem,
  listInventory,
  listRoster,
  persistGrant,
}) {
  if (!shouldGrantStewardInventory(user) || !user?.id) {
    return { added: 0, targets: [] };
  }

  const roster = listRoster
    ? await listRoster()
    : await loadRosterCharacters({
        retrySeed: false,
        allowBundledFallback: false,
        waitBootstrap: false,
      });
  const characters = roster.characters || roster.rawCharacters || [];
  const animas = roster.animas || [];
  const selected =
    (characterId &&
      [...characters, ...animas].find((row) => row?.id === characterId)) ||
    { id: characterId || undefined };
  const targets = selectStewardInventoryTargets({
    selected: characterId ? selected : null,
    characters,
    animas,
  });
  if (!targets.length) return { added: 0, targets };

  let added = 0;
  for (const target of targets) {
    const existing = listInventory
      ? await listInventory(target.id)
      : (await base44.entities.Inventory.filter(
          { character_id: target.id },
          "-created_date",
          INVENTORY_LIST_LIMIT,
        )) || [];
    const missing = missingCatalogItems(existing, ATTAINABLE_ITEMS);
    for (const item of missing) {
      const payload = catalogItemToInventoryPayload(item, target.id);
      if (createItem) await createItem(payload);
      else await base44.entities.Inventory.create(payload);
      added += 1;
    }
  }

  if (persistGrant && !storedInventoryGrantIsFull(user?.settings?.inventory)) {
    await persistGrant({
      ...(user.settings || {}),
      inventory: {
        ...(user.settings?.inventory || {}),
        granted_full_catalog: true,
        catalog_size: ATTAINABLE_ITEMS.length,
      },
    });
  }

  return { added, targets };
}

/**
 * When the steward opens Inventory, grant any missing catalog items onto
 * their selected character and Anima-linked companions.
 *
 * @param {string | null | undefined} characterId
 */
export default function useStewardInventoryGrant(characterId) {
  const { user, setUser } = useAuth();
  const [granting, setGranting] = useState(false);
  const [done, setDone] = useState(false);
  const [added, setAdded] = useState(0);
  const ranRef = useRef("");

  useEffect(() => {
    const steward = shouldGrantStewardInventory(user);
    if (!user?.id || !steward) {
      setDone(true);
      setGranting(false);
      return;
    }
    if (!characterId) {
      setDone(false);
      return;
    }
    const lockKey = `${user.id}:${characterId}`;
    if (ranRef.current === lockKey) return;

    let cancelled = false;
    setGranting(true);
    setDone(false);

    const run = grantLocks.get(lockKey) || ensureStewardCatalogGrant({
      user,
      characterId,
      persistGrant: async (settings) => {
        const updated = await base44.auth.updateMe({ settings });
        if (setUser && updated) setUser(updated);
        return updated;
      },
    });
    grantLocks.set(lockKey, run);

    run
      .then((result) => {
        if (cancelled) return;
        ranRef.current = lockKey;
        setAdded(result.added);
        setDone(true);
      })
      .catch((err) => {
        console.warn("[Anima] Steward inventory grant failed:", err?.message || err);
        if (!cancelled) setDone(true);
      })
      .finally(() => {
        grantLocks.delete(lockKey);
        if (!cancelled) setGranting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.email, user?.username, characterId, setUser]);

  return { granting, done, added };
}
