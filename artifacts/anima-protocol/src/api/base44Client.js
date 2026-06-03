// Server-backed entity store — replaces the previous localStorage store with
// the api-server `/api/store` endpoints so all user progress (characters, chats,
// journals, inventory, quests, world state, settings, etc.) persists on the
// server, scoped to the signed-in Clerk account, and syncs across devices.
//
// The public interface (entities CRUD/filter, auth.me/updateMe/
// updateMyUserData/syncIdentity/clearSession/logout, asServiceRole, integrations,
// functions) is kept identical to the old localStorage implementation so the
// hundreds of call sites across the app are untouched.

import { animaApi } from './animaApi';

const STORE_BASE = `${window.location.origin}/api/store`;

// --- Clerk token bridge -----------------------------------------------------
// The non-React client cannot read the Clerk session directly. AuthContext
// registers a token getter here (see setAuthTokenGetter) so every request can
// attach the user's Clerk session token. Calls are gated until a getter exists.
let tokenGetter = null;
let resolveReady;
const readyPromise = new Promise((r) => {
  resolveReady = r;
});

export function setAuthTokenGetter(fn) {
  tokenGetter = fn;
  if (fn) resolveReady();
}

async function getToken() {
  if (!tokenGetter) await readyPromise;
  try {
    return tokenGetter ? await tokenGetter() : null;
  } catch {
    return null;
  }
}

async function authHeaders(extra) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function storeFetch(path, options = {}) {
  const headers = await authHeaders(options.headers);
  return fetch(`${STORE_BASE}${path}`, { ...options, headers });
}

// AI photo edit. Sends a base64 image data URL + a text prompt to the
// api-server (gpt-image-1 edit) and returns the transformed image as a data
// URL. Used by the home-page "add photo" AI edit feature.
const API_BASE = `${window.location.origin}/api`;

export async function editImage({ image, prompt }) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/openai/image-edit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image, prompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// --- list cache + in-flight de-dupe -----------------------------------------
// list() is called very frequently across the app. A short TTL cache plus
// in-flight de-duplication keeps it responsive without going stale: any write
// to an entity bumps that entity's version, invalidating its cached queries.
const LIST_TTL = 2000;
const listCache = new Map(); // key -> { value, expiry }
const inflight = new Map(); // key -> promise
const entityVersion = new Map(); // entityName -> number

function verOf(entityName) {
  return entityVersion.get(entityName) || 0;
}

function bumpVersion(entityName) {
  entityVersion.set(entityName, verOf(entityName) + 1);
  // Record that this device just wrote, so the cross-device poller can avoid
  // treating our own change as a remote one (see pollRevision below).
  lastLocalWriteAt = Date.now();
}

// Clear all cached state. Called on sign-out / account switch so one account
// never sees another account's cached data.
export function clearStoreCache() {
  listCache.clear();
  inflight.clear();
  entityVersion.clear();
}

// --- Cross-device live sync -------------------------------------------------
// The server exposes a cheap /revision token that shifts whenever any of the
// account's data changes. We poll it (on an interval while visible, and
// immediately on focus / tab-visible) and, when it changes due to a write from
// ANOTHER device, drop our caches and notify React via a window event so open
// pages can refetch. Local writes are suppressed so a device doesn't reload in
// response to its own edits.
const STORE_CHANGED_EVENT = 'anima:store-changed';
const POLL_INTERVAL_MS = 15000;
// If a local write happened within this window of a detected revision change,
// assume the change was ours and don't force open pages to reload.
const SELF_WRITE_SUPPRESS_MS = POLL_INTERVAL_MS + 5000;

let lastLocalWriteAt = 0;
let lastSeenRevision = null;
let pollTimer = null;
let syncStarted = false;

export async function fetchRevision() {
  const token = await getToken();
  if (!token) return null;
  try {
    const res = await storeFetch('/revision');
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.revision === 'string' ? data.revision : null;
  } catch {
    return null;
  }
}

function notifyStoreChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT));
  }
}

function dropCaches() {
  clearStoreCache();
  profileCache = null;
  profileExpiry = 0;
}

async function pollRevision() {
  const rev = await fetchRevision();
  if (rev == null) return;
  if (lastSeenRevision == null) {
    // First successful poll just establishes a baseline; nothing to react to.
    lastSeenRevision = rev;
    return;
  }
  if (rev === lastSeenRevision) return;

  const causedByLocalWrite =
    Date.now() - lastLocalWriteAt < SELF_WRITE_SUPPRESS_MS;
  if (causedByLocalWrite) {
    // The change likely came from THIS device's recent write, so don't force
    // open pages to reload from their own edits. Drop caches so the next
    // natural fetch is fresh, but DELIBERATELY do not advance the baseline or
    // notify: if this revision actually reflects another device's change, the
    // next poll (once local writes settle past the suppress window) still sees
    // rev !== lastSeenRevision and emits it. This guarantees a remote change is
    // never permanently lost — at worst it is delayed until local edits pause.
    dropCaches();
    return;
  }

  lastSeenRevision = rev;
  dropCaches();
  notifyStoreChanged();
}

function handleVisibility() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    pollRevision();
  }
}

// Reset the sync baseline (e.g. on account switch) so the next poll re-baselines
// against the new account instead of firing a spurious change event.
function resetSyncBaseline() {
  lastSeenRevision = null;
}

export function startStoreSync() {
  if (syncStarted || typeof window === 'undefined') return;
  syncStarted = true;
  resetSyncBaseline();
  pollRevision();
  pollTimer = setInterval(() => {
    if (
      typeof document === 'undefined' ||
      document.visibilityState === 'visible'
    ) {
      pollRevision();
    }
  }, POLL_INTERVAL_MS);
  window.addEventListener('focus', pollRevision);
  document.addEventListener('visibilitychange', handleVisibility);
}

export function stopStoreSync() {
  if (!syncStarted) return;
  syncStarted = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', pollRevision);
    document.removeEventListener('visibilitychange', handleVisibility);
  }
  resetSyncBaseline();
}

// Full account export. Returns every entity record for the signed-in user plus
// their profile, in the same shape bulkImport() consumes so a backup can be
// restored after a factory reset. Used by the "Export my data" backup feature.
export async function exportData() {
  const res = await storeFetch('/export');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// One-time bulk import used by the local->server migration. The server only
// imports when the account has no data yet, so this is safe to call and a no-op
// for accounts that already have server data.
export async function bulkImport(payload) {
  const res = await storeFetch('/import', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  clearStoreCache();
  return res.json();
}

function buildQuery({ filters, sort, limit }) {
  const params = new URLSearchParams();
  if (typeof sort === 'string' && sort) params.set('sort', sort);
  if (typeof limit === 'number' && limit >= 0) params.set('limit', String(limit));
  if (filters && typeof filters === 'object' && Object.keys(filters).length) {
    params.set('filters', JSON.stringify(filters));
  }
  return params.toString();
}

async function queryEntity(entityName, opts) {
  const qs = buildQuery(opts);
  const key = `${entityName}|v${verOf(entityName)}|${qs}`;

  const cached = listCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    const token = await getToken();
    if (!token) return [];
    const res = await storeFetch(
      `/${encodeURIComponent(entityName)}${qs ? `?${qs}` : ''}`,
    );
    if (res.status === 401) return [];
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const data = await res.json();
    listCache.set(key, { value: data, expiry: Date.now() + LIST_TTL });
    return data;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

function entityStore(entityName) {
  return {
    // SDK-style signatures used across the app:
    //   list()                     → all items
    //   list("-updated_date", 50)  → sorted + limited
    //   list({ key: value })       → filtered (back-compat)
    async list(sortOrFilters, limit) {
      if (typeof sortOrFilters === 'string') {
        return queryEntity(entityName, { sort: sortOrFilters, limit });
      }
      if (sortOrFilters && typeof sortOrFilters === 'object') {
        return queryEntity(entityName, { filters: sortOrFilters, limit });
      }
      return queryEntity(entityName, { limit });
    },

    async get(id) {
      const token = await getToken();
      if (!token) return null;
      const res = await storeFetch(
        `/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`,
      );
      if (res.status === 401 || res.status === 404) return null;
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },

    async create(data) {
      const res = await storeFetch(`/${encodeURIComponent(entityName)}`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      bumpVersion(entityName);
      return res.json();
    },

    async update(id, data) {
      const res = await storeFetch(
        `/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(data || {}) },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      bumpVersion(entityName);
      return res.json();
    },

    async delete(id) {
      const res = await storeFetch(
        `/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      bumpVersion(entityName);
    },

    async bulkCreate(dataArray) {
      const res = await storeFetch(`/${encodeURIComponent(entityName)}/bulk`, {
        method: 'POST',
        body: JSON.stringify({ items: dataArray || [] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      bumpVersion(entityName);
      return res.json();
    },

    // filter(filters?, sort?, limit?) — SDK-style equality filtering with
    // optional sort string and numeric limit.
    async filter(filters = {}, sort, limit) {
      return queryEntity(entityName, { filters, sort, limit });
    },
  };
}

// --- Profile / identity -----------------------------------------------------
// Clerk owns identity (id, email, full_name); the server profile record holds
// everything else (settings, display_name, selected_mode, etc.). me() merges
// the Clerk identity over the server profile so the rest of the app keeps
// reading a single user object via base44.auth.me().
const PROFILE_DEFAULTS = {
  role: 'User',
  selected_mode: 'companion',
};

let currentIdentity = null; // { id, email, full_name } from Clerk
let profileCache = null; // server profile data
let profileExpiry = 0;
const PROFILE_TTL = 2000;

function mergedUser(profileData) {
  return {
    ...PROFILE_DEFAULTS,
    created_date: new Date().toISOString(),
    ...(profileData || {}),
    ...(currentIdentity || {}),
  };
}

async function loadProfile(force) {
  if (!force && profileCache && profileExpiry > Date.now()) {
    return profileCache;
  }
  const token = await getToken();
  if (!token) {
    profileCache = {};
    profileExpiry = Date.now() + PROFILE_TTL;
    return profileCache;
  }
  const res = await storeFetch('/profile');
  if (!res.ok) {
    profileCache = profileCache || {};
    return profileCache;
  }
  const data = await res.json();
  profileCache = data || {};
  profileExpiry = Date.now() + PROFILE_TTL;
  return profileCache;
}

async function saveProfile(patch) {
  const current = await loadProfile(true);
  const next = { ...current, ...patch };
  const res = await storeFetch('/profile', {
    method: 'PUT',
    body: JSON.stringify(next),
  });
  if (res.ok) {
    profileCache = await res.json();
  } else {
    profileCache = next;
  }
  profileExpiry = Date.now() + PROFILE_TTL;
  return mergedUser(profileCache);
}

const entitiesProxy = new Proxy(
  {},
  {
    get: (_, entityName) => entityStore(entityName),
  },
);

export const base44 = {
  auth: {
    isAuthenticated: async () => !!(await getToken()),

    redirectToLogin: () => {
      window.location.href = '/sign-in';
    },

    me: async () => {
      const profile = await loadProfile(false);
      return mergedUser(profile);
    },

    // Merge Clerk identity (id, email, name) into the in-memory identity used
    // by me(). Called by AuthContext when a Clerk session becomes available.
    // Switching accounts clears cached store/profile data.
    syncIdentity: (identity) => {
      if (identity && identity.id && currentIdentity?.id !== identity.id) {
        clearStoreCache();
        profileCache = null;
        profileExpiry = 0;
        // Re-baseline cross-device sync so the next poll compares against the
        // NEW account, never firing a spurious change from the old account's
        // revision (and never missing the new account's first real change).
        resetSyncBaseline();
      }
      currentIdentity = { ...(currentIdentity || {}), ...identity };
      return mergedUser(profileCache);
    },

    clearSession: () => {
      currentIdentity = null;
      profileCache = null;
      profileExpiry = 0;
      clearStoreCache();
    },

    updateMe: async (data) => saveProfile(data),
    updateMyUserData: async (data) => saveProfile(data),

    // Identity/session redirects are owned by Clerk (see AuthContext.logout).
    // This only clears local caches.
    logout: async () => {
      currentIdentity = null;
      profileCache = null;
      profileExpiry = 0;
      clearStoreCache();
    },
  },

  entities: entitiesProxy,

  // Mirror the SDK's service-role accessor. There is no privilege separation
  // here — server queries are always scoped to the authenticated user — so it
  // resolves the same server-backed entity store.
  asServiceRole: {
    entities: entitiesProxy,
  },

  integrations: {
    Core: {
      InvokeLLM: async ({ prompt, systemPrompt }) => {
        // Create/reuse a conversation for LLM calls
        let convId = sessionStorage.getItem('anima_llm_conv_id');
        if (!convId) {
          const conv = await animaApi.conversations.create('LLM session');
          convId = String(conv.id);
          sessionStorage.setItem('anima_llm_conv_id', convId);
        }

        let result = '';
        for await (const chunk of animaApi.sendMessage(
          Number(convId),
          prompt,
          systemPrompt || '',
        )) {
          if (chunk.done) break;
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.content) result += chunk.content;
        }
        return result;
      },

      GenerateImage: async () => {
        console.warn('GenerateImage not implemented in Replit environment');
        return null;
      },

      UploadFile: async () => {
        console.warn('UploadFile not implemented in Replit environment');
        return { url: null };
      },

      GetStripeLifetimePrices: async () => {
        return { prices: [] };
      },
    },
  },

  functions: new Proxy(
    {},
    {
      get: (_, fnName) => {
        const callFn = async (nameOrData, data) => {
          // Support both call styles:
          // base44.functions.invoke("fnName", data)
          // base44.functions.realName.invoke(data)
          const realName = fnName === 'invoke' ? nameOrData : fnName;
          const payload = fnName === 'invoke' ? data : nameOrData;
          try {
            const res = await fetch(
              `${window.location.origin}/api/openai/invoke/${realName}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
              },
            );
            if (!res.ok) {
              const err = await res
                .json()
                .catch(() => ({ error: res.statusText }));
              throw new Error(err.error || res.statusText);
            }
            const json = await res.json();
            return json.result;
          } catch (err) {
            console.warn(`base44.functions.${String(realName)} failed:`, err.message);
            return null;
          }
        };

        if (fnName === 'invoke') {
          return callFn;
        }
        return { invoke: callFn };
      },
    },
  ),
};

export default base44;
