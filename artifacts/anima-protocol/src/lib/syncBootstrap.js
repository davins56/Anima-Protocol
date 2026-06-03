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

async function run() {
  try {
    await migrateLocalDataOnce();
  } catch (err) {
    console.warn("[Anima] Local data migration failed:", err.message);
  }
  await seedCharactersIfNeeded();
}

// Migrate the browser's local data to the server exactly once, ever. The flag
// is global (not per-account) so the local data is attributed to the FIRST
// account that signs in on this browser and is never re-imported into a
// different account afterwards. The server additionally refuses to import into
// an account that already has data.
async function migrateLocalDataOnce() {
  if (localStorage.getItem(MIGRATION_KEY)) return;

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
    // Only treat the migration as done when the server confirms the import
    // succeeded. A partial/failed import that still resolves (e.g.
    // `{ imported: false }`) must NOT set the flag, or the user's local
    // characters/profile would be permanently left behind with no retry.
    if (!result?.imported) {
      throw new Error("bulk import did not confirm success");
    }
    console.log(`[Anima] Migrated ${result.count} records to your account.`);
  }

  localStorage.setItem(MIGRATION_KEY, "1");
}
