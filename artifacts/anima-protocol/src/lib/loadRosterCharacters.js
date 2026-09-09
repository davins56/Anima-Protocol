// Shared character roster loader for Chat / New Session / story choosers.
// Waits for bootstrap, lists account characters, and retries starter seeding
// when the roster is still empty — same recovery path Characters.jsx uses so
// preloaded starters are available to chat after sign-in.

import { awaitCompanionStoreAuth } from "@/lib/listPersonalAnimas";
import {
  PERSONAL_ANIMA_NAME_ALIASES,
} from "@/lib/personalAnimaRecord";
import {
  base44,
  notifyStoreChanged,
} from "@/api/base44Client";
import { matchCharacterByIdentity } from "@/lib/createInitSession";
import { getStarterRoster, retryStarterSeed } from "@/lib/seedCharacters";
import { normalizeStoreList } from "@/lib/storeRecords";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import {
  STORE_AUTH_WAIT_MS,
  STORE_LIST_TIMEOUT_MS,
  withStoreTimeout,
} from "@/lib/storeTimeouts";
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

const LIST_OPTS = { _bootstrapInternal: true };

function rosterListTimeoutError() {
  const err = new Error(
    "The server took too long to respond. Check your connection or try again in a moment.",
  );
  err.code = "timeout";
  return err;
}

function asAnimaChars(animas) {
  return (animas || []).map((a) => ({
    ...a,
    _isAnima: true,
    category: a.archetype || "guardian",
    universe: "Anima",
  }));
}

function dedupeById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    if (row.id) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
    }
    out.push(row);
  }
  return out;
}

async function settleRosterEntityList(listFn, timeoutMs = STORE_LIST_TIMEOUT_MS) {
  try {
    const rows = normalizeStoreList(
      await withStoreTimeout(
        Promise.resolve().then(listFn),
        timeoutMs,
        rosterListTimeoutError,
      ),
    );
    return { rows, error: null };
  } catch (err) {
    return { rows: [], error: err };
  }
}

async function listRosterEntity(listFn, timeoutMs = STORE_LIST_TIMEOUT_MS) {
  let result = await settleRosterEntityList(listFn, timeoutMs);
  if (result.error && isStoreTimeoutError(result.error)) {
    await awaitCompanionStoreAuth(STORE_AUTH_WAIT_MS);
    result = await settleRosterEntityList(listFn, timeoutMs);
  }
  if (result.error) {
    console.warn(
      "[Anima] Roster entity load failed:",
      result.error?.message || result.error,
    );
  }
  return result;
}

async function recoverPersonalCompanionRows(
  characterLimit,
  timeoutMs = STORE_LIST_TIMEOUT_MS,
) {
  const filter =
    typeof base44.entities.Character.filter === "function"
      ? (query, sort, limit, opts) =>
          base44.entities.Character.filter(query, sort, limit, opts)
      : () => Promise.resolve([]);
  try {
    return await withStoreTimeout(
      Promise.all([
        filter(
          { creation_method: "ai_prompt" },
          "-created_date",
          characterLimit,
          LIST_OPTS,
        ).catch(() => []),
        base44.entities.Anima.list("-created_date", 20, {
          ...LIST_OPTS,
          search: { name: "serenity" },
        }).catch(() => []),
        ...PERSONAL_ANIMA_NAME_ALIASES.map((name) =>
          base44.entities.Character.list("-created_date", 20, {
            ...LIST_OPTS,
            search: { name },
          }).catch(() => []),
        ),
      ]).then(([prompted, serenity, ...named]) => ({
        characters: normalizeStoreList([
          ...(prompted || []),
          ...named.flat(),
        ]),
        animas: normalizeStoreList(serenity),
      })),
      timeoutMs,
      rosterListTimeoutError,
    );
  } catch (err) {
    console.warn(
      "[Anima] Personal companion recovery failed:",
      err?.message || err,
    );
    return { characters: [], animas: [] };
  }
}

/** Bundled starter roster for chat pickers (not yet confirmed in the account store). */
export function getBundledStarterRoster() {
  return getStarterRoster().map((c) => ({ ...c, _bundled: true }));
}

/** True when the picker already has a store/Anima row (not only bundled starters). */
export function hasAccountRosterRows(characters) {
  return (characters || []).some((c) => c && c.id && !c._bundled);
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
 * @param {{ retrySeed?: boolean, characterLimit?: number, animaLimit?: number, waitBootstrap?: boolean, allowBundledFallback?: boolean, notifyOnSeed?: boolean, listTimeoutMs?: number }} [opts]
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
  listTimeoutMs = STORE_LIST_TIMEOUT_MS,
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

  // Independent clocks, like Sacred Space. A hung Character.list must not
  // starve Anima.list (Serenity) or name recovery (Aelynd). Skip the second
  // ensureBootstrapComplete inside queryEntity — caller already waited or
  // chose waitBootstrap:false so Select Character is not gated again.
  const [charResult, animaResult, recovered] = await Promise.all([
    listRosterEntity(
      () =>
        base44.entities.Character.list(
          "-created_date",
          characterLimit,
          LIST_OPTS,
        ),
      listTimeoutMs,
    ),
    listRosterEntity(
      () =>
        base44.entities.Anima.list("-created_date", animaLimit, LIST_OPTS),
      listTimeoutMs,
    ),
    recoverPersonalCompanionRows(characterLimit, listTimeoutMs),
  ]);

  let rawCharacters = dedupeById([
    ...charResult.rows,
    ...recovered.characters,
  ]);
  let listError = charResult.error;
  const animas = dedupeById([...animaResult.rows, ...recovered.animas]);

  let seedError = null;
  let seededCount = 0;
  // Empty-token [] is not a confirmed empty account. retryStarterSeed waits
  // waitForStoreAuth(30000) up to three times — that left Select Character
  // on the initial "Loading account characters…" banner with starters only.
  const confirmedEmpty =
    !!token && !listError && !charResult.rows.length && !animas.length;
  if (confirmedEmpty && retrySeed) {
    try {
      seededCount =
        (await withStoreTimeout(
          Promise.resolve().then(() => retryStarterSeed()),
          STORE_AUTH_WAIT_MS,
          rosterListTimeoutError,
        )) || 0;
      if (notifyOnSeed && seededCount > 0) {
        notifyStoreChanged();
      }
      const afterSeed = await listRosterEntity(
        () =>
          base44.entities.Character.list(
            "-created_date",
            characterLimit,
            LIST_OPTS,
          ),
        listTimeoutMs,
      );
      rawCharacters = dedupeById([
        ...afterSeed.rows,
        ...recovered.characters,
      ]);
      if (afterSeed.error) seedError = afterSeed.error;
    } catch (err) {
      seedError = err;
      console.warn(
        "[Anima] Starter seed retry during roster load failed:",
        err?.message || err,
      );
    }
  }

  const storeError = listError || seedError || authError;
  const storeCharacters = rawCharacters;
  const animaAsChars = asAnimaChars(animas);
  const hasStoreRows = storeCharacters.length > 0 || animas.length > 0;
  let usingBundledSeed = false;
  // Always merge missing starters onto a successful store list so custom
  // characters stay visible and preloaded seeds remain pickable. An empty or
  // failed read still paints the bundled roster instead of a blank picker.
  if (allowBundledFallback) {
    rawCharacters = mergeRosterWithBundled(
      storeCharacters,
      getBundledStarterRoster(),
    );
    usingBundledSeed = !hasStoreRows;
  }

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
