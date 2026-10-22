/** Client for /api/voice/* — the xAI key stays in the Worker; we only get ephemeral tokens. */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...(await authHeaders()), "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, code: body?.code });
  return body as T;
}

export type VoiceSessionGrant = {
  token: string;
  expires_at: number;
  url: string;
  model: string;
  session: Record<string, unknown>;
  voice_version: number | null;
};

export type CharacterVoice = { voice_id: string; voice_kind: "builtin" | "custom"; display_name: string | null; version: number };

export const fetchVoiceStatus = () => call<{ enabled: boolean; model: string }>("/voice/status");
export const fetchVoices = () => call<{ voices: Array<{ voice_id: string; name: string; language: string | null }> }>("/voice/voices");
export const fetchCharacterVoice = (id: string) => call<{ voice: CharacterVoice | null; enabled: boolean }>(`/voice/${encodeURIComponent(id)}`);
export const setCharacterVoice = (id: string, body: { voice_id: string; consent?: boolean; settings?: Record<string, unknown>; change_note?: string }) =>
  call<{ voice: CharacterVoice; identity_version: number }>(`/voice/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
export const cloneCharacterVoice = (id: string, body: { dataUrl: string; consent: true; name?: string; language?: string; duration_s?: number }) =>
  call<{ voice: CharacterVoice; identity_version: number }>(`/voice/${encodeURIComponent(id)}/clone`, { method: "POST", body: JSON.stringify(body) });
export const requestVoiceSession = (id: string, sessionId?: string | null) =>
  call<VoiceSessionGrant>(`/voice/${encodeURIComponent(id)}/session`, { method: "POST", body: JSON.stringify({ session_id: sessionId || null }) });
export const logVoiceTurn = (
  id: string,
  t: { session_id?: string | null; turn_id: string; user_text?: string; assistant_text?: string; interrupted?: boolean; latency_ms?: number | null },
) => call<{ id: string | null }>(`/voice/${encodeURIComponent(id)}/turns`, { method: "POST", body: JSON.stringify(t) });
