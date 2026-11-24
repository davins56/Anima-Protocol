/**
 * Chat upgrade 4: front end for the user-commanded tool loop.
 *
 * Contract: /workspace/audits/tools-guardrails-plan.md §4 plus the
 * "API changes agreed with Builder (2026-11-10)" addendum. Summary:
 *  - The chat SSE stream carries `{ tool: {...} }` frames (one per state
 *    change) with a per-action `seq` that increases. `done.tool_actions` lists
 *    the action ids of the turn.
 *  - event: started | confirmation_required | progress | succeeded | failed |
 *           denied | expired | stopped
 *  - confirmation: { id, action_kind, expires_at, request_hash, target,
 *                    payload_summary, amount?, currency? }
 *  - result.sources: [{ id, title, url, snippet, site_name? }], cited as [n].
 *
 * Only an explicit command or button triggers a tool; this module never starts
 * one. It only shows what the server reports and sends the user's decisions.
 * Behind VITE_ANIMA_TOOLS (off by default).
 */

export function toolsUiEnabled(env: Record<string, unknown> | undefined = import.meta.env): boolean {
  const raw = String(env?.VITE_ANIMA_TOOLS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export const TOOL_EVENTS = [
  "started",
  "confirmation_required",
  "progress",
  "succeeded",
  "failed",
  "denied",
  "expired",
  "stopped",
] as const;
export type ToolEvent = (typeof TOOL_EVENTS)[number];

export const TERMINAL_EVENTS: ReadonlySet<ToolEvent> = new Set(["succeeded", "failed", "denied", "expired", "stopped"]);

export interface ToolSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  site_name?: string;
}

export interface ToolConfirmation {
  id: string;
  action_kind: string;
  expires_at: string;
  request_hash: string;
  target: string;
  payload_summary: string;
  amount?: number | null;
  currency?: string | null;
}

export interface ToolAction {
  action_id: string;
  tool: string;
  turn_id: string | null;
  user_message_id: string | null;
  seq: number;
  event: ToolEvent;
  summary: string;
  reason: string | null;
  confirmation: ToolConfirmation | null;
  sources: ToolSource[];
  result: { title?: string; url?: string; count?: number } | null;
  /** Local-only: the user pressed confirm/deny/stop and the request is in flight. */
  pending?: "confirm" | "deny" | "stop" | null;
  /** Local-only: last error from a user decision. */
  error?: string | null;
}

export type ToolActionMap = Record<string, ToolAction>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Only http(s) links are ever rendered as links. */
export function safeHttpUrl(raw: unknown): string | null {
  const s = str(raw).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseSources(raw: unknown): ToolSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolSource[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const url = safeHttpUrl(r.url);
    if (!url) continue;
    out.push({
      id: str(r.id) || String(out.length + 1),
      title: str(r.title).slice(0, 300) || url,
      url,
      snippet: str(r.snippet).slice(0, 600),
      ...(str(r.site_name) ? { site_name: str(r.site_name).slice(0, 120) } : {}),
    });
  }
  return out;
}

function parseConfirmation(raw: unknown): ToolConfirmation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const hash = str(r.request_hash);
  if (!id || !hash) return null;
  const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : null;
  return {
    id,
    action_kind: str(r.action_kind) || "submit",
    expires_at: str(r.expires_at),
    request_hash: hash,
    target: str(r.target).slice(0, 300),
    payload_summary: str(r.payload_summary).slice(0, 4000),
    amount,
    currency: str(r.currency) || null,
  };
}

/** Validate one `tool` frame from the stream or the replay endpoint. */
export function parseToolFrame(raw: unknown): Omit<ToolAction, "pending" | "error"> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const actionId = str(r.action_id);
  const event = str(r.event) as ToolEvent;
  const seq = typeof r.seq === "number" && Number.isInteger(r.seq) ? r.seq : NaN;
  if (!actionId || !(TOOL_EVENTS as readonly string[]).includes(event) || !(seq >= 1)) return null;
  const result = r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : null;
  return {
    action_id: actionId,
    tool: str(r.tool) || "tool",
    turn_id: str(r.turn_id) || null,
    user_message_id: str(r.user_message_id) || null,
    seq,
    event,
    summary: str(r.summary).slice(0, 500),
    reason: str(r.reason) || null,
    confirmation: parseConfirmation(r.confirmation),
    sources: parseSources(result?.sources),
    result: result
      ? {
          ...(str(result.title) ? { title: str(result.title) } : {}),
          ...(safeHttpUrl(result.url) ? { url: safeHttpUrl(result.url) as string } : {}),
          ...(typeof result.count === "number" ? { count: result.count } : {}),
        }
      : null,
  };
}

/**
 * Fold one frame into the map. Frames at or below the action's current seq
 * are ignored (replays and duplicates), and nothing follows a terminal event.
 * A later frame keeps the confirmation and sources it doesn't repeat.
 */
export function applyToolFrame(map: ToolActionMap, raw: unknown): ToolActionMap {
  const frame = parseToolFrame(raw);
  if (!frame) return map;
  const prev = map[frame.action_id];
  if (prev && (frame.seq <= prev.seq || TERMINAL_EVENTS.has(prev.event))) return map;
  const next: ToolAction = {
    ...frame,
    summary: frame.summary || prev?.summary || "",
    confirmation: frame.confirmation || (frame.event === "confirmation_required" ? null : prev?.confirmation ?? null),
    sources: frame.sources.length ? frame.sources : prev?.sources ?? [],
    result: frame.result || prev?.result || null,
    pending: null,
    error: null,
  };
  return { ...map, [frame.action_id]: next };
}

/** Mark a user decision as in flight, or record its error. */
export function patchAction(map: ToolActionMap, actionId: string, patch: Partial<ToolAction>): ToolActionMap {
  const prev = map[actionId];
  if (!prev) return map;
  return { ...map, [actionId]: { ...prev, ...patch } };
}

export function isWaitingForUser(action: ToolAction, now = Date.now()): boolean {
  if (action.event !== "confirmation_required" || !action.confirmation) return false;
  const exp = Date.parse(action.confirmation.expires_at);
  return !Number.isFinite(exp) || exp > now;
}

export function canStop(action: ToolAction): boolean {
  return !TERMINAL_EVENTS.has(action.event);
}

const REASON_COPY: Record<string, string> = {
  not_allowed: "This tool isn't allowed for this companion.",
  killed: "Tools are switched off.",
  limit: "Daily limit reached.",
  ssrf_blocked: "That address isn't allowed.",
  not_user_turn: "Tools only run when you ask for them.",
  user_denied: "You said no.",
  user_stop: "You stopped it.",
  rate_limited: "Too many requests. Try again shortly.",
};

export function reasonText(reason: string | null): string {
  if (!reason) return "";
  return REASON_COPY[reason] || reason.replace(/_/g, " ");
}

export function statusText(action: ToolAction): string {
  switch (action.event) {
    case "started":
      return "Working…";
    case "progress":
      return "Working…";
    case "confirmation_required":
      return "Waiting for you";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "denied":
      return "Not run";
    case "expired":
      return "Expired";
    case "stopped":
      return "Stopped";
    default:
      return "";
  }
}

/** Actions for one turn, oldest first (by first-seen order of the map). */
export function actionsForTurn(map: ToolActionMap, turnId: string | null | undefined): ToolAction[] {
  if (!turnId) return [];
  return Object.values(map).filter((a) => a.turn_id === turnId);
}
