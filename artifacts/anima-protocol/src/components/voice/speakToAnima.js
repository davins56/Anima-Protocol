import { base44 } from '@/api/base44Client';
import { apiUrl } from '@/lib/apiOrigin';
import { authHeaders } from '@/api/authBridge';

export const TTS_TIMEOUT_MS = 20_000;

function stripMarkup(text) {
  return (text || '')
    .replace(/\*[^*]*\*/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/#{1,6}\s/g, '')
    .trim();
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/**
 * Speak text using a character's ElevenLabs voice (with optional emotion params).
 * Routes through POST /api/tts — never the JSON function dispatcher or a
 * browser-side ElevenLabs call (those hang or return no audio).
 *
 * @param {object} params
 * @param {string} params.text
 * @param {string} [params.characterId]
 * @param {string} [params.voiceId]
 * @param {string} [params.emotion]
 * @param {number} [params.intensity]
 * @returns {Promise<{audioUrl?: string}>}
 */
export async function speakToAnima({
  text,
  characterId,
  voiceId,
  emotion = 'neutral',
  intensity = 5,
}) {
  const clean = stripMarkup(text);
  if (!clean) return {};

  let resolvedVoiceId = voiceId || null;

  if (!resolvedVoiceId && characterId) {
    try {
      const chars = await base44.entities.Character.list();
      const char = chars.find((c) => c.id === characterId);
      resolvedVoiceId = char?.elevenlabs_voice_id || null;
    } catch {
      // ignore and fall through to the server default voice
    }
  }

  let res;
  try {
    res = await fetch(apiUrl('/tts'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        text: clean,
        voice_id: resolvedVoiceId || null,
        emotion,
        intensity,
      }),
      signal: timeoutSignal(TTS_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new Error('Voice replay timed out');
    }
    throw err;
  }

  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`TTS failed: ${msg}`);
  }

  const audioData = await res.arrayBuffer();
  const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
  const audioUrl = URL.createObjectURL(audioBlob);
  return { audioUrl };
}
