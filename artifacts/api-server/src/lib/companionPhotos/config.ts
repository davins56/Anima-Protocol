/**
 * Companion photos: settings. All plain env vars (none are secrets).
 * See docs/companion-photos.md.
 */

/** Default image model: FLUX.2 [klein] 4B, which accepts the avatar as a reference image. */
export const DEFAULT_PHOTO_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
/** Text-only fallback when the primary model errors (not when it flags the output). */
export const DEFAULT_PHOTO_FALLBACK_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/**
 * Workers AI FLUX.2 [klein] 4B accepts width/height from 256 to 1920
 * (platform default 1024×768). See
 * https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/
 */
export const PHOTO_SIZE_MIN = 256;
export const PHOTO_SIZE_MAX = 1920;

export type PhotoOrientation = "portrait" | "landscape" | "square";
export type PhotoSize = { width: number; height: number };
export type PhotoSizes = Record<PhotoOrientation, PhotoSize>;

/** High-res defaults: at or above 1024 on the long edge, inside the model max. */
export const DEFAULT_PHOTO_SIZES: PhotoSizes = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1536 },
  landscape: { width: 1536, height: 1024 },
};

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
  sizes: PhotoSizes;
  /** Companions may offer an unprompted photo of a vivid moment. */
  spontaneousEnabled: boolean;
  /** Minimum chat turns in the session after the last unprompted photo. */
  spontaneousMinExchanges: number;
  /** Minimum time after the last unprompted photo. */
  spontaneousCooldownMs: number;
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

function snapDim(n: number): number {
  const clamped = Math.min(PHOTO_SIZE_MAX, Math.max(PHOTO_SIZE_MIN, Math.round(n)));
  return Math.max(PHOTO_SIZE_MIN, Math.min(PHOTO_SIZE_MAX, Math.round(clamped / 8) * 8));
}

/** Parse "1024x1536" or "1024×1536". Invalid values fall back to `d`. */
export function parsePhotoSize(raw: string | undefined, d: PhotoSize): PhotoSize {
  const m = String(raw ?? "").trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!m) return { width: snapDim(d.width), height: snapDim(d.height) };
  return { width: snapDim(Number(m[1])), height: snapDim(Number(m[2])) };
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
    sizes: {
      square: parsePhotoSize(env.ANIMA_COMPANION_PHOTO_SIZE_SQUARE, DEFAULT_PHOTO_SIZES.square),
      portrait: parsePhotoSize(env.ANIMA_COMPANION_PHOTO_SIZE_PORTRAIT, DEFAULT_PHOTO_SIZES.portrait),
      landscape: parsePhotoSize(env.ANIMA_COMPANION_PHOTO_SIZE_LANDSCAPE, DEFAULT_PHOTO_SIZES.landscape),
    },
    // On by default; ANIMA_COMPANION_PHOTO_SPONTANEOUS=off disables unprompted photos.
    spontaneousEnabled: !off(env.ANIMA_COMPANION_PHOTO_SPONTANEOUS),
    spontaneousMinExchanges: int(env.ANIMA_COMPANION_PHOTO_SPONTANEOUS_EXCHANGES, 8, 1, 100),
    spontaneousCooldownMs: int(env.ANIMA_COMPANION_PHOTO_SPONTANEOUS_COOLDOWN_MIN, 20, 1, 24 * 60) * 60_000,
  };
}

/** Multipart (FLUX.2) models take FormData and reference images; FLUX.1 takes JSON. */
export function isMultipartImageModel(model: string): boolean {
  return /black-forest-labs\/flux-2/i.test(model);
}
