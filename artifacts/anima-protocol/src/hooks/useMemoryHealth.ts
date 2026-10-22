/**
 * Lean, cached memory-health query for the chat header.
 * One in-flight request per character; results reused for 60s across mounts.
 */
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

export type MemoryHealth = {
  memory_count: number;
  first_memory_at: string | null;
  last_memory_at: string | null;
  identity_version: number | null;
  last_recall_at: string | null;
  oldest_recent_recall: { event_id: string; age_s: number; recalled_at: string; content: string } | null;
};

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: MemoryHealth | null; promise?: Promise<MemoryHealth | null> }>();

export function invalidateMemoryHealth(characterId?: string): void {
  if (characterId) cache.delete(characterId);
  else cache.clear();
}

async function fetchHealth(characterId: string): Promise<MemoryHealth | null> {
  const res = await fetch(apiUrl(`/memory-core/${encodeURIComponent(characterId)}/health`), {
    headers: await authHeaders(),
  });
  if (!res.ok) return null; // 503 memory_schema_missing → indicator stays hidden
  const body = (await res.json()) as { health?: MemoryHealth };
  return body.health || null;
}

function load(characterId: string): Promise<MemoryHealth | null> {
  const hit = cache.get(characterId);
  if (hit?.promise) return hit.promise;
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
  const promise = fetchHealth(characterId)
    .catch(() => null)
    .then((value) => {
      cache.set(characterId, { at: Date.now(), value });
      return value;
    });
  cache.set(characterId, { at: hit?.at ?? 0, value: hit?.value ?? null, promise });
  return promise;
}

/** `refreshKey` (e.g. message count) re-reads after the TTL when the chat advances. */
export function useMemoryHealth(characterId: string | null | undefined, refreshKey?: unknown) {
  const [health, setHealth] = useState<MemoryHealth | null>(() =>
    characterId ? cache.get(characterId)?.value ?? null : null,
  );
  useEffect(() => {
    if (!characterId) {
      setHealth(null);
      return;
    }
    let alive = true;
    load(characterId).then((h) => alive && setHealth(h));
    return () => {
      alive = false;
    };
  }, [characterId, refreshKey]);
  return health;
}

export function formatAge(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
