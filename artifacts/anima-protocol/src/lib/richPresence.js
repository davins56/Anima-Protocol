// Chat upgrade 6b: richer presence and a "home model offline" state.
//
// Behind VITE_ANIMA_RICH_PRESENCE=1 (off by default). With the flag off the
// header keeps its plain "Online" pill and nothing here probes anything.
//
// Everything is derived from data the chat already has: the transient
// thinking / typing / streaming rows, the server's `resting_notice` row (the
// home model or its tunnel was down and the message was queued), the browser's
// online flag, and the signed-in `GET /api/chat/mind-status` answer
// (chat-upgrade-server-contracts.md §2). Public `/api/healthz/llm` is config
// only and is no longer used for home-mind detection. Nothing here switches
// to another model or turns on a cloud provider; it only reports.
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiOrigin";
import { requireChatAuthHeaders } from "@/api/animaApi";

/** Build-time flag. "1", "true" or "on" turn it on; anything else is off. */
export function richPresenceEnabled(env = import.meta.env) {
  const raw = String(env?.VITE_ANIMA_RICH_PRESENCE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** @typedef {"online" | "offline" | "unreachable" | "unknown"} HomeModelState */
/**
 * @typedef {"device_offline" | "home_offline" | "resting" | "unreachable"
 *   | "thinking" | "waiting" | "typing" | "photo" | "here"} PresenceKind
 */

/** Poll window: clamp(retry_after_s, 15, 60) seconds (contract §2.4). */
export const HOME_MODEL_POLL_MIN_MS = 15_000;
export const HOME_MODEL_POLL_MAX_MS = 60_000;
/** Kept for callers; the longest poll interval. */
export const HOME_MODEL_POLL_MS = HOME_MODEL_POLL_MAX_MS;

export const PRESENCE_COPY = Object.freeze({
  homeOfflineTitle: "Home mind offline",
  homeOfflineBody: "Her home model isn't answering right now. Try again in a little while.",
  restingBody: "Her home model is offline. Your message is safe with her; she'll answer when it's back.",
  deviceOfflineBody: "You're offline. Check your connection.",
  unreachableBody: "Can't reach Anima right now.",
});

const TRANSIENT = new Set(["__typing__", "__thinking__"]);

/**
 * The newest row that tells us something about her state. Skips the user's
 * own lines' disclosures and scene rows.
 */
function latestSignal(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    if (m.type === "resting_notice") return m;
    if (m.role === "assistant") return m;
    if (m.role === "user") return m;
  }
  return null;
}

/**
 * Compose what the header says about her right now.
 *
 * @param {{
 *   messages?: unknown[],
 *   replying?: boolean,
 *   homeModel?: HomeModelState,
 *   deviceOnline?: boolean,
 *   name?: string,
 * }} input
 * @returns {{ kind: PresenceKind, label: string, detail: string | null, tone: "ok" | "busy" | "warn" | "off" }}
 */
export function describePresence({ messages = [], replying = false, homeModel = "unknown", deviceOnline = true, name = "" } = {}) {
  const who = String(name || "").trim() || "She";
  if (deviceOnline === false) {
    return { kind: "device_offline", label: "You're offline", detail: PRESENCE_COPY.deviceOfflineBody, tone: "off" };
  }
  const last = latestSignal(messages);
  if (last && TRANSIENT.has(last.character_name)) {
    if (last.photo_pending) return { kind: "photo", label: `${who} is taking a photo…`, detail: null, tone: "busy" };
    const copy = String(last.content || "").trim();
    if (last.character_name === "__thinking__" && copy && copy !== "...") {
      return { kind: "waiting", label: `${who} is getting ready…`, detail: copy, tone: "busy" };
    }
    if (last.character_name === "__thinking__") return { kind: "thinking", label: `${who} is thinking…`, detail: null, tone: "busy" };
    return { kind: "typing", label: `${who} is typing…`, detail: null, tone: "busy" };
  }
  if (last && last.role === "assistant" && last.is_streaming === true) {
    const speaker = String(last.character_name || "").trim() || who;
    if (last.photo_pending) return { kind: "photo", label: `${speaker} is taking a photo…`, detail: null, tone: "busy" };
    return { kind: "typing", label: `${speaker} is typing…`, detail: null, tone: "busy" };
  }
  if (replying) return { kind: "thinking", label: `${who} is thinking…`, detail: null, tone: "busy" };
  if (homeModel === "offline") {
    return { kind: "home_offline", label: PRESENCE_COPY.homeOfflineTitle, detail: PRESENCE_COPY.homeOfflineBody, tone: "warn" };
  }
  if (last && last.type === "resting_notice") {
    return { kind: "resting", label: `${who} is resting · home mind offline`, detail: PRESENCE_COPY.restingBody, tone: "warn" };
  }
  if (homeModel === "unreachable") {
    return { kind: "unreachable", label: "Can't reach Anima", detail: PRESENCE_COPY.unreachableBody, tone: "off" };
  }
  return { kind: "here", label: "Online", detail: null, tone: "ok" };
}

/** True for states that should show the offline strip above the composer. */
export function isHomeOfflineKind(kind) {
  return kind === "home_offline" || kind === "resting";
}

// --- Home model status (shared across components) --------------------------

/** @type {HomeModelState} */
let homeState = "unknown";
/** ms epoch before which a non-forced check returns the cached state. */
let nextCheckAt = 0;
/** @type {Promise<HomeModelState> | null} */
let inflight = null;
/** @type {Set<() => void>} */
const listeners = new Set();

function publish() {
  for (const l of listeners) l();
}

/** @returns {HomeModelState} */
export function homeModelState() {
  return homeState;
}

/** @param {unknown} seconds */
export function pollDelayMs(seconds) {
  const s = Number(seconds);
  const ms = Number.isFinite(s) ? s * 1000 : HOME_MODEL_POLL_MAX_MS;
  return Math.min(HOME_MODEL_POLL_MAX_MS, Math.max(HOME_MODEL_POLL_MIN_MS, ms));
}

/** ms until the next poll is due (for the hook's timer). */
export function homeModelNextCheckInMs(now = Date.now()) {
  return Math.max(0, nextCheckAt - now);
}

/**
 * Map a mind-status `home_mind` value (contract §2.2/§2.4).
 * `not_used` (cloud brain, no home box in use) reads as online: no strip.
 *
 * @param {unknown} homeMind
 * @returns {HomeModelState}
 */
export function homeStateFromMind(homeMind) {
  if (homeMind === "online" || homeMind === "not_used") return "online";
  if (homeMind === "offline") return "offline";
  return "unknown";
}

function settle(state, delayMs) {
  homeState = state;
  nextCheckAt = Date.now() + delayMs;
  publish();
  return state;
}

/**
 * The chat stream reported `resting: true` (the home model or its tunnel is
 * down). Go offline at once instead of waiting for the next poll. The server
 * records the same failure in its breaker, so the next poll agrees.
 */
export function markHomeModelOffline() {
  if (homeState === "offline") return;
  settle("offline", HOME_MODEL_POLL_MIN_MS);
}

/**
 * Ask `GET /api/chat/mind-status` (signed in). Responses:
 *  200 home_mind online|not_used → online, offline → offline, unknown → unknown;
 *  401 / 409 mind_status_disabled → unknown (today's behaviour);
 *  429 → keep the last state and wait `retry_after`;
 *  any other status → unknown; a network error → unreachable.
 * The next poll is due after clamp(retry_after_s, 15, 60) s. `force` skips
 * the wait and asks for `?fresh=1` (the "Check again" button).
 *
 * @param {{ force?: boolean, fetchImpl?: typeof fetch, authHeaders?: (extra?: Record<string, string>) => Promise<Record<string, string>>, now?: number }} [opts]
 * @returns {Promise<HomeModelState>}
 */
export function checkHomeModel({
  force = false,
  fetchImpl = globalThis.fetch,
  authHeaders = requireChatAuthHeaders,
  now = Date.now(),
} = {}) {
  if (inflight) return inflight;
  if (!force && nextCheckAt > 0 && now < nextCheckAt) return Promise.resolve(homeState);
  inflight = (async () => {
    let headers;
    try {
      headers = await authHeaders({ Accept: "application/json" });
    } catch {
      // Not signed in: nothing to ask. Same as a 401.
      return settle("unknown", HOME_MODEL_POLL_MAX_MS);
    }
    let res;
    try {
      res = await fetchImpl(apiUrl(force ? "/chat/mind-status?fresh=1" : "/chat/mind-status"), {
        method: "GET",
        headers,
        cache: "no-store",
      });
    } catch {
      return settle("unreachable", HOME_MODEL_POLL_MIN_MS);
    }
    /** @type {Record<string, unknown> | null} */
    const body = await res.json().catch(() => null);
    if (res.ok) {
      return settle(homeStateFromMind(body?.home_mind), pollDelayMs(body?.retry_after_s));
    }
    if (res.status === 429) {
      const wait = Number(body?.retry_after);
      const ms = Number.isFinite(wait) && wait > 0 ? Math.max(HOME_MODEL_POLL_MIN_MS, wait * 1000) : HOME_MODEL_POLL_MAX_MS;
      return settle(homeState, ms);
    }
    // 401, 409 mind_status_disabled, and anything else: unknown.
    return settle("unknown", HOME_MODEL_POLL_MAX_MS);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function resetHomeModelForTests() {
  homeState = "unknown";
  nextCheckAt = 0;
  inflight = null;
  listeners.clear();
}

/**
 * Re-renders on home-model changes. Polls on the server's schedule while the
 * tab is visible; does nothing when `enabled` is false.
 */
export function useHomeModelState(enabled = true) {
  const [state, setState] = useState(homeState);
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    let alive = true;
    const onChange = () => setState(homeState);
    listeners.add(onChange);
    const schedule = () => {
      if (!alive) return;
      clearTimeout(timer);
      timer = setTimeout(tick, Math.max(1_000, homeModelNextCheckInMs()));
    };
    const tick = () => {
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (hidden) return schedule();
      void checkHomeModel().finally(schedule);
    };
    void checkHomeModel().finally(schedule);
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") void checkHomeModel();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      listeners.delete(onChange);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  return enabled ? state : "unknown";
}

/** navigator.onLine, kept live with the online/offline events. */
export function useDeviceOnline(enabled = true) {
  const read = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);
  const [online, setOnline] = useState(read);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const update = () => setOnline(read());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [enabled]);
  return enabled ? online : true;
}
