/**
 * Client reporter for the sensory layer (server: /api/senses, switch
 * ANIMA_KERNEL_SENSES). Opt-in per device: nothing is sent until the steward
 * turns it on with `setSensesOptIn(true)`.
 *
 * A browser can only share a few signals (timezone, online, battery). Calendar
 * blocks come from a native shell (the iOS wrapper via EventKit) posting the
 * same JSON shape to PUT /api/senses:
 *
 *   { timezone, calendar: [{ title, startsAt, endsAt }], device: { platform,
 *     battery (0–1), charging, online, focusMode } }
 *
 * The server keeps only the latest snapshot for 6 hours and never puts
 * calendar titles in a prompt; the agency tick only uses it to wait while the
 * steward is busy.
 */
import { requireChatAuthHeaders } from "@/api/animaApi";
import { apiUrl } from "./apiOrigin";

const OPT_IN_KEY = "anima_senses_opt_in";
/** Do not report more often than this from one tab. */
export const SENSES_REPORT_INTERVAL_MS = 30 * 60_000;

export function sensesOptedIn(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSensesOptIn(on, storage = globalThis.localStorage) {
  try {
    if (on) storage?.setItem(OPT_IN_KEY, "1");
    else storage?.removeItem(OPT_IN_KEY);
  } catch {
    /* private mode */
  }
}

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The browser half of a snapshot. Never throws; unknown signals are null. */
export async function buildBrowserSensesSnapshot(nav = globalThis.navigator) {
  let battery = null;
  let charging = null;
  try {
    if (typeof nav?.getBattery === "function") {
      const b = await nav.getBattery();
      if (typeof b?.level === "number") battery = b.level;
      if (typeof b?.charging === "boolean") charging = b.charging;
    }
  } catch {
    /* not exposed */
  }
  const platform = nav?.userAgentData?.platform || null;
  return {
    timezone: browserTimezone(),
    calendar: [],
    device: {
      platform: typeof platform === "string" ? platform : null,
      battery,
      charging,
      online: typeof nav?.onLine === "boolean" ? nav.onLine : null,
      focusMode: null,
    },
  };
}

let lastReportAt = 0;

/**
 * Report once per interval when opted in. Returns the server summary, or null
 * when skipped. A 409 means the server switch is off; that is not an error.
 */
export async function reportSenses({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  nav = globalThis.navigator,
  now = Date.now(),
  force = false,
} = {}) {
  if (!sensesOptedIn(storage)) return null;
  if (!force && now - lastReportAt < SENSES_REPORT_INTERVAL_MS) return null;
  lastReportAt = now;
  try {
    const headers = await requireChatAuthHeaders({ "Content-Type": "application/json" });
    const body = JSON.stringify(await buildBrowserSensesSnapshot(nav));
    const res = await fetchImpl(apiUrl("/api/senses"), { method: "PUT", headers, body });
    if (res.status === 409 || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Forget the stored snapshot and stop reporting from this device. */
export async function forgetSenses({ fetchImpl = globalThis.fetch, storage = globalThis.localStorage } = {}) {
  setSensesOptIn(false, storage);
  lastReportAt = 0;
  try {
    const headers = await requireChatAuthHeaders();
    await fetchImpl(apiUrl("/api/senses"), { method: "DELETE", headers });
  } catch {
    /* best effort */
  }
}
