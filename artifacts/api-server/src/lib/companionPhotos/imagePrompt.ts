/**
 * Image prompt for one companion photo: framing + who (appearance anchor) +
 * what the companion chose to show + a style that stays the same for this
 * companion + the safety clause. Deterministic, no model call.
 */
import type { PhotoFraming, PhotoIntent } from "./intent";
import { SKIN_TONE_GUARD, type CompanionLook } from "./appearance";
import { DEFAULT_PHOTO_SIZES, type PhotoOrientation, type PhotoSizes } from "./config";
import { safetyClause } from "./safety";

export type PhotoStyleKind = "illustrated" | "photoreal" | "custom" | "reference";

export type ImagePromptInput = {
  companionName: string;
  universe?: string;
  look: CompanionLook;
  intent: PhotoIntent;
  level: "sfw" | "suggestive";
  /** Pre-installed roster character (existing IP): never photoreal likeness. */
  preinstalled: boolean;
  /** An avatar is attached as image 0. */
  hasReference: boolean;
};

const MAX_PROMPT = 1900;

function clean(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f<>[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const FRAMING: Record<PhotoFraming, string> = {
  selfie: "A casual smartphone selfie taken at arm's length, looking into the camera",
  portrait: "A natural portrait photo, head and shoulders",
  full_body: "A full-body photo",
  closeup: "A close-up photo",
  landscape: "A photo",
};

export function styleFor(input: Pick<ImagePromptInput, "look" | "preinstalled" | "hasReference" | "universe">): {
  kind: PhotoStyleKind;
  text: string;
} {
  if (input.look.style) return { kind: "custom", text: `Art style: ${clean(input.look.style, 120)}.` };
  if (input.preinstalled) {
    const universe = clean(input.universe, 80);
    return {
      kind: "illustrated",
      text: input.hasReference
        ? "Keep the exact art style of image 0 (illustrated, not a photograph of a real person)."
        : `Stylized illustration true to the art style of ${universe || "their story"}, not a photograph of a real person.`,
    };
  }
  if (input.hasReference) {
    return { kind: "reference", text: "Match the look, rendering and art style of image 0." };
  }
  return {
    kind: "photoreal",
    text: "Photorealistic, natural light, shot on a phone camera, true-to-life color, sharp focus.",
  };
}

export function buildImagePrompt(input: ImagePromptInput): string {
  const name = clean(input.companionName, 60) || "the companion";
  const look = clean(input.look.description, 420);
  const scene = clean(input.intent.description, 400);
  const style = styleFor(input);
  const ofCompanion = input.intent.subject === "self";
  const parts: string[] = [];
  if (ofCompanion) {
    const who = input.hasReference
      ? `${name}, the exact same character as in image 0 (same face, hair, features, colors and outfit style)`
      : name;
    parts.push(`${FRAMING[input.intent.framing] || FRAMING.selfie} of ${who}.`);
    if (look) parts.push(`${name}: ${look}.`);
    const skin = clean(input.look.skinTone, 80);
    if (skin) parts.push(`${name}'s skin tone, exactly: ${skin}.`);
    const signature = clean(input.look.signature, 200);
    if (signature) parts.push(`Always visible: ${signature}.`);
    if (scene) parts.push(`Scene: ${scene}.`);
  } else {
    parts.push(
      `${FRAMING[input.intent.framing] || FRAMING.landscape} taken by ${name} on their phone, from their point of view: ${scene || "what they see right now"}.`,
    );
    parts.push("Candid and personal, like a photo sent to someone close.");
    if (input.hasReference) parts.push("Image 0 shows the photographer; use it only for the world's art style and colors.");
  }
  parts.push(SKIN_TONE_GUARD);
  parts.push(style.text);
  parts.push(safetyClause(input.level, ofCompanion));
  return parts.join(" ").slice(0, MAX_PROMPT);
}

/** Stable per companion, so photos keep a consistent look between requests. */
export function companionSeed(characterId: string, salt: string | number = 0): number {
  let h = 2166136261 >>> 0;
  const s = `${characterId}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 2_147_483_647;
}

export function orientationOf(
  intent: PhotoIntent,
  brief?: { orientation?: PhotoOrientation } | null,
): PhotoOrientation {
  if (brief?.orientation === "portrait" || brief?.orientation === "landscape" || brief?.orientation === "square") {
    return brief.orientation;
  }
  if (intent.framing === "landscape" && intent.subject !== "self") return "landscape";
  if (
    intent.framing === "selfie" ||
    intent.framing === "portrait" ||
    intent.framing === "closeup" ||
    intent.framing === "full_body"
  ) {
    return "portrait";
  }
  return "square";
}

/** Largest configured size for the scene's orientation (portrait / landscape / square). */
export function photoSize(
  intent: PhotoIntent,
  sizes: PhotoSizes = DEFAULT_PHOTO_SIZES,
  brief?: { orientation?: PhotoOrientation } | null,
): { width: number; height: number } {
  const kind = orientationOf(intent, brief);
  return sizes[kind] ?? sizes.square;
}
