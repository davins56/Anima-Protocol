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
import { downscaleDataUrl } from '@/lib/downscaleImage';
import { apiUrl } from '@/lib/apiOrigin';
import {
  ensureBootstrapComplete,
  isBootstrapSettled,
} from '@/lib/bootstrapState';
import {
  STORE_FETCH_TIMEOUT_MS,
  STORE_SESSION_CREATE_TIMEOUT_MS,
} from '@/lib/storeTimeouts';
import {
  authHeaders,
  clearAuthTokenGetter,
  getToken,
  setAuthTokenGetter,
  waitForStoreAuth,
} from './authBridge';

const STORE_BASE = () => apiUrl('/store');

export { clearAuthTokenGetter, setAuthTokenGetter, waitForStoreAuth };
export { STORE_FETCH_TIMEOUT_MS, STORE_SESSION_CREATE_TIMEOUT_MS };

const DEFAULT_STORE_TIMEOUT_MESSAGE =
  'The server took too long to respond. Check your connection or try again in a moment.';

async function storeFetch(path, options = {}) {
  const token = await getToken();
  if (!token) {
    const err = new Error(
      'Not signed in — your session may have expired. Sign out and sign in again, then retry.',
    );
    err.status = 401;
    throw err;
  }

  const {
    timeoutMs,
    timeoutMessage,
    signal: userSignal,
    headers: optionHeaders,
    ...fetchOptions
  } = options;
  const budget =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? timeoutMs
      : STORE_FETCH_TIMEOUT_MS;

  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(budget)
      : undefined;
  let signal = timeoutSignal;
  if (userSignal && timeoutSignal) {
    signal = AbortSignal.any([userSignal, timeoutSignal]);
  } else if (userSignal) {
    signal = userSignal;
  }

  const makeRequest = async (retryOptions = {}) => {
    const headers = await authHeaders(optionHeaders, retryOptions);
    return await fetch(`${STORE_BASE()}${path}`, {
      ...fetchOptions,
      headers,
      credentials: 'same-origin',
      signal,
    });
  };

  let res;
  try {
    res = await makeRequest();
    if (res.status === 401) {
      const retried = await makeRequest({ skipCache: true });
      if (retried.status !== 401) {
        return retried;
      }
      res = retried;
    }
    // Stale Worker/pg sockets surface as 503 "Database connection reset".
    // One extra attempt lets the server open a fresh connection.
    if (await isRetryableStoreReset(res)) {
      res = await makeRequest();
    }
    return res;
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      const timeoutErr = new Error(timeoutMessage || DEFAULT_STORE_TIMEOUT_MESSAGE);
      timeoutErr.code = 'timeout';
      throw timeoutErr;
    }
    throw err;
  }
}

async function isRetryableStoreReset(res) {
  if (res.status !== 503) return false;
  try {
    const json = await res.clone().json();
    return (
      json?.reason === 'reset' ||
      /connection reset/i.test(String(json?.error || ''))
    );
  } catch {
    return false;
  }
}

export const STORE_UNREACHABLE_MESSAGE =
  'The companion store is unreachable. The database could not be reached — retry in a moment.';

const STORE_API_NOT_FOUND_MESSAGE =
  'Character store API not found — the backend may not be running or /api is not proxied to it.';

/** Cloudflare error/challenge/301 pages and SPA HTML — never show this in the UI. */
export function isHtmlErrorBody(text, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const head = raw.trimStart().slice(0, 400);
  return (
    /<!DOCTYPE\s+html/i.test(head) ||
    /^<html[\s>]/i.test(head) ||
    /<!--\[if\s+lt\s+IE/i.test(head) ||
    /<center>\s*cloudflare\s*<\/center>/i.test(raw) ||
    /301\s+Moved\s+Permanently/i.test(head)
  );
}

// Parse a failed store response into a human-readable message. Non-JSON bodies
// (Cloudflare 1101/524 HTML, www→apex homepage HTML, Express 404) must never
// dump a raw snippet into Character library loadError.
export async function parseStoreErrorResponse(res) {
  const text = await res.text();
  const contentType =
    typeof res.headers?.get === 'function'
      ? res.headers.get('content-type')
      : undefined;
  try {
    const json = JSON.parse(text);
    return json.error || res.statusText || `HTTP ${res.status}`;
  } catch {
    if (res.status === 404 && !isHtmlErrorBody(text, contentType)) {
      return STORE_API_NOT_FOUND_MESSAGE;
    }
    if (isHtmlErrorBody(text, contentType) || res.status >= 500) {
      return STORE_UNREACHABLE_MESSAGE;
    }
    if (res.status === 404) {
      return STORE_API_NOT_FOUND_MESSAGE;
    }
    return STORE_UNREACHABLE_MESSAGE;
  }
}

function storeError(res, message) {
  const e = new Error(message);
  e.status =
    message === STORE_UNREACHABLE_MESSAGE ? 503 : res.status;
  return e;
}

// Shared helper for image API calls (edit / generate). Surfaces abort vs
// network vs server errors the same way so UI can branch consistently.
async function postImageApi(path, body, signal) {
  const headers = await authHeaders();
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Re-throw aborts untouched so callers can distinguish a user cancel from a
    // genuine failure; everything else here is a connectivity problem.
    if (err?.name === 'AbortError') throw err;
    const netErr = new Error('Network request failed.');
    netErr.code = 'network';
    throw netErr;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || res.statusText);
    e.status = res.status;
    e.code = err.code;
    throw e;
  }
  return res.json();
}

// AI photo edit. Sends a base64 image data URL + a text prompt to the
// api-server (gpt-image-1 edit) and returns the transformed image as a data
// URL. Used by the home-page "add photo" AI edit feature.
export async function editImage({ image, prompt, signal }) {
  return postImageApi('/openai/image-edit', { image, prompt }, signal);
}

// AI image generation from a text prompt (no source image). Returns a PNG
// data URL. Used by Customise Anima when forging a look from scratch.
export async function generateImage({ prompt, signal }) {
  return postImageApi('/openai/image-generate', { prompt }, signal);
}

// --- file uploads (object storage) ------------------------------------------
// User-picked and AI-edited portraits are stored as real files in object
// storage (not base64 in the DB). The flow is: downscale to a small JPEG ->
// ask the api-server for a presigned PUT URL -> upload the bytes directly to
// storage -> persist the served object path (e.g. "/api/storage/objects/...").
// That served path loads in a plain <img> and persists across refresh/devices.

function dataUrlToBlob(dataUrl) {
  const [header, b64] = String(dataUrl).split(',');
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/jpeg';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Convert a Blob to a base64 payload (no data: prefix) for the direct upload API.
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function parseUploadErrorResponse(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (json?.error) return String(json.error);
  } catch {
    // Non-JSON (HTML 404 from an assets-only deploy, Cloudflare challenge, …)
  }
  if (res.status === 401) {
    return 'Sign in to upload an image, then try again.';
  }
  if (res.status === 413) {
    return 'That image is too large. Try a smaller photo.';
  }
  if (res.status === 404) {
    return 'Image upload API not found — /api/storage/uploads is not available on this host.';
  }
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  return snippet || res.statusText || `Upload failed (${res.status})`;
}

/**
 * Upload an image blob and return the served object path.
 *
 * Uses the Postgres-backed POST /api/storage/uploads endpoint so avatar upload
 * works on Cloudflare Workers / Vercel (the legacy Replit GCS sidecar is
 * unavailable there). Requires a signed-in Clerk session.
 */
async function uploadBlob(blob) {
  const token = await getToken();
  if (!token) {
    const err = new Error(
      'Sign in to upload an image, then try again.',
    );
    err.status = 401;
    throw err;
  }

  const headers = await authHeaders();
  const dataBase64 = await blobToBase64(blob);
  let res;
  try {
    res = await fetch(apiUrl('/storage/uploads'), {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({
        contentType: blob.type || 'image/jpeg',
        dataBase64,
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const netErr = new Error('Network request failed — could not reach the image upload API.');
    netErr.code = 'network';
    throw netErr;
  }
  if (!res.ok) {
    const message = await parseUploadErrorResponse(res);
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  const payload = await res.json();
  if (payload?.file_url) return payload.file_url;
  if (payload?.objectPath) {
    // Root-relative path so the avatar resolves against the current origin.
    return `/api/storage${payload.objectPath}`;
  }
  throw new Error('Upload failed — no file URL returned.');
}

// Downscale a data URL to a small JPEG and upload it. Returns the served path.
export async function uploadDataUrl(dataUrl, { maxSize = 1024, quality = 0.85 } = {}) {
  const small = await downscaleDataUrl(dataUrl, maxSize, quality);
  return uploadBlob(dataUrlToBlob(small));
}

// Fetch an image URL (e.g. a stored "/api/storage/objects/..." path) and read
// it back as a data URL. Needed because the AI image-edit endpoint only accepts
// data: URLs, so a stored avatar must be inlined before it can be re-edited.
export async function urlToDataUrl(url) {
  if (typeof url === 'string' && url.startsWith('data:')) return url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load image (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
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
// Polling cadence. With server push (SSE) connected, polling is only a safety
// net so it runs slowly (PUSH_FALLBACK_POLL_INTERVAL_MS). If the stream is
// down, we fall back to the original faster cadence (POLL_INTERVAL_MS).
const POLL_INTERVAL_MS = 15000;
const PUSH_FALLBACK_POLL_INTERVAL_MS = 60000;
// If a local write happened within this window of a detected revision change,
// assume the change was ours and don't force open pages to reload. Kept fixed
// (not tied to the poll interval) so lengthening the fallback poll under push
// doesn't widen self-write suppression.
const SELF_WRITE_SUPPRESS_MS = 20000;

let lastLocalWriteAt = 0;
let lastSeenRevision = null;
let pollTimer = null;
let pollIntervalMs = POLL_INTERVAL_MS;
let suppressRecheckTimer = null;
let syncStarted = false;

// --- Server push (SSE) state ---
const SSE_PATH = '/events';
const SSE_RETRY_BASE_MS = 1000;
const SSE_RETRY_MAX_MS = 30000;
const SSE_PUSH_DEBOUNCE_MS = 200;
// The server heartbeats every 25s. If we go this long without ANY bytes (a
// heartbeat, a change event, or comment) the stream is effectively dead — some
// proxies hold/buffer a stream open without delivering bytes — so we treat the
// silence as a drop and force a reconnect. The window allows two missed beats
// plus slack so a single late heartbeat never trips a needless reconnect.
const SSE_HEARTBEAT_TIMEOUT_MS = 60000;
// Emitted (and logged) whenever the live-sync transport flips between the
// instant server-push path and the slower polling fallback, so this otherwise
// silent degradation is observable. detail: { mode: 'push' | 'polling' }.
const SYNC_MODE_EVENT = 'anima:sync-mode';
let sseController = null;
let sseConnected = false;
let sseRetryTimer = null;
let sseRetryDelay = SSE_RETRY_BASE_MS;
let pushDebounceTimer = null;
let sseHeartbeatTimer = null;
let lastEmittedSyncMode = null;

// Announce the current live-sync transport (push vs polling) once per change.
// Gated on syncStarted so a clean sign-out teardown doesn't log a misleading
// "polling fallback". Both a console line and a window event are emitted so the
// degradation can be seen in the console and reacted to by the UI if desired.
function emitSyncMode() {
  if (!syncStarted) return;
  const mode = sseConnected ? 'push' : 'polling';
  if (mode === lastEmittedSyncMode) return;
  lastEmittedSyncMode = mode;
  try {
    if (typeof console !== 'undefined') {
      console.info(
        mode === 'push'
          ? '[anima sync] server push connected — instant sync active'
          : '[anima sync] server push unavailable — using polling fallback',
      );
    }
  } catch {
    /* ignore logging failures */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYNC_MODE_EVENT, { detail: { mode } }));
  }
}

// Single setter for the push-connected flag so every transition emits the
// sync-mode signal exactly once and stays in sync with the poll cadence.
function setSseConnected(value) {
  if (sseConnected === value) return;
  sseConnected = value;
  emitSyncMode();
}

// (Re)arm the heartbeat watchdog. Called once the stream opens and again on
// every chunk received; if it ever fires we abort the stream, which unwinds the
// read loop into connectSse's finally (reconnect + revert to fast polling).
function armSseWatchdog(controller) {
  if (sseHeartbeatTimer) clearTimeout(sseHeartbeatTimer);
  sseHeartbeatTimer = setTimeout(() => {
    sseHeartbeatTimer = null;
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, SSE_HEARTBEAT_TIMEOUT_MS);
}

function clearSseWatchdog() {
  if (sseHeartbeatTimer) {
    clearTimeout(sseHeartbeatTimer);
    sseHeartbeatTimer = null;
  }
}

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

export function notifyStoreChanged() {
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
    // Under push, a genuine remote change that lands inside the suppress window
    // would otherwise only be caught by the (now-slow) fallback poll. Schedule
    // a one-shot re-check right after the window closes so the bound stays tight
    // regardless of the poll cadence.
    scheduleSuppressRecheck();
    return;
  }

  lastSeenRevision = rev;
  dropCaches();
  notifyStoreChanged();
}

// One-shot re-poll fired just after the self-write suppression window closes,
// so a remote change masked by a local write is detected promptly even when the
// periodic poll is running slowly (push connected). Coalesced into one timer.
function scheduleSuppressRecheck() {
  if (suppressRecheckTimer || !syncStarted) return;
  const wait =
    Math.max(0, SELF_WRITE_SUPPRESS_MS - (Date.now() - lastLocalWriteAt)) + 500;
  suppressRecheckTimer = setTimeout(() => {
    suppressRecheckTimer = null;
    pollRevision();
  }, wait);
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

// (Re)create the periodic poll timer at the given cadence. The poll is the
// safety net: fast when push is unavailable, slow when push is connected.
// No-op once sync is stopped so a late SSE teardown (connectSse's finally) can
// never resurrect polling after stopStoreSync()/sign-out.
function setPollTimer(intervalMs) {
  if (!syncStarted) return;
  if (pollTimer && pollIntervalMs === intervalMs) return;
  pollIntervalMs = intervalMs;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (
      typeof document === 'undefined' ||
      document.visibilityState === 'visible'
    ) {
      pollRevision();
    }
  }, intervalMs);
}

function applyPollCadence() {
  setPollTimer(
    sseConnected ? PUSH_FALLBACK_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
  );
}

// A push from the server only tells us "something changed" — the real change
// detection (and self-write suppression) still runs against /revision. Coalesce
// bursts of pushes (e.g. several rapid writes) into a single revision check.
function onServerPush() {
  if (pushDebounceTimer) return;
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    pollRevision();
  }, SSE_PUSH_DEBOUNCE_MS);
}

// True when a parsed SSE block contains at least one `data:` line (i.e. a real
// event, not a heartbeat/comment line beginning with ':').
function sseBlockHasData(block) {
  return block.split('\n').some((line) => line.startsWith('data:'));
}

function scheduleSseReconnect() {
  if (!syncStarted || sseRetryTimer) return;
  const delay = sseRetryDelay;
  sseRetryDelay = Math.min(sseRetryDelay * 2, SSE_RETRY_MAX_MS);
  sseRetryTimer = setTimeout(() => {
    sseRetryTimer = null;
    connectSse();
  }, delay);
}

// Subscribe to the server push stream. Uses fetch streaming (not EventSource)
// so the Clerk bearer token can be sent as an Authorization header. On any drop
// the periodic poll cadence reverts to fast and a backoff reconnect is queued.
async function connectSse() {
  if (
    !syncStarted ||
    sseController ||
    typeof window === 'undefined' ||
    typeof fetch === 'undefined' ||
    typeof AbortController === 'undefined'
  ) {
    return;
  }
  const token = await getToken();
  if (!syncStarted) return;
  if (!token) {
    scheduleSseReconnect();
    return;
  }
  const controller = new AbortController();
  sseController = controller;
  try {
    const res = await fetch(`${STORE_BASE()}${SSE_PATH}`, {
      headers: await authHeaders({ Accept: 'text/event-stream' }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`SSE connect failed: ${res.status}`);
    }
    setSseConnected(true);
    sseRetryDelay = SSE_RETRY_BASE_MS;
    applyPollCadence();
    // A freshly opened stream may have missed a change between the last poll and
    // now; check once on connect so we never start out stale.
    pollRevision();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Arm the watchdog immediately: if the proxy accepts the connection but then
    // delivers no bytes at all, the silence still triggers a reconnect.
    armSseWatchdog(controller);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Any bytes (event, heartbeat, or comment) prove the stream is alive.
      armSseWatchdog(controller);
      buffer += decoder.decode(value, { stream: true });
      // Some proxies normalize line endings, so an event block may arrive
      // separated by `\r\n\r\n` instead of `\n\n`. Collapse CRLF to LF before
      // splitting so those pushes aren't missed. A `\r` whose paired `\n` lands
      // in the next chunk simply waits one iteration (no `\r\n` to collapse yet).
      buffer = buffer.replace(/\r\n/g, '\n');
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (sseBlockHasData(block)) onServerPush();
      }
    }
  } catch {
    // aborted (stop/account switch) or network/stream error — handled below.
  } finally {
    clearSseWatchdog();
    if (sseController === controller) sseController = null;
    setSseConnected(false);
    applyPollCadence();
    scheduleSseReconnect();
  }
}

function disconnectSse() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  if (pushDebounceTimer) {
    clearTimeout(pushDebounceTimer);
    pushDebounceTimer = null;
  }
  sseRetryDelay = SSE_RETRY_BASE_MS;
  clearSseWatchdog();
  if (sseController) {
    try {
      sseController.abort();
    } catch {
      /* ignore */
    }
    sseController = null;
  }
  sseConnected = false;
  // Reset the announced transport so the next startStoreSync re-announces from
  // a clean slate (avoids a suppressed first emit after a stop/start cycle).
  lastEmittedSyncMode = null;
}

export function startStoreSync() {
  if (syncStarted || typeof window === 'undefined') return;
  syncStarted = true;
  resetSyncBaseline();
  pollRevision();
  applyPollCadence();
  window.addEventListener('focus', pollRevision);
  document.addEventListener('visibilitychange', handleVisibility);
  connectSse();
}

export function stopStoreSync() {
  if (!syncStarted) return;
  syncStarted = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (suppressRecheckTimer) {
    clearTimeout(suppressRecheckTimer);
    suppressRecheckTimer = null;
  }
  disconnectSse();
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

// Restore a backup into the signed-in account, even when it already has data.
// mode "merge" upserts the backup over current data (keeping records the backup
// doesn't mention); mode "replace" wipes everything first, then restores. Used
// by the Settings "Restore From Backup" feature.
export async function restoreData(payload, mode = 'merge') {
  const res = await storeFetch('/restore', {
    method: 'POST',
    body: JSON.stringify({ ...(payload || {}), mode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  clearStoreCache();
  return res.json();
}

function buildQuery({ filters, sort, limit, offset, search, count }) {
  const params = new URLSearchParams();
  if (typeof sort === 'string' && sort) params.set('sort', sort);
  if (typeof limit === 'number' && limit >= 0) params.set('limit', String(limit));
  if (typeof offset === 'number' && offset > 0) params.set('offset', String(offset));
  if (filters && typeof filters === 'object' && Object.keys(filters).length) {
    params.set('filters', JSON.stringify(filters));
  }
  if (search && typeof search === 'object' && Object.keys(search).length) {
    params.set('search', JSON.stringify(search));
  }
  // count=1 flips the list endpoint to return the grand total ({ count }) for
  // the same filters/search, so a "jump to page N" pager can size itself.
  if (count) params.set('count', '1');
  return params.toString();
}

// Grand total of rows matching a list query (same filters/search as list, but
// ignoring sort/limit/offset). Reuses queryEntity so it shares the same short
// TTL cache + version invalidation: a write to the entity bumps its version and
// the next count is refetched fresh.
async function countEntity(entityName, { filters, search } = {}) {
  const data = await queryEntity(entityName, { filters, search, count: true });
  return data && typeof data.count === 'number' ? data.count : 0;
}

const ROSTER_ENTITIES = new Set(['Character', 'Anima']);

async function queryEntity(entityName, opts) {
  // Wait for starter seeding before UI reads the roster. Bootstrap-internal
  // reads pass `_bootstrapInternal` so they do not await the in-flight promise.
  if (ROSTER_ENTITIES.has(entityName) && !opts?._bootstrapInternal) {
    await ensureBootstrapComplete();
  }

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
    // Never cache auth failures as an empty roster — that made bootstrap/repair
    // think seeding succeeded when the store was never reachable. After bootstrap
    // settles, surface 401 so the UI can prompt re-sign-in instead of "0 indexed".
    if (res.status === 401) {
      if (ROSTER_ENTITIES.has(entityName) && isBootstrapSettled()) {
        throw storeError(
          res,
          'Session not recognized by the server — sign out, sign back in, and try again.',
        );
      }
      return [];
    }
    if (!res.ok) {
      throw storeError(res, await parseStoreErrorResponse(res));
    }
    const text = await res.text();
    if (isHtmlErrorBody(text, res.headers?.get?.('content-type'))) {
      throw storeError({ status: 503 }, STORE_UNREACHABLE_MESSAGE);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw storeError({ status: 503 }, STORE_UNREACHABLE_MESSAGE);
    }
    // Don't cache an empty roster while bootstrap may still be seeding — pages
    // that fetched too early would otherwise keep [] for the TTL window.
    const skipEmptyRosterCache =
      ROSTER_ENTITIES.has(entityName) &&
      !isBootstrapSettled() &&
      Array.isArray(data) &&
      data.length === 0;
    if (!skipEmptyRosterCache) {
      listCache.set(key, { value: data, expiry: Date.now() + LIST_TTL });
    }
    return data;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

// --- Chat messages (stored as individual rows) ------------------------------
// Chat messages now live as their own rows on the server (see api-server
// /messages routes), not as one big array on the ChatSession record. These
// helpers back base44.messages and the ChatSession hydration/shim below so the
// ~50 places that read `session.messages` and the handful that write it keep
// working unchanged, while appends stay O(1) and reads can page.
async function throwErr(res) {
  if (res.status === 401) {
    throw storeError(
      res,
      'Session not recognized by the server — sign out, sign back in, and try again.',
    );
  }
  throw storeError(res, await parseStoreErrorResponse(res));
}

// Read a session's messages, ascending (chronological) seq. With no limit this
// is the whole history; limit/beforeSeq page it (see the server contract).
async function listMessages(sessionId, { limit, beforeSeq } = {}) {
  if (!sessionId) return [];
  const token = await getToken();
  if (!token) return [];
  const params = new URLSearchParams();
  params.set('session_id', sessionId);
  if (typeof limit === 'number' && limit >= 0) params.set('limit', String(limit));
  if (typeof beforeSeq === 'number') params.set('before_seq', String(beforeSeq));
  const res = await storeFetch(`/messages?${params.toString()}`);
  if (res.status === 401) return [];
  if (!res.ok) await throwErr(res);
  return res.json();
}

// Append ONE message; the server assigns its seq atomically so this never
// rewrites the existing history. Returns the stored message (with id + seq).
async function appendMessage(sessionId, message) {
  const res = await storeFetch('/messages', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, message: message || {} }),
  });
  if (!res.ok) await throwErr(res);
  bumpVersion('ChatMessage');
  bumpVersion('ChatSession');
  return res.json();
}

// Reconcile a full message array against the stored rows (diff by id). Backs the
// ChatSession.update({messages}) shim so edit/delete/rewind keep working.
async function replaceMessages(sessionId, messages) {
  const res = await storeFetch('/messages/replace', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      messages: Array.isArray(messages) ? messages : [],
    }),
  });
  if (!res.ok) await throwErr(res);
  bumpVersion('ChatMessage');
  bumpVersion('ChatSession');
  return res.json();
}

// Batch-fetch messages for many sessions in one request: { [id]: message[] }.
async function messagesBySessions(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (list.length === 0) return {};
  const token = await getToken();
  if (!token) return {};
  const res = await storeFetch('/messages/by-sessions', {
    method: 'POST',
    body: JSON.stringify({ ids: list }),
  });
  if (res.status === 401) return {};
  if (!res.ok) await throwErr(res);
  return res.json();
}

// Batch message COUNT per session: { [id]: number }. Backs metadata-only lists
// (e.g. the Stories Library cards and Lore Archives XP/rank totals) that show
// each session's message total without hydrating the full history.
async function messageCountsBySessions(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (list.length === 0) return {};
  const token = await getToken();
  if (!token) return {};
  const res = await storeFetch('/messages/counts', {
    method: 'POST',
    body: JSON.stringify({ ids: list }),
  });
  if (res.status === 401) return {};
  if (!res.ok) await throwErr(res);
  return res.json();
}

// Attach `.messages` (from rows) to a single session for backward compatibility.
async function hydrateOne(session) {
  if (!session || !session.id) return session;
  const messages = await listMessages(session.id);
  return { ...session, messages };
}

// Attach `.messages` to many sessions via one batch query.
async function hydrateMany(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return sessions;
  const map = await messagesBySessions(sessions.map((s) => s && s.id));
  return sessions.map((s) =>
    s && s.id ? { ...s, messages: map[s.id] || [] } : s,
  );
}

function entityStore(entityName) {
  const base = {
    // SDK-style signatures used across the app:
    //   list()                          → all items
    //   list("-updated_date", 50)       → sorted + limited
    //   list("-created_date", 50, {offset: 100}) → one page, fetched in SQL
    //   list({ key: value })            → filtered (back-compat)
    async list(sortOrFilters, limit, opts) {
      const offset = opts && typeof opts.offset === 'number' ? opts.offset : undefined;
      // Equality filters and substring search can ride alongside a sort string
      // via opts (the SDK's positional first arg can only carry one OR the
      // other), so the paginated story list can push mode + title across pages.
      const search = opts && opts.search ? opts.search : undefined;
      const optFilters = opts && opts.filters ? opts.filters : undefined;
      if (typeof sortOrFilters === 'string') {
        return queryEntity(entityName, {
          sort: sortOrFilters,
          limit,
          offset,
          filters: optFilters,
          search,
          _bootstrapInternal: opts?._bootstrapInternal,
        });
      }
      if (sortOrFilters && typeof sortOrFilters === 'object') {
        return queryEntity(entityName, {
          filters: sortOrFilters,
          limit,
          offset,
          search,
          _bootstrapInternal: opts?._bootstrapInternal,
        });
      }
      return queryEntity(entityName, {
        limit,
        offset,
        filters: optFilters,
        search,
        _bootstrapInternal: opts?._bootstrapInternal,
      });
    },

    // Grand total matching optional { filters, search } — same scoping as
    // list() but without sort/limit/offset. Lets a paged view show "Page X of Y"
    // and jump straight to any page without walking every preceding page.
    async count(opts) {
      const filters = opts && opts.filters ? opts.filters : undefined;
      const search = opts && opts.search ? opts.search : undefined;
      return countEntity(entityName, { filters, search });
    },

    async get(id, opts) {
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

    async create(data, opts = {}) {
      const res = await storeFetch(`/${encodeURIComponent(entityName)}`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
        timeoutMs: opts.timeoutMs,
        timeoutMessage: opts.timeoutMessage,
      });
      if (!res.ok) await throwErr(res);
      bumpVersion(entityName);
      return res.json();
    },

    async update(id, data) {
      const res = await storeFetch(
        `/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(data || {}) },
      );
      if (!res.ok) await throwErr(res);
      bumpVersion(entityName);
      return res.json();
    },

    // Upsert many records with client-provided ids (starter seed/repair).
    async bulkUpsert(dataArray, opts = {}) {
      const res = await storeFetch(
        `/${encodeURIComponent(entityName)}/bulk-upsert`,
        {
          method: 'POST',
          body: JSON.stringify({ items: dataArray || [] }),
          timeoutMs: opts.timeoutMs,
        },
      );
      if (!res.ok) await throwErr(res);
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

    // filter(filters?, sort?, limit?, opts?) — SDK-style equality filtering with
    // optional sort string, numeric limit and { offset } for SQL-side paging.
    async filter(filters = {}, sort, limit, opts) {
      const offset = opts && typeof opts.offset === 'number' ? opts.offset : undefined;
      return queryEntity(entityName, {
        filters,
        sort,
        limit,
        offset,
        _bootstrapInternal: opts?._bootstrapInternal,
      });
    },
  };

  // ChatSession messages live as their own rows now, but the rest of the app
  // still expects each session to carry a `.messages` array (reads) and to write
  // it back via update({messages}). Wrap the store so:
  //  - get()/list() transparently HYDRATE `.messages` from the message rows
  //    (list opts out with { withMessages: false } for metadata-only lists like
  //    the chat sidebar, avoiding fetching every session's full history);
  //  - update({messages}) reconciles the array into rows (an edit touches one
  //    row, a rewind trims the tail) instead of rewriting the whole history.
  // The high-frequency append path does NOT go through here — callers use
  // base44.messages.append for an O(1) single-row insert.
  if (entityName === 'ChatSession') {
    return {
      ...base,
      async create(data) {
        const hasMessages =
          data && Object.prototype.hasOwnProperty.call(data, 'messages');
        const messages = hasMessages ? data.messages : undefined;
        const rest = hasMessages
          ? (() => {
              const { messages: _omit, ...sessionFields } = data;
              return sessionFields;
            })()
          : data || {};
        // New sessions store chat rows separately. Never POST a nested
        // messages array, and skip /messages/replace when there is nothing
        // to persist — empty replace was a second 8s-budget write on Init.
        const session = await base.create(
          { ...rest, messages_migrated: rest.messages_migrated ?? true },
          { timeoutMs: STORE_SESSION_CREATE_TIMEOUT_MS },
        );
        if (Array.isArray(messages) && messages.length > 0) {
          const savedMessages = await replaceMessages(session.id, messages);
          return { ...session, messages: savedMessages };
        }
        return { ...session, messages: Array.isArray(messages) ? [] : session.messages };
      },
      async list(sortOrFilters, limit, opts) {
        const sessions = await base.list(sortOrFilters, limit, opts);
        if (opts && opts.withMessages === false) return sessions;
        return hydrateMany(sessions);
      },
      async filter(filters = {}, sort, limit, opts) {
        const offset = opts && typeof opts.offset === 'number' ? opts.offset : undefined;
        const sessions = await queryEntity(entityName, { filters, sort, limit, offset });
        if (opts && opts.withMessages === false) return sessions;
        return hydrateMany(sessions);
      },
      async get(id, opts) {
        const session = await base.get(id, opts);
        if (opts && opts.withMessages === false) return session;
        return hydrateOne(session);
      },
      async update(id, data) {
        if (data && Object.prototype.hasOwnProperty.call(data, 'messages')) {
          const { messages, ...rest } = data;
          const savedMessages = await replaceMessages(id, messages);
          const session =
            Object.keys(rest).length > 0
              ? await base.update(id, rest)
              : await base.get(id);
          return { ...(session || { id }), messages: savedMessages };
        }
        return base.update(id, data);
      },
    };
  }

  return base;
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

const ADMIN_EMAILS = new Set([
  'davins56@gmail.com',
  'davins56@hotmail.com',
  ...(import.meta.env.VITE_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
]);

let currentIdentity = null; // { id, email, full_name } from Clerk
let profileCache = null; // server profile data
let profileExpiry = 0;
const PROFILE_TTL = 2000;

// Best-effort parse of an LLM's structured-output reply into an object.
// Models are asked (via the system prompt) to return raw JSON, but often wrap
// it in a ```json fence anyway, or add stray leading/trailing prose — so try
// progressively looser extraction rather than let one deviation blow up every
// caller that expects a plain object back.
function parseLLMJsonResponse(text) {
  const trimmed = (text || '').trim();
  const attempts = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim(),
  ];
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) attempts.push(braceMatch[0]);

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next, looser candidate
    }
  }
  console.warn('[InvokeLLM] Could not parse structured response as JSON:', trimmed.slice(0, 200));
  return {};
}

function mergedUser(profileData) {
  const email = currentIdentity?.email?.toLowerCase?.() || '';
  const adminRole = ADMIN_EMAILS.has(email) ? { role: 'admin' } : {};
  return {
    ...PROFILE_DEFAULTS,
    created_date: new Date().toISOString(),
    ...(profileData || {}),
    ...adminRole,
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

  // Chat messages stored as individual rows (see the /messages routes). The
  // hot append path uses base44.messages.append for an O(1) single-row insert;
  // reads can page via list({ limit, beforeSeq }).
  messages: {
    list: (sessionId, opts) => listMessages(sessionId, opts),
    append: (sessionId, message) => appendMessage(sessionId, message),
    replace: (sessionId, messages) => replaceMessages(sessionId, messages),
    bySessions: (ids) => messagesBySessions(ids),
    counts: (ids) => messageCountsBySessions(ids),
  },

  // Mirror the SDK's service-role accessor. There is no privilege separation
  // here — server queries are always scoped to the authenticated user — so it
  // resolves the same server-backed entity store.
  asServiceRole: {
    entities: entitiesProxy,
  },

  integrations: {
    Core: {
      InvokeLLM: async ({
        prompt,
        systemPrompt,
        system_prompt,
        deepMode,
        response_json_schema,
        max_tokens,
      }) => {
        // Create/reuse a conversation for LLM calls — routes through the
        // api-server (api/index.mjs on Vercel) with auth + provider failover.
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
          systemPrompt || system_prompt || '',
          !!deepMode,
          response_json_schema,
          typeof max_tokens === 'number' ? max_tokens : undefined,
        )) {
          if (chunk.done) break;
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.content) result += chunk.content;
        }

        if (!response_json_schema) return result;
        return parseLLMJsonResponse(result);
      },

      // Generate (or re-style) an image. When existing_image_urls is provided,
      // prefers the image-edit path so the current portrait is transformed;
      // otherwise generates from the prompt alone. Returns { url } as a data URL.
      GenerateImage: async ({ prompt, existing_image_urls, signal } = {}) => {
        if (typeof prompt !== 'string' || !prompt.trim()) {
          throw new Error('A generation prompt is required.');
        }
        const existing = Array.isArray(existing_image_urls)
          ? existing_image_urls.find((u) => typeof u === 'string' && u.trim())
          : null;

        if (existing) {
          try {
            const dataUrl = await urlToDataUrl(existing);
            const result = await editImage({ image: dataUrl, prompt, signal });
            if (result?.image) return { url: result.image };
          } catch (err) {
            // Fall through to pure generation if the source can't be loaded
            // or edit fails for a non-policy reason — generation still gives
            // the user a portrait from their feature prompts.
            if (err?.code === 'content_policy') throw err;
            console.warn('GenerateImage edit path failed, falling back to generate:', err?.message);
          }
        }

        const result = await generateImage({ prompt, signal });
        if (!result?.image) throw new Error('No image was returned.');
        return { url: result.image };
      },

      UploadFile: async ({ file } = {}) => {
        if (!file) {
          throw new Error('No image selected.');
        }
        const type = String(file.type || '');
        if (type && !type.startsWith('image/') && type !== 'application/octet-stream') {
          throw new Error('That file is not an image. Choose a JPEG, PNG, or WebP photo.');
        }
        const dataUrl = await readFileAsDataUrl(file);
        const file_url = await uploadDataUrl(dataUrl);
        return { file_url, url: file_url };
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
              apiUrl(`/openai/invoke/${realName}`),
              {
                method: 'POST',
                headers: await authHeaders(),
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
