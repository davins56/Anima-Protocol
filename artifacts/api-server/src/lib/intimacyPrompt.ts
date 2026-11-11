import type { IntimacyProfile, IntimacyScene, IntimacyTurnResult } from "./intimacyTypes";

export function getIntimacyPromptGuidance(
  profile: IntimacyProfile,
  scene?: IntimacyScene,
  result?: IntimacyTurnResult,
  /** Long-term Synchro tier label. Shapes ease of expression only, never Heat or limits. */
  synchroTier?: string | null,
): string {
  if (!profile.intimacyEnabled || result?.blockIntimacy) {
    return "Never explicit or anatomical content.";
  }

  const heat = result?.heat ?? profile.heat ?? 0;
  const phase = result?.phase ?? scene?.phase ?? "closed";
  const pace = profile.preferredPace || "slow";

  const parts: string[] = [
    `INTIMACY ENGINE ACTIVE (Heat: ${heat}/100, Phase: ${phase.toUpperCase()}, Preferred Pace: ${pace.toUpperCase()}):`,
  ];

  if (synchroTier) {
    parts.push(
      `- Long-term bond: ${synchroTier}. Established trust can make affection feel natural and unforced in your own manner, ` +
        `but it is not Heat: Heat stays ${heat}/100 and moves only with the user's current cues, and no limit or safeword weakens because the bond is strong. ` +
        `You may still decline or slow things.`,
    );
  }

  if (profile.safeword) {
    parts.push(`- Safeword is "${profile.safeword}". If spoken or requested by user, immediately transition to gentle aftercare.`);
  }

  if (profile.limits?.length) {
    parts.push(`- Hard Limits (STRICT BOUNDARIES): ${profile.limits.join(", ")}. Never cross or push these.`);
  }

  if (profile.softLimits?.length) {
    parts.push(`- Soft Limits (Handle with care and check in): ${profile.softLimits.join(", ")}.`);
  }

  if (profile.kinks?.length) {
    parts.push(`- Expressed Preferences / Kinks: ${profile.kinks.join(", ")}.`);
  }

  if (profile.anatomy && Object.keys(profile.anatomy).length > 0) {
    const anatomyDesc = Object.entries(profile.anatomy)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    if (anatomyDesc) {
      parts.push(`- Known Companion Anatomy & Characteristics: ${anatomyDesc}`);
    }
  }

  if (phase === "aftercare") {
    parts.push(
      `- AFTERCARE PHASE: Focus completely on emotional grounding, warmth, physical closeness, and gentle verbal check-in (${profile.aftercareStyle || "gentle grounding"}).`,
    );
  } else if (phase === "peak") {
    parts.push(
      `- PEAK PHASE: High intensity, vivid sensual presence and deep passion while keeping pace and boundaries intact.`,
    );
  } else if (phase === "contact") {
    parts.push(
      `- CONTACT PHASE: Tactile closeness, physical intimacy, and heightened emotional/sensual focus.`,
    );
  } else if (phase === "tension") {
    parts.push(
      `- TENSION PHASE: Anticipation, subtle touch, atmospheric heat, and emotional build-up.`,
    );
  }

  return parts.join("\n");
}

export const buildIntimacyPromptBlock = getIntimacyPromptGuidance;
