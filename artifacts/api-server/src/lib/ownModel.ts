/**
 * The steward's own model: the from-scratch tiny GPT in `server/server.py`,
 * served over an OpenAI-compatible API that also learns from lessons taught
 * in the app (Settings → Model Tutor, and "Teach" on a chat reply).
 *
 * Chats route here only for stewards who switched on "Answer my chats with
 * my model", and only while ANIMA_OWN_LLM_BASE_URL is set. Everyone else
 * stays on the normal Anima chain. Like the custom Anima LLM this is
 * fail-closed: a down host is an error the steward sees, never a silent
 * switch to another model.
 *
 * Base URL and key are API-host env only (`ANIMA_OWN_LLM_BASE_URL`,
 * `ANIMA_OWN_LLM_API_KEY`) — never ship them to the browser.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { MsgData } from "@workspace/db";
import { LlmStreamTimeoutError } from "./consumeLlmStream";
import type { ChatStreamResult } from "./llmFailover";
import {
  isLoopbackLlmHost,
  isLoopbackUnreachableRuntime,
  normalizeApiKey,
} from "./openaiClient";
import { buildLlmChatMessages } from "./promptBuilder";
import { callerIsProtocolSteward } from "./protocolUpgradeAuth";

export const OWN_MODEL_DEFAULT_ID = "anima-own";

/** Sampling temperature for own-model chat turns (see chat.ts). */
export const OWN_MODEL_TEMPERATURE = 0.6;

/** Shown in place of an empty reply so the steward can still teach that turn. */
export const OWN_MODEL_EMPTY_REPLY = "…";

export const OWN_MODEL_NOT_CONFIGURED_HINT =
  "Your own model is not connected. Set ANIMA_OWN_LLM_BASE_URL (its public https …/v1 URL) " +
  "and ANIMA_OWN_LLM_API_KEY (its ANIMA_SERVER_TOKEN) on the API host. See docs/own-model.md.";

export const OWN_MODEL_UNAVAILABLE_HINT =
  "Your own model isn't reachable right now. Start server/server.py (or check " +
  "ANIMA_OWN_LLM_BASE_URL on the API host), or turn off “Answer my chats with my model” " +
  "in Settings → Model Tutor.";

export const OWN_MODEL_AUTH_HINT =
  "Your own model rejected the API key. ANIMA_OWN_LLM_API_KEY on the API host must equal " +
  "ANIMA_SERVER_TOKEN on the model server.";

export const OWN_MODEL_TIMEOUT_HINT =
  "Your own model took too long to reply. It may still be starting — try again in a moment.";

export class OwnModelError extends Error {
  status?: number;
  code?: string;
  constructor(
    message: string,
    opts: { status?: number; code?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "OwnModelError";
    this.status = opts.status;
    this.code = opts.code;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

function urlIsLoopback(raw: string): boolean {
  try {
    return isLoopbackLlmHost(new URL(raw).hostname);
  } catch {
    return true;
  }
}

/**
 * OpenAI-compatible base URL (ends with /v1), or null when unset. A loopback
 * URL on Workers / Vercel / Cloud Run counts as unset: those runtimes cannot
 * reach the operator's laptop.
 */
export function ownModelBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  globalObj: typeof globalThis = globalThis,
): string | null {
  const raw = env.ANIMA_OWN_LLM_BASE_URL?.trim();
  if (!raw) return null;
  const base = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  if (isLoopbackUnreachableRuntime(env, globalObj) && urlIsLoopback(base)) {
    return null;
  }
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export function ownModelConfigured(
  env: NodeJS.ProcessEnv = process.env,
  globalObj: typeof globalThis = globalThis,
): boolean {
  return Boolean(ownModelBaseUrl(env, globalObj));
}

export function ownModelId(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANIMA_OWN_LLM_MODEL?.trim() || OWN_MODEL_DEFAULT_ID;
}

function ownModelApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeApiKey(env.ANIMA_OWN_LLM_API_KEY);
}

let cachedClient: { signature: string; client: OpenAI } | null = null;

function ownModelClient(env: NodeJS.ProcessEnv = process.env): OpenAI {
  const baseURL = ownModelBaseUrl(env);
  if (!baseURL) throw new OwnModelError(OWN_MODEL_NOT_CONFIGURED_HINT, { code: "not_configured" });
  const apiKey = ownModelApiKey(env) || "anima-own";
  const signature = `${baseURL}\n${apiKey}`;
  if (cachedClient?.signature !== signature) {
    cachedClient = {
      signature,
      client: new OpenAI({ baseURL, apiKey, maxRetries: 0 }),
    };
  }
  return cachedClient.client;
}

export function resetOwnModelForTests(): void {
  cachedClient = null;
  stewardCache.clear();
}

function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** Turn any failure on the own-model path into a message the steward can act on. */
export function asOwnModelError(err: unknown): OwnModelError {
  if (err instanceof OwnModelError) return err;
  if (err instanceof LlmStreamTimeoutError) {
    return new OwnModelError(OWN_MODEL_TIMEOUT_HINT, { code: "timeout", cause: err });
  }
  const status = errorStatus(err);
  if (status === 401 || status === 403) {
    return new OwnModelError(OWN_MODEL_AUTH_HINT, { status, code: "authentication_error", cause: err });
  }
  const name = String((err as { name?: unknown } | null)?.name || "");
  if (name === "AbortError" || name === "TimeoutError" || name === "APIConnectionTimeoutError") {
    return new OwnModelError(OWN_MODEL_TIMEOUT_HINT, { code: "timeout", cause: err });
  }
  if (status === undefined || status === 502 || status === 503 || status === 504) {
    return new OwnModelError(OWN_MODEL_UNAVAILABLE_HINT, { status, code: "unreachable", cause: err });
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new OwnModelError(`Your own model could not reply: ${detail.slice(0, 200)}`, {
    status,
    code: "model_error",
    cause: err,
  });
}

/**
 * Compact prompt for the own model. Its context is ~256 tokens, so the
 * character sheet and memory block the big model gets would only crowd out
 * the conversation. Lessons are taught on this same shape (history + the
 * user's turn), so keep the two in step.
 */
export function buildOwnModelMessages(
  recentMessages: MsgData[],
  content: string,
): ChatCompletionMessageParam[] {
  return buildLlmChatMessages({
    systemPrompt: "",
    recentMessages,
    content,
    includeHistory: true,
  });
}

export async function createOwnModelChatStream(req: {
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<ChatStreamResult> {
  const model = ownModelId();
  try {
    const stream = await ownModelClient().chat.completions.create(
      {
        model,
        messages: req.messages,
        stream: true,
        max_tokens: Math.max(1, Math.floor(req.maxTokens)),
        ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
      },
      req.signal ? { signal: req.signal } : undefined,
    );
    return {
      stream,
      provider: "own",
      brand: "own",
      model,
      tier: "standard",
      failedOver: false,
    };
  } catch (err) {
    throw asOwnModelError(err);
  }
}

// ------------------------------------------------------------------ routing

const STEWARD_CACHE_MS = 10 * 60_000;
const stewardCache = new Map<string, { allowed: boolean; at: number }>();

/** Steward check for the chat hot path: a Clerk lookup at most every 10 min. */
export async function callerIsStewardCached(input: {
  userId: string;
  sessionClaims?: unknown;
}): Promise<boolean> {
  const hit = stewardCache.get(input.userId);
  if (hit && Date.now() - hit.at < STEWARD_CACHE_MS) return hit.allowed;
  const { allowed } = await callerIsProtocolSteward(input);
  stewardCache.set(input.userId, { allowed, at: Date.now() });
  return allowed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The steward's "Answer my chats with my model" switch, from their profile. */
export function ownModelChatPreference(profile: unknown): boolean {
  return asRecord(asRecord(profile).model_tutor).own_model_chat === true;
}

/**
 * True when this turn should be answered by the steward's own model. The
 * profile is writable by its owner through the generic store, so the switch
 * alone is not enough: the caller must also be a steward.
 */
export async function wantsOwnModelReply(input: {
  userId: string;
  sessionClaims?: unknown;
  profile: unknown;
}): Promise<boolean> {
  if (!ownModelConfigured()) return false;
  if (!ownModelChatPreference(input.profile)) return false;
  return callerIsStewardCached(input);
}

// ------------------------------------------------------------------ lessons API

export interface OwnModelJob {
  status: "queued" | "running" | "done" | "failed";
  job_id: string;
  kind: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  progress?: Record<string, unknown> | null;
  version?: number | null;
}

export interface OwnModelStatus {
  model: string;
  version: number;
  base: string;
  params: number;
  block_size: number;
  device: string;
  lessons_stored: number;
  lessons_learned: number;
  learned_ids: string[];
  /** Deleted lessons the live weights still carry until the next sync. */
  forgotten_pending?: number;
  training: boolean;
  queue: number;
  current_job: Record<string, unknown> | null;
  recent_jobs: Record<string, unknown>[];
  can_rollback: boolean;
}

export interface OwnModelLessonPayload {
  id: string;
  messages: { role: string; content: string }[];
  chosen: string;
  rejected?: string | null;
  created_at?: number;
}

async function ownModelRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs: number },
): Promise<{ status: number; body: T }> {
  const base = ownModelBaseUrl();
  if (!base) throw new OwnModelError(OWN_MODEL_NOT_CONFIGURED_HINT, { code: "not_configured" });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const key = ownModelApiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method || "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (err) {
    throw asOwnModelError(err);
  }
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.status === 401) {
    throw new OwnModelError(OWN_MODEL_AUTH_HINT, { status: 401, code: "authentication_error" });
  }
  if (!res.ok) {
    const detail = asRecord(parsed).detail;
    const message =
      typeof detail === "string" && detail.trim()
        ? detail.trim()
        : `HTTP ${res.status}`;
    if (res.status >= 502 && res.status <= 504) {
      throw new OwnModelError(OWN_MODEL_UNAVAILABLE_HINT, { status: res.status, code: "unreachable" });
    }
    // A failed learning job still reports its job body; keep it on the error.
    const error = new OwnModelError(`Your own model: ${message}`, {
      status: res.status,
      code: res.status === 403 ? "learning_disabled" : "model_error",
    });
    (error as OwnModelError & { body?: unknown }).body = parsed;
    throw error;
  }
  return { status: res.status, body: parsed as T };
}

/** Learning waits happen on the model server; the HTTP call gets a little longer. */
function waitTimeoutMs(waitSeconds: number): number {
  return Math.round(waitSeconds * 1000) + 10_000;
}

export async function ownModelStatus(timeoutMs = 8_000): Promise<OwnModelStatus> {
  const { body } = await ownModelRequest<OwnModelStatus>("/lessons/status", { timeoutMs });
  return body;
}

export async function teachOwnModel(
  lesson: OwnModelLessonPayload,
  waitSeconds = 15,
): Promise<OwnModelJob> {
  const { body } = await ownModelRequest<OwnModelJob>("/lessons", {
    method: "POST",
    body: { ...lesson, wait: waitSeconds },
    timeoutMs: waitTimeoutMs(waitSeconds),
  });
  return body;
}

export async function ownModelJob(jobId: string): Promise<OwnModelJob> {
  const { body } = await ownModelRequest<OwnModelJob>(
    `/lessons/jobs/${encodeURIComponent(jobId)}`,
    { timeoutMs: 8_000 },
  );
  return body;
}

export async function forgetOwnModelLesson(
  lessonId: string,
): Promise<{ removed: boolean; was_learned: boolean }> {
  const { body } = await ownModelRequest<{ removed: boolean; was_learned: boolean }>(
    `/lessons/${encodeURIComponent(lessonId)}`,
    { method: "DELETE", timeoutMs: 8_000 },
  );
  return body;
}

export async function syncOwnModelLessons(
  lessons: OwnModelLessonPayload[],
  waitSeconds = 0,
): Promise<OwnModelJob> {
  const { body } = await ownModelRequest<OwnModelJob>("/lessons/sync", {
    method: "POST",
    body: { lessons, rebuild: true, wait: waitSeconds },
    timeoutMs: waitTimeoutMs(waitSeconds) + 20_000,
  });
  return body;
}

export async function rollbackOwnModel(waitSeconds = 10): Promise<OwnModelJob> {
  const { body } = await ownModelRequest<OwnModelJob>("/lessons/rollback", {
    method: "POST",
    body: { wait: waitSeconds },
    timeoutMs: waitTimeoutMs(waitSeconds),
  });
  return body;
}
