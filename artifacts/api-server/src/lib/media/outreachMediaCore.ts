/**
 * Proactive media, pure half: should this outreach carry a photo or a voice
 * note, within the daily caps? Runtime: ./outreachMedia.ts. Switch `media`.
 *
 * Text stays the default. Media is an occasional gift, chosen by the moment:
 * a voice note when she is reaching out with care or after a storm, a photo
 * for a warm check-in after time apart. Caps apply only to proactive sends.
 */

export type OutreachMediaKind = "photo" | "voice";

export type OutreachMediaConfig = {
  /** Chance a qualifying outreach carries media at all. */
  chance: number;
  /** Rolling 24 h caps for proactive sends. */
  photoCap: number;
  voiceCap: number;
};

export type OutreachMediaInput = {
  /** Agency situation when the tick ran, else null (tick off). */
  situation: string | null;
  intent: "follow_up_thread" | "check_in" | null;
  usedToday: { photo: number; voice: number };
  available: { photo: boolean; voice: boolean };
  /** Uniform [0, 1) draws, injected for tests. */
  roll: number;
  pickRoll: number;
};

function num(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number(v);
  return v != null && v.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

export function outreachMediaConfig(env: Record<string, string | undefined> = process.env): OutreachMediaConfig {
  return {
    chance: num(env.ANIMA_OUTREACH_MEDIA_CHANCE, 0.35, 0, 1),
    photoCap: Math.round(num(env.ANIMA_OUTREACH_PHOTO_DAILY_CAP, 2, 0, 50)),
    voiceCap: Math.round(num(env.ANIMA_OUTREACH_VOICE_DAILY_CAP, 3, 0, 50)),
  };
}

/** Which medium suits the moment, before caps and availability. */
export function preferredMedia(situation: string | null, intent: string | null): OutreachMediaKind[] {
  if (situation === "care_need" || situation === "storm") return ["voice"];
  if (intent === "follow_up_thread") return ["voice", "photo"];
  return ["photo", "voice"];
}

export function chooseOutreachMedia(input: OutreachMediaInput, cfg: OutreachMediaConfig): OutreachMediaKind | null {
  if (input.roll >= cfg.chance) return null;
  const allowed = preferredMedia(input.situation, input.intent).filter((kind) =>
    kind === "photo"
      ? input.available.photo && input.usedToday.photo < cfg.photoCap
      : input.available.voice && input.usedToday.voice < cfg.voiceCap,
  );
  if (!allowed.length) return null;
  // Mostly the first preference; sometimes the other, so it doesn't feel scripted.
  return allowed.length > 1 && input.pickRoll < 0.3 ? allowed[1] : allowed[0];
}

/**
 * A candid, identity-locked scene for the photo pipeline (promptComposer
 * adds her visual identity). Grounded in what she is saying, never the
 * steward's private details.
 */
export function outreachPhotoPrompt(characterName: string, message: string): string {
  const said = String(message || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const who = characterName.trim() || "the companion";
  return [
    `A candid, warm selfie of ${who}, taken as if sent to someone ${who} cares about.`,
    "Natural, intimate framing, soft light, looking toward the camera, a quiet everyday moment.",
    said ? `The mood matches this message: "${said.replace(/"/g, "'")}".` : "",
    "No text, captions, or logos in the image. Fully clothed, safe for a lock screen.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function pushTitleFor(characterName: string, kind: OutreachMediaKind | null): string {
  if (kind === "photo") return `${characterName} sent you a photo`;
  if (kind === "voice") return `${characterName} sent you a voice note`;
  return `${characterName} sent you a message`;
}
