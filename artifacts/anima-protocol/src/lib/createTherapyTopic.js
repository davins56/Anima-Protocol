import { base44 } from "@/api/base44Client";
import {
  STORE_TOPIC_CREATE_RETRY_LIMIT,
  STORE_TOPIC_CREATE_TIMEOUT_MS,
} from "@/lib/storeTimeouts";

export const THERAPY_TOPIC_SAVE_FALLBACK =
  "Could not save that topic. Try again.";

/** Keep a just-created topic in local state if a follow-up list refresh races empty. */
export const PENDING_THERAPY_TOPIC_MS = 20000;

export function therapyTopicSaveErrorMessage(err) {
  const msg = String(err?.message || "").trim();
  return msg || THERAPY_TOPIC_SAVE_FALLBACK;
}

export function isRetryableTopicCreateError(err) {
  if (!err) return false;
  if (err.code === "timeout") return true;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  if (err.status === 503) return true;
  return /connection reset/i.test(String(err.message || ""));
}

/**
 * POST /api/store/TherapyTopic with the extended create budget.
 * Retries once on timeout or 503 reset, matching Init's create path.
 * Does not require an Anima.
 */
export async function createTherapyTopic(
  data,
  {
    create = (payload, opts) =>
      base44.entities.TherapyTopic.create(payload, opts),
    timeoutMs = STORE_TOPIC_CREATE_TIMEOUT_MS,
    retryLimit = STORE_TOPIC_CREATE_RETRY_LIMIT,
  } = {},
) {
  const attempts = Math.max(0, retryLimit) + 1;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await create(data, { timeoutMs });
    } catch (err) {
      lastErr = err;
      if (isRetryableTopicCreateError(err) && i < attempts - 1) continue;
      throw err;
    }
  }
  throw lastErr;
}

export function mergePreservedTherapyTopics(listed, previous, pendingIds) {
  const next = Array.isArray(listed) ? listed : [];
  if (!pendingIds?.size) return next;
  const listedIds = new Set(next.map((row) => row?.id).filter(Boolean));
  const preserved = (Array.isArray(previous) ? previous : []).filter(
    (row) => row?.id && pendingIds.has(row.id) && !listedIds.has(row.id),
  );
  if (preserved.length === 0) return next;
  return [...preserved, ...next];
}
