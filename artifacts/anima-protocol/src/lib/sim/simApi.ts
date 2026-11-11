/**
 * Client for /api/sim. The battle runs locally (optimistic, 20 Hz); inputs are
 * flushed in batches with the client's state hash so the server can replay and
 * confirm. Offline / not-migrated → local-only battle, no memory consequences.
 */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";
import type { SimConfig, StampedAction, CorruptionRecord } from "./engine";

export type SimSession = { id: string; character_id: string; node_id: string | null; config: SimConfig; outcome: string | null };
export type FlushResult = {
  accepted: number;
  action_count: number;
  tick: number;
  hash: string;
  outcome: "win" | "lose" | null;
  memory_events: number;
  corruptions: CorruptionRecord[];
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...(await authHeaders()), "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, code: body?.code });
  return body as T;
}

export const createSimSession = (args: { character_id: string; node_id?: string | null; start_w?: number }) =>
  call<{ session: SimSession }>("/sim/sessions", { method: "POST", body: JSON.stringify(args) });

export const flushSimActions = (id: string, body: { from_idx: number; actions: StampedAction[]; claimed: { tick: number; hash: string } }) =>
  call<FlushResult>(`/sim/sessions/${encodeURIComponent(id)}/actions`, { method: "POST", body: JSON.stringify(body) });

/** Local practice battle when the server is unavailable (nothing is recorded). */
export function localSimConfig(args: { characterId: string; startW: number; nodeBandW?: number; seed?: number }): SimConfig {
  const w = args.nodeBandW ?? 10;
  const band = w < 20 ? "noise" : w < 45 ? "ambient" : w < 75 ? "data" : w < 88 ? "rare" : "serenity";
  return {
    seed: args.seed ?? (Date.now() & 0x7fffffff),
    companionId: args.characterId,
    startW: args.startW,
    enemies: [{ kind: "mettaur", band, hp: 140 }, { kind: "shade", band: band === "noise" ? "ambient" : "noise", hp: 100 }],
    memoryPool: [],
  };
}
