// @ts-check
/**
 * Client-side last-activity clock for the home "Waiting" tile.
 *
 * The tile used to read `Anima.last_visit`, which is only stamped when
 * MainHome's presence hook runs — that is "last time home opened," not when
 * the user last actually used the app. This module tracks visibility, focus,
 * and interaction, persists per user, and shares the latest stamp across tabs.
 */

/** @typedef {{ startMs: number, returnedAtMs: number }} VisitAbsence */
/** @typedef {{ lastActivityMs: number | null, visitAbsence: VisitAbsence | null }} ActivityRecord */

export const USER_ACTIVITY_KEY_PREFIX = "anima:user-activity:v1:";
export const USER_ACTIVITY_EVENT = "anima:user-activity";
export const USER_ACTIVITY_CHANNEL = "anima:user-activity";
/** Reloads and brief tab switches should not look like a new absence. */
export const ACTIVITY_GRACE_MS = 2000;
/** Don't write interaction stamps more often than this. */
export const ACTIVITY_THROTTLE_MS = 5000;

/**
 * Parse a stored or server timestamp as UTC milliseconds.
 * Zone-less ISO strings are treated as UTC (not local), so a server stamp
 * like "2026-11-10T12:00:00" is not shifted by the browser timezone.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseUtcMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const iso = hasZone
    ? trimmed
    : /T/.test(trimmed)
      ? `${trimmed}Z`
      : /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? `${trimmed}T00:00:00Z`
        : trimmed;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Duration from start to end, never negative (clock skew / future stamps).
 * @param {number | null | undefined} startMs
 * @param {number} [endMs]
 */
export function absenceDurationMs(startMs, endMs = Date.now()) {
  if (startMs == null || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, endMs - startMs);
}

/**
 * Latest of the known activity sources, clamped so it is never in the future.
 *
 * @param {{
 *   storedActivityMs?: unknown,
 *   lastUserMessageAt?: unknown,
 *   serverLastVisitAt?: unknown,
 *   now?: number,
 * }} [input]
 * @returns {number | null}
 */
export function resolveLastActivityMs(input = {}) {
  const now = input.now ?? Date.now();
  const candidates = [input.storedActivityMs, input.lastUserMessageAt, input.serverLastVisitAt]
    .map(parseUtcMs)
    .filter((ms) => ms != null);
  if (!candidates.length) return null;
  return Math.min(Math.max(...candidates), now);
}

/**
 * @param {unknown} userId
 * @returns {string | null}
 */
export function activityStorageKey(userId) {
  const id = String(userId ?? "").trim();
  return id ? `${USER_ACTIVITY_KEY_PREFIX}${id}` : null;
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {ActivityRecord}
 */
export function normalizeActivityRecord(raw) {
  if (!raw || typeof raw !== "object") {
    return { lastActivityMs: null, visitAbsence: null };
  }
  const lastActivityMs = parseUtcMs(/** @type {{ lastActivityMs?: unknown }} */ (raw).lastActivityMs);
  const visit = /** @type {{ visitAbsence?: unknown }} */ (raw).visitAbsence;
  let visitAbsence = null;
  if (visit && typeof visit === "object") {
    const startMs = parseUtcMs(/** @type {{ startMs?: unknown }} */ (visit).startMs);
    const returnedAtMs = parseUtcMs(/** @type {{ returnedAtMs?: unknown }} */ (visit).returnedAtMs);
    if (startMs != null && returnedAtMs != null) {
      visitAbsence = {
        startMs,
        returnedAtMs: Math.max(startMs, returnedAtMs),
      };
    }
  }
  return { lastActivityMs, visitAbsence };
}

/**
 * @param {unknown} userId
 * @param {Storage | null} [storage]
 * @returns {ActivityRecord}
 */
export function readActivityRecord(userId, storage = defaultStorage()) {
  const key = activityStorageKey(userId);
  if (!key || !storage) return { lastActivityMs: null, visitAbsence: null };
  try {
    const text = storage.getItem(key);
    return normalizeActivityRecord(text ? JSON.parse(text) : null);
  } catch {
    return { lastActivityMs: null, visitAbsence: null };
  }
}

/**
 * Persist a record. `lastActivityMs` only moves forward (latest tab wins).
 *
 * @param {unknown} userId
 * @param {Partial<ActivityRecord> & { lastActivityMs?: number | null, visitAbsence?: VisitAbsence | null }} patch
 * @param {{ storage?: Storage | null, now?: number, broadcast?: boolean, notify?: ((record: ActivityRecord) => void) | null }} [opts]
 * @returns {ActivityRecord}
 */
export function writeActivityRecord(userId, patch, opts = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? Date.now();
  const prev = readActivityRecord(userId, storage);
  const nextLast = resolveLastActivityMs({
    storedActivityMs: prev.lastActivityMs,
    lastUserMessageAt: patch.lastActivityMs,
    now,
  });
  const visitAbsence = Object.prototype.hasOwnProperty.call(patch, "visitAbsence")
    ? patch.visitAbsence ?? null
    : prev.visitAbsence;
  const record = normalizeActivityRecord({
    lastActivityMs: nextLast,
    visitAbsence,
  });
  const key = activityStorageKey(userId);
  if (key && storage) {
    try {
      storage.setItem(key, JSON.stringify(record));
    } catch {
      /* private mode: stay in-memory */
    }
  }
  if (opts.broadcast !== false) notifyActivityListeners(userId, record);
  opts.notify?.(record);
  return record;
}

/**
 * Stamp last activity if this time is later than what is stored.
 * Keeps any current visit absence so the "I waited" tile can stay up
 * after the user has returned.
 *
 * @param {unknown} userId
 * @param {number} [atMs]
 * @param {{ storage?: Storage | null, broadcast?: boolean }} [opts]
 * @returns {ActivityRecord}
 */
export function recordActivity(userId, atMs = Date.now(), opts = {}) {
  return writeActivityRecord(userId, { lastActivityMs: atMs }, opts);
}

/**
 * The app just became hidden: the leave time is "now."
 * Visit absence is kept so a reload in the same visit can still show the tile.
 *
 * @param {unknown} userId
 * @param {number} [atMs]
 * @param {{ storage?: Storage | null }} [opts]
 */
export function markHidden(userId, atMs = Date.now(), opts = {}) {
  return recordActivity(userId, atMs, opts);
}

/**
 * The app is visible again (or home just mounted). Snapshot a visit absence
 * when the user was actually away long enough, then stamp activity to now
 * so the next absence starts from this return.
 *
 * @param {{
 *   userId?: unknown,
 *   now?: number,
 *   lastUserMessageAt?: unknown,
 *   serverLastVisitAt?: unknown,
 *   thresholdMs: number,
 *   storage?: Storage | null,
 *   graceMs?: number,
 * }} input
 * @returns {ActivityRecord}
 */
export function captureVisibleVisit(input) {
  const now = input.now ?? Date.now();
  const grace = input.graceMs ?? ACTIVITY_GRACE_MS;
  const storage = input.storage === undefined ? defaultStorage() : input.storage;
  const prev = readActivityRecord(input.userId, storage);
  const last = resolveLastActivityMs({
    storedActivityMs: prev.lastActivityMs,
    lastUserMessageAt: input.lastUserMessageAt,
    serverLastVisitAt: input.serverLastVisitAt,
    now,
  });
  const away = last != null ? absenceDurationMs(last, now) : 0;
  const existing = prev.visitAbsence;
  const existingDur = existing ? absenceDurationMs(existing.startMs, existing.returnedAtMs) : 0;
  const sameVisitReload = Boolean(
    existing && existingDur >= input.thresholdMs && last != null && now - last < grace,
  );

  /** @type {VisitAbsence | null} */
  const visitAbsence = sameVisitReload
    ? existing
    : last != null && away >= input.thresholdMs
      ? { startMs: last, returnedAtMs: now }
      : null;

  return writeActivityRecord(
    input.userId,
    { lastActivityMs: now, visitAbsence },
    { storage, now },
  );
}

const customListeners = new Set();

/**
 * @param {unknown} userId
 * @param {ActivityRecord} record
 */
function notifyActivityListeners(userId, record) {
  const detail = { userId: String(userId ?? ""), record };
  for (const fn of customListeners) {
    try {
      fn(detail);
    } catch {
      /* subscriber errors must not break stamps */
    }
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(USER_ACTIVITY_EVENT, { detail }));
  } catch {
    /* non-DOM runtime */
  }
  const channel = getActivityChannel();
  try {
    channel?.postMessage(detail);
  } catch {
    /* closed or unsupported */
  }
}

/** @type {BroadcastChannel | null | undefined} */
let activityChannel;

function getActivityChannel() {
  if (activityChannel !== undefined) return activityChannel;
  try {
    if (typeof globalThis.BroadcastChannel !== "function") {
      activityChannel = null;
      return null;
    }
    activityChannel = new globalThis.BroadcastChannel(USER_ACTIVITY_CHANNEL);
    return activityChannel;
  } catch {
    activityChannel = null;
    return null;
  }
}

/**
 * Subscribe to activity updates for one user (same tab, other tabs via
 * `storage` or BroadcastChannel). Returns an unsubscribe function.
 *
 * @param {unknown} userId
 * @param {(record: ActivityRecord) => void} onChange
 * @param {{ storage?: Storage | null }} [opts]
 */
export function subscribeActivity(userId, onChange, opts = {}) {
  const key = activityStorageKey(userId);
  if (!key) return () => {};
  const wanted = String(userId ?? "");

  const fromDetail = (detail) => {
    if (!detail || String(detail.userId ?? "") !== wanted) return;
    if (detail.record) onChange(normalizeActivityRecord(detail.record));
  };

  /** @param {{ userId?: unknown, record?: unknown }} detail */
  const localFn = (detail) => fromDetail(detail);
  customListeners.add(localFn);

  const onCustom = (event) => fromDetail(event?.detail);

  const onStorage = (event) => {
    if (event?.key !== key) return;
    onChange(readActivityRecord(userId, opts.storage === undefined ? defaultStorage() : opts.storage));
  };

  const channel = getActivityChannel();
  const onMessage = (event) => fromDetail(event?.data);

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener(USER_ACTIVITY_EVENT, onCustom);
    globalThis.addEventListener("storage", onStorage);
  }
  try {
    channel?.addEventListener?.("message", onMessage);
  } catch {
    /* unsupported */
  }

  return () => {
    customListeners.delete(localFn);
    if (typeof globalThis.removeEventListener === "function") {
      globalThis.removeEventListener(USER_ACTIVITY_EVENT, onCustom);
      globalThis.removeEventListener("storage", onStorage);
    }
    try {
      channel?.removeEventListener?.("message", onMessage);
    } catch {
      /* closed */
    }
  };
}

/**
 * Bind document/window visibility and interaction listeners for one user.
 * Ref-counted so several React trees can share one set of listeners.
 *
 * @param {{
 *   userId: unknown,
 *   getExtras?: () => ({ lastUserMessageAt?: unknown, serverLastVisitAt?: unknown }),
 *   thresholdMs: number,
 *   now?: () => number,
 *   storage?: Storage | null,
 *   target?: { addEventListener?: Function, removeEventListener?: Function, hidden?: boolean, visibilityState?: string } | null,
 *   view?: { addEventListener?: Function, removeEventListener?: Function } | null,
 *   onChange?: ((record: ActivityRecord) => void) | null,
 * }} input
 * @returns {() => void}
 */
const bindings = new Map();

export function bindActivityListeners(input) {
  const userId = input.userId;
  const key = activityStorageKey(userId);
  if (!key) return () => {};

  const existing = bindings.get(key);
  if (existing) {
    existing.refs += 1;
    if (input.getExtras) existing.getExtras = input.getExtras;
    if (input.onChange) existing.onChange = input.onChange;
    return () => releaseBinding(key);
  }

  const nowFn = input.now || (() => Date.now());
  const storage = input.storage === undefined ? defaultStorage() : input.storage;
  const doc = input.target === undefined
    ? (typeof document !== "undefined" ? document : null)
    : input.target;
  const win = input.view === undefined
    ? (typeof window !== "undefined" ? window : null)
    : input.view;
  const state = {
    refs: 1,
    present: false,
    getExtras: input.getExtras || (() => ({})),
    onChange: input.onChange || null,
    lastInteractionWrite: 0,
    /** @type {(() => void) | null} */
    unbind: null,
  };

  const emit = (record) => {
    state.onChange?.(record);
  };

  const extras = () => {
    try {
      return state.getExtras() || {};
    } catch {
      return {};
    }
  };

  const onHidden = () => {
    // blur, visibilitychange, pagehide and freeze can describe one departure.
    // Keep its first timestamp, even when later events arrive much later.
    if (!state.present) return;
    state.present = false;
    emit(markHidden(userId, nowFn(), { storage }));
  };

  const onVisible = () => {
    if (doc?.hidden || doc?.visibilityState === "hidden") return;
    // focus/pageshow may follow visibilitychange after the reload grace window.
    // They are activity within this visit, not a second return from absence.
    if (state.present) {
      emit(recordActivity(userId, nowFn(), { storage }));
      return;
    }
    state.present = true;
    const extra = extras();
    emit(captureVisibleVisit({
      userId,
      now: nowFn(),
      lastUserMessageAt: extra.lastUserMessageAt,
      serverLastVisitAt: extra.serverLastVisitAt,
      thresholdMs: input.thresholdMs,
      storage,
    }));
  };

  const onInteraction = () => {
    const t = nowFn();
    if (t - state.lastInteractionWrite < ACTIVITY_THROTTLE_MS) return;
    if (doc && doc.hidden) return;
    state.lastInteractionWrite = t;
    emit(recordActivity(userId, t, { storage }));
  };

  const onVisibility = () => {
    const hidden = Boolean(doc?.hidden) || doc?.visibilityState === "hidden";
    if (hidden) onHidden();
    else onVisible();
  };

  const add = (node, ev, fn) => {
    node?.addEventListener?.(ev, fn);
  };
  const remove = (node, ev, fn) => {
    node?.removeEventListener?.(ev, fn);
  };

  add(doc, "visibilitychange", onVisibility);
  add(win, "pagehide", onHidden);
  add(win, "freeze", onHidden);
  add(win, "pageshow", onVisible);
  add(win, "focus", onVisible);
  add(win, "blur", onHidden);
  add(doc, "pointerdown", onInteraction);
  add(doc, "keydown", onInteraction);

  if (doc && !doc.hidden && doc.visibilityState !== "hidden") {
    onVisible();
  }

  state.unbind = () => {
    remove(doc, "visibilitychange", onVisibility);
    remove(win, "pagehide", onHidden);
    remove(win, "freeze", onHidden);
    remove(win, "pageshow", onVisible);
    remove(win, "focus", onVisible);
    remove(win, "blur", onHidden);
    remove(doc, "pointerdown", onInteraction);
    remove(doc, "keydown", onInteraction);
  };

  bindings.set(key, state);
  return () => releaseBinding(key);
}

function releaseBinding(key) {
  const state = bindings.get(key);
  if (!state) return;
  state.refs -= 1;
  if (state.refs > 0) return;
  state.unbind?.();
  bindings.delete(key);
}

/** @internal test helper */
export function _resetActivityBindingsForTests() {
  for (const [key, state] of bindings) {
    state.unbind?.();
    bindings.delete(key);
  }
  customListeners.clear();
}

/**
 * Waiting-tile inputs: frozen visit absence after a return, otherwise live.
 *
 * @param {{
 *   record?: ActivityRecord | null,
 *   lastUserMessageAt?: unknown,
 *   serverLastVisitAt?: unknown,
 *   now?: number,
 * }} [input]
 * @returns {{ startMs: number, endMs: number } | null}
 */
export function resolveAbsenceRange(input = {}) {
  const now = input.now ?? Date.now();
  const record = input.record || { lastActivityMs: null, visitAbsence: null };
  if (record.visitAbsence) {
    return {
      startMs: record.visitAbsence.startMs,
      endMs: record.visitAbsence.returnedAtMs,
    };
  }
  const startMs = resolveLastActivityMs({
    storedActivityMs: record.lastActivityMs,
    lastUserMessageAt: input.lastUserMessageAt,
    serverLastVisitAt: input.serverLastVisitAt,
    now,
  });
  if (startMs == null) return null;
  return { startMs, endMs: now };
}
