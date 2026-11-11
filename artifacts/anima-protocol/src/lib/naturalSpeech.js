/**
 * Natural Web Speech helpers for Sacred Space / meditation.
 *
 * Browser TTS sounds robotic for a few specific reasons, each handled here:
 * - Every utterance restarts the engine's intonation, so speaking one short
 *   sentence at a time gives every line the same flat "read-out" contour.
 *   We group sentences into breath-sized phrases instead.
 * - Heavy slow-down (rate well below 1) stretches vowels unnaturally.
 * - Any pitch other than 1 makes neural / network voices pitch-shift their
 *   audio, which adds a metallic edge. Pitch only moves on basic local voices.
 * - Uniform gaps between phrases sound mechanical; pauses follow punctuation.
 * - Emoji, symbols and URLs get read out literally.
 */

export const SACRED_SPACE_SPEECH = Object.freeze({
  rate: 0.92,
  pitch: 1.0,
  volume: 0.9,
  pauseMs: 240,
});

export const CHAT_SPEECH = Object.freeze({
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  pauseMs: 160,
});

/**
 * Upper bound for one utterance. Long enough to hold a couple of sentences
 * with natural flow; short enough to dodge Chrome's network voices going
 * silent on long utterances (~15s).
 */
export const DEFAULT_CHUNK_MAX = 180;

const QUALITY_BOOSTS = [
  [/online\s*\(natural\)/i, 90],
  [/neural/i, 80],
  [/premium/i, 72],
  [/\bnatural\b/i, 68],
  [/enhanced/i, 50],
  [/google/i, 46],
  [/microsoft/i, 18],
];

const QUALITY_PENALTIES = [
  [/compact|espeak|eSpeak|festival|robot|novelty/i, -120],
  [/whisper|bad news|good news|zarvox|albert|bells|boing|bubbles|cellos|deranged|hysterical|junior|kathy|princess|ralph/i, -110],
  [/desktop/i, -18],
];

// Word boundaries matter: without them "Female" matches "male" and
// "Woman" matches "man", so feminine voices were scored as masculine too.
const FEMININE_VOICE = /\b(samantha|karen|moira|fiona|victoria|allison|ava|zoe|aria|jenny|susan|zira|salli|ivy|joanna|kendra|kimberly|nicole|raveena|tessa|emma|amy|olivia|luna|nova|shimmer|sonia|libby|natasha|michelle|ana|female|woman)\b/i;
const MASCULINE_VOICE = /\b(daniel|alex|ryan|guy|davis|brian|matthew|james|david|fred|tom|arthur|oliver|mark|george|eric|christopher|roger|steffan|william|male|man)\b/i;

/** Voices that are neural / streamed and must not be pitch-shifted. */
const NEURAL_VOICE = /online\s*\(natural\)|neural|natural|premium|enhanced|google/i;

const FEMININE_NAMES = new Set([
  "serenity", "anima", "korra", "asami", "jinora", "lin", "natasha", "wanda",
  "sersi", "thena", "asami",
]);
const MASCULINE_NAMES = new Set([
  "mako", "bolin", "tenzin", "zaheer", "tony", "steve", "thor", "loki",
  "peter", "bruce", "nick", "ikaris", "gilgamesh", "kingo",
]);

/**
 * Strip markdown, stage directions, and extra whitespace so TTS does not
 * read asterisks or bracketed asides.
 * @param {unknown} text
 * @returns {string}
 */
export function stripSpeechMarkup(text) {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, " ")
    .replace(/_([^_]+)_/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn cleaned text into something a TTS engine reads like a person would:
 * no emoji names, no URLs, no "dot dot dot", no spelled-out symbols.
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeForSpeech(text) {
  return stripSpeechMarkup(text)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/gu, "")
    .replace(/\.{3,}/g, "…")
    .replace(/…+/g, "…")
    .replace(/\s*&\s*/g, " and ")
    .replace(/[~^|<>{}\\]/g, " ")
    .replace(/([!?])\1+/g, "$1")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Infer a speaking-voice gender from companion fields when present.
 * Defaults to feminine (Anima / Serenity) when there is no signal.
 * @param {object | null | undefined} companion
 * @returns {"feminine" | "masculine"}
 */
export function inferCompanionVoiceGender(companion) {
  if (!companion || typeof companion !== "object") return "feminine";

  const explicit = String(
    companion.gender || companion.voice_gender || companion.sex || "",
  ).toLowerCase().trim();
  if (/^(f|female|feminine|woman|girl|she)$/.test(explicit)) return "feminine";
  if (/^(m|male|masculine|man|boy|he)$/.test(explicit)) return "masculine";

  const blob = [
    companion.personality,
    companion.backstory,
    companion.speaking_style,
    companion.description,
  ]
    .filter(Boolean)
    .join(" ");
  const she = (blob.match(/\b(she|her|hers|herself)\b/gi) || []).length;
  const he = (blob.match(/\b(he|him|his|himself)\b/gi) || []).length;
  if (she > he + 1) return "feminine";
  if (he > she + 1) return "masculine";

  const first = String(companion.name || "").trim().split(/\s+/)[0]?.toLowerCase();
  if (first && FEMININE_NAMES.has(first)) return "feminine";
  if (first && MASCULINE_NAMES.has(first)) return "masculine";
  return "feminine";
}

/**
 * Break a companion reply into breath-sized phrases. Short sentences are
 * grouped so the engine can carry intonation across them (one sentence per
 * utterance is what makes browser TTS sound like a list being read).
 * A trailing ellipsis always ends a phrase so the pause after it is real.
 * @param {unknown} text
 * @param {{ maxLen?: number }} [options]
 * @returns {string[]}
 */
export function chunkSpeechText(text, options = {}) {
  const maxLen = Number(options.maxLen) > 0 ? Number(options.maxLen) : DEFAULT_CHUNK_MAX;
  const clean = normalizeForSpeech(text);
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => (s.length <= maxLen ? [s] : splitLongPhrase(s, maxLen)));

  const chunks = [];
  let buf = "";
  for (const sentence of sentences) {
    const next = buf ? `${buf} ${sentence}` : sentence;
    if (buf && next.length > maxLen) {
      chunks.push(buf);
      buf = sentence;
    } else {
      buf = next;
    }
    if (buf.endsWith("…")) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Pause after a phrase, shaped by how it ends — longer after a trailing-off
 * ellipsis or a question, shorter after a clause break.
 * @param {string} chunk
 * @param {number} baseMs
 * @returns {number}
 */
export function pauseAfterChunk(chunk, baseMs) {
  const base = Math.max(0, Number(baseMs) || 0);
  const end = String(chunk || "").trim().slice(-1);
  if (end === "…") return Math.round(base * 1.8);
  if (end === "?") return Math.round(base * 1.3);
  if (end === "." || end === "!") return base;
  return Math.round(base * 0.5);
}

/**
 * Neural / streamed voices sound best untouched; pitch-shifting them adds
 * a metallic edge.
 * @param {{ name?: string, localService?: boolean } | null | undefined} voice
 * @returns {boolean}
 */
export function isNeuralVoice(voice) {
  if (!voice) return false;
  return NEURAL_VOICE.test(String(voice.name || "")) || voice.localService === false;
}

/**
 * @param {string} sentence
 * @param {number} maxLen
 * @returns {string[]}
 */
function splitLongPhrase(sentence, maxLen) {
  const parts = sentence
    .split(/(?<=[;:—–])\s+|(?<=,)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const merged = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.length + part.length + 1 <= maxLen) {
      merged[merged.length - 1] = `${last} ${part}`;
    } else if (part.length <= maxLen) {
      merged.push(part);
    } else {
      merged.push(...splitByWordBudget(part, maxLen));
    }
  }
  return merged;
}

/**
 * @param {string} phrase
 * @param {number} maxLen
 * @returns {string[]}
 */
function splitByWordBudget(phrase, maxLen) {
  const words = phrase.split(/\s+/);
  const out = [];
  let buf = "";
  for (const word of words) {
    const next = buf ? `${buf} ${word}` : word;
    if (next.length > maxLen && buf) {
      out.push(buf);
      buf = word;
    } else {
      buf = next;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Score a browser voice for Sacred Space: quality first, then English,
 * then a gentle gender/timbre match.
 * @param {SpeechSynthesisVoice | { name?: string, lang?: string, localService?: boolean, default?: boolean }} voice
 * @param {{ gender?: "feminine" | "masculine", langPrefix?: string }} [prefs]
 * @returns {number}
 */
export function scoreSpeechVoice(voice, prefs = {}) {
  if (!voice) return -Infinity;
  const name = String(voice.name || "");
  const lang = String(voice.lang || "");
  const gender = prefs.gender || "feminine";
  const langPrefix = prefs.langPrefix || "en";

  let score = 0;
  for (const [re, pts] of QUALITY_BOOSTS) {
    if (re.test(name)) score += pts;
  }
  for (const [re, pts] of QUALITY_PENALTIES) {
    if (re.test(name)) score += pts;
  }

  if (lang.toLowerCase().startsWith(langPrefix)) score += 24;
  else if (lang.toLowerCase().startsWith("en")) score += 16;
  else score -= 40;

  if (lang.toLowerCase() === "en-us" || lang.toLowerCase() === "en-gb" || lang.toLowerCase() === "en-au") {
    score += 6;
  }

  const feminine = FEMININE_VOICE.test(name);
  const masculine = MASCULINE_VOICE.test(name);
  if (gender === "feminine" && feminine) score += 22;
  if (gender === "masculine" && masculine) score += 22;
  if (gender === "feminine" && masculine) score -= 10;
  if (gender === "masculine" && feminine) score -= 10;

  // Cloud / network neural voices usually sound warmer than compact local ones.
  if (voice.localService === false) score += 12;
  if (voice.default && lang.toLowerCase().startsWith("en")) score += 4;

  return score;
}

/**
 * Pick the most natural English voice available, matching companion timbre
 * when that data exists.
 * @param {Array<SpeechSynthesisVoice | { name?: string, lang?: string, localService?: boolean, default?: boolean }>} voices
 * @param {{ companion?: object | null, gender?: "feminine" | "masculine", langPrefix?: string }} [options]
 * @returns {SpeechSynthesisVoice | object | null}
 */
export function selectNaturalVoice(voices, options = {}) {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];
  if (!list.length) return null;
  const gender = options.gender || inferCompanionVoiceGender(options.companion);
  const ranked = [...list].sort(
    (a, b) => scoreSpeechVoice(b, { gender, langPrefix: options.langPrefix })
      - scoreSpeechVoice(a, { gender, langPrefix: options.langPrefix }),
  );
  return ranked[0] || null;
}

/**
 * Resolve rate / pitch / volume for intimate meditation speech.
 * Slightly slower than default chat TTS; no cartoon extremes.
 * @param {{ gender?: "feminine" | "masculine", settings?: { rate?: number, pitch?: number, volume?: number, pauseMs?: number } }} [options]
 */
export function resolveSpeechSettings(options = {}) {
  const base = { ...SACRED_SPACE_SPEECH, ...(options.settings || {}) };
  const gender = options.gender || inferCompanionVoiceGender(options.companion);
  const basePitch = Number.isFinite(Number(base.pitch)) ? Number(base.pitch) : 1;
  // Only nudge pitch on basic local voices, and only when the voice's own
  // timbre does not already match the companion. Neural voices stay at their
  // native pitch.
  let pitch = basePitch;
  const voice = options.voice || null;
  const voiceName = String(voice?.name || "");
  const timbreMatches = gender === "masculine"
    ? MASCULINE_VOICE.test(voiceName)
    : FEMININE_VOICE.test(voiceName);
  if (voice && !isNeuralVoice(voice) && !timbreMatches) {
    pitch = gender === "masculine" ? basePitch - 0.05 : basePitch + 0.04;
  } else if (!voice) {
    pitch = gender === "masculine" ? basePitch - 0.03 : basePitch;
  }
  pitch = clamp(pitch, 0.85, 1.15);
  return {
    rate: clamp(Number(base.rate) || SACRED_SPACE_SPEECH.rate, 0.7, 1.15),
    pitch,
    volume: clamp(Number(base.volume) || SACRED_SPACE_SPEECH.volume, 0.4, 1),
    pauseMs: Math.max(80, Number(base.pauseMs) || SACRED_SPACE_SPEECH.pauseMs),
  };
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Speak text as sequential phrase utterances with short pauses.
 * Returns a controller so the caller can cancel mid-stream.
 *
 * @param {unknown} text
 * @param {{
 *   synth?: SpeechSynthesis,
 *   voices?: Array<SpeechSynthesisVoice>,
 *   companion?: object | null,
 *   gender?: "feminine" | "masculine",
 *   settings?: { rate?: number, pitch?: number, volume?: number, pauseMs?: number },
 *   onStart?: () => void,
 *   onEnd?: () => void,
 *   onError?: (err: unknown) => void,
 *   Utterance?: typeof SpeechSynthesisUtterance,
 * }} [options]
 * @returns {{ cancel: () => void, chunks: string[], voice: object | null }}
 */
export function speakNaturally(text, options = {}) {
  const chunks = chunkSpeechText(text);
  const synth = options.synth
    || (typeof window !== "undefined" ? window.speechSynthesis : null);
  const Utterance = options.Utterance
    || (typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : null);
  const voices = options.voices
    || (typeof synth?.getVoices === "function" ? synth.getVoices() : []);
  const gender = options.gender || inferCompanionVoiceGender(options.companion);
  const voice = selectNaturalVoice(voices, { companion: options.companion, gender });
  const settings = resolveSpeechSettings({ ...options, gender, voice });

  let cancelled = false;
  let timer = null;
  let index = 0;
  let started = false;

  const finish = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    options.onEnd?.();
  };

  const cancel = () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      synth?.cancel();
    } catch {
      /* ignore */
    }
    if (started) options.onEnd?.();
  };

  if (!chunks.length || !synth || !Utterance) {
    return { cancel: () => {}, chunks, voice };
  }

  const speakNext = () => {
    if (cancelled) return;
    if (index >= chunks.length) {
      finish();
      return;
    }

    const utterance = new Utterance(chunks[index]);
    if (voice) utterance.voice = voice;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    utterance.lang = voice?.lang || "en-US";

    utterance.onend = () => {
      if (cancelled) return;
      index += 1;
      if (index >= chunks.length) {
        finish();
        return;
      }
      timer = setTimeout(speakNext, pauseAfterChunk(chunks[index - 1], settings.pauseMs));
    };
    utterance.onerror = (event) => {
      const err = event?.error;
      if (err === "interrupted" || err === "canceled") return;
      options.onError?.(event);
      finish();
    };

    if (!started) {
      started = true;
      options.onStart?.();
    }
    try {
      synth.speak(utterance);
    } catch (err) {
      options.onError?.(err);
      finish();
    }
  };

  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
  speakNext();
  return { cancel, chunks, voice };
}
