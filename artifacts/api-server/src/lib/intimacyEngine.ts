import type {
  IntimacyProfile,
  IntimacyScene,
  IntimacyTurnResult,
  IntimacyPhase,
} from "./intimacyTypes";

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
  const { profile, content, adultEnabled = true, therapyMode = false } = params;
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
  const userSafeword = (profile.safeword || "red").trim().toLowerCase();
  const safewordHit =
    (userSafeword && text.includes(userSafeword)) ||
    (userSafeword !== "red" && text.includes("red"));

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
      if (limit.trim() && text.includes(limit.trim().toLowerCase())) {
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
      if (softLimit.trim() && text.includes(softLimit.trim().toLowerCase())) {
        events.push(`soft_limit:${softLimit}`);
      }
    }
  }

  // 4. Escalation & Heat calculation
  const hasKiss = /(kiss|lips|smooth lips|mouth)/i.test(text);
  const hasTouch = /(touch|embrace|hold|caress|stroke|hands|body)/i.test(text);
  const hasContact = /(contact|sensual|naked|undress|desire|want you|skin|bare)/i.test(text);
  const hasPeak = /(orgasm|climax|cum|release|over the edge|intense)/i.test(text);

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
  }

  let nextHeat = Math.min(100, Math.max(0, profile.heat + heatDelta));
  let currentPhase: IntimacyPhase = scene.phase;

  if (currentPhase === "aftercare") {
    // Decay heat in aftercare
    nextHeat = Math.max(10, nextHeat - 5);
  } else {
    if (nextHeat >= 80) {
      currentPhase = "peak";
    } else if (nextHeat >= 40) {
      currentPhase = "contact";
    } else if (nextHeat >= 15) {
      currentPhase = "tension";
    } else if (heatDelta > 0) {
      currentPhase = "tension";
    }
  }

  if (hasKiss) events.push("kiss");
  if (hasTouch) events.push("touch");
  if (hasContact) events.push("contact_language");

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
