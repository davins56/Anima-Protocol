// Shared character roster loader for Chat / New Session / story choosers.
// Waits for bootstrap, lists account characters, and retries starter seeding
// when the roster is still empty — same recovery path Characters.jsx uses so
// preloaded starters are available to chat after sign-in.

import {
  base44,
  notifyStoreChanged,
  waitForStoreAuth,
} from "@/api/base44Client";
import { getStarterRoster, retryStarterSeed } from "@/lib/seedCharacters";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { STORE_AUTH_WAIT_MS } from "@/lib/storeTimeouts";
import {
  isStoreDatabaseError,
  isStoreReadUnavailable,
} from "@/lib/storeErrorSignals";

// Re-exported for existing importers; the implementation now lives in
// storeErrorSignals.js so Characters.jsx and this loader cannot drift apart.
export { isStoreDatabaseError, isStoreReadUnavailable };

function asAnimaChars(animas) {
  return (animas || []).map((a) => ({
    ...a,
    _isAnima: true,
    category: a.archetype || "guardian",
    universe: "Anima",
  }));
}

/** Bundled starter roster for chat pickers (not yet confirmed in the account store). */
export function getBundledStarterRoster() {
  return getStarterRoster().map((c) => ({ ...c, _bundled: true }));
}

/**
 * Load Character + Anima rows for chat pickers.
 * @param {{ retrySeed?: boolean, characterLimit?: number, animaLimit?: number, waitBootstrap?: boolean, allowBundledFallback?: boolean, notifyOnSeed?: boolean }} [opts]
 * @returns {Promise<{ characters: object[], rawCharacters: object[], animas: object[], animaAsChars: object[], error: Error|null, usingBundledSeed: boolean }>}
 */
export async function loadRosterCharacters({
  retrySeed = true,
  characterLimit = 500,
  animaLimit = 100,
  waitBootstrap = true,
  // Chat pickers should never look permanently empty — fall back to the
  // bundled starter roster when the store/seed path cannot populate one.
  allowBundledFallback = true,
  // notifyStoreChanged re-enters useStoreSync loaders; only notify when the
  // seed actually wrote rows (upsertCharacters already notifies on write).
  notifyOnSeed = false,
} = {}) {
  if (waitBootstrap) {
    await whenBootstrapReady();
  }

  // Character.list returns [] (no throw) when the Clerk token getter is not
  // ready yet — wait briefly so we don't treat "auth still loading" as an
  // empty account.
  let authError = null;
  try {
    await waitForStoreAuth(STORE_AUTH_WAIT_MS);
  } catch (err) {
    authError = err;
    console.warn(
      "[Anima] Store auth not ready for roster load:",
      err?.message || err,
    );
  }

  let rawCharacters = [];
  let listError = null;
  try {
    rawCharacters =
      (await base44.entities.Character.list("-created_date", characterLimit)) ||
      [];
  } catch (err) {
    listError = err;
    console.warn("[Anima] Character roster load failed:", err?.message || err);
    rawCharacters = [];
  }

  let seedError = null;
  let seededCount = 0;
  if (!rawCharacters.length && retrySeed) {
    try {
      seededCount = (await retryStarterSeed()) || 0;
      if (notifyOnSeed && seededCount > 0) {
        notifyStoreChanged();
      }
      rawCharacters =
        (await base44.entities.Character.list(
          "-created_date",
          characterLimit,
        )) || [];
    } catch (err) {
      seedError = err;
      console.warn(
        "[Anima] Starter seed retry during roster load failed:",
        err?.message || err,
      );
    }
  }

  let animas = [];
  try {
    animas =
      (await base44.entities.Anima.list("-created_date", animaLimit)) || [];
  } catch (err) {
    console.warn("[Anima] Anima roster load failed:", err?.message || err);
    animas = [];
  }

  const storeError = listError || seedError || authError;
  let usingBundledSeed = false;
  // Any empty store result for a chat picker must surface starters — including
  // useStoreSync refetches with retrySeed:false, which previously wiped the
  // bundled list and left Select Character on "NO RESULTS FOUND".
  if (allowBundledFallback && !rawCharacters.length) {
    rawCharacters = getBundledStarterRoster();
    usingBundledSeed = true;
  }

  const animaAsChars = asAnimaChars(animas);
  return {
    characters: [...animaAsChars, ...rawCharacters],
    rawCharacters,
    animas,
    animaAsChars,
    error: storeError,
    usingBundledSeed,
  };
}
