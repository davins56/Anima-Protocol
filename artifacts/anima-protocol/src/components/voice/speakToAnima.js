import { base44 } from '@/api/base44Client';

function stripMarkup(text) {
  return (text || '')
    .replace(/\*[^*]*\*/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/#{1,6}\s/g, '')
    .trim();
}

/**
 * Speak text using a character's ElevenLabs voice (with optional emotion params).
 * This is an app-agnostic helper so we can reuse it from different UI flows
 * (message card "hear voice" button, and "speak to my anima" voice input).
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

  let resolvedVoiceId = voiceId;

  if (!resolvedVoiceId && characterId) {
    try {
      const chars = await base44.entities.Character.list();
      const char = chars.find((c) => c.id === characterId);
      resolvedVoiceId = char?.elevenlabs_voice_id;
    } catch {
      // ignore and fall through
    }
  }

  if (!resolvedVoiceId) {
    // No voice assigned; fail soft.
    return {};
  }

  // Let the server compute emotional voice settings (production integration).
  // Fall back to a minimal voice_settings object if adjustment fails.
  let voiceSettings = null;
  if (characterId) {
    try {
      const adjustmentResult = await base44.functions.invoke(
        'adjustVoiceEmotionalParameters',
        { character_id: characterId, emotion, intensity }
      );
      voiceSettings = adjustmentResult?.data?.voice_settings || null;
    } catch {
      voiceSettings = null;
    }
  }

  const body = voiceSettings
    ? {
        text: clean,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: voiceSettings.stability,
          similarity_boost: 0.85,
          style: voiceSettings.style,
          use_speaker_boost: voiceSettings.speaker_boost,
        },
      }
    : {
        text: clean,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true,
        },
      };

  // Note: xi-api-key should be handled server-side in production.
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': '',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.statusText}`);
  }

  const audioData = await res.arrayBuffer();
  const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
  const audioUrl = URL.createObjectURL(audioBlob);
  return { audioUrl };
}

