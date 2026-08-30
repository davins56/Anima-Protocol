/**
 * Image generate/edit via Google Gemini Flash Image (gemini-2.5-flash-image).
 *
 * Used when OPENAI_API_KEY is missing or gpt-image-1 fails (auth / quota /
 * upstream errors). Requires GEMINI_API_KEY or GOOGLE_API_KEY from AI Studio.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
 */

import { normalizeApiKey } from "./openaiClient";

const DEFAULT_MODEL = "gemini-2.5-flash-image";
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BYTES = 12 * 1024 * 1024;

export type GeminiImageResult = {
  image: string;
  provider: "gemini";
  model: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

export function isFreeImageFallbackEnabled(): boolean {
  const raw = (process.env.IMAGE_FREE_FALLBACK || "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "none");
}

export function geminiImageApiKey(): string | null {
  return (
    normalizeApiKey(process.env.GEMINI_API_KEY) ||
    normalizeApiKey(process.env.GOOGLE_API_KEY)
  );
}

export function hasGeminiImageKey(): boolean {
  return Boolean(geminiImageApiKey());
}

export function geminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

export function geminiImageBaseUrl(): string {
  const raw = process.env.GEMINI_API_BASE_URL?.trim();
  if (!raw) return DEFAULT_BASE;
  return raw.replace(/\/$/, "");
}

function extractInlineImage(parts: GeminiPart[] | undefined): {
  mimeType: string;
  data: string;
} | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const camel = part?.inlineData;
    if (camel?.data) {
      return {
        mimeType: camel.mimeType || "image/png",
        data: camel.data,
      };
    }
    const snake = part?.inline_data;
    if (snake?.data) {
      return {
        mimeType: snake.mime_type || "image/png",
        data: snake.data,
      };
    }
  }
  return null;
}

function mapGeminiHttpError(status: number, bodyText: string): Error {
  let message = bodyText.slice(0, 300) || `Gemini image request failed (${status}).`;
  let code = "server_error";
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string; code?: number };
    };
    if (parsed?.error?.message) message = parsed.error.message;
    const statusName = (parsed?.error?.status || "").toUpperCase();
    if (
      status === 429 ||
      statusName.includes("RESOURCE_EXHAUSTED") ||
      /quota|rate.?limit/i.test(message)
    ) {
      code = "rate_limit";
    } else if (
      status === 401 ||
      status === 403 ||
      statusName.includes("UNAUTHENTICATED") ||
      statusName.includes("PERMISSION_DENIED") ||
      /api key|permission|credential/i.test(message)
    ) {
      code = "auth_error";
      message = "Image generation is temporarily unavailable. Please try again later.";
    } else if (
      status === 400 &&
      (/safety|blocked|prohibited|invalid.?argument.*image|policy/i.test(message) ||
        statusName.includes("INVALID_ARGUMENT"))
    ) {
      // Only treat clearly safety-ish 400s as content_policy; generic 400 stays server_error
      // unless the message mentions safety/block.
      if (/safety|blocked|prohibited|policy/i.test(message)) {
        code = "content_policy";
        message = "That request was blocked by the content safety filter.";
      }
    }
  } catch {
    // keep raw snippet
  }

  const httpStatus =
    code === "auth_error"
      ? 503
      : code === "rate_limit"
        ? 429
        : code === "content_policy"
          ? 400
          : status >= 400 && status < 600
            ? status
            : 502;

  return Object.assign(new Error(message), { status: httpStatus, code });
}

async function callGeminiImage(parts: GeminiPart[]): Promise<GeminiImageResult> {
  const apiKey = geminiImageApiKey();
  if (!apiKey) {
    throw Object.assign(
      new Error(
        "GEMINI_API_KEY (or GOOGLE_API_KEY) must be set for Gemini image generation.",
      ),
      { status: 503, code: "auth_error" },
    );
  }

  const model = geminiImageModel();
  const url = `${geminiImageBaseUrl()}/models/${encodeURIComponent(model)}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "User-Agent": "AnimaProtocol/1.0 (gemini image)",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
      },
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw mapGeminiHttpError(res.status, bodyText);
  }

  let payload: {
    candidates?: Array<{
      content?: { parts?: GeminiPart[] };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  try {
    payload = JSON.parse(bodyText) as typeof payload;
  } catch {
    throw Object.assign(new Error("Gemini returned a non-JSON response."), {
      status: 502,
      code: "server_error",
    });
  }

  if (payload.promptFeedback?.blockReason) {
    throw Object.assign(
      new Error("That request was blocked by the content safety filter."),
      { status: 400, code: "content_policy" },
    );
  }

  const finish = payload.candidates?.[0]?.finishReason || "";
  if (/SAFETY|BLOCK|PROHIBITED/i.test(finish)) {
    throw Object.assign(
      new Error("That request was blocked by the content safety filter."),
      { status: 400, code: "content_policy" },
    );
  }

  const inline = extractInlineImage(payload.candidates?.[0]?.content?.parts);
  if (!inline?.data) {
    throw Object.assign(new Error("Gemini returned no image data."), {
      status: 502,
      code: "server_error",
    });
  }

  // Rough size guard on decoded payload length (base64 ≈ 4/3 of bytes).
  const approxBytes = Math.floor((inline.data.length * 3) / 4);
  if (approxBytes > MAX_BYTES) {
    throw Object.assign(new Error("Gemini returned an image that is too large."), {
      status: 413,
      code: "server_error",
    });
  }

  const mime = inline.mimeType || "image/png";
  return {
    image: `data:${mime};base64,${inline.data}`,
    provider: "gemini",
    model,
  };
}

/** Text-to-image with Gemini Flash Image. */
export async function generateImageWithGemini(prompt: string): Promise<GeminiImageResult> {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) {
    throw Object.assign(new Error("A generation prompt is required."), {
      status: 400,
      code: "invalid_request",
    });
  }
  return callGeminiImage([
    {
      text: [
        "Generate exactly one high-quality character portrait image.",
        "Obey every HARD REQUIREMENT about skin tone / complexion literally.",
        "Do not default to pale or light skin unless the prompt asks for it.",
        "Match the requested skin colour on face, neck, and hands.",
        trimmed.slice(0, 2500),
      ].join("\n"),
    },
  ]);
}

/**
 * Image edit with Gemini Flash Image (source portrait + instruction).
 * Used when OpenAI edit is unavailable.
 */
export async function editImageWithGemini(
  imageDataUrl: string,
  prompt: string,
): Promise<GeminiImageResult> {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) {
    throw Object.assign(new Error("An edit prompt is required."), {
      status: 400,
      code: "invalid_request",
    });
  }
  const match = String(imageDataUrl || "").match(/^data:(.+?);base64,(.*)$/);
  if (!match) {
    throw Object.assign(new Error("A base64 image data URL is required."), {
      status: 400,
      code: "invalid_request",
    });
  }
  const mimeType = match[1] || "image/png";
  const data = match[2];
  if (!data) {
    throw Object.assign(new Error("Malformed image data."), {
      status: 400,
      code: "invalid_request",
    });
  }

  return callGeminiImage([
    {
      text: [
        "Use the attached image as a visual reference for a character portrait.",
        "Preserve facial identity and likeness from the reference.",
        "Apply every HARD REQUIREMENT and appearance instruction in the prompt (hair, outfit, eyes, style, skin tone).",
        "If skin tone / complexion is specified, change it clearly and consistently on face, neck, and hands.",
        "Never ignore a requested skin colour.",
        `Instructions: ${trimmed.slice(0, 2500)}`,
      ].join("\n"),
    },
    { inlineData: { mimeType, data } },
  ]);
}
