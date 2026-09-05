/**
 * Image generate/edit via OpenRouter's dedicated Images API.
 *
 * Production Worker anima-protocol binds OPENROUTER_API_KEY (chat) but not
 * GEMINI_API_KEY / OPENAI_API_KEY. Without this fallback, Customise Anima
 * "Generate Look" always 503s on anima-protocol.com.
 *
 * Docs: https://openrouter.ai/docs/api/api-reference/images/generate-an-image
 */

import {
  getOpenRouterApiKey,
  hasOpenRouterKey,
  OPENROUTER_BASE_URL,
} from "./openaiClient";

const DEFAULT_MODEL = "google/gemini-2.5-flash-image";
const MAX_BYTES = 12 * 1024 * 1024;

export type OpenRouterImageResult = {
  image: string;
  provider: "openrouter";
  model: string;
};

export function openRouterImageModel(): string {
  return (
    process.env.ANIMA_OPENROUTER_IMAGE_MODEL?.trim() ||
    process.env.OPENROUTER_IMAGE_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

export function openRouterImageBaseUrl(): string {
  const raw =
    process.env.ANIMA_OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL;
  return raw.replace(/\/$/, "");
}

function referer(): string {
  return (
    process.env.ANIMA_OPENROUTER_HTTP_REFERER?.trim() ||
    "https://www.anima-protocol.com"
  );
}

function appTitle(): string {
  return process.env.ANIMA_OPENROUTER_APP_TITLE?.trim() || "Anima Protocol";
}

function extractB64(payload: {
  data?: Array<{ b64_json?: string; b64Json?: string; url?: string }>;
}): { mimeType: string; data: string } | null {
  const first = payload?.data?.[0];
  if (!first) return null;
  const b64 = first.b64_json || first.b64Json;
  if (typeof b64 === "string" && b64.trim()) {
    const trimmed = b64.trim();
    if (trimmed.startsWith("data:")) {
      const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
      if (match) return { mimeType: match[1], data: match[2] };
    }
    return { mimeType: "image/png", data: trimmed };
  }
  if (typeof first.url === "string" && first.url.startsWith("data:")) {
    const match = first.url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) return { mimeType: match[1], data: match[2] };
  }
  return null;
}

function mapOpenRouterHttpError(status: number, bodyText: string): Error {
  let message = bodyText.slice(0, 300) || `OpenRouter image request failed (${status}).`;
  let code = "server_error";
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; code?: number | string };
    };
    if (parsed?.error?.message) message = parsed.error.message;
  } catch {
    // keep raw snippet
  }

  if (status === 402 || /credit|quota|payment required/i.test(message)) {
    code = "rate_limit";
    message =
      "The image provider needs credits. Add OpenRouter credits, or bind GEMINI_API_KEY / OPENAI_API_KEY, then retry.";
  } else if (status === 429 || /rate.?limit/i.test(message)) {
    code = "rate_limit";
    message = "The image service is busy right now.";
  } else if (
    status === 401 ||
    status === 403 ||
    /api key|unauthorized|forbidden|authentication/i.test(message)
  ) {
    code = "auth_error";
    message = "Image generation is temporarily unavailable. Please try again later.";
  } else if (status === 400 && /safety|blocked|prohibited|policy|moderation/i.test(message)) {
    code = "content_policy";
    message = "That request was blocked by the content safety filter.";
  }

  const httpStatus =
    code === "auth_error"
      ? 503
      : code === "rate_limit"
        ? status === 402
          ? 503
          : 429
        : code === "content_policy"
          ? 400
          : status >= 400 && status < 600
            ? status
            : 502;

  return Object.assign(new Error(message), { status: httpStatus, code });
}

async function callOpenRouterImages(body: Record<string, unknown>): Promise<OpenRouterImageResult> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw Object.assign(
      new Error(
        "OPENROUTER_API_KEY must be set for OpenRouter image generation.",
      ),
      { status: 503, code: "auth_error" },
    );
  }

  const model = openRouterImageModel();
  const url = `${openRouterImageBaseUrl()}/images`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer(),
      "X-Title": appTitle(),
      "User-Agent": "AnimaProtocol/1.0 (openrouter image)",
    },
    body: JSON.stringify({
      model,
      aspect_ratio: "1:1",
      ...body,
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw mapOpenRouterHttpError(res.status, bodyText);
  }

  let payload: { data?: Array<{ b64_json?: string; b64Json?: string; url?: string }> };
  try {
    payload = JSON.parse(bodyText) as typeof payload;
  } catch {
    throw Object.assign(new Error("OpenRouter returned a non-JSON image response."), {
      status: 502,
      code: "server_error",
    });
  }

  const inline = extractB64(payload);
  if (!inline?.data) {
    throw Object.assign(new Error("OpenRouter returned no image data."), {
      status: 502,
      code: "server_error",
    });
  }

  const approxBytes = Math.floor((inline.data.length * 3) / 4);
  if (approxBytes > MAX_BYTES) {
    throw Object.assign(new Error("OpenRouter returned an image that is too large."), {
      status: 413,
      code: "server_error",
    });
  }

  return {
    image: `data:${inline.mimeType || "image/png"};base64,${inline.data}`,
    provider: "openrouter",
    model,
  };
}

/** Text-to-image via OpenRouter Images API. */
export async function generateImageWithOpenRouter(
  prompt: string,
): Promise<OpenRouterImageResult> {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) {
    throw Object.assign(new Error("A generation prompt is required."), {
      status: 400,
      code: "invalid_request",
    });
  }
  if (!hasOpenRouterKey()) {
    throw Object.assign(
      new Error("OPENROUTER_API_KEY must be set for OpenRouter image generation."),
      { status: 503, code: "auth_error" },
    );
  }
  return callOpenRouterImages({ prompt: trimmed.slice(0, 2500) });
}

/**
 * Image-to-image via OpenRouter `input_references` (same endpoint as generate).
 */
export async function editImageWithOpenRouter(
  imageDataUrl: string,
  prompt: string,
): Promise<OpenRouterImageResult> {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) {
    throw Object.assign(new Error("An edit prompt is required."), {
      status: 400,
      code: "invalid_request",
    });
  }
  if (!String(imageDataUrl || "").startsWith("data:")) {
    throw Object.assign(new Error("A base64 image data URL is required."), {
      status: 400,
      code: "invalid_request",
    });
  }
  if (!hasOpenRouterKey()) {
    throw Object.assign(
      new Error("OPENROUTER_API_KEY must be set for OpenRouter image generation."),
      { status: 503, code: "auth_error" },
    );
  }
  return callOpenRouterImages({
    prompt: trimmed.slice(0, 2500),
    input_references: [imageDataUrl],
  });
}

export const MISSING_IMAGE_PROVIDER_MESSAGE =
  "Image generation is not configured on this server. Bind GEMINI_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY, then redeploy. You can still upload a photo.";

export function missingImageProviderError(): Error {
  return Object.assign(new Error(MISSING_IMAGE_PROVIDER_MESSAGE), {
    status: 503,
    code: "auth_error",
  });
}
