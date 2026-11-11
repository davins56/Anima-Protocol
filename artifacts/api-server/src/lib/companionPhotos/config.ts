/**
 * Companion photos: settings. All plain env vars (none are secrets).
 * See docs/companion-photos.md.
 */

/** Default image model: FLUX.2 [klein] 4B, which accepts the avatar as a reference image. */
export const DEFAULT_PHOTO_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
/** Text-only fallback when the primary model errors (not when it flags the output). */
export const DEFAULT_PHOTO_FALLBACK_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export type CompanionPhotoConfig = {
  enabled: boolean;
  model: string;
  fallbackModel: string | null;
  dailyLimit: number;
  hourlyLimit: number;
  /** Longest a reply waits for its photo after the text is done. */
  timeoutMs: number;
  /** Send the companion's avatar as a reference image (identity lock). */
  useAvatarReference: boolean;
};

type Env = Record<string, string | undefined>;

function off(raw: string | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "off" || v === "no";
}

function int(raw: string | undefined, d: number, min: number, max: number): number {
  const n = Number(String(raw ?? "").trim());
  if (raw == null || String(raw).trim() === "" || !Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function modelId(raw: string | undefined, d: string): string {
  const v = String(raw ?? "").trim();
  return /^@(cf|hf)\//.test(v) ? v : d;
}

export function companionPhotoConfig(env: Env = process.env): CompanionPhotoConfig {
  const fallbackRaw = String(env.ANIMA_COMPANION_PHOTO_FALLBACK_MODEL ?? "").trim();
  return {
    // On by default; ANIMA_COMPANION_PHOTOS=off is the kill switch.
    enabled: !off(env.ANIMA_COMPANION_PHOTOS),
    model: modelId(env.ANIMA_COMPANION_PHOTO_MODEL, DEFAULT_PHOTO_MODEL),
    fallbackModel: off(fallbackRaw)
      ? null
      : modelId(fallbackRaw, DEFAULT_PHOTO_FALLBACK_MODEL),
    dailyLimit: int(env.ANIMA_COMPANION_PHOTO_DAILY_LIMIT, 20, 0, 500),
    hourlyLimit: int(env.ANIMA_COMPANION_PHOTO_HOURLY_LIMIT, 6, 0, 100),
    timeoutMs: int(env.ANIMA_COMPANION_PHOTO_TIMEOUT_MS, 45_000, 5_000, 120_000),
    useAvatarReference: !off(env.ANIMA_COMPANION_PHOTO_REFERENCE),
  };
}

/** Multipart (FLUX.2) models take FormData and reference images; FLUX.1 takes JSON. */
export function isMultipartImageModel(model: string): boolean {
  return /black-forest-labs\/flux-2/i.test(model);
}
