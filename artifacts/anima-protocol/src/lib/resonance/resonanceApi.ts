import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";
import type { Band, SignalType, SpawnRules } from "./tuning";

export type ResonanceNode = {
  id: string;
  user_id: string | null;
  character_id: string | null;
  label: string;
  band: Band;
  frequency: number;
  signal_type: SignalType;
  is_signature: boolean;
  position: { x: number; y: number; z: number };
  geo_lat: number | null;
  geo_lng: number | null;
  spawn_rules: SpawnRules;
  created_by: string;
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

export const fetchResonance = () => call<{ nodes: ResonanceNode[] }>("/resonance/nodes");
export const syncCompanionNodes = (companions: Array<{ id: string; name: string }>) =>
  call<{ created: number }>("/resonance/nodes/sync", { method: "POST", body: JSON.stringify({ companions }) });
export const createResonanceNode = (node: Partial<ResonanceNode>) =>
  call<{ node: ResonanceNode }>("/resonance/nodes", { method: "POST", body: JSON.stringify(node) });
export const logResonanceEncounter = (e: {
  node_id: string;
  character_id?: string | null;
  session_id?: string | null;
  tuned_frequency: number;
  signal_strength: number;
  mode: "map" | "ar" | "pan";
  geo_lat?: number;
  geo_lng?: number;
}) => call<{ memory_event_id: string | null; character_id: string | null }>("/resonance/encounters", { method: "POST", body: JSON.stringify(e) });
export const bootstrapMemory = (characterId: string, sessionId?: string) =>
  call<unknown>(`/memory-core/${encodeURIComponent(characterId)}/bootstrap`, {
    method: "POST",
    body: JSON.stringify({ sessionId: sessionId || null, limit: 6 }),
  });
