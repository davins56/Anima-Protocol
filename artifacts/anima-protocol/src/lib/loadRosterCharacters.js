// Shared character roster loader for Chat / New Session / story choosers.
// Waits for bootstrap, lists account characters, and retries starter seeding
// when the roster is still empty — same recovery path Characters.jsx uses so
// preloaded starters are available to chat after sign-in.

import { base44, notifyStoreChanged } from "@/api/base44Client";
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

/**
 * Load Character + Anima rows for chat pickers.
 * @param {{ retrySeed?: boolean, characterLimit?: number, animaLimit?: number, waitBootstrap?: boolean }} [opts]
 * @returns {Promise<{ characters: object[], rawCharacters: object[], animas: object[], animaAsChars: object[], error: Error|null, usingBundledSeed: boolean }>}
 */
export async function loadRosterCharacters({
  retrySeed = true,
  characterLimit = 500,
  animaLimit = 100,
  waitBootstrap = true,
} = {}) {
  if (waitBootstrap) {
    await whenBootstrapReady();
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

  const storeError = listError || seedError;
  let usingBundledSeed = false;
  // When Postgres is down, surface the same bundled starter roster Characters.jsx
  // uses so New Session is not a permanent empty state. Rows are marked
  // `_bundled` — callers must upsert before creating a chat session.
  if (!rawCharacters.length && isStoreDatabaseError(storeError)) {
    rawCharacters = getStarterRoster().map((c) => ({ ...c, _bundled: true }));
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
