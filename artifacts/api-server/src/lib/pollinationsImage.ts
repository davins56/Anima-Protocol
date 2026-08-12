/**
 * Free text-to-image via Pollinations.ai (FLUX by default).
 *
 * Used as a fallback when OPENAI_API_KEY is missing or gpt-image-1 fails
 * (auth / quota / upstream errors). No API key required for basic use.
 *
 * Docs: https://github.com/pollinations/pollinations/blob/master/APIDOCS.md
 */

const DEFAULT_BASE = "https://image.pollinations.ai";
const DEFAULT_MODEL = "flux";
const DEFAULT_SIZE = 1024;
const MAX_BYTES = 12 * 1024 * 1024;

export type FreeImageResult = {
  /** PNG/JPEG/WebP data URL suitable for the existing client contract. */
  image: string;
  provider: "pollinations";
  model: string;
};

export function isFreeImageFallbackEnabled(): boolean {
  const raw = (process.env.IMAGE_FREE_FALLBACK || "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "none");
}

export function pollinationsBaseUrl(): string {
  const raw = process.env.POLLINATIONS_BASE_URL?.trim();
  if (!raw) return DEFAULT_BASE;
  return raw.replace(/\/$/, "");
}

export function pollinationsModel(): string {
  return process.env.POLLINATIONS_MODEL?.trim() || DEFAULT_MODEL;
}

/** Build the GET URL Pollinations serves images from. Exported for tests. */
export function buildPollinationsImageUrl(
  prompt: string,
  opts: { width?: number; height?: number; model?: string; seed?: number } = {},
): string {
  const trimmed = prompt.trim().slice(0, 1000);
  // Pollinations expects the prompt in the path; encodeURIComponent keeps it safe.
  const pathPrompt = encodeURIComponent(trimmed);
  const width = opts.width ?? DEFAULT_SIZE;
  const height = opts.height ?? DEFAULT_SIZE;
  const model = opts.model ?? pollinationsModel();
  const params = new URLSearchParams({
    model,
    width: String(width),
    height: String(height),
    nologo: "true",
    // Keep generated looks out of the public community feed.
    private: "true",
  });
  if (typeof opts.seed === "number" && Number.isFinite(opts.seed)) {
    params.set("seed", String(Math.trunc(opts.seed)));
  }
  return `${pollinationsBaseUrl()}/prompt/${pathPrompt}?${params.toString()}`;
}

function mimeFromContentType(ct: string | null): string {
  const lower = (ct || "").toLowerCase();
  if (lower.includes("png")) return "image/png";
  if (lower.includes("webp")) return "image/webp";
  if (lower.includes("gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Generate an image from a text prompt using the free Pollinations endpoint.
 * Returns a data URL matching `/api/openai/image-generate`.
 */
export async function generateImageWithPollinations(
  prompt: string,
  opts: { signal?: AbortSignal; width?: number; height?: number; seed?: number } = {},
): Promise<FreeImageResult> {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) {
    throw Object.assign(new Error("A generation prompt is required."), {
      status: 400,
      code: "invalid_request",
    });
  }

  const model = pollinationsModel();
  const url = buildPollinationsImageUrl(trimmed, {
    width: opts.width,
    height: opts.height,
    model,
    seed: opts.seed,
  });

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "image/*",
      "User-Agent": "AnimaProtocol/1.0 (free image fallback)",
    },
    signal: opts.signal,
  });

  if (!res.ok) {
    const status = res.status >= 400 && res.status < 600 ? res.status : 502;
    const code =
      status === 429
        ? "rate_limit"
        : status === 400 || status === 422
          ? "content_policy"
          : "server_error";
    throw Object.assign(
      new Error(`Free image provider failed (${status}).`),
      { status, code },
    );
  }

  const mime = mimeFromContentType(res.headers.get("content-type"));
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    throw Object.assign(new Error("Free image provider returned an empty image."), {
      status: 502,
      code: "server_error",
    });
  }
  if (buf.length > MAX_BYTES) {
    throw Object.assign(new Error("Free image provider returned an image that is too large."), {
      status: 413,
      code: "server_error",
    });
  }

  return {
    image: `data:${mime};base64,${buf.toString("base64")}`,
    provider: "pollinations",
    model,
  };
}
