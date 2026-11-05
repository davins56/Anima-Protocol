/**
 * Sensory layer, pure half (switch `senses`, ANIMA_KERNEL_SENSES).
 *
 * The steward's own device reports what it is willing to share: upcoming
 * calendar blocks, a few device signals, the local clock. The server keeps
 * only the latest snapshot on `user_profiles.data.senses` (no history), drops
 * it after `SENSES_MAX_AGE_MS`, and never puts raw calendar titles in a
 * prompt. The agency tick reads it to choose *when* to speak, not *what*.
 *
 * Weather is not reported here: the server already fetches it for the
 * steward's region (regionalWorldKnowledge, Open-Meteo).
 */

export const SENSES_PROFILE_KEY = "senses";
export const SENSES_SCHEMA_VERSION = 1;
/** A snapshot older than this is treated as absent. */
export const SENSES_MAX_AGE_MS = 6 * 3_600_000;

const MAX_EVENTS = 8;
const MAX_TITLE = 80;
/** Calendar blocks further out than this are not kept. */
const MAX_LOOKAHEAD_MS = 48 * 3_600_000;
/** A single block longer than this is ignored (all-day / multi-day noise). */
const MAX_BLOCK_MS = 12 * 3_600_000;

export type SensesCalendarBlock = {
  title: string;
  startsAt: string;
  endsAt: string;
};

export type SensesDevice = {
  platform: string | null;
  battery: number | null;
  charging: boolean | null;
  online: boolean | null;
  /** Steward-reported focus / do-not-disturb, when the OS exposes it. */
  focusMode: boolean | null;
};

export type SensesSnapshot = {
  schema: typeof SENSES_SCHEMA_VERSION;
  receivedAt: string;
  timezone: string | null;
  calendar: SensesCalendarBlock[];
  device: SensesDevice;
};

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function cleanTitle(v: unknown): string {
  if (typeof v !== "string") return "Busy";
  // Strip control characters and collapse whitespace; titles never reach a prompt.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, MAX_TITLE) || "Busy";
}

function validTimezone(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

/** Whitelist-only sanitizer for a client-reported snapshot. */
export function normalizeSensesSnapshot(raw: unknown, now = Date.now()): SensesSnapshot {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dev = src.device && typeof src.device === "object" ? (src.device as Record<string, unknown>) : {};
  const rawCalendar = Array.isArray(src.calendar) ? src.calendar : [];

  const calendar: SensesCalendarBlock[] = [];
  for (const item of rawCalendar.slice(0, 64)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const startsAt = isoOrNull(e.startsAt ?? e.start);
    const endsAt = isoOrNull(e.endsAt ?? e.end);
    if (!startsAt || !endsAt) continue;
    const s = Date.parse(startsAt);
    const en = Date.parse(endsAt);
    if (en <= s || en - s > MAX_BLOCK_MS) continue;
    if (en < now || s > now + MAX_LOOKAHEAD_MS) continue;
    calendar.push({ title: cleanTitle(e.title), startsAt, endsAt });
  }
  calendar.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const battery = typeof dev.battery === "number" && Number.isFinite(dev.battery)
    ? Math.round(Math.min(1, Math.max(0, dev.battery)) * 100) / 100
    : null;
  const platform = typeof dev.platform === "string"
    ? dev.platform.replace(/[^\w .\-/]/g, "").slice(0, 24) || null
    : null;

  return {
    schema: SENSES_SCHEMA_VERSION,
    receivedAt: new Date(now).toISOString(),
    timezone: validTimezone(src.timezone),
    calendar: calendar.slice(0, MAX_EVENTS),
    device: {
      platform,
      battery,
      charging: boolOrNull(dev.charging),
      online: boolOrNull(dev.online),
      focusMode: boolOrNull(dev.focusMode),
    },
  };
}

/** Read a stored snapshot back; null when missing, malformed, or stale. */
export function readStoredSenses(raw: unknown, now = Date.now()): SensesSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const received = typeof src.receivedAt === "string" ? Date.parse(src.receivedAt) : NaN;
  if (!Number.isFinite(received) || now - received > SENSES_MAX_AGE_MS || received > now + 60_000) return null;
  const snap = normalizeSensesSnapshot(raw, now);
  return { ...snap, receivedAt: new Date(received).toISOString() };
}

/** What the agency tick needs from the senses: is the steward busy now? */
export function sensesPercept(
  snap: SensesSnapshot | null,
  now = Date.now(),
): { busyNow: boolean; busyForMinutes: number | null } | null {
  if (!snap) return null;
  if (snap.device.focusMode === true) return { busyNow: true, busyForMinutes: 60 };
  const current = snap.calendar.find((b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now);
  if (!current) return { busyNow: false, busyForMinutes: null };
  return { busyNow: true, busyForMinutes: Math.ceil((Date.parse(current.endsAt) - now) / 60_000) };
}

/**
 * Non-identifying summary safe to show back to the steward (Settings) or log.
 * Never includes calendar titles.
 */
export function summarizeSenses(snap: SensesSnapshot | null, now = Date.now()) {
  if (!snap) return { present: false as const };
  const next = snap.calendar.find((b) => Date.parse(b.startsAt) > now) ?? null;
  const percept = sensesPercept(snap, now);
  return {
    present: true as const,
    receivedAt: snap.receivedAt,
    timezone: snap.timezone,
    calendarBlocks: snap.calendar.length,
    busyNow: percept?.busyNow ?? false,
    nextBlockInMinutes: next ? Math.round((Date.parse(next.startsAt) - now) / 60_000) : null,
    device: snap.device,
  };
}
