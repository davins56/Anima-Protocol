// @ts-check
/**
 * Pose / palette engine for the living full-body companion presence.
 * Pure functions so chat can drive idle, emotion, speaking, and thinking
 * without embedding animation math in the SVG component.
 */

/**
 * @typedef {{ hue: number, sat: number, light: number }} EmotionPalette
 * @typedef {{ rotate: number, lift: number }} ArmPose
 * @typedef {{
 *   lean: number,
 *   headTilt: number,
 *   headDrop: number,
 *   shoulderLift: number,
 *   armL: ArmPose,
 *   armR: ArmPose,
 *   stanceWidth: number,
 *   bounce: boolean,
 *   breath: number,
 *   vulnerable: boolean,
 *   intensity: number,
 *   emotion: string,
 * }} PresencePose
 * @typedef {{ shoulder: number, torso: number, stance: number, height: number }} BuildMetrics
 */

export const EMOTION_PALETTE = {
  joyful: { hue: 45, sat: 92, light: 62 },
  calm: { hue: 190, sat: 88, light: 58 },
  sad: { hue: 220, sat: 70, light: 48 },
  angry: { hue: 8, sat: 92, light: 52 },
  afraid: { hue: 280, sat: 72, light: 52 },
  disgusted: { hue: 140, sat: 70, light: 42 },
  surprised: { hue: 50, sat: 95, light: 64 },
  hopeful: { hue: 160, sat: 80, light: 56 },
  conflicted: { hue: 295, sat: 68, light: 54 },
  desperate: { hue: 330, sat: 78, light: 48 },
  loving: { hue: 320, sat: 82, light: 60 },
  tender: { hue: 205, sat: 75, light: 62 },
  neutral: { hue: 190, sat: 70, light: 55 },
};

export const VULNERABLE_EMOTIONS = new Set([
  "sad",
  "afraid",
  "conflicted",
  "desperate",
]);

const BUILD_METRICS = {
  slim: { shoulder: 0.88, torso: 0.86, stance: 0.9, height: 1.02 },
  average: { shoulder: 1, torso: 1, stance: 1, height: 1 },
  athletic: { shoulder: 1.14, torso: 1.08, stance: 1.08, height: 1.02 },
  stocky: { shoulder: 1.18, torso: 1.2, stance: 1.16, height: 0.94 },
  tall: { shoulder: 1.02, torso: 0.96, stance: 1.04, height: 1.12 },
  petite: { shoulder: 0.9, torso: 0.92, stance: 0.88, height: 0.88 },
  other: { shoulder: 1, torso: 1, stance: 1, height: 1 },
};

/**
 * @param {string | undefined} emotion
 * @returns {EmotionPalette}
 */
export function getEmotionPalette(emotion) {
  if (!emotion || !(emotion in EMOTION_PALETTE)) return EMOTION_PALETTE.neutral;
  return EMOTION_PALETTE[/** @type {keyof typeof EMOTION_PALETTE} */ (emotion)];
}

/**
 * @param {string | undefined} build
 * @returns {BuildMetrics}
 */
export function getBuildMetrics(build) {
  const key = String(build || "average").toLowerCase();
  if (!(key in BUILD_METRICS)) return BUILD_METRICS.average;
  return BUILD_METRICS[/** @type {keyof typeof BUILD_METRICS} */ (key)];
}

/**
 * @param {number} intensity
 */
function clampIntensity(intensity) {
  const n = Number(intensity);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(10, n)) / 10;
}

/**
 * Rest pose offsets for each emotion. Values are degrees / unitless scales
 * consumed by LivingPresence SVG transforms.
 *
 * @param {string | undefined} emotion
 * @param {number} [intensity=5]
 * @returns {PresencePose}
 */
export function getPose(emotion, intensity = 5) {
  const t = clampIntensity(intensity);
  const key =
    emotion && emotion in EMOTION_PALETTE
      ? /** @type {keyof typeof EMOTION_PALETTE} */ (emotion)
      : "neutral";

  /** @type {Record<string, Omit<PresencePose, "vulnerable" | "intensity" | "emotion">>} */
  const poses = {
    joyful: {
      lean: -2,
      headTilt: -6,
      headDrop: -6,
      shoulderLift: 8 + t * 6,
      armL: { rotate: -28 - t * 18, lift: 16 },
      armR: { rotate: 32 + t * 16, lift: 18 },
      stanceWidth: 18,
      bounce: true,
      breath: 2.2 - t * 0.5,
    },
    calm: {
      lean: 0,
      headTilt: 2,
      headDrop: 0,
      shoulderLift: 0,
      armL: { rotate: -8, lift: 0 },
      armR: { rotate: 10, lift: 0 },
      stanceWidth: 14,
      bounce: false,
      breath: 3.4,
    },
    sad: {
      lean: 6,
      headTilt: 12,
      headDrop: 14,
      shoulderLift: -10,
      armL: { rotate: 18, lift: -12 },
      armR: { rotate: -14, lift: -10 },
      stanceWidth: 10,
      bounce: false,
      breath: 4.2,
    },
    angry: {
      lean: -1,
      headTilt: -2,
      headDrop: 2,
      shoulderLift: 14,
      armL: { rotate: 22, lift: 8 },
      armR: { rotate: -24, lift: 8 },
      stanceWidth: 22 + t * 6,
      bounce: false,
      breath: 1.8 - t * 0.3,
    },
    afraid: {
      lean: 4,
      headTilt: 8,
      headDrop: 8,
      shoulderLift: 6,
      armL: { rotate: 32, lift: 10 },
      armR: { rotate: -30, lift: 10 },
      stanceWidth: 8,
      bounce: false,
      breath: 1.6,
    },
    disgusted: {
      lean: -8,
      headTilt: -10,
      headDrop: 4,
      shoulderLift: -4,
      armL: { rotate: 8, lift: 4 },
      armR: { rotate: 28, lift: 6 },
      stanceWidth: 16,
      bounce: false,
      breath: 2.8,
    },
    surprised: {
      lean: -4,
      headTilt: -4,
      headDrop: -10,
      shoulderLift: 16,
      armL: { rotate: -40, lift: 22 },
      armR: { rotate: 42, lift: 22 },
      stanceWidth: 20,
      bounce: true,
      breath: 1.5,
    },
    hopeful: {
      lean: -3,
      headTilt: -8,
      headDrop: -8,
      shoulderLift: 6,
      armL: { rotate: -12, lift: 8 },
      armR: { rotate: 36 + t * 10, lift: 20 },
      stanceWidth: 15,
      bounce: false,
      breath: 2.6,
    },
    conflicted: {
      lean: 3,
      headTilt: -10,
      headDrop: 4,
      shoulderLift: 2,
      armL: { rotate: 24, lift: 2 },
      armR: { rotate: 8, lift: 12 },
      stanceWidth: 13,
      bounce: false,
      breath: 2.4,
    },
    desperate: {
      lean: 5,
      headTilt: 6,
      headDrop: 6,
      shoulderLift: 10,
      armL: { rotate: -34, lift: 24 },
      armR: { rotate: 36, lift: 24 },
      stanceWidth: 12,
      bounce: false,
      breath: 1.7,
    },
    loving: {
      lean: -4,
      headTilt: -3,
      headDrop: -2,
      shoulderLift: 4,
      armL: { rotate: -22, lift: 14 },
      armR: { rotate: 24, lift: 14 },
      stanceWidth: 16,
      bounce: false,
      breath: 3.0,
    },
    tender: {
      lean: 2,
      headTilt: 4,
      headDrop: 2,
      shoulderLift: -2,
      armL: { rotate: 6, lift: 4 },
      armR: { rotate: 16, lift: 8 },
      stanceWidth: 12,
      bounce: false,
      breath: 3.6,
    },
    neutral: {
      lean: 0,
      headTilt: 0,
      headDrop: 0,
      shoulderLift: 0,
      armL: { rotate: -6, lift: 0 },
      armR: { rotate: 8, lift: 0 },
      stanceWidth: 14,
      bounce: false,
      breath: 3.2,
    },
  };

  const pose = poses[key] || poses.neutral;
  return {
    ...pose,
    vulnerable: VULNERABLE_EMOTIONS.has(key),
    intensity: t,
    emotion: key,
  };
}

/**
 * Extra arm motion while the companion is speaking (or thinking).
 * @param {number} tMs
 * @param {{ speaking?: boolean, thinking?: boolean }} state
 */
export function getSpeakingGesture(tMs, state = {}) {
  const t = Math.max(0, Number(tMs) || 0) / 1000;
  if (state.thinking) {
    return {
      armL: { rotate: 8 + Math.sin(t * 1.4) * 6, lift: 10 },
      armR: { rotate: 18 + Math.cos(t * 1.1) * 8, lift: 16 },
      headTilt: 8 + Math.sin(t * 0.7) * 4,
    };
  }
  if (!state.speaking) {
    return { armL: { rotate: 0, lift: 0 }, armR: { rotate: 0, lift: 0 }, headTilt: 0 };
  }
  return {
    armL: { rotate: Math.sin(t * 2.4) * 12, lift: 6 + Math.sin(t * 1.8) * 8 },
    armR: { rotate: Math.sin(t * 2.1 + 1.2) * 14, lift: 8 + Math.cos(t * 1.6) * 7 },
    headTilt: Math.sin(t * 1.3) * 3,
  };
}

/**
 * Mouth openness 0..1. Quiet rest when silent; viseme-like pulse while speaking.
 * @param {number} tMs
 * @param {boolean} speaking
 */
export function getVisemeOpenness(tMs, speaking) {
  if (!speaking) return 0.08;
  const t = Math.max(0, Number(tMs) || 0) / 1000;
  const pulse = 0.35 + 0.35 * Math.abs(Math.sin(t * 9.4)) + 0.2 * Math.abs(Math.sin(t * 17.1));
  return Math.max(0.12, Math.min(1, pulse));
}

/**
 * Idle sway amplitude in degrees.
 * @param {boolean} speaking
 * @param {boolean} bounce
 */
export function getIdleSway(speaking, bounce) {
  if (speaking) return 1.8;
  if (bounce) return 2.6;
  return 1.2;
}

/**
 * Characters currently on stage for a session.
 * @param {{ mode?: string, character_id?: string, group_character_ids?: string[] } | null | undefined} session
 * @param {Array<{ id: string }> | null | undefined} characters
 */
export function resolvePresenceCast(session, characters) {
  if (!session || !Array.isArray(characters) || characters.length === 0) return [];
  if (session.mode === "group" && Array.isArray(session.group_character_ids)) {
    const ids = new Set(session.group_character_ids.filter(Boolean));
    return characters.filter((c) => ids.has(c.id));
  }
  if (session.character_id) {
    const match = characters.find((c) => c.id === session.character_id);
    return match ? [match] : [];
  }
  return [];
}

/**
 * Last real spoken line (skips typing / thinking / event bubbles).
 * @param {Array<{ character_name?: string, type?: string, role?: string, content?: string }> | null | undefined} messages
 */
export function lastSpokenLine(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.character_name === "__typing__" || m.character_name === "__thinking__") continue;
    if (m.type === "event") continue;
    return m;
  }
  return null;
}

/**
 * Highlight the companion who last spoke (or is currently TTS-ing).
 * @param {Array<{ id: string, name?: string }>} cast
 * @param {{ character_name?: string, role?: string } | null} lastLine
 * @param {boolean} speaking
 */
export function highlightedCastId(cast, lastLine, speaking) {
  if (!Array.isArray(cast) || cast.length === 0) return null;
  if (lastLine?.role === "user") return speaking ? cast[0]?.id ?? null : null;
  if (lastLine?.character_name) {
    const match = cast.find((c) => c.name === lastLine.character_name);
    if (match) return match.id;
  }
  return cast.length === 1 ? cast[0].id : null;
}

/**
 * @param {string} emotion
 * @param {number} [alpha=1]
 */
export function emotionCss(emotion, alpha = 1) {
  const { hue, sat, light } = getEmotionPalette(emotion);
  return `hsl(${hue} ${sat}% ${light}% / ${alpha})`;
}

/**
 * Canonical full-body Serenity sprite (public asset). Used as the floating
 * presence on the messages screen instead of the geometric vessel mesh.
 */
export const SERENITY_PRESENCE_SRC = "/serenity-presence.webp";
export const SERENITY_PRESENCE_DETAIL_SRC = "/serenity-presence-detail.webp";

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimUrl(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * True when the companion should appear as Serenity (first Anima), not a
 * story-character portrait.
 *
 * @param {{ name?: string, _isAnima?: boolean, category?: string } | null | undefined} character
 */
export function isSerenityPresence(character) {
  if (!character) return false;
  const name = String(character.name || "").trim();
  if (/^serenity(\b|$)/i.test(name)) return true;
  if (character.category === "anima-construct" && !name) return true;
  return false;
}

/**
 * Full-figure sprite for the living presence rail/stage.
 * Prefers an explicit body image, then Serenity's canonical illustration,
 * then a character portrait used as a standing figure (no geometric vessel).
 *
 * @param {{ name?: string, avatar_url?: string, body_url?: string, full_body_url?: string, _isAnima?: boolean, category?: string } | null | undefined} character
 * @param {{ detail?: boolean }} [opts]
 * @returns {string}
 */
export function resolvePresenceSprite(character, opts = {}) {
  const body = trimUrl(character?.body_url) || trimUrl(character?.full_body_url);
  if (body) return body;
  const canonical = opts.detail ? SERENITY_PRESENCE_DETAIL_SRC : SERENITY_PRESENCE_SRC;
  if (isSerenityPresence(character)) return canonical;
  const avatar = trimUrl(character?.avatar_url);
  if (avatar) return avatar;
  if (character?._isAnima) return canonical;
  return "";
}
