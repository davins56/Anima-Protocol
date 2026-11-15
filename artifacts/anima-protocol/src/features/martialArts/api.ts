/**
 * /api/martial-arts client (#768 §6). Every route is 404 when ANIMA_MARTIAL_ARTS
 * is off (or the server half hasn't shipped yet); the client then hides the
 * whole feature. Errors come back as a flat result, never thrown.
 */
import { authHeaders } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";
import type { CharacterStyleView, MartialStatus, PickBody } from "./types";
import type { MartialProfile } from "@workspace/martial-core";

export type ApiResult<T> = { ok: boolean; status: number; data: T | null; code?: string; body?: Record<string, unknown> | null };

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(apiUrl(`/martial-arts${path}`), {
      method: init.method ?? "GET",
      headers: await authHeaders(init.body === undefined ? undefined : { "Content-Type": "application/json" }),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const json = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => null) : null;
    if (!res.ok) return { ok: false, status: res.status, data: null, code: json?.code ?? json?.error, body: json };
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const martialArtsApi = {
  status: () => call<MartialStatus>("/status"),
  character: (characterId: string) => call<CharacterStyleView>(`/characters/${encodeURIComponent(characterId)}`),
  pick: (characterId: string, body: PickBody) =>
    call<{ profile: MartialProfile }>(`/characters/${encodeURIComponent(characterId)}/pick`, { method: "POST", body }),
};

let statusPromise: Promise<boolean> | null = null;

/** Cached for the page lifetime: one /status call, any failure means "off". */
export function martialArtsEnabled(): Promise<boolean> {
  if (!statusPromise) statusPromise = martialArtsApi.status().then((r) => !!(r.ok && r.data?.enabled));
  return statusPromise;
}

/** Test hook. */
export function resetMartialArtsStatus() {
  statusPromise = null;
}

/**
 * D3: the first battle picks automatically. NetBattle is client-only, so it
 * asks the server to make the auto pick (expected_rev 0) when there is no
 * profile yet. A concurrent first battle gets 409 and re-reads the one
 * committed profile, so both converge. Returns null when unavailable.
 */
export async function ensureFirstBattleProfile(characterId: string): Promise<MartialProfile | null> {
  if (!characterId || !(await martialArtsEnabled())) return null;
  const view = await martialArtsApi.character(characterId);
  if (!view.ok || !view.data) return null;
  if (view.data.profile) return view.data.profile;
  const picked = await martialArtsApi.pick(characterId, { action: "auto", expected_rev: 0 });
  if (picked.ok && picked.data?.profile) return picked.data.profile;
  if (picked.status === 409) {
    const again = await martialArtsApi.character(characterId);
    return again.ok ? again.data?.profile ?? null : null;
  }
  return null;
}
