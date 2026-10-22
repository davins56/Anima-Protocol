/**
 * Optional server adapter. The battle always runs locally; when the
 * immersive-sim API is reachable the stamped input log is flushed to
 * POST /api/sim/sessions/:id/actions with the client's {tick, hash} so the
 * server can replay it through the same sim-core and record consequences.
 * Any failure (offline, 404 before the migration, 401) degrades to local play.
 */
import type { SimConfig, StampedAction } from "@workspace/sim-core";
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

export type RemoteSession = { id: string; config: SimConfig };
export type FlushResponse = { accepted: number; action_count: number; tick: number; hash: string; outcome: "win" | "lose" | null };
export type RemoteStatus = "offline" | "connecting" | "synced" | "pending" | "desync" | "error";

type Fetcher = typeof fetch;

async function call<T>(path: string, init: RequestInit, fetcher: Fetcher): Promise<T> {
  const headers = { ...((await authHeaders()) as Record<string, string>), "Content-Type": "application/json" };
  const res = await fetcher(apiUrl(path), { ...init, headers, credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, code: body?.code });
  return body as T;
}

export async function createRemoteSession(
  args: { characterId: string; startW: number; nodeId?: string | null },
  fetcher: Fetcher = fetch,
): Promise<RemoteSession | null> {
  try {
    const r = await call<{ session: { id: string; config: SimConfig } }>(
      "/sim/sessions",
      { method: "POST", body: JSON.stringify({ character_id: args.characterId, start_w: args.startW, node_id: args.nodeId ?? null }) },
      fetcher,
    );
    return r?.session?.id && r.session.config ? { id: r.session.id, config: r.session.config } : null;
  } catch {
    return null;
  }
}

/** Incremental flusher: sends log[sent..] with the claimed state, never re-sends accepted inputs. */
export class ActionFlusher {
  private sent = 0;
  private inflight = false;
  status: RemoteStatus = "pending";
  lastError: string | null = null;

  constructor(
    readonly sessionId: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async flush(log: StampedAction[], claimed: { tick: number; hash: string }): Promise<FlushResponse | null> {
    if (this.inflight || this.status === "desync") return null;
    this.inflight = true;
    const from = this.sent;
    const actions = log.slice(from);
    try {
      const r = await call<FlushResponse>(
        `/sim/sessions/${encodeURIComponent(this.sessionId)}/actions`,
        { method: "POST", body: JSON.stringify({ from_idx: from, actions, claimed }) },
        this.fetcher,
      );
      this.sent = from + actions.length;
      this.status = "synced";
      this.lastError = null;
      return r;
    } catch (e) {
      const err = e as Error & { code?: string };
      this.lastError = err.message;
      this.status = err.code === "sim_desync" || err.code === "sim_rejected" ? "desync" : "error";
      return null;
    } finally {
      this.inflight = false;
    }
  }
}
