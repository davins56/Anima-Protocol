import type {
  IntimacyProfile,
  IntimacyScene,
  IntimacyTurnResult,
  IntimacyPhase,
} from "./intimacyTypes";

<<<<<<< HEAD
=======
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word / whole-phrase match (case-insensitive input expected). */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = phrase.trim();
  if (!needle) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

const KISS_RE = /\b(kiss(es|ed|ing)?|lips?|mouth|nibbl\w*|lick\w*)\b/i;
const TOUCH_RE =
  /\b(touch\w*|embrac\w*|hold(s|ing)?|held|caress\w*|strok\w*|hands?|body|bodies|fingers?|thighs?|hips?|waist|neck|spine|shiver\w*|tremb\w*|pull(s|ed|ing)? (you|me) (close|closer|in)|press(es|ed|ing)? against|cuddl\w*|straddl\w*|grind\w*)\b/i;
const CONTACT_RE =
  /\b(sensual\w*|naked|nude|undress\w*|strip\w*|desir\w*|want you|need you|crave you|skin|bare|aroused?|arousal|horny|turned on|lingerie|thong|panties|bra|breasts?|nipples?|moan\w*|gasp\w*|between the sheets|seduc\w*|tease\w*|teasing|throb\w*)\b/i;
const PEAK_RE = /\b(orgasm\w*|climax\w*|cum(ming)?|over the edge|come for me)\b/i;
const FLIRT_RE =
  /\b(flirt\w*|blush\w*|sexy|gorgeous|darling|babe|gaze|stare|eyes on|closer|whisper\w*|heart racing|breathless|tempt\w*|intimate|romantic|cute)\b/i;

>>>>>>> origin/main
export function decayHeat(profile: IntimacyProfile, idleMinutes: number): IntimacyProfile {
  if (idleMinutes < 8 || profile.heat <= 0) return profile;
  const decayAmount = Math.floor((idleMinutes - 5) / 5) * 2;
  const nextHeat = Math.max(0, profile.heat - Math.max(2, decayAmount));
  return {
    ...profile,
    heat: nextHeat,
  };
}

export interface EvaluateTurnParams {
  profile: IntimacyProfile;
  scene?: IntimacyScene;
  content: string;
  adultEnabled?: boolean;
  therapyMode?: boolean;
}

export function evaluateTurn(params: EvaluateTurnParams): IntimacyTurnResult {
  // Fail closed: a caller that forgets adultEnabled must not unlock intimacy.
  const { profile, content, adultEnabled = false, therapyMode = false } = params;
  const scene: IntimacyScene = params.scene || {
    id: "default",
    conversationId: "default",
    characterId: profile.characterId,
    userId: profile.userId,
    phase: "closed",
    heatPeak: 0,
    actsLog: [],
  };

  if (therapyMode || !adultEnabled || !profile.intimacyEnabled) {
    return {
      blockIntimacy: true,
      events: [],
      phase: "closed",
      heat: 0,
      profile: { ...profile, heat: 0 },
      scene: { ...scene, phase: "closed" },
    };
  }

  const text = (content || "").toLowerCase();
  const events: string[] = [];

  // 1. Safeword check
<<<<<<< HEAD
  const userSafeword = (profile.safeword || "red").trim().toLowerCase();
  const safewordHit =
    (userSafeword && text.includes(userSafeword)) ||
    (userSafeword !== "red" && text.includes("red"));
=======
  // Whole-word match only: a bare substring check made "shivered", "desired",
  // "covered" and "whispered" trip the default "red" safeword, which reset heat
  // and parked the scene in aftercare mid-conversation.
  const userSafeword = (profile.safeword || "red").trim().toLowerCase();
  const safewordHit =
    containsPhrase(text, userSafeword) || (userSafeword !== "red" && containsPhrase(text, "red"));
>>>>>>> origin/main

  if (safewordHit) {
    events.push("safeword");
    const nextProfile: IntimacyProfile = {
      ...profile,
      heat: 15,
      lastSceneAt: new Date().toISOString(),
    };
    const nextScene: IntimacyScene = {
      ...scene,
      phase: "aftercare",
      endedReason: "safeword",
      heatPeak: Math.max(scene.heatPeak, profile.heat),
      updatedAt: new Date().toISOString(),
    };
    return {
      events,
      phase: "aftercare",
      heat: 15,
      profile: nextProfile,
      scene: nextScene,
    };
  }

  // 2. Limits check
  if (Array.isArray(profile.limits)) {
    for (const limit of profile.limits) {
<<<<<<< HEAD
      if (limit.trim() && text.includes(limit.trim().toLowerCase())) {
=======
      if (containsPhrase(text, limit.trim().toLowerCase())) {
>>>>>>> origin/main
        events.push(`hard_limit:${limit}`);
        const nextProfile: IntimacyProfile = {
          ...profile,
          heat: 15,
          lastSceneAt: new Date().toISOString(),
        };
        const nextScene: IntimacyScene = {
          ...scene,
          phase: "aftercare",
          endedReason: `hard_limit:${limit}`,
          updatedAt: new Date().toISOString(),
        };
        return {
          events,
          phase: "aftercare",
          heat: 15,
          profile: nextProfile,
          scene: nextScene,
        };
      }
    }
  }

  // 3. Soft limits check
  if (Array.isArray(profile.softLimits)) {
    for (const softLimit of profile.softLimits) {
<<<<<<< HEAD
      if (softLimit.trim() && text.includes(softLimit.trim().toLowerCase())) {
=======
      if (containsPhrase(text, softLimit.trim().toLowerCase())) {
>>>>>>> origin/main
        events.push(`soft_limit:${softLimit}`);
      }
    }
  }

  // 4. Escalation & Heat calculation
<<<<<<< HEAD
  const hasKiss = /(kiss|lips|smooth lips|mouth)/i.test(text);
  const hasTouch = /(touch|embrace|hold|caress|stroke|hands|body)/i.test(text);
  const hasContact = /(contact|sensual|naked|undress|desire|want you|skin|bare)/i.test(text);
  const hasPeak = /(orgasm|climax|cum|release|over the edge|intense)/i.test(text);
=======
  const hasKiss = KISS_RE.test(text);
  const hasTouch = TOUCH_RE.test(text);
  const hasContact = CONTACT_RE.test(text);
  const hasPeak = PEAK_RE.test(text);
  const hasFlirt = FLIRT_RE.test(text);
>>>>>>> origin/main

  let heatDelta = 0;
  const pace = profile.preferredPace || "slow";
  const multiplier = pace === "intense" ? 2.0 : pace === "build" ? 1.4 : 1.0;

  if (hasPeak) {
    heatDelta += Math.round(30 * multiplier);
  } else if (hasContact) {
    heatDelta += Math.round(20 * multiplier);
  } else if (hasTouch) {
    heatDelta += Math.round(12 * multiplier);
  } else if (hasKiss) {
    heatDelta += Math.round(8 * multiplier);
<<<<<<< HEAD
=======
  } else if (hasFlirt) {
    heatDelta += Math.round(5 * multiplier);
>>>>>>> origin/main
  }

  let nextHeat = Math.min(100, Math.max(0, profile.heat + heatDelta));
  let currentPhase: IntimacyPhase = scene.phase;

<<<<<<< HEAD
  if (currentPhase === "aftercare") {
    // Decay heat in aftercare
    nextHeat = Math.max(10, nextHeat - 5);
  } else {
=======
  if (currentPhase === "aftercare" && heatDelta === 0) {
    // Decay heat in aftercare
    nextHeat = Math.max(10, nextHeat - 5);
  } else {
    // Renewed sensual language after aftercare re-opens the scene instead of
    // pinning it in aftercare forever.
>>>>>>> origin/main
    if (nextHeat >= 80) {
      currentPhase = "peak";
    } else if (nextHeat >= 40) {
      currentPhase = "contact";
    } else if (nextHeat >= 15) {
      currentPhase = "tension";
    } else if (heatDelta > 0) {
      currentPhase = "tension";
<<<<<<< HEAD
=======
    } else if (currentPhase === "aftercare") {
      currentPhase = "closed";
>>>>>>> origin/main
    }
  }

  if (hasKiss) events.push("kiss");
  if (hasTouch) events.push("touch");
  if (hasContact) events.push("contact_language");
<<<<<<< HEAD
=======
  if (hasFlirt) events.push("flirt");
>>>>>>> origin/main

  const nextProfile: IntimacyProfile = {
    ...profile,
    heat: nextHeat,
    lastSceneAt: new Date().toISOString(),
  };

  const nextScene: IntimacyScene = {
    ...scene,
    phase: currentPhase,
    heatPeak: Math.max(scene.heatPeak, nextHeat),
    updatedAt: new Date().toISOString(),
  };

  return {
    events,
    phase: currentPhase,
    heat: nextHeat,
    profile: nextProfile,
    scene: nextScene,
  };
}

export const processIntimacyTurn = evaluateTurn;
