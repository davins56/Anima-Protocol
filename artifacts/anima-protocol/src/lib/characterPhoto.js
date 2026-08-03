// @ts-check
// Auto-search character portraits via the api-server (/api/character-image),
// which queries the web (Wikipedia) for a representative photo.

import { apiUrl } from '@/lib/apiOrigin';

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
export async function findCharacterPhoto(name, universe) {
  if (!name) return null;
  const params = new URLSearchParams({ name });
  if (universe) params.set("universe", universe);
  const res = await fetch(`${apiUrl('/character-image')}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`character-image lookup failed: ${res.status}`);
  }
  const data = await res.json();
  return data?.url || null;
}