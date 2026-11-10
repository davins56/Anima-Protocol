/**
 * Fetch + parse a companion's uploaded VRM/GLB.
 *
 * `config.model.url` is either the owner-only `/api/vessel/:id/model` route
 * (302 → short-lived signed storage URL) or an allowlisted https .vrm/.glb.
 * We always fetch the *API* URL and read the bytes immediately, so the signed
 * URL is never stored. If the signed hop fails (expired / 400 / 401 / 403) we
 * ask the API again, which mints a fresh one. Bytes (not the signed URL) are
 * cached briefly so the studio canvas and the chat portrait share one download;
 * each renderer parses its own copy so it can own and dispose its scene.
 */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";
import type { VesselConfig } from "./vesselConfig";

export const MODEL_MAX_BYTES = 50 * 1024 * 1024;
const API_MODEL = /^\/api\/vessel\/([^/?#\s]{1,120})\/model$/;
const RETRY_STATUSES = new Set([400, 401, 403]);
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 2;

export type VesselModelMeta = VesselConfig["model"];

export class VesselModelFetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "VesselModelFetchError";
    this.status = status;
  }
}

export function isApiModelUrl(url: string | undefined | null): boolean {
  return typeof url === "string" && API_MODEL.test(url);
}

/** Resolve a stored model URL to the URL the browser should request. */
export function resolveModelRequestUrl(url: string): string {
  const m = url.match(API_MODEL);
  return m ? apiUrl(`/vessel/${m[1]}/model`) : url;
}

/** Cache key: the storage path changes on every replace, so a new upload is a new key. */
export function modelCacheKey(model: Pick<VesselModelMeta, "url" | "path" | "byteSize"> | null | undefined): string {
  if (!model?.url) return "";
  return `${model.url}#${model.path || ""}#${model.byteSize ?? ""}`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * GET the model bytes, following the API's 302. Retries once (by default)
 * against the API URL when the signed hop has expired or been rejected.
 */
export async function fetchVesselModelBytes(
  url: string,
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal; retries?: number; headers?: () => Promise<Record<string, string>> } = {},
): Promise<ArrayBuffer> {
  const doFetch = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const api = isApiModelUrl(url);
  const target = resolveModelRequestUrl(url);
  const retries = Math.max(0, opts.retries ?? 1);
  const headers = opts.headers ?? (() => authHeaders() as Promise<Record<string, string>>);
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Fresh auth headers each attempt (Clerk tokens are short-lived too).
    const init: RequestInit = api
      ? { headers: await headers(), credentials: "same-origin", cache: "no-store", redirect: "follow", signal: opts.signal }
      : { credentials: "omit", redirect: "follow", signal: opts.signal };
    const res = await doFetch(target, init);
    if (res.ok) {
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > MODEL_MAX_BYTES) throw new VesselModelFetchError("Model is larger than 50 MB.", 413);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MODEL_MAX_BYTES) throw new VesselModelFetchError("Model is larger than 50 MB.", 413);
      return buf;
    }
    lastStatus = res.status;
    // 404 (no model) and 5xx are not expiry: don't hammer the API.
    if (!api || !RETRY_STATUSES.has(res.status)) break;
  }
  throw new VesselModelFetchError(lastStatus === 404 ? "No model uploaded." : `Model download failed (HTTP ${lastStatus}).`, lastStatus);
}

const cache = new Map<string, { at: number; promise: Promise<ArrayBuffer> }>();

/** Stable promise per key (React `use()` needs the same promise across renders). */
export function loadVesselModelBytes(url: string, key = url, fetchImpl?: FetchLike): Promise<ArrayBuffer> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetchVesselModelBytes(url, { fetchImpl });
  // Don't keep failures: the next mount should try again.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  cache.set(key, { at: now, promise });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return promise;
}

export function clearVesselModelCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
