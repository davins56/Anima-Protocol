/**
 * Chat upgrade 4: calls for the user's decisions on tool actions, per the
 * agreed contract (tools-guardrails-plan.md §4.3–4.5 + addendum) and the
 * server contract in chat-upgrade-server-contracts.md §3. The browser
 * never starts a tool here; it confirms, denies, stops, or replays.
 */
import { requireChatAuthHeaders } from "@/api/animaApi";
import { apiUrl } from "@/lib/apiOrigin";

type FetchOpts = { fetchImpl?: typeof fetch };

export type DecisionResult =
  | { ok: true; status: string; action?: unknown; message?: undefined }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      action?: unknown;
      retryAfter?: number;
      /** 423 from the global or per-user kill switch. Stop still works. */
      killed?: boolean;
      /** 503 `tools_disabled`: ANIMA_TOOLS is off on the server. */
      disabled?: boolean;
    };

const ERROR_COPY: Record<number, [string, string]> = {
  401: ["auth", "Sign in again to continue."],
  404: ["not_found", "That action wasn't found."],
  409: ["already_decided", "That was already decided."],
  410: ["expired", "This request expired. Ask again if you still want it."],
  412: ["changed", "The request changed since you saw it, so it wasn't run."],
  423: ["killed", "Tools are switched off (kill switch). Stop still works."],
  429: ["rate_limited", "Too many requests. Try again shortly."],
  501: ["not_available", "That isn't available on this server yet."],
  503: ["not_available", "Tools aren't available on this server right now."],
};

/** Server `error` codes from the tools contract (§3.2) with their own copy. */
const CODE_COPY: Record<string, string> = {
  tools_disabled: "Tools are off on this server.",
  tools_schema_missing: "Tools aren't set up on this server yet.",
  killed: "Tools are switched off (kill switch). Stop still works.",
  preview_not_available: "Page preview isn't available yet. It comes in a later phase.",
};

/** Turn a non-OK response into a DecisionResult. Exported for tests. */
export function errorResult(status: number, json: Record<string, unknown> | null): DecisionResult & { ok: false } {
  const [fallbackCode, fallbackMessage] = ERROR_COPY[status] || ["error", "That didn't go through."];
  const serverCode = typeof json?.error === "string" ? json.error : "";
  const code = serverCode && CODE_COPY[serverCode] ? serverCode : fallbackCode;
  const message = (serverCode && CODE_COPY[serverCode]) || fallbackMessage;
  const retryAfter = typeof json?.retry_after === "number" ? json.retry_after : undefined;
  const killed = status === 423 || json?.killed === true;
  const disabled = status === 503 && serverCode === "tools_disabled";
  return {
    ok: false,
    status,
    code: killed ? "killed" : code,
    message: killed ? CODE_COPY.killed : message,
    action: json?.action,
    ...(retryAfter ? { retryAfter } : {}),
    ...(killed ? { killed: true } : {}),
    ...(disabled ? { disabled: true } : {}),
  };
}

async function request(
  method: "GET" | "POST" | "PUT",
  path: string,
  body: unknown,
  { fetchImpl = globalThis.fetch }: FetchOpts = {},
): Promise<DecisionResult & { json?: Record<string, unknown> | null }> {
  try {
    const headers = await requireChatAuthHeaders(method === "GET" ? {} : { "Content-Type": "application/json" });
    const res = await fetchImpl(apiUrl(path), {
      method,
      headers,
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, status: String(json?.status ?? "ok"), action: json?.action ?? json, json };
    return errorResult(res.status, json);
  } catch {
    return { ok: false, status: 0, code: "network", message: "Couldn't reach the server." };
  }
}

function post(path: string, body: unknown, opts?: FetchOpts): Promise<DecisionResult> {
  return request("POST", path, body, opts);
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

/**
 * Per-companion tool settings (§3.2): GET /api/tools/settings?character_id=.
 * Read-only here; the Settings UI is still on hold. Settings changes are not
 * written to the action log in v1 (the server relies on updated_at).
 */
export async function fetchToolSettings(characterId: string, opts?: FetchOpts) {
  const res = await request("GET", `/tools/settings?character_id=${encodeURIComponent(characterId)}`, null, opts);
  if (!res.ok) return res;
  return { ...res, settings: res.json ?? null };
}

/**
 * GET /api/tools/actions/:id/preview. Returns 501 `preview_not_available`
 * until phase 3; callers show `message` as is.
 */
export async function fetchToolPreview(actionId: string, opts?: FetchOpts) {
  const res = await request("GET", `/tools/actions/${encodeURIComponent(actionId)}/preview`, null, opts);
  if (!res.ok) return res;
  return { ...res, preview: res.json ?? null };
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
): Promise<{ ok: boolean; status: number; killed?: boolean; disabled?: boolean }> {
  try {
    const headers = await requireChatAuthHeaders({ Accept: "text/event-stream" });
    const res = await fetchImpl(
      apiUrl(`/tools/actions/${encodeURIComponent(actionId)}/events?after_seq=${Math.max(0, Math.floor(afterSeq))}`),
      { method: "GET", headers, signal },
    );
    if (!res.ok || !res.body) {
      const json = res.ok ? null : ((await res.json().catch(() => null)) as Record<string, unknown> | null);
      const err = res.ok ? null : errorResult(res.status, json);
      return { ok: false, status: res.status, ...(err?.killed ? { killed: true } : {}), ...(err?.disabled ? { disabled: true } : {}) };
    }
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
