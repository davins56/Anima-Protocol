/**
 * Day rhythm client.
 *
 * Wired today: GET /api/senses (status), PUT /api/senses (opt-in snapshot,
 * including a timezone override), DELETE /api/senses (forget the snapshot).
 * Those routes live behind ANIMA_KERNEL_SENSES and are off unless set.
 *
 * Not connected: per-user or per-companion quiet hours. Those exist only as a
 * global Worker env default (ANIMA_AGENCY_QUIET_START_HOUR / _END_HOUR,
 * 22 to 8). The backend team's GET/PUT /api/rhythm/settings proposal is
 * unapproved, so this client does not call that path or invent a contract.
 * getRhythmSettings() returns a typed "not connected yet" state. UI drafts
 * stay in memory and are not written to localStorage.
 */
import { z } from "zod";
import { requireChatAuthHeaders } from "@/api/animaApi";
import { apiUrl } from "@/lib/apiOrigin";
import {
  forgetSenses,
  pushSensesSnapshot,
  sensesOptedIn,
  setSensesOptIn,
  setSensesTimezoneOverride,
  validTimezone,
} from "@/lib/animaSenses";

/** Server default from agencyTick.ts agencyConfig (22, 8). */
export const SERVER_QUIET_START_HOUR = 22;
export const SERVER_QUIET_END_HOUR = 8;
export const SERVER_QUIET_HOURS_LABEL = "Server default: 10 PM to 8 AM";

export const SensesDeviceSchema = z.object({
  platform: z.string().nullable().optional(),
  battery: z.number().nullable().optional(),
  charging: z.boolean().nullable().optional(),
  online: z.boolean().nullable().optional(),
  focusMode: z.boolean().nullable().optional(),
});

export const SensesStatusSchema = z.object({
  enabled: z.boolean(),
  present: z.boolean(),
  receivedAt: z.string().optional(),
  timezone: z.string().nullable().optional(),
  calendarBlocks: z.number().optional(),
  busyNow: z.boolean().optional(),
  nextBlockInMinutes: z.number().nullable().optional(),
  device: SensesDeviceSchema.optional(),
});

export type SensesStatus = z.infer<typeof SensesStatusSchema>;

export type DayRhythmLoadErrorKind =
  | "unauthorized"
  | "server_error"
  | "invalid_response"
  | "network_error";

export type DayRhythmLoad =
  | { ok: true; status: SensesStatus }
  | { ok: false; kind: DayRhythmLoadErrorKind; message: string };

/**
 * Documented shape for a future per-user quiet-hours route. Not a contract —
 * the GET/PUT /api/rhythm/settings proposal is unapproved. Exported so the
 * settings draft and tests share one typed preview object.
 */
export const RhythmSettingsDraftSchema = z.object({
  quietStartHour: z.number().int().min(0).max(23),
  quietEndHour: z.number().int().min(0).max(23),
  quietDays: z.array(z.number().int().min(0).max(6)),
  companionId: z.string().nullable(),
});

export type RhythmSettingsDraft = z.infer<typeof RhythmSettingsDraftSchema>;

export const DEFAULT_RHYTHM_DRAFT: RhythmSettingsDraft = {
  quietStartHour: SERVER_QUIET_START_HOUR,
  quietEndHour: SERVER_QUIET_END_HOUR,
  quietDays: [0, 1, 2, 3, 4, 5, 6],
  companionId: null,
};

export type RhythmSettingsConnection =
  | { connected: false; reason: "not_connected_yet" };

export async function getRhythmSettings(): Promise<RhythmSettingsConnection> {
  return { connected: false, reason: "not_connected_yet" };
}

export function deviceTimezone(): string | null {
  try {
    return validTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

export function listTimezones(extra?: string | null): string[] {
  const set = new Set<string>();
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      for (const tz of Intl.supportedValuesOf("timeZone")) set.add(tz);
    }
  } catch {
    /* ignore */
  }
  if (set.size === 0) set.add("UTC");
  const device = deviceTimezone();
  if (device) set.add(device);
  const validExtra = validTimezone(extra);
  if (validExtra) set.add(validExtra);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function formatHourLabel(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadSensesStatus({
  fetchImpl = globalThis.fetch,
}: {
  fetchImpl?: typeof fetch;
} = {}): Promise<DayRhythmLoad> {
  try {
    const headers = await requireChatAuthHeaders();
    const res = await fetchImpl(apiUrl("/api/senses"), { method: "GET", headers });
    if (res.status === 401) {
      return { ok: false, kind: "unauthorized", message: "Sign in to manage day rhythm." };
    }
    if (!res.ok) {
      return { ok: false, kind: "server_error", message: "Could not load day rhythm status." };
    }
    const parsed = SensesStatusSchema.safeParse(await parseJson(res));
    if (!parsed.success) {
      return { ok: false, kind: "invalid_response", message: "Could not read day rhythm status." };
    }
    return { ok: true, status: parsed.data };
  } catch {
    return { ok: false, kind: "network_error", message: "Could not reach the server." };
  }
}

export async function optInDayRhythm({
  timezone,
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  nav = globalThis.navigator,
}: {
  timezone?: string | null;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  nav?: Navigator;
} = {}): Promise<
  | { ok: true; status: SensesStatus }
  | { ok: false; serverOff: true }
  | { ok: false; serverOff?: false; message: string }
> {
  if (timezone !== undefined) setSensesTimezoneOverride(timezone, storage);
  setSensesOptIn(true, storage);
  const result = await pushSensesSnapshot({ fetchImpl, storage, nav, timezone });
  if (result.serverOff) return { ok: false, serverOff: true };
  if (!result.ok) {
    return { ok: false, message: "Could not share your rhythm snapshot." };
  }
  const parsed = SensesStatusSchema.safeParse(result.summary);
  if (!parsed.success) {
    return {
      ok: true,
      status: { enabled: true, present: true },
    };
  }
  return { ok: true, status: parsed.data };
}

export async function optOutAndForgetRhythm({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
}: {
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
} = {}): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await forgetSenses({ fetchImpl, storage });
  if (result.ok) return { ok: true };
  return { ok: false, message: "Could not forget your rhythm data. Please try again." };
}

export function isDayRhythmOptedIn(storage = globalThis.localStorage): boolean {
  return sensesOptedIn(storage);
}

export { setSensesTimezoneOverride, sensesOptedIn, validTimezone };
