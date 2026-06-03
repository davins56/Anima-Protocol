import { bulkImport } from "@/api/base44Client";
import { seedCharactersIfNeeded, resetSeedLock } from "@/lib/seedCharacters";

// One-time migration of the browser's pre-sync localStorage data up to the
// signed-in account, followed by per-account starter seeding. Both steps are
// run exactly once per signed-in account per page load via a per-user promise
// lock (race-safe against React StrictMode's double-invoke).

const MIGRATION_KEY = "anima_server_migration_v1";
const ENTITY_PREFIX = "anima_entity_";
const LEGACY_AUTH_KEY = "anima_auth_user";

let bootstrapPromise = null;
let bootstrappedUserId = null;

export function bootstrapUserData(userId) {
  if (bootstrappedUserId === userId && bootstrapPromise) {
    return bootstrapPromise;
  }
  bootstrappedUserId = userId;
  resetSeedLock();
  bootstrapPromise = run();
  return bootstrapPromise;
}

// Possible migration outcomes surfaced to the caller so the UI can tell the
// user when their pre-sync local data hasn't made it up to their account yet.
//   "migrated" — local data was imported and the server confirmed success
//   "skipped"  — nothing to migrate, or it was already migrated previously
//   "failed"   — there was local data but the import did not confirm success
async function run() {
  let outcome = "skipped";
  try {
    outcome = await migrateLocalDataOnce();
  } catch (err) {
    console.warn("[Anima] Local data migration failed:", err.message);
    outcome = "failed";
  }
  await seedCharactersIfNeeded();
  return outcome;
}

// Migrate the browser's local data to the server exactly once, ever. The flag
// is global (not per-account) so the local data is attributed to the FIRST
// account that signs in on this browser and is never re-imported into a
// different account afterwards. The server additionally refuses to import into
// an account that already has data.
async function migrateLocalDataOnce() {
  if (localStorage.getItem(MIGRATION_KEY)) return "skipped";

  const entities = {};
  let hasData = false;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(ENTITY_PREFIX)) continue;
    const name = key.slice(ENTITY_PREFIX.length);
    try {
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(arr) && arr.length) {
        entities[name] = arr;
        hasData = true;
      }
    } catch {
      /* skip malformed entries */
    }
  }

  let profile;
  try {
    const raw = sessionStorage.getItem(LEGACY_AUTH_KEY);
    if (raw) {
      const u = JSON.parse(raw);
      if (u && typeof u === "object") {
        // Drop the old local identity fields — Clerk owns identity now.
        const { id, email, full_name, role, created_date, ...rest } = u;
        void id;
        void email;
        void full_name;
        void role;
        void created_date;
        if (Object.keys(rest).length) profile = rest;
      }
    }
  } catch {
    /* ignore */
  }

  if (hasData || profile) {
    const payload = { entities };
    if (profile) payload.profile = profile;
    const result = await bulkImport(payload);
    // The account already has server data, so the one-time import (which only
    // ever targets an EMPTY account) is a legitimate no-op, NOT a failure. The
    // user's data is already safe on their account; mark the migration done so
    // we stop retrying and never show the "hasn't synced" notice. (Without this,
    // every returning user with leftover local data on a fresh browser gets a
    // permanent false-alarm toast that reloads the app when its Retry is tapped.)
    if (!result?.imported && result?.reason === "account_not_empty") {
      localStorage.setItem(MIGRATION_KEY, "1");
      return "skipped";
    }
    // Only treat the migration as done when the server confirms the import
    // succeeded. A partial/failed import that still resolves (e.g.
    // `{ imported: false }`) must NOT set the flag, or the user's local
    // characters/profile would be permanently left behind with no retry.
    if (!result?.imported) {
      throw new Error("bulk import did not confirm success");
    }
    console.log(`[Anima] Migrated ${result.count} records to your account.`);
    localStorage.setItem(MIGRATION_KEY, "1");
    return "migrated";
  }

  localStorage.setItem(MIGRATION_KEY, "1");
  return "skipped";
}
