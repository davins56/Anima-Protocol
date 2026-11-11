/** Client for /api/vessel/* with a tiny in-memory cache (chat header + studio share it). */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";
import { parseVesselConfig, type VesselConfig } from "./vesselConfig";

export type VesselRecord = {
  id: string;
  character_id: string;
  version: number;
  config: VesselConfig;
  snapshot_path: string | null;
  created_at: string;
};

const cache = new Map<string, { at: number; value: VesselRecord | null }>();
const inflight = new Map<string, Promise<VesselRecord | null>>();
const listeners = new Set<(characterId: string) => void>();
const TTL = 60_000;

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, code: body?.code });
  return body;
}

export function onVesselChanged(fn: (characterId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function fetchVessel(characterId: string, force = false): Promise<VesselRecord | null> {
  const hit = cache.get(characterId);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value;
  const pending = inflight.get(characterId);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetch(apiUrl(`/vessel/${encodeURIComponent(characterId)}`), {
        headers: await authHeaders(),
        credentials: "include",
      });
      const body = await json(res);
      const v = body.vessel ? { ...body.vessel, config: parseVesselConfig(body.vessel.config) } : null;
      cache.set(characterId, { at: Date.now(), value: v });
      return v;
    } catch (err) {
      if ((err as { code?: string }).code === "vessel_schema_missing") {
        cache.set(characterId, { at: Date.now(), value: null });
        return null;
      }
      throw err;
    } finally {
      inflight.delete(characterId);
    }
  })();
  inflight.set(characterId, p);
  return p;
}

export async function uploadVesselSnapshot(characterId: string, dataUrl: string) {
  const res = await fetch(apiUrl(`/vessel/${encodeURIComponent(characterId)}/snapshot`), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ dataUrl }),
  });
  return (await json(res)) as { snapshot_bucket: string | null; snapshot_path: string; url: string };
}

export async function saveVessel(args: {
  characterId: string;
  name: string;
  config: VesselConfig;
  changeNote?: string;
  snapshot?: { snapshot_bucket: string | null; snapshot_path: string } | null;
}): Promise<{ vessel: VesselRecord; identity_version: number }> {
  const res = await fetch(apiUrl(`/vessel/${encodeURIComponent(args.characterId)}`), {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: args.name,
      config: args.config,
      change_note: args.changeNote || "",
      ...(args.snapshot || {}),
    }),
  });
  const out = await json(res);
  cache.set(args.characterId, { at: Date.now(), value: { ...out.vessel, config: parseVesselConfig(out.vessel.config) } });
  listeners.forEach((fn) => fn(args.characterId));
  return out;
}

/** Same-origin URL that 302s to the latest snapshot; usable as an extra photo reference. */
export function vesselSnapshotUrl(characterId: string): string {
  return apiUrl(`/vessel/${encodeURIComponent(characterId)}/snapshot`);
}
