/**
 * Photo note for the text-only anima-chat model.
 *
 * The droplet model cannot see images, and chat stays fail-closed: this
 * module must not call OpenRouter, OpenAI, Workers AI, or any other host.
 * A future on-box vision model replaces `describeSharedPhotos` only.
 */

export const SHARED_PHOTO_MAX = 4;
const VISION_NOTE_MAX_CHARS = 400;

export type SharedPhotoVisionInput = {
  count: number;
};

/**
 * Vision seam. Returns null until a local vision model is plugged in here.
 * Callers must not send the photo to another provider when this returns null.
 */
export async function describeSharedPhotos(
  _input: SharedPhotoVisionInput,
): Promise<string | null> {
  return null;
}

export function photoCountFromMetadata(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const raw = (metadata as { photo_count?: unknown }).photo_count;
  const count = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(SHARED_PHOTO_MAX, Math.floor(count));
}

function capVisionNote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= VISION_NOTE_MAX_CHARS) return flat;
  return `${flat.slice(0, VISION_NOTE_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * One short note for this turn. The caption stays in the user message;
 * this line only tells her a photo is attached and what she is allowed to say.
 */
export function sharedPhotoPromptNote(input: {
  count: number;
  visionSummary?: string | null;
}): string {
  const count = Math.max(0, Math.min(SHARED_PHOTO_MAX, Math.floor(input.count) || 0));
  if (!count) return "";
  const noun = count === 1 ? "a photo" : `${count} photos`;
  const vision = capVisionNote(String(input.visionSummary || ""));
  if (vision) {
    return `The user shared ${noun}. Local vision note: ${vision}. Do not add visual details beyond that note.`;
  }
  return `The user shared ${noun} with this message. You cannot see the image. Do not describe it or pretend you looked. Respond to their words.`;
}
