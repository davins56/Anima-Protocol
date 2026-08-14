// Thin, typed client for artifacts/api-server/src/routes/relationshipOs.ts.
// Mirrors the real route paths, request bodies, and response shapes from
// that router — this replaces the localStorage-based memoryService.ts
// from the original belonging module, which duplicated what this backend
// already does.
//
// TWO ASSUMPTIONS TO VERIFY:
//
// 1. Base path — confirm where relationshipOsRouter is actually mounted
//    in your server entrypoint (e.g. `app.use('/api/relationship', relationshipOsRouter)`)
//    and adjust RELATIONSHIP_API_BASE if it differs.
//
// 2. Auth — relationshipOs.ts uses Clerk's getAuth(req), which reads the
//    session from cookies/headers Clerk's middleware attaches. If your
//    frontend and API share an origin and you're using @clerk/clerk-react
//    with credentials included, you may not need configureRelationshipApiAuth
//    at all. If they're cross-origin or you use bearer tokens, call
//    configureRelationshipApiAuth(async () => (await getToken())) once at
//    app startup, using Clerk's useAuth().getToken().

import type {
  JournalEntry,
  JournalEntryType,
  ResonanceMemory,
  ResonanceVector,
  TimelineEvent,
  TimelineEventType,
} from '../types/relationship';

const RELATIONSHIP_API_BASE = '/api/relationship';

let getAuthToken: (() => Promise<string | null>) | null = null;

export function configureRelationshipApiAuth(fn: () => Promise<string | null>): void {
  getAuthToken = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (getAuthToken) {
    const token = await getAuthToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${RELATIONSHIP_API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Relationship API ${res.status}: ${body || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ---------- Timeline ----------

export function getTimelineEvents(
  animaId: string,
  opts?: { limit?: number; eventType?: TimelineEventType }
) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.eventType) params.set('eventType', opts.eventType);
  const qs = params.toString() ? `?${params}` : '';
  return request<{ events: TimelineEvent[] }>(`/timeline/${animaId}${qs}`);
}

export function openRelationshipChapter(
  animaId: string,
  body: { title: string; summary?: string; chapterIndex?: number }
) {
  return request<{ event: TimelineEvent }>(`/timeline/${animaId}/chapter`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------- Resonance memories ----------

export function getResonanceMemories(animaId: string, opts?: { limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params}` : '';
  return request<{ memories: ResonanceMemory[] }>(`/resonance-memories/${animaId}${qs}`);
}

export function crystallizeResonanceMemory(
  animaId: string,
  body: {
    title: string;
    body: string;
    resonanceSnapshot: ResonanceVector;
    sessionId?: string;
    emotionalTone?: string;
    tags?: string[];
    intensity?: number;
  }
) {
  return request<{ memory: ResonanceMemory }>(`/resonance-memories/${animaId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------- Journal ----------

export function getJournalEntries(
  animaId: string,
  opts?: { limit?: number; unreadOnly?: boolean }
) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.unreadOnly) params.set('unread', '1');
  const qs = params.toString() ? `?${params}` : '';
  return request<{ entries: JournalEntry[] }>(`/journal/${animaId}${qs}`);
}

export function writeJournalEntry(
  animaId: string,
  body: {
    title: string;
    content: string;
    entryType?: JournalEntryType;
    sourceSessionId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  return request<{ entry: JournalEntry }>(`/journal/${animaId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function markJournalRead(animaId: string, entryId: string) {
  return request<{ ok: true }>(`/journal/${animaId}/${entryId}/read`, { method: 'POST' });
}
