// @ts-check
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

/**
 * Synthesize a clone test line through the API server's /tts proxy. The
 * ElevenLabs key lives only in server env (ELEVENLABS_API_KEY); the client
 * never holds it.
 * @param {string} voiceId
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Blob>}
 */
export async function synthesizeCloneTest(voiceId, fetchImpl = fetch) {
  const res = await fetchImpl(apiUrl("/tts"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ text: "This is a test of the voice clone.", voice_id: voiceId }),
  });
  if (!res.ok) {
    const err = new Error(res.status === 503 ? "Voice cloning is not configured." : `TTS failed (${res.status})`);
    // @ts-ignore
    err.status = res.status;
    throw err;
  }
  return res.blob();
}
