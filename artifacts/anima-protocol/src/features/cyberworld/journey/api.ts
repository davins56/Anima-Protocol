/**
 * Live wiring for journey sync + interests: the app's Clerk token bridge and
 * API origin. Degrades silently (queue keeps, no hints) when signed out or
 * when the #724 routes aren't deployed.
 */
import { authHeaders, getToken, hasAuthTokenGetter } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";
import { createInterestCache } from "./interests";
import { createBackendSink, type BackendSink, type Transport } from "./sync";

const readBody = async (res: Response) => ((res.headers.get("content-type") || "").includes("json") ? res.json().catch(() => null) : null);

export const postJourneyEvents: Transport = async (rows, token, opts) => {
  const res = await fetch(apiUrl("/memory/journey-events"), {
    method: "POST",
    headers: await authHeaders(undefined, { token, waitForAuth: false }),
    body: JSON.stringify({ events: rows }),
    cache: "no-store",
    keepalive: opts?.keepalive,
  });
  const ra = Number(res.headers.get("Retry-After"));
  return { status: res.status, body: await readBody(res), retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : null };
};

async function fetchInterests(characterId: string): Promise<unknown> {
  const token = await getToken();
  if (!token) throw new Error("signed out");
  const res = await fetch(apiUrl(`/memory/journey-interests?character_id=${encodeURIComponent(characterId)}`), {
    headers: await authHeaders(undefined, { token, waitForAuth: false }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`interests ${res.status}`);
  return readBody(res);
}

let sink: BackendSink | null = null;
/** One backend sink per page (it owns timers + the persisted queue). */
export function backendJourneySink(): BackendSink {
  sink ??= createBackendSink({ transport: postJourneyEvents, getToken: () => getToken(), lifecycle: true });
  return sink;
}

export const journeyInterests = createInterestCache({ fetcher: fetchInterests, enabled: hasAuthTokenGetter });
