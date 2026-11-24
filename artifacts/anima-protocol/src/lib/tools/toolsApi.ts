/**
 * Chat upgrade 4: calls for the user's decisions on tool actions, per the
 * agreed contract (tools-guardrails-plan.md §4.3–4.5 + addendum). The browser
 * never starts a tool here; it confirms, denies, stops, or replays.
 */
import { requireChatAuthHeaders } from "@/api/animaApi";
import { apiUrl } from "@/lib/apiOrigin";

type FetchOpts = { fetchImpl?: typeof fetch };

export type DecisionResult =
  | { ok: true; status: string; action?: unknown; message?: undefined }
  | { ok: false; status: number; code: string; message: string; action?: unknown; retryAfter?: number };

const ERROR_COPY: Record<number, [string, string]> = {
  401: ["auth", "Sign in again to continue."],
  404: ["not_found", "That action wasn't found."],
  409: ["already_decided", "That was already decided."],
  410: ["expired", "This request expired. Ask again if you still want it."],
  412: ["changed", "The request changed since you saw it, so it wasn't run."],
  423: ["killed", "Tools are switched off."],
  429: ["rate_limited", "Too many requests. Try again shortly."],
  501: ["not_available", "Tools aren't available on this server yet."],
  503: ["not_available", "Tools aren't available on this server yet."],
};

async function post(path: string, body: unknown, { fetchImpl = globalThis.fetch }: FetchOpts = {}): Promise<DecisionResult> {
  try {
    const headers = await requireChatAuthHeaders({ "Content-Type": "application/json" });
    const res = await fetchImpl(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body ?? {}) });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, status: String(json?.status ?? "ok"), action: json?.action ?? json };
    const [code, message] = ERROR_COPY[res.status] || ["error", "That didn't go through."];
    const retryAfter = typeof json?.retry_after === "number" ? json.retry_after : undefined;
    return { ok: false, status: res.status, code, message, action: json?.action, ...(retryAfter ? { retryAfter } : {}) };
  } catch {
    return { ok: false, status: 0, code: "network", message: "Couldn't reach the server." };
  }
}

export function decideToolAction(
  actionId: string,
  args: { confirmationId: string; decision: "confirm" | "deny"; requestHash: string },
  opts?: FetchOpts,
) {
  return post(
    `/tools/actions/${encodeURIComponent(actionId)}/confirm`,
    { confirmation_id: args.confirmationId, decision: args.decision, request_hash: args.requestHash },
    opts,
  );
}

export function stopToolAction(actionId: string, opts?: FetchOpts) {
  return post(`/tools/actions/${encodeURIComponent(actionId)}/stop`, {}, opts);
}

export function stopAllToolActions(opts?: FetchOpts) {
  return post("/tools/stop", {}, opts);
}

/** Parse SSE text into `data:` JSON payloads (one per event block). */
export function parseSseBlocks(text: string): { rest: string; payloads: unknown[] } {
  const normalized = text.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const payloads: unknown[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // Ignore a malformed frame; the next one carries the full state.
    }
  }
  return { rest, payloads };
}

/**
 * Follow an action after the chat stream closed (e.g. after confirming):
 * GET /tools/actions/:id/events?after_seq=N, an SSE stream of `tool` frames.
 * Resolves when the stream ends or `signal` aborts.
 */
export async function followToolAction(
  actionId: string,
  afterSeq: number,
  onFrame: (frame: unknown) => void,
  { fetchImpl = globalThis.fetch, signal }: FetchOpts & { signal?: AbortSignal } = {},
): Promise<{ ok: boolean; status: number }> {
  try {
    const headers = await requireChatAuthHeaders({ Accept: "text/event-stream" });
    const res = await fetchImpl(
      apiUrl(`/tools/actions/${encodeURIComponent(actionId)}/events?after_seq=${Math.max(0, Math.floor(afterSeq))}`),
      { method: "GET", headers, signal },
    );
    if (!res.ok || !res.body) return { ok: false, status: res.status };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { rest, payloads } = parseSseBlocks(buffer);
      buffer = rest;
      for (const p of payloads) {
        const frame = p && typeof p === "object" && "tool" in (p as object) ? (p as { tool: unknown }).tool : p;
        onFrame(frame);
      }
    }
    return { ok: true, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
