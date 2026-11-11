import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

let cachedConfigured = null;

/**
 * Whether the server can open a live ElevenLabs voice session (key bound).
 * Cached for the page lifetime; failures read as "not available".
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>}
 */
export async function isVoiceAgentAvailable(fetchImpl = fetch) {
  if (cachedConfigured !== null) return cachedConfigured;
  try {
    const res = await fetchImpl(apiUrl("/voice-agent/status"), { headers: await authHeaders() });
    const data = res.ok ? await res.json() : null;
    cachedConfigured = Boolean(data?.configured);
  } catch {
    cachedConfigured = false;
  }
  return cachedConfigured;
}

/** @internal test helper */
export function resetVoiceAgentAvailability() {
  cachedConfigured = null;
}

/**
 * Ask the server for a short-lived signed URL to the private Sacred Space
 * agent. The ElevenLabs key never reaches the browser.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function fetchVoiceAgentSignedUrl(fetchImpl = fetch) {
  const res = await fetchImpl(apiUrl("/voice-agent/session"), {
    method: "POST",
    headers: await authHeaders(),
    body: "{}",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.signedUrl) {
    throw new Error(data?.error || `Voice session failed (${res.status})`);
  }
  return data.signedUrl;
}

/**
 * Per-session values the agent prompt reads ({{companion_name}} etc.), so it
 * speaks as the companion the user is with. Strings only, trimmed to keep the
 * prompt small.
 * @param {object | null | undefined} character
 * @param {string | null | undefined} ritualFocus
 * @returns {Record<string, string>}
 */
export function buildVoiceAgentVariables(character, ritualFocus) {
  const clip = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    companion_name: clip(character?.name, 80) || "Serenity",
    companion_universe: character?.universe ? `from ${clip(character.universe, 80)}` : "",
    companion_personality: clip(character?.personality, 600) || "Warm, present, and genuine",
    companion_speaking_style: clip(character?.speaking_style, 300) || "Thoughtful and measured",
    ritual_focus: clip(ritualFocus, 40) || "awakening",
  };
}
