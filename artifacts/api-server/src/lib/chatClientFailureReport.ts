import { logger } from "./logger";
import {
  CHAT_FAILURE_PHASES,
  chatFailureTypeById,
  isChatFailurePhase,
  type ChatFailurePhase,
} from "./chatFailureTypes";

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const MAX_MS = 3_600_000;
const MAX_UA = 180;
const DEDUPE_MS = 10 * 60 * 1000;

const seen = new Map<string, number>();

export function resetChatClientFailureReportsForTests(): void {
  seen.clear();
}

export type ChatClientFailureLog = {
  event: "chat_client_failure";
  failure_type: string;
  phase: ChatFailurePhase;
  failure_phase: ChatFailurePhase;
  turn_id: string | null;
  session_id: string;
  ms_to_failure: number;
  ms_to_first_token: number | null;
  partial_kept: boolean;
  app_version: string | null;
  user_agent: string | null;
  user_id: string;
};

export type ChatClientFailureOutcome =
  | { ok: true; duplicate: boolean; log: ChatClientFailureLog | null }
  | { ok: false; status: number; error: string };

function cleanId(value: unknown): string {
  const text = String(value ?? "").trim();
  return ID_RE.test(text) ? text : "";
}

function cleanVersion(value: unknown): string {
  const text = String(value ?? "").trim();
  return VERSION_RE.test(text) ? text : "";
}

function cleanUserAgent(value: unknown): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_UA);
}

function cleanMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_MS) return null;
  return Math.round(value);
}

function remember(key: string, now: number): boolean {
  const prev = seen.get(key);
  if (prev != null && now - prev < DEDUPE_MS) return false;
  seen.set(key, now);
  if (seen.size > 500) {
    const oldest = seen.keys().next().value;
    if (oldest) seen.delete(oldest);
  }
  return true;
}

/**
 * Validate an allowlisted client failure report and log one structured line.
 * Unknown fields, including any message or memory text, are dropped.
 */
export function recordChatClientFailure(input: {
  userId: string;
  body: unknown;
  userAgent?: string;
  now?: number;
}): ChatClientFailureOutcome {
  const body =
    input.body && typeof input.body === "object" && !Array.isArray(input.body)
      ? (input.body as Record<string, unknown>)
      : null;
  if (!body) return { ok: false, status: 400, error: "Invalid chat failure report" };

  const failureType = chatFailureTypeById(body.failure_type);
  if (!failureType || !isChatFailurePhase(body.phase)) {
    return { ok: false, status: 400, error: "Invalid chat failure report" };
  }
  if (!(CHAT_FAILURE_PHASES as readonly string[]).includes(body.phase)) {
    return { ok: false, status: 400, error: "Invalid chat failure report" };
  }
  const sessionId = cleanId(body.session_id);
  if (!sessionId) return { ok: false, status: 400, error: "Invalid chat failure report" };
  const turnId = body.turn_id == null || body.turn_id === "" ? "" : cleanId(body.turn_id);
  if (body.turn_id != null && body.turn_id !== "" && !turnId) {
    return { ok: false, status: 400, error: "Invalid chat failure report" };
  }
  const msToFailure = cleanMs(body.ms_to_failure);
  if (msToFailure == null) {
    return { ok: false, status: 400, error: "Invalid chat failure report" };
  }
  const msToFirst =
    body.ms_to_first_token == null ? null : cleanMs(body.ms_to_first_token);
  if (body.ms_to_first_token != null && msToFirst == null) {
    return { ok: false, status: 400, error: "Invalid chat failure report" };
  }
  if (typeof body.partial_kept !== "boolean") {
    return { ok: false, status: 400, error: "Invalid chat failure report" };
  }

  const phase = body.phase;
  const userId = cleanId(input.userId) || "user";
  const log: ChatClientFailureLog = {
    event: "chat_client_failure",
    failure_type: failureType.id,
    phase,
    failure_phase: phase,
    turn_id: turnId || null,
    session_id: sessionId,
    ms_to_failure: msToFailure,
    ms_to_first_token: msToFirst,
    partial_kept: body.partial_kept,
    app_version: cleanVersion(body.app_version) || null,
    user_agent: cleanUserAgent(body.user_agent || input.userAgent) || null,
    user_id: userId,
  };

  const now = input.now ?? Date.now();
  const key = `${userId}|${log.turn_id || log.session_id}|${log.failure_type}`;
  if (!remember(key, now)) return { ok: true, duplicate: true, log: null };

  logger.info(log, "chat_client_failure");
  return { ok: true, duplicate: false, log };
}
