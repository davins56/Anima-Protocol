/**
 * /api/deepnet client. The server decides access (flag + allowlist); any
 * non-2xx from /status means "not available" and the page fetches nothing else.
 */
import { authHeaders } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";
import type { DeepnetMap, QuestView } from "./types";

/** One flat shape (the app tsconfig is non-strict, so union narrowing on `ok` is unreliable). */
export type ApiResult<T> = { ok: boolean; status: number; data: T | null; code?: string };

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(apiUrl(`/deepnet${path}`), {
      method: init.method ?? "GET",
      headers: await authHeaders(init.body === undefined ? undefined : { "Content-Type": "application/json" }),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const json = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => null) : null;
    if (!res.ok) return { ok: false, status: res.status, data: null, code: json?.code };
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const deepnetApi = {
  status: () => call<{ enabled: boolean; allowed: boolean; display_name: string }>("/status"),
  map: (characterId: string) => call<DeepnetMap>(`/map?character_id=${encodeURIComponent(characterId)}`),
  enter: (characterId: string, nodeId: string) =>
    call<{ quest_id: string | null }>("/enter", { method: "POST", body: { character_id: characterId, node_id: nodeId } }),
  quest: (characterId: string, questId: string) =>
    call<QuestView>(`/quest?character_id=${encodeURIComponent(characterId)}&quest_id=${encodeURIComponent(questId)}`),
  step: (characterId: string, questId: string, expectedSeq: number, step: Record<string, unknown>) =>
    call<QuestView>("/quest/events", { method: "POST", body: { character_id: characterId, quest_id: questId, expected_seq: expectedSeq, ...step } }),
};
