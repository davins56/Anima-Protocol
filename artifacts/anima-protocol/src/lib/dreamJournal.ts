/**
 * Dream journal client (docs/dream-journal-frontend-contract.md).
 *
 * List / detail / settings / mark-read talk to /api/dreams/:characterId
 * (artifacts/api-server/src/routes/dreams.ts). Responses are validated with
 * zod. A missing route or schema (older deploy) becomes `unavailable` so the UI
 * can show "not available yet" instead of a fake journal. Continuity (last three fragments, presence) is a separate,
 * already-shipped surface — see useIsDreaming and unreadDreamsFromContinuity.
 */
import { z } from "zod";
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

export const DREAM_JOURNAL_MAX_LIMIT = 50;
export const WHAT_DID_YOU_DREAM_PROMPT = "What did you dream?";
export const COMPOSE_PREFILL_QUERY = "compose";
export const COMPOSE_PREFILL_TOKEN_PREFIX = "compose-prefill";
export const DREAM_READ_STORAGE_KEY = "anima_dream_journal_read";

export const DreamJournalEntrySchema = z.object({
  id: z.string(),
  created_at: z.string(),
  mood: z.string().nullable().optional(),
  themes: z.array(z.string()).optional().default([]),
  summary: z.string(),
  fragment: z.string().optional().default(""),
  read: z.boolean().optional().default(false),
  surfaced_count: z.number().int().min(0).optional(),
});

export const DreamJournalPageSchema = z.object({
  character_id: z.string(),
  dreaming_enabled: z.boolean(),
  unread_count: z.number().int().min(0),
  is_dreaming: z.boolean().optional(),
  dreams: z.array(DreamJournalEntrySchema),
  next_cursor: z.string().nullable(),
});

export const DreamJournalSettingsSchema = z.object({
  character_id: z.string(),
  dreaming_enabled: z.boolean(),
});

export const DreamJournalReadSchema = z.object({
  ok: z.boolean(),
  unread_count: z.number().int().min(0).optional(),
});

export type DreamJournalEntry = z.infer<typeof DreamJournalEntrySchema>;
export type DreamJournalPage = z.infer<typeof DreamJournalPageSchema>;
export type DreamJournalSettings = z.infer<typeof DreamJournalSettingsSchema>;

export type DreamJournalErrorCode =
  | "unauthorized"
  | "companion_not_found"
  | "dream_not_found"
  | "invalid_cursor"
  | "dream_schema_missing"
  | "unavailable"
  | "server_error"
  | "invalid_response"
  | "network_error";

export class DreamJournalError extends Error {
  constructor(
    public code: DreamJournalErrorCode,
    public status: number,
    message?: string,
  ) {
    super(message || code);
    this.name = "DreamJournalError";
  }
}

export function isDreamJournalUnavailable(err: unknown): boolean {
  return err instanceof DreamJournalError && (err.code === "unavailable" || err.code === "dream_schema_missing");
}

export function dreamJournalListPath(
  characterId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (opts.limit) {
    params.set("limit", String(Math.min(DREAM_JOURNAL_MAX_LIMIT, Math.max(1, Math.floor(opts.limit)))));
  }
  if (opts.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  return `/dreams/${encodeURIComponent(characterId)}${qs ? `?${qs}` : ""}`;
}

export function dreamJournalDetailPath(characterId: string, dreamId: string): string {
  return `/dreams/${encodeURIComponent(characterId)}/${encodeURIComponent(dreamId)}`;
}

export function dreamJournalSettingsPath(characterId: string): string {
  return `/dreams/${encodeURIComponent(characterId)}/settings`;
}

export function dreamJournalReadPath(characterId: string, dreamId: string): string {
  return `/dreams/${encodeURIComponent(characterId)}/${encodeURIComponent(dreamId)}/read`;
}

export function dreamJournalPagePath(characterId?: string | null, name?: string | null): string {
  const base = characterId ? `/dreams/${encodeURIComponent(characterId)}` : "/dreams";
  if (!name) return base;
  const params = new URLSearchParams({ name });
  return `${base}?${params}`;
}

export function dreamJournalChatPath(
  opts: { sessionId?: string | null; characterId?: string | null; prompt?: string } = {},
): string {
  const params = new URLSearchParams();
  params.set(COMPOSE_PREFILL_QUERY, opts.prompt || WHAT_DID_YOU_DREAM_PROMPT);
  if (opts.characterId) params.set("character", opts.characterId);
  const base = opts.sessionId ? `/chat/${encodeURIComponent(opts.sessionId)}` : "/chat";
  return `${base}?${params.toString()}`;
}

/** Pull `compose` out of a chat URL so the composer can be prefilled without sending. */
export function consumeComposePrefill(search: string): {
  text: string;
  characterId: string | null;
  nextSearch: string;
} | null {
  const rawQuery = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(rawQuery);
  const raw = params.get(COMPOSE_PREFILL_QUERY);
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (!text) return null;
  const characterId = params.get("character")?.trim() || null;
  params.delete(COMPOSE_PREFILL_QUERY);
  const next = params.toString();
  return { text, characterId, nextSearch: next ? `?${next}` : "" };
}

export function isDreamingPresence(presence: unknown): boolean {
  return presence === "dreaming";
}

export type ContinuityDreamFragment = {
  id?: string;
  fragment?: string;
  mood?: string | null;
  themes?: string[];
  created_at?: string;
};

export function unreadDreamsFromContinuity(
  recentDreams: ContinuityDreamFragment[] | null | undefined,
  readIds: Iterable<string>,
): ContinuityDreamFragment[] {
  const read = new Set(readIds);
  return (recentDreams || []).filter((d) => d?.id && !read.has(d.id));
}

export function readDreamIds(characterId: string, storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage): string[] {
  if (!characterId || !storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(DREAM_READ_STORAGE_KEY) || "{}");
    const list = raw?.[characterId];
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function markDreamsReadLocally(
  characterId: string,
  ids: string[],
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined = globalThis.localStorage,
): string[] {
  if (!characterId || !storage || !ids.length) return readDreamIds(characterId, storage);
  const next = [...new Set([...readDreamIds(characterId, storage), ...ids])];
  try {
    const raw = JSON.parse(storage.getItem(DREAM_READ_STORAGE_KEY) || "{}");
    const all = raw && typeof raw === "object" ? raw : {};
    all[characterId] = next;
    storage.setItem(DREAM_READ_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* private mode */
  }
  return next;
}

function errorFromResponse(res: Response, body: unknown): DreamJournalError {
  const code = (body as { code?: string } | null)?.code;
  const message = (body as { error?: string } | null)?.error;
  if (res.status === 401) return new DreamJournalError("unauthorized", 401, message);
  if (code === "companion_not_found" || code === "dream_not_found" || code === "invalid_cursor" || code === "dream_schema_missing") {
    return new DreamJournalError(code, res.status, message);
  }
  // A missing Workers/Vercel route is usually a bare 404/405/501 without our code.
  if (res.status === 404 || res.status === 405 || res.status === 501 || res.status === 503) {
    return new DreamJournalError("unavailable", res.status, message);
  }
  return new DreamJournalError("server_error", res.status, message);
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<{ res: Response; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: { ...(await authHeaders()), ...(init.headers || {}) },
      cache: "no-store",
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    throw new DreamJournalError("network_error", 0);
  }
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await res.json().catch(() => null) : await res.text().catch(() => null);
  if (!res.ok) throw errorFromResponse(res, typeof body === "string" ? null : body);
  return { res, body };
}

export async function fetchDreamJournal(
  characterId: string,
  opts: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
): Promise<DreamJournalPage> {
  const { res, body } = await apiFetch(dreamJournalListPath(characterId, opts), { signal: opts.signal });
  const parsed = DreamJournalPageSchema.safeParse(body);
  if (!parsed.success) throw new DreamJournalError("invalid_response", res.status);
  return parsed.data;
}

export async function fetchDreamJournalEntry(
  characterId: string,
  dreamId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<DreamJournalEntry> {
  const { res, body } = await apiFetch(dreamJournalDetailPath(characterId, dreamId), { signal: opts.signal });
  const parsed = DreamJournalEntrySchema.safeParse(body);
  if (!parsed.success) throw new DreamJournalError("invalid_response", res.status);
  return parsed.data;
}

export async function fetchDreamJournalSettings(
  characterId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<DreamJournalSettings> {
  const { res, body } = await apiFetch(dreamJournalSettingsPath(characterId), { signal: opts.signal });
  const parsed = DreamJournalSettingsSchema.safeParse(body);
  if (!parsed.success) throw new DreamJournalError("invalid_response", res.status);
  return parsed.data;
}

export async function updateDreamJournalSettings(
  characterId: string,
  dreamingEnabled: boolean,
): Promise<DreamJournalSettings> {
  const { res, body } = await apiFetch(dreamJournalSettingsPath(characterId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dreaming_enabled: dreamingEnabled }),
  });
  const parsed = DreamJournalSettingsSchema.safeParse(body);
  if (!parsed.success) throw new DreamJournalError("invalid_response", res.status);
  return parsed.data;
}

export async function markDreamRead(characterId: string, dreamId: string): Promise<{ ok: boolean; unread_count?: number }> {
  const { res, body } = await apiFetch(dreamJournalReadPath(characterId, dreamId), { method: "POST" });
  const parsed = DreamJournalReadSchema.safeParse(body);
  if (!parsed.success) throw new DreamJournalError("invalid_response", res.status);
  return parsed.data;
}

export function formatDreamDate(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

export function moodTag(mood: string | null | undefined): string | null {
  const value = typeof mood === "string" ? mood.trim() : "";
  return value ? value : null;
}
