/**
 * Minimal fal.ai queue client (no SDK — keeps the Worker bundle lean).
 *
 * Flow: POST https://queue.fal.run/{model} → { request_id, status_url, response_url }
 * then GET {status_url}/stream?logs=1 (SSE) until COMPLETED, then GET response_url.
 * Docs: https://fal.ai/docs/documentation/model-apis/inference/queue
 */
import { normalizeApiKey } from "../openaiClient";

export const FAL_QUEUE_BASE = "https://queue.fal.run";

export type FalSubmit = {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
};

export type FalStatus = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | string;
  queue_position?: number;
  logs?: Array<{ message: string }> | null;
  error?: string;
  error_type?: string;
};

export type FalImage = { url: string; width?: number; height?: number; content_type?: string };
export type FalResult = { images?: FalImage[]; image?: FalImage; seed?: number; has_nsfw_concepts?: boolean[] };

export function falApiKey(): string | null {
  return normalizeApiKey(process.env.FAL_KEY) || normalizeApiKey(process.env.FAL_API_KEY);
}

export function hasFalKey(): boolean {
  return Boolean(falApiKey());
}

function falError(message: string, status = 502, code = "server_error"): Error {
  return Object.assign(new Error(message), { status, code });
}

function headers(): Record<string, string> {
  const key = falApiKey();
  if (!key) throw falError("FAL_KEY is not configured.", 503, "auth_error");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

export async function falSubmit(model: string, input: Record<string, unknown>): Promise<FalSubmit> {
  const res = await fetch(`${FAL_QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? "auth_error" : res.status === 429 ? "rate_limit" : res.status === 422 ? "invalid_request" : "server_error";
    throw falError(`fal submit failed (${res.status}): ${text.slice(0, 300)}`, res.status === 422 ? 400 : 502, code);
  }
  return JSON.parse(text) as FalSubmit;
}

/** Yields status objects from the fal SSE status stream until COMPLETED. */
export async function* falStatusStream(statusUrl: string, signal?: AbortSignal): AsyncGenerator<FalStatus> {
  const res = await fetch(`${statusUrl}/stream?logs=1`, { headers: headers(), signal });
  if (!res.ok || !res.body) throw falError(`fal status stream failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop() ?? "";
    for (const line of done ? [...lines, buffer] : lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const status = JSON.parse(trimmed.slice(5).trim()) as FalStatus;
        yield status;
        if (status.status === "COMPLETED") {
          await reader.cancel().catch(() => {});
          return;
        }
      } catch {
        // keep-alive or partial line
      }
    }
    if (done) return;
  }
}

export async function falResult(responseUrl: string): Promise<FalResult> {
  const res = await fetch(responseUrl, { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw falError(`fal result failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as FalResult;
}

export function firstImage(result: FalResult): FalImage | null {
  return result.images?.[0] || result.image || null;
}
