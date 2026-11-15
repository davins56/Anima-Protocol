/**
 * 2D vessel snapshot for small surfaces (chat header): the latest Vessel Studio
 * render, fetched once per (character, snapshot_path) through the owner-only
 * GET /api/vessel/:id/snapshot (302 → signed URL) and kept as an object URL.
 * No WebGL. Failures are cached as null so callers fall back to the avatar
 * without refetching on every render.
 */
import { authHeaders } from "@/api/authBridge";
import { vesselSnapshotUrl } from "./vesselApi";

const cache = new Map<string, Promise<string | null>>();
const MAX = 24;

const keyFor = (characterId: string, path: string) => `${characterId}\u0000${path}`;

function remember(key: string, p: Promise<string | null>) {
  cache.delete(key);
  cache.set(key, p);
  while (cache.size > MAX) {
    const [oldest, value] = cache.entries().next().value as [string, Promise<string | null>];
    cache.delete(oldest);
    value.then((url) => url?.startsWith("blob:") && URL.revokeObjectURL(url)).catch(() => {});
  }
}

/** Seed the cache right after Vessel Studio uploads a snapshot (no round-trip). */
export function primeVesselSnapshot(characterId: string, path: string | null | undefined, dataUrl: string | null | undefined) {
  if (!characterId || !path || !dataUrl) return;
  remember(keyFor(characterId, path), Promise.resolve(dataUrl));
}

export function peekVesselSnapshot(characterId: string, path: string): Promise<string | null> | undefined {
  return cache.get(keyFor(characterId, path));
}

export function loadVesselSnapshot(characterId: string, path: string | null | undefined): Promise<string | null> {
  if (!characterId || !path) return Promise.resolve(null);
  const key = keyFor(characterId, path);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(vesselSnapshotUrl(characterId), { headers: await authHeaders(), credentials: "include" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/") || typeof URL.createObjectURL !== "function") return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  })();
  remember(key, p);
  return p;
}

/** Test hook. */
export function __resetVesselSnapshots() {
  cache.clear();
}
