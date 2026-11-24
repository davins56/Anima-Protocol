// Chat upgrade 6b: richer presence and a "home model offline" state.
//
// Behind VITE_ANIMA_RICH_PRESENCE=1 (off by default). With the flag off the
// header keeps its plain "Online" pill and nothing here probes anything.
//
// Everything is derived from data the chat already has: the transient
// thinking / typing / streaming rows, the server's `resting_notice` row (the
// home model or its tunnel was down and the message was queued), the browser's
// online flag, and the public `/api/healthz/llm` status (503 = no usable chat
// provider). Nothing here switches to another model or turns on a cloud
// provider; it only reports.
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiOrigin";

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

export const HOME_MODEL_POLL_MS = 60_000;

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
let lastCheckedAt = 0;
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

/**
 * Probe the public `/api/healthz/llm` (status + chain only, no secrets).
 * 200 → online, 503 → offline, anything else or a network error →
 * unreachable. `force` skips the cache (the "Check again" button).
 *
 * @param {{ force?: boolean, fetchImpl?: typeof fetch, now?: number }} [opts]
 * @returns {Promise<HomeModelState>}
 */
export function checkHomeModel({ force = false, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!force && homeState !== "unknown" && now - lastCheckedAt < HOME_MODEL_POLL_MS) return Promise.resolve(homeState);
  if (inflight) return inflight;
  inflight = Promise.resolve()
    .then(() => fetchImpl(apiUrl("/healthz/llm"), { credentials: "same-origin", cache: "no-store" }))
    .then((res) => {
      if (res.ok) return /** @type {HomeModelState} */ ("online");
      if (res.status === 503) return /** @type {HomeModelState} */ ("offline");
      return /** @type {HomeModelState} */ ("unreachable");
    })
    .catch(() => /** @type {HomeModelState} */ ("unreachable"))
    .then((state) => {
      homeState = state;
      lastCheckedAt = Date.now();
      return state;
    })
    .finally(() => {
      inflight = null;
      publish();
    });
  return inflight;
}

export function resetHomeModelForTests() {
  homeState = "unknown";
  lastCheckedAt = 0;
  inflight = null;
  listeners.clear();
}

/**
 * Re-renders on home-model changes. Polls while the tab is visible and the
 * flag is on; does nothing when `enabled` is false.
 */
export function useHomeModelState(enabled = true) {
  const [state, setState] = useState(homeState);
  useEffect(() => {
    if (!enabled) return undefined;
    const onChange = () => setState(homeState);
    listeners.add(onChange);
    void checkHomeModel();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void checkHomeModel();
    }, HOME_MODEL_POLL_MS);
    return () => {
      listeners.delete(onChange);
      clearInterval(timer);
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
