import { base44, uploadDataUrl } from "@/api/base44Client";
import { isRetryableStoreWriteError } from "@/lib/storeErrorSignals";
import {
  STORE_COMPANION_CREATE_RETRY_LIMIT,
  STORE_COMPANION_CREATE_TIMEOUT_MS,
} from "@/lib/storeTimeouts";

/**
 * Shown after Character/Anima create aborts (including the one retry) and no
 * just-written row can be recovered. Distinct from the generic storeFetch
 * toast so a successful-but-slow save is not reported as a connection failure.
 */
export const COMPANION_CREATE_TIMEOUT_MESSAGE =
  "Saving this companion timed out. The store is reachable — try again in a moment.";

export const COMPANION_CREATE_FALLBACK =
  "Could not save this companion. Try again.";

/** Recover a write that finished after the client aborted. */
export const PENDING_COMPANION_CREATE_MS = 60000;

export function isCompanionCreateTimeoutError(err) {
  if (!err) return false;
  if (err.code === "timeout") return true;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  return /took too long to respond/i.test(String(err.message || ""));
}

export function companionCreateErrorMessage(err) {
  if (isCompanionCreateTimeoutError(err)) return COMPANION_CREATE_TIMEOUT_MESSAGE;
  const msg = String(err?.message || "").trim();
  return msg || COMPANION_CREATE_FALLBACK;
}

export function normalizeCompanionName(name) {
  return String(name || "").trim().toLowerCase();
}

function createdMs(row) {
  const raw = row?.created_date || row?.createdAt || 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Newest roster row with this name written inside the pending window. */
export function matchJustCreatedCompanion(
  rows,
  name,
  now = Date.now(),
) {
  const needle = normalizeCompanionName(name);
  if (!needle) return null;
  const cutoff = now - PENDING_COMPANION_CREATE_MS;
  const matches = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row?.id) return false;
    if (normalizeCompanionName(row.name) !== needle) return false;
    const created = createdMs(row);
    return created >= cutoff;
  });
  matches.sort((a, b) => createdMs(b) - createdMs(a));
  return matches[0] || null;
}

async function recoverCreatedCompanion(name, list) {
  if (!normalizeCompanionName(name) || typeof list !== "function") return null;
  try {
    const rows = await list("-created_date", 50, { _bootstrapInternal: true });
    return matchJustCreatedCompanion(rows, name);
  } catch {
    return null;
  }
}

function rosterEntity(entityName) {
  return entityName === "Character" ? "Character" : "Anima";
}

/**
 * Drop inline data-URL portraits before POST. A multi-MB avatar_url on
 * /api/store/Character is what used to blow the 8s client abort on Workers.
 */
export async function persistCompanionAvatarUrl(url, persist) {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) return "";
  if (!trimmed.startsWith("data:")) return trimmed;
  const upload = typeof persist === "function" ? persist : uploadDataUrl;
  if (typeof upload !== "function") return "";
  try {
    return await upload(trimmed);
  } catch {
    return "";
  }
}

/**
 * POST /api/store/Character or /Anima with the extended create budget.
 * Retries once on timeout or 503 reset. If the write landed after abort,
 * returns the recovered row instead of the generic timeout toast.
 */
export async function createCompanionRecord(
  entityName,
  data,
  {
    create,
    list,
    persistAvatar,
    timeoutMs = STORE_COMPANION_CREATE_TIMEOUT_MS,
    retryLimit = STORE_COMPANION_CREATE_RETRY_LIMIT,
  } = {},
) {
  const entity = rosterEntity(entityName);
  const createFn =
    create ||
    ((payload, opts) => base44.entities[entity].create(payload, opts));
  const listFn =
    list ||
    ((sort, limit, opts) => base44.entities[entity].list(sort, limit, opts));

  const payload = { ...(data || {}) };
  payload.avatar_url = await persistCompanionAvatarUrl(
    payload.avatar_url,
    persistAvatar,
  );

  const attempts = Math.max(0, retryLimit) + 1;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await createFn(payload, { timeoutMs });
    } catch (err) {
      lastErr = err;
      if (isRetryableStoreWriteError(err)) {
        const recovered = await recoverCreatedCompanion(payload.name, listFn);
        if (recovered) return recovered;
        if (i < attempts - 1) continue;
      }
      if (isCompanionCreateTimeoutError(err)) {
        const timeoutErr = new Error(COMPANION_CREATE_TIMEOUT_MESSAGE);
        timeoutErr.code = "timeout";
        timeoutErr.cause = err;
        throw timeoutErr;
      }
      throw err;
    }
  }
  const recovered = await recoverCreatedCompanion(payload.name, listFn);
  if (recovered) return recovered;
  if (isCompanionCreateTimeoutError(lastErr)) {
    const timeoutErr = new Error(COMPANION_CREATE_TIMEOUT_MESSAGE);
    timeoutErr.code = "timeout";
    timeoutErr.cause = lastErr;
    throw timeoutErr;
  }
  throw lastErr;
}
