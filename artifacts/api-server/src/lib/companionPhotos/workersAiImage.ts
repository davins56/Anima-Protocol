/**
 * One image from Workers AI through the Worker's `AI` binding (no new
 * binding, no new secret). FLUX.2 models take multipart form data and up to
 * four reference images; FLUX.1 [schnell] takes JSON and text only.
 *
 * Errors are classified so the caller never routes around moderation:
 * a flagged output (Workers AI 3030) is retried at most once on the same
 * model without the reference image, and never sent to the unmoderated
 * text-only fallback.
 */
import type { WorkersAiBinding } from "../aiBinding";
import { isMultipartImageModel } from "./config";
import type { ReferenceImage } from "./appearance";

export type ImageErrorKind = "flagged" | "quota" | "unavailable" | "bad_output";

export class CompanionImageError extends Error {
  constructor(
    message: string,
    readonly kind: ImageErrorKind,
  ) {
    super(message);
    this.name = "CompanionImageError";
  }
}

export function classifyImageError(err: unknown): ImageErrorKind {
  if (err instanceof CompanionImageError) return err.kind;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/\b3030\b|flagged|nsfw|content (policy|moderation)|safety/i.test(msg)) return "flagged";
  if (/\b4006\b|neurons|daily free|quota|rate limit|\b429\b/i.test(msg)) return "quota";
  return "unavailable";
}

export type GeneratedImage = {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  model: string;
  usedReference: boolean;
};

function sniffType(bytes: Uint8Array): GeneratedImage["contentType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function decodeOutput(out: unknown): Promise<Uint8Array> {
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out && typeof (out as ReadableStream).getReader === "function") {
    return new Uint8Array(await new Response(out as ReadableStream).arrayBuffer());
  }
  const b64 =
    (out as { image?: unknown })?.image ??
    (out as { result?: { image?: unknown } })?.result?.image;
  if (typeof b64 === "string" && b64) return new Uint8Array(Buffer.from(b64, "base64"));
  throw new CompanionImageError("The image model returned no image.", "bad_output");
}

export async function runImageModel(args: {
  binding: WorkersAiBinding;
  model: string;
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  reference?: ReferenceImage | null;
}): Promise<GeneratedImage> {
  let raw: unknown;
  const useRef = Boolean(args.reference) && isMultipartImageModel(args.model);
  if (isMultipartImageModel(args.model)) {
    const form = new FormData();
    form.append("prompt", args.prompt);
    form.append("width", String(args.width));
    form.append("height", String(args.height));
    if (typeof args.seed === "number") form.append("seed", String(args.seed));
    if (useRef && args.reference) {
      form.append(
        "input_image_0",
        new Blob([args.reference.bytes as BlobPart], { type: args.reference.contentType }),
        "reference",
      );
    }
    // FormData has no public body/boundary; a Response serializes both.
    const encoded = new Response(form);
    raw = await args.binding.run(args.model, {
      multipart: {
        body: encoded.body,
        contentType: encoded.headers.get("content-type") || "multipart/form-data",
      },
    });
  } else {
    raw = await args.binding.run(args.model, { prompt: args.prompt.slice(0, 2048), steps: 4 });
  }
  const bytes = await decodeOutput(raw);
  const contentType = sniffType(bytes);
  if (!contentType) throw new CompanionImageError("The image model returned unreadable bytes.", "bad_output");
  return { bytes, contentType, model: args.model, usedReference: useRef };
}

/**
 * Primary model with the avatar reference; on a flag, the same model once
 * without the reference (a copyrighted or photographed avatar is a common
 * trigger); on an outage, the text-only fallback model. Flagged twice is final.
 */
export async function generateCompanionImage(args: {
  binding: WorkersAiBinding;
  model: string;
  fallbackModel: string | null;
  prompt: string;
  promptWithoutReference: string;
  width: number;
  height: number;
  seed?: number;
  reference?: ReferenceImage | null;
}): Promise<GeneratedImage> {
  const base = { binding: args.binding, width: args.width, height: args.height, seed: args.seed };
  const withRef = Boolean(args.reference) && isMultipartImageModel(args.model);
  try {
    return await runImageModel({
      ...base,
      model: args.model,
      prompt: withRef ? args.prompt : args.promptWithoutReference,
      reference: withRef ? args.reference : null,
    });
  } catch (err) {
    const kind = classifyImageError(err);
    if (kind === "flagged") {
      if (!withRef) throw new CompanionImageError("The photo was flagged by the image model.", "flagged");
      try {
        return await runImageModel({ ...base, model: args.model, prompt: args.promptWithoutReference, reference: null });
      } catch (retryErr) {
        const retryKind = classifyImageError(retryErr);
        throw new CompanionImageError(
          retryKind === "flagged" ? "The photo was flagged by the image model." : String((retryErr as Error)?.message || retryErr),
          retryKind,
        );
      }
    }
    if (kind === "quota" || !args.fallbackModel || args.fallbackModel === args.model) {
      throw new CompanionImageError(String((err as Error)?.message || err), kind);
    }
    try {
      return await runImageModel({ ...base, model: args.fallbackModel, prompt: args.promptWithoutReference, reference: null });
    } catch (fallbackErr) {
      throw new CompanionImageError(String((fallbackErr as Error)?.message || fallbackErr), classifyImageError(fallbackErr));
    }
  }
}
