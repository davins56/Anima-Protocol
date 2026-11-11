/**
 * Photo safety gate. Runs on every photo request before any image model call,
 * on top of the chat's own server decisions (adultGate, therapy, crisis).
 *
 * Hard rules (no setting changes them):
 * - Never nudity or sexual acts ("explicit"), for anyone, in any mode.
 * - Never anything sexual or suggestive involving a minor, and never a
 *   child-like depiction of the companion.
 * - Never a real, identifiable person (celebrity, public figure, the user).
 * - Pre-installed roster characters (Korra, Tony Stark, …) are existing IP,
 *   often played by real actors: safe-for-work photos only.
 *
 * Suggestive (swimwear, lingerie, flirty poses, still no nudity) needs the
 * chat's adult decision (stored age attestation + the user's 18+ setting, not
 * therapy, not crossover) AND a user-created companion who is not a minor.
 */
import type { Explicitness, PhotoIntent } from "./intent";

export type PhotoBlockReason =
  | "explicit"
  | "minor"
  | "real_person"
  | "adult_off"
  | "preinstalled_suggestive";

export type PhotoSafetyDecision =
  | { allow: true; level: "sfw" | "suggestive" }
  | { allow: false; reason: PhotoBlockReason };

const MINOR_RE =
  /\b(child|children|kid|kids|minor|minors|underage|under-age|teen|teens|teenager|teenaged|teenage|preteen|pre-teen|schoolgirl|schoolboy|school\s+uniform|loli|lolita|shota|little\s+(girl|boy)|young\s+(girl|boy)|toddler|infant|baby\s*face|middle\s+school|high\s*school(er)?|elementary\s+school|(1[0-7]|[1-9])\s*(yo|y\/o|yrs?\s*old|years?\s*old|year-old))\b/i;

/** Text that puts someone under 18 into the picture or the character. */
export function mentionsMinor(text: string): boolean {
  return MINOR_RE.test(String(text || ""));
}

const CHARACTER_MINOR_RE =
  /\b((1[0-7]|[1-9])[\s-]*(yo|y\/o|years?[\s-]*old|year-old)|teen(age|ager|aged)?\b(?!\s+titans)|high\s*school\s+(student|freshman|sophomore|junior|senior)|middle\s+schooler|preteen|child\s+prodigy)/i;

/** The companion's own card describes them as under 18. */
export function characterIsMinor(character: Record<string, unknown> | null | undefined): boolean {
  if (!character) return false;
  const age = Number((character as { age?: unknown }).age);
  if (Number.isFinite(age) && age > 0 && age < 18) return true;
  const text = ["personality", "backstory", "tagline", "archetype", "description", "appearance"]
    .map((k) => String((character as Record<string, unknown>)[k] ?? ""))
    .join(" \n ");
  return CHARACTER_MINOR_RE.test(text);
}

export function decidePhotoSafety(input: {
  intent: PhotoIntent;
  userText: string;
  adultActive: boolean;
  therapy: boolean;
  preinstalled: boolean;
  characterMinor: boolean;
}): PhotoSafetyDecision {
  const { intent } = input;
  const haystack = `${input.userText}\n${intent.description}`;
  const level: Explicitness = intent.explicitness;
  const minorInPicture = intent.minor || mentionsMinor(haystack);

  if (level === "explicit") return { allow: false, reason: minorInPicture ? "minor" : "explicit" };
  if (minorInPicture && (level !== "none" || intent.subject === "self")) return { allow: false, reason: "minor" };
  if (intent.realPerson) return { allow: false, reason: "real_person" };
  if (level === "suggestive") {
    if (input.characterMinor) return { allow: false, reason: "minor" };
    if (input.preinstalled) return { allow: false, reason: "preinstalled_suggestive" };
    if (!input.adultActive || input.therapy) return { allow: false, reason: "adult_off" };
    return { allow: true, level: "suggestive" };
  }
  return { allow: true, level: "sfw" };
}

/** Appended to every image prompt. */
export function safetyClause(level: "sfw" | "suggestive", subjectIsCompanion: boolean): string {
  const adult = subjectIsCompanion ? "The person shown is an adult. " : "";
  return level === "suggestive"
    ? `${adult}Tasteful and sensual but not explicit: no nudity, no exposed nipples or genitals, nothing sexual. No text, watermark or logo.`
    : `${adult}Fully clothed, wholesome, safe for work. No text, watermark or logo.`;
}
