/**
 * Backend journey sync (pairs with the Anima Backend Data route from #724):
 *
 *   POST /api/memory/journey-events  { events: Row[] }   (Row = toMemoryEventRow() minus user_id, ≤ 20)
 *
 * The queue/cap/response logic here is pure (state in → state out) and unit
 * tested; `createBackendSink` adds persistence (localStorage), timers and the
 * page-lifecycle flushes around it. The server takes user_id from the Clerk
 * session — it is never sent. Mock residents ("mock-…") never leave the browser.
 */
import { toMemoryEventRow, type JourneyEvent, type JourneySink } from "./log";

export const SYNC_QUEUE_KEY = "anima.cyberworld.journeys.sync.v1";
export const BATCH_MAX = 20;
/** Matches the server default: journey events per companion per UTC day. */
export const DAILY_CAP = 5;
/** Queued rows kept per companion (newest win) so a capped companion can't grow the queue forever. */
export const QUEUE_PER_COMPANION = 10;
export const FLUSH_MS = 60_000;
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 30 * 60_000;

export type SyncRow = Omit<ReturnType<typeof toMemoryEventRow>, "user_id">;

export type SyncState = {
  version: 1;
  queue: SyncRow[];
  /** UTC day (YYYY-MM-DD) that `sent` / `blocked` refer to. */
  day: string;
  /** Rows accepted by the server today, per companion (inserted + duplicates). */
  sent: Record<string, number>;
  /** Companions the server capped today (429 rate_limited with character_id). */
  blocked: string[];
  /** Epoch ms before which nothing is sent (network / 5xx backoff, generic 429). */
  backoffUntil: number;
  failures: number;
  /** 401 seen: pause until signed in again (not persisted across reloads). */
  authPaused: boolean;
};

export type SyncResponse = { status: number; body?: unknown; retryAfterSec?: number | null } | { status: 0; error: string };

export type SyncOutcome = { state: SyncState; log?: string };

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const isMockId = (id: string) => id.startsWith("mock-");

export function emptySyncState(now: number): SyncState {
  return { version: 1, queue: [], day: utcDay(now), sent: {}, blocked: [], backoffUntil: 0, failures: 0, authPaused: false };
}

/** Row for the API: the memory_events mapping without user_id. */
export function toSyncRow(e: JourneyEvent): SyncRow {
  const { user_id: _omit, ...row } = toMemoryEventRow(e, "");
  void _omit;
  return row;
}

/** New UTC day: caps and blocks reset. */
export function rollDay(s: SyncState, now: number): SyncState {
  const day = utcDay(now);
  return s.day === day ? s : { ...s, day, sent: {}, blocked: [] };
}

/** Queue events (skips mock ids, dedupes by dedupe_key, keeps the newest QUEUE_PER_COMPANION per companion). */
export function enqueue(s: SyncState, events: readonly JourneyEvent[]): SyncState {
  const seen = new Set(s.queue.map((r) => r.dedupe_key));
  let queue = [...s.queue];
  for (const e of events) {
    if (isMockId(e.companionId) || isMockId(e.id)) continue;
    const row = toSyncRow(e);
    if (seen.has(row.dedupe_key)) continue;
    seen.add(row.dedupe_key);
    queue.push(row);
  }
  const counts = new Map<string, number>();
  for (const r of queue) counts.set(r.character_id, (counts.get(r.character_id) ?? 0) + 1);
  const drop = new Map([...counts].map(([c, n]) => [c, Math.max(0, n - QUEUE_PER_COMPANION)]));
  queue = queue.filter((r) => {
    const d = drop.get(r.character_id) ?? 0;
    if (d <= 0) return true;
    drop.set(r.character_id, d - 1);
    return false;
  });
  return queue.length === s.queue.length && queue.every((r, i) => r === s.queue[i]) ? s : { ...s, queue };
}

/**
 * Next batch to send, or null. One companion per batch so a 404/429 for one
 * companion can't sink the others; size ≤ BATCH_MAX and ≤ its remaining daily cap.
 */
export function nextBatch(s: SyncState, now: number): SyncRow[] | null {
  if (s.authPaused || now < s.backoffUntil || !s.queue.length) return null;
  const st = rollDay(s, now);
  for (const r of st.queue) {
    const c = r.character_id;
    if (st.blocked.includes(c)) continue;
    const room = Math.min(BATCH_MAX, DAILY_CAP - (st.sent[c] ?? 0));
    if (room <= 0) continue;
    return st.queue.filter((x) => x.character_id === c).slice(0, room);
  }
  return null;
}

const removeRows = (queue: SyncRow[], batch: readonly SyncRow[]) => {
  const keys = new Set(batch.map((r) => r.dedupe_key));
  return queue.filter((r) => !keys.has(r.dedupe_key));
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Fold one POST result into the state. Never throws; `log` is set for things worth a single console line. */
export function applyResponse(s0: SyncState, batch: readonly SyncRow[], res: SyncResponse, now: number): SyncOutcome {
  const s = rollDay(s0, now);
  const companion = batch[0]?.character_id;
  const body = obj("body" in res ? res.body : null);
  const backoff = (): SyncOutcome => {
    const failures = s.failures + 1;
    const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
    return { state: { ...s, failures, backoffUntil: now + wait } };
  };
  switch (true) {
    case res.status === 200: {
      // inserted, duplicates and rejected (mock_id / invalid_payload / invalid_dedupe_key …) are all final.
      const accepted = num(body.inserted) + num(body.duplicates);
      const rejected = Array.isArray(body.rejected) ? body.rejected.length : 0;
      const sent = companion ? { ...s.sent, [companion]: (s.sent[companion] ?? 0) + accepted } : s.sent;
      return { state: { ...s, queue: removeRows(s.queue, batch), sent, failures: 0, backoffUntil: 0 }, log: rejected ? `journey sync: ${rejected} event(s) rejected` : undefined };
    }
    case res.status === 400:
      return { state: { ...s, queue: removeRows(s.queue, batch), failures: 0 }, log: `journey sync: batch dropped (${String(body.code ?? "bad request")})` };
    case res.status === 401:
      return { state: { ...s, authPaused: true } };
    case res.status === 404 && body.code === "companion_not_found":
      return { state: { ...s, queue: s.queue.filter((r) => r.character_id !== companion), failures: 0 }, log: "journey sync: companion not found, dropped its events" };
    case res.status === 429: {
      const retry = num(body.retry_after) || num("retryAfterSec" in res ? res.retryAfterSec : 0) || 60;
      const who = typeof body.character_id === "string" ? body.character_id : null;
      if (body.code === "rate_limited" && who) {
        // Daily cap for this companion: stop for the rest of the UTC day; others keep flowing.
        return { state: { ...s, blocked: s.blocked.includes(who) ? s.blocked : [...s.blocked, who], sent: { ...s.sent, [who]: Math.max(s.sent[who] ?? 0, num(body.limit) || DAILY_CAP) } } };
      }
      return { state: { ...s, backoffUntil: now + retry * 1000 } };
    }
    default:
      // Network error (status 0), 404 without our code (route not deployed), 5xx …: keep the queue, back off.
      return backoff();
  }
}

/* ── Persistence + lifecycle ──────────────────────────────────────────── */

type Store = Pick<Storage, "getItem" | "setItem">;

export function parseSyncState(raw: string | null, now: number): SyncState {
  const base = emptySyncState(now);
  try {
    const d = obj(raw ? JSON.parse(raw) : null);
    if (d.version !== 1) return base;
    const queue = Array.isArray(d.queue) ? (d.queue as SyncRow[]).filter((r) => r && typeof r.dedupe_key === "string" && typeof r.character_id === "string" && !isMockId(r.character_id)) : [];
    const sent: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(d.sent))) if (num(v) > 0) sent[k] = num(v);
    const blocked = Array.isArray(d.blocked) ? d.blocked.filter((x): x is string => typeof x === "string") : [];
    return rollDay({ ...base, queue, day: typeof d.day === "string" ? d.day : base.day, sent, blocked, backoffUntil: num(d.backoffUntil), failures: num(d.failures) }, now);
  } catch {
    return base;
  }
}

export type Transport = (rows: SyncRow[], token: string, opts?: { keepalive?: boolean }) => Promise<SyncResponse>;

export type BackendSink = JourneySink & { flush(): Promise<void>; dispose(): void; state(): SyncState };

/**
 * JourneySink that queues rows and POSTs them when signed in. `getToken`
 * returns null when signed out (nothing is sent; the queue waits).
 */
export function createBackendSink(opts: {
  transport: Transport;
  getToken: () => Promise<string | null>;
  store?: Store | null;
  now?: () => number;
  /** Install interval + visibility/pagehide listeners (off in tests). */
  lifecycle?: boolean;
  log?: (msg: string) => void;
}): BackendSink {
  const store = opts.store === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : opts.store;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.info(m));
  const logged = new Set<string>();
  let state = parseSyncState(store?.getItem(SYNC_QUEUE_KEY) ?? null, now());
  let busy = false;
  let lastToken: string | null = null;
  let hadToken = false;
  const save = () => {
    try {
      const { authPaused: _a, ...persist } = state;
      void _a;
      store?.setItem(SYNC_QUEUE_KEY, JSON.stringify(persist));
    } catch {
      /* best-effort */
    }
  };
  const once = (m?: string) => {
    if (m && !logged.has(m)) {
      logged.add(m);
      log(m);
    }
  };

  async function flush() {
    if (busy) return;
    busy = true;
    try {
      const token = await opts.getToken().catch(() => null);
      // Signed out → in again clears a 401 pause.
      if (!token) {
        hadToken = false;
        return;
      }
      if (!hadToken && state.authPaused) state = { ...state, authPaused: false };
      hadToken = true;
      lastToken = token;
      for (let i = 0; i < 10; i++) {
        const batch = nextBatch(state, now());
        if (!batch) break;
        const res = await opts.transport(batch, token).catch((e: unknown) => ({ status: 0 as const, error: String(e) }));
        const out = applyResponse(state, batch, res, now());
        state = out.state;
        once(out.log);
        save();
      }
    } finally {
      busy = false;
    }
  }

  /** Unload: fire one keepalive POST with the cached token; dedupe keys make a repeat safe. */
  const finalFlush = () => {
    const batch = nextBatch(state, now());
    if (batch && lastToken && !busy) void opts.transport(batch, lastToken, { keepalive: true }).catch(() => undefined);
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const onVis = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  if (opts.lifecycle && typeof window !== "undefined") {
    timer = setInterval(() => void flush(), FLUSH_MS);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", finalFlush);
  }

  return {
    record(events) {
      const next = enqueue(state, events);
      if (next !== state) {
        state = next;
        save();
      }
    },
    list: () => [],
    flush,
    state: () => state,
    dispose() {
      if (timer) clearInterval(timer);
      if (typeof window !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pagehide", finalFlush);
      }
    },
  };
}
