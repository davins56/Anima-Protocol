// @ts-check
// Auto-search character portraits via the api-server (/api/character-image),
// which queries the web (Wikipedia) for a representative photo.

import { apiUrl } from '@/lib/apiOrigin';
import { authHeaders } from '@/api/authBridge';

// Looks up a portrait for a character.
// Resolves to an image URL string on success, or null for a *definitive*
// no-match (the service answered but found nothing).
// THROWS on transient failures (network error / non-OK response) so callers
// can distinguish "no photo exists" from "couldn't reach the service" and
// avoid permanently giving up after a temporary outage.
/**
 * @param {string} name
 * @param {string} [universe]
 */
export const CHARACTER_PHOTO_LOOKUP_TIMEOUT_MS = 8000;

export async function findCharacterPhoto(name, universe) {
  if (!name) return null;
  const params = new URLSearchParams({ name });
  if (universe) params.set("universe", universe);
  const signal =
    typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(CHARACTER_PHOTO_LOOKUP_TIMEOUT_MS)
      : undefined;
  let res;
  try {
    res = await fetch(`${apiUrl("/character-image")}?${params.toString()}`, {
      headers: await authHeaders(),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") return null;
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`character-image lookup failed: ${res.status}`);
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.url || null;
}