/**
 * Calendar awareness client (server: /api/calendar, see
 * artifacts/api-server/src/routes/calendar.ts).
 *
 * Busy/free only: the server reads Google freeBusy or Microsoft Graph
 * start/end/showAs and never event titles. Connecting is opt-in; disconnect
 * and "Forget my rhythm data" delete the stored token.
 */
import { z } from "zod";
import { requireChatAuthHeaders } from "@/api/animaApi";
import { apiUrl } from "@/lib/apiOrigin";

export type CalendarProvider = "google" | "microsoft";
export const CALENDAR_PROVIDER_LABELS: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  microsoft: "Outlook / Microsoft 365",
};

export const CalendarStatusSchema = z.object({
  enabled: z.boolean(),
  keyConfigured: z.boolean().optional(),
  providers: z.object({ google: z.boolean(), microsoft: z.boolean() }),
  connections: z.array(
    z.object({
      provider: z.enum(["google", "microsoft"]),
      status: z.enum(["active", "reauth_required"]),
      connectedAt: z.string().nullable().optional(),
      lastSyncedAt: z.string().nullable().optional(),
      lastError: z.string().nullable().optional(),
    }),
  ),
  busy: z
    .object({ receivedAt: z.string(), providers: z.array(z.string()), busyBlocks: z.number() })
    .nullable()
    .optional(),
});
export type CalendarStatus = z.infer<typeof CalendarStatusSchema>;

export async function loadCalendarStatus({
  fetchImpl = globalThis.fetch,
}: { fetchImpl?: typeof fetch } = {}): Promise<{ ok: true; status: CalendarStatus } | { ok: false; message: string }> {
  try {
    const headers = await requireChatAuthHeaders();
    const res = await fetchImpl(apiUrl("/calendar"), { method: "GET", headers });
    if (!res.ok) return { ok: false, message: "Could not load calendar status." };
    const parsed = CalendarStatusSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, message: "Could not read calendar status." };
    return { ok: true, status: parsed.data };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

/** Ask the server for the provider sign-in URL. The caller navigates to it. */
export async function startCalendarConnect(
  provider: CalendarProvider,
  { fetchImpl = globalThis.fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  try {
    const headers = await requireChatAuthHeaders();
    // same-origin credentials so the browser keeps the OAuth state cookie.
    const res = await fetchImpl(apiUrl(`/calendar/connect/${provider}`), {
      method: "POST",
      headers,
      credentials: "same-origin",
    });
    if (res.status === 409) return { ok: false, message: "Day rhythm is turned off on the server." };
    if (res.status === 503) return { ok: false, message: "Calendar sign-in is not set up on the server yet." };
    if (!res.ok) return { ok: false, message: "Could not start calendar sign-in." };
    const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url : "";
    if (!/^https:\/\/(accounts\.google\.com|login\.microsoftonline\.com)\//.test(url)) {
      return { ok: false, message: "Could not start calendar sign-in." };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

export async function disconnectCalendarProvider(
  provider: CalendarProvider,
  { fetchImpl = globalThis.fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean }> {
  try {
    const headers = await requireChatAuthHeaders();
    const res = await fetchImpl(apiUrl(`/calendar/${provider}`), { method: "DELETE", headers });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Outcome codes the server appends to /settings?calendar=… after sign-in. */
export function calendarOutcomeMessage(code: string | null): { tone: "ok" | "error"; text: string } | null {
  switch (code) {
    case null:
    case "":
      return null;
    case "connected":
      return { tone: "ok", text: "Calendar connected. Only busy and free times are read." };
    case "denied":
      return { tone: "error", text: "Calendar sign-in was cancelled." };
    case "scope_missing":
      return { tone: "error", text: "Calendar permission was not granted, so nothing was connected." };
    case "invalid_state":
      return { tone: "error", text: "That sign-in link expired or came from another browser. Try again." };
    case "unavailable":
      return { tone: "error", text: "Calendar sign-in is not set up on the server yet." };
    default:
      return { tone: "error", text: "Could not connect your calendar. Try again." };
  }
}
