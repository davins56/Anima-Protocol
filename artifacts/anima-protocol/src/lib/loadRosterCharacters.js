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

function asAnimaChars(animas) {
  return (animas || []).map((a) => ({
    ...a,
    _isAnima: true,
    category: a.archetype || "guardian",
    universe: "Anima",
  }));
}

/** True when /api/store failed because Postgres is down / unreachable. */
export function isStoreDatabaseError(err) {
  const status = err?.status;
  if (status === 503) return true;
  const msg = String(err?.message || "");
  return /database|postgres|unavailable|unreachable|connection/i.test(msg);
}

function bundledStarterRoster() {
  return getStarterRoster().map((c) => ({ ...c, _bundled: true }));
}

/**
 * Load Character + Anima rows for chat pickers.
 * @param {{ retrySeed?: boolean, characterLimit?: number, animaLimit?: number, waitBootstrap?: boolean, allowBundledFallback?: boolean }} [opts]
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
} = {}) {
  if (waitBootstrap) {
    await whenBootstrapReady();
  }

  // Character.list returns [] (no throw) when the Clerk token getter is not
  // ready yet — wait briefly so we don't treat "auth still loading" as an
  // empty account.
  let authError = null;
  try {
    await waitForStoreAuth(15000);
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
  if (!rawCharacters.length && retrySeed) {
    try {
      await retryStarterSeed();
      notifyStoreChanged();
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
  // After a seed retry (or when the store is unreachable), never leave the
  // Select Character screen blank — show bundled starters. Rows are marked
  // `_bundled`; NewSessionModal upserts them before creating a session.
  const shouldUseBundled =
    allowBundledFallback &&
    !rawCharacters.length &&
    (retrySeed || isStoreDatabaseError(storeError) || !!authError);
  if (shouldUseBundled) {
    rawCharacters = bundledStarterRoster();
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
