// Shared character roster loader for Chat / New Session / story choosers.
// Waits for bootstrap, lists account characters, and retries starter seeding
// when the roster is still empty — same recovery path Characters.jsx uses so
// preloaded starters are available to chat after sign-in.

import { awaitCompanionStoreAuth } from "@/lib/listPersonalAnimas";
import {
  base44,
  notifyStoreChanged,
} from "@/api/base44Client";
import { matchCharacterByIdentity } from "@/lib/createInitSession";
import { getStarterRoster, retryStarterSeed } from "@/lib/seedCharacters";
import { normalizeStoreList } from "@/lib/storeRecords";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { STORE_AUTH_WAIT_MS } from "@/lib/storeTimeouts";
import {
  classifyRosterFallback,
  isStoreDatabaseError,
  isStoreReadUnavailable,
  isStoreTimeoutError,
  rosterFallbackLabel,
  rosterFallbackMessage,
} from "@/lib/storeErrorSignals";

// Re-exported for existing importers; the implementation now lives in
// storeErrorSignals.js so Characters.jsx and this loader cannot drift apart.
export {
  classifyRosterFallback,
  isStoreDatabaseError,
  isStoreReadUnavailable,
  isStoreTimeoutError,
  rosterFallbackLabel,
  rosterFallbackMessage,
};

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
 * Keep store rows (custom + seeded) and fill any missing starters from the
 * bundled roster. A failed/empty auth read must not hide custom characters
 * that were already on screen, and a custom-only store list must still offer
 * preloaded starters.
 */
export function mergeRosterWithBundled(storeChars, bundledChars) {
  const store = normalizeStoreList(storeChars);
  const bundled = Array.isArray(bundledChars) ? bundledChars : [];
  const seenIds = new Set(
    store.map((c) => c?.id).filter((id) => typeof id === "string" && id),
  );
  const out = [...store];
  for (const starter of bundled) {
    if (!starter) continue;
    if (starter.id && seenIds.has(starter.id)) continue;
    if (matchCharacterByIdentity(starter, store)) continue;
    out.push({ ...starter, _bundled: true });
    if (starter.id) seenIds.add(starter.id);
  }
  return out;
}

/**
 * Load Character + Anima rows for chat pickers.
 * @param {{ retrySeed?: boolean, characterLimit?: number, animaLimit?: number, waitBootstrap?: boolean, allowBundledFallback?: boolean, notifyOnSeed?: boolean }} [opts]
 * @returns {Promise<{ characters: object[], rawCharacters: object[], animas: object[], animaAsChars: object[], error: Error|null, usingBundledSeed: boolean, fallbackKind: string|null }>}
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

  // Same fail-open Clerk wait Customise Anima uses. Character.list still
  // returns [] when getToken() is minting — do not treat that as empty.
  const token = await awaitCompanionStoreAuth(STORE_AUTH_WAIT_MS);
  const authError = token
    ? null
    : new Error("Store auth token not available");
  if (authError) {
    console.warn(
      "[Anima] Store auth not ready for roster load:",
      authError.message,
    );
  }

  let rawCharacters = [];
  let listError = null;
  try {
    rawCharacters = normalizeStoreList(
      await base44.entities.Character.list("-created_date", characterLimit),
    );
  } catch (err) {
    listError = err;
    console.warn("[Anima] Character roster load failed:", err?.message || err);
    rawCharacters = [];
    // First list after OTP often races schema warmup. Wait for auth again,
    // then retry once with a fresh storeFetch abort — do not treat that as
    // a sticky offline roster.
    if (isStoreTimeoutError(err)) {
      await awaitCompanionStoreAuth(STORE_AUTH_WAIT_MS);
      try {
        rawCharacters = normalizeStoreList(
          await base44.entities.Character.list("-created_date", characterLimit),
        );
        listError = null;
      } catch (retryErr) {
        listError = retryErr;
        console.warn(
          "[Anima] Character roster retry after timeout failed:",
          retryErr?.message || retryErr,
        );
        rawCharacters = [];
      }
    }
  }

  let seedError = null;
  let seededCount = 0;
  if (!rawCharacters.length && retrySeed) {
    try {
      seededCount = (await retryStarterSeed()) || 0;
      if (notifyOnSeed && seededCount > 0) {
        notifyStoreChanged();
      }
      rawCharacters = normalizeStoreList(
        await base44.entities.Character.list(
          "-created_date",
          characterLimit,
        ),
      );
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
  const storeCharacters = rawCharacters;
  let usingBundledSeed = false;
  // Always merge missing starters onto a successful store list so custom
  // characters stay visible and preloaded seeds remain pickable. An empty or
  // failed read still paints the bundled roster instead of a blank picker.
  if (allowBundledFallback) {
    rawCharacters = mergeRosterWithBundled(
      storeCharacters,
      getBundledStarterRoster(),
    );
    usingBundledSeed = storeCharacters.length === 0;
  }

  const animaAsChars = asAnimaChars(animas);
  const fallbackKind = usingBundledSeed ? classifyRosterFallback(storeError) : null;
  return {
    characters: [...animaAsChars, ...rawCharacters],
    rawCharacters,
    animas,
    animaAsChars,
    error: storeError,
    usingBundledSeed,
    fallbackKind,
  };
}
