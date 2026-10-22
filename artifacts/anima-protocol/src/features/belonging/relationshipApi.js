// @ts-check
/**
 * Port of anima-belonging/src/lib/relationshipApi.ts onto this app's API
 * plumbing (apiUrl + Clerk bearer). The router is mounted at
 * /api/relationship-os (api-server routes/index.ts), not /api/relationship
 * as the drop-in assumed.
 */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

const BASE = "/relationship-os";

async function request(path, init = {}, fetchImpl = fetch) {
  const res = await fetchImpl(apiUrl(`${BASE}${path}`), {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Relationship API ${res.status}`);
  return res.json();
}

/** @param {string} animaId @param {{ limit?: number, eventType?: string }} [opts] */
export async function getTimelineEvents(animaId, opts = {}, fetchImpl) {
  const q = new URLSearchParams();
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.eventType) q.set("eventType", opts.eventType);
  const qs = q.toString() ? `?${q}` : "";
  const data = await request(`/timeline/${encodeURIComponent(animaId)}${qs}`, {}, fetchImpl);
  return Array.isArray(data?.events) ? data.events : [];
}

/** @param {string} animaId @param {{ limit?: number, unreadOnly?: boolean }} [opts] */
export async function getJournalEntries(animaId, opts = {}, fetchImpl) {
  const q = new URLSearchParams();
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.unreadOnly) q.set("unread", "1");
  const qs = q.toString() ? `?${q}` : "";
  const data = await request(`/journal/${encodeURIComponent(animaId)}${qs}`, {}, fetchImpl);
  return Array.isArray(data?.entries) ? data.entries : [];
}

export function markJournalRead(animaId, entryId, fetchImpl) {
  return request(
    `/journal/${encodeURIComponent(animaId)}/${encodeURIComponent(entryId)}/read`,
    { method: "POST" },
    fetchImpl,
  );
}
