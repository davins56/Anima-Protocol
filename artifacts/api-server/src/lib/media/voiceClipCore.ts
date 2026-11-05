/**
 * Voice notes, pure half: what gets spoken and the provider request bodies.
 * Runtime: ./voiceClip.ts. Switch: `media` (ANIMA_KERNEL_MEDIA).
 */

/** A voice note is a note, not an audiobook: ~25 s at a natural pace, and well under the 1 MB blob cap. */
export const VOICE_CLIP_MAX_CHARS = 400;
/** MP3 at 64 kbps keeps a 25 s clip near 200 KB. */
export const VOICE_CLIP_BIT_RATE = 64_000;

/**
 * Text a voice should say: no tags, no markdown, no *stage directions*,
 * capped at a sentence boundary. Empty string means nothing worth speaking.
 */
export function cleanSpokenText(raw: unknown, max = VOICE_CLIP_MAX_CHARS): string {
  let s = String(raw ?? "")
    .replace(/\[[A-Z]+:[^\]]*\]/g, " ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*[^*\n]{1,200}\*/g, " ")
    .replace(/[_*`#>~]+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const cut = Math.max(s.lastIndexOf(". "), s.lastIndexOf("! "), s.lastIndexOf("? "));
  return (cut > max * 0.5 ? s.slice(0, cut + 1) : s.replace(/\s+\S*$/, "") + "…").trim();
}

export type SavedVoice = {
  voice_id: string;
  language: string | null;
  settings: { speed?: number; replace?: Record<string, string> } | null;
} | null;

/** xAI POST /v1/tts body for her saved (builtin or cloned) voice. */
export function xaiTtsBody(voice: SavedVoice, text: string, defaultVoiceId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text,
    voice_id: voice?.voice_id || defaultVoiceId,
    language: voice?.language || "auto",
    output_format: { codec: "mp3", sample_rate: 24_000, bit_rate: VOICE_CLIP_BIT_RATE },
  };
  const speed = voice?.settings?.speed;
  if (typeof speed === "number" && Number.isFinite(speed)) body.speed = speed;
  const replace = voice?.settings?.replace;
  if (replace && typeof replace === "object" && Object.keys(replace).length) body.replace = replace;
  return body;
}

/** Which provider will speak, given configured keys. */
export function pickVoiceProvider(keys: { xai: boolean; elevenlabs: boolean }): "xai" | "elevenlabs" | null {
  if (keys.xai) return "xai";
  if (keys.elevenlabs) return "elevenlabs";
  return null;
}
