/**
 * Client for /api/photo/* (identity-locked companion photos).
 * Streams PhotoEvents over SSE from POST /api/photo/generate.
 */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";
import { readSseJsonStream } from "@/lib/readSseJsonStream";

export type RefinementOp = "new" | "regenerate" | "vary_angle" | "outfit" | "expression" | "freeform";

export type SceneSpec = {
  setting?: string;
  mood?: string;
  lighting?: string;
  composition?: string;
  camera?: string;
  outfit?: string;
  expression?: string;
  angle?: string;
};

export type VisualDescriptor = {
  age_range?: string;
  ethnicity?: string;
  skin_tone?: string;
  face_shape?: string;
  eye_color?: string;
  eye_shape?: string;
  hair_color?: string;
  hair_style?: string;
  body_type?: string;
  distinguishing_marks?: string[];
  signature_outfit?: string;
  style?: "photoreal" | "cinematic" | "anime";
};

export type ReferenceImage = {
  url: string;
  storage_bucket?: string | null;
  storage_path?: string;
  kind?: "face" | "half" | "full";
  is_primary?: boolean;
  added_at?: string;
};

export type VisualIdentity = {
  id: string;
  character_id: string;
  character_name: string;
  version: number;
  locked: boolean;
  reference_images: ReferenceImage[];
  descriptor: VisualDescriptor;
  negative_traits: string;
  provider_config: Record<string, unknown>;
};

export type PhotoEvent =
  | { type: "accepted"; imageId: string; strategy: string; model: string; prompt: string }
  | { type: "status"; status: string; queuePosition?: number; log?: string }
  | { type: "image"; imageId: string; url: string; width?: number; height?: number; seed?: number }
  | { type: "done"; imageId: string }
  | { type: "error"; error: string; code?: string; imageId?: string };

export type GeneratePhotoInput = {
  characterId: string;
  characterName?: string;
  sessionId?: string | null;
  messageId?: string | null;
  prompt?: string;
  scene?: SceneSpec;
  refinement?: { op: RefinementOp; value?: string; parentImageId?: string };
  imageSize?: "portrait_4_3" | "portrait_16_9" | "square_hd" | "landscape_4_3" | "landscape_16_9";
  extraReferenceUrl?: string;
  extraDescriptor?: string[];
};

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || res.statusText) as Error & { code?: string; status?: number };
    err.code = body?.code;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export async function fetchIdentity(characterId: string): Promise<VisualIdentity | null> {
  const res = await fetch(apiUrl(`/photo/identity/${encodeURIComponent(characterId)}`), { headers: await authHeaders() });
  return (await json<{ identity: VisualIdentity | null }>(res)).identity;
}

export async function saveIdentity(characterId: string, patch: Partial<VisualIdentity>): Promise<VisualIdentity> {
  const res = await fetch(apiUrl(`/photo/identity/${encodeURIComponent(characterId)}`), {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  return (await json<{ identity: VisualIdentity }>(res)).identity;
}

export async function uploadReference(
  characterId: string,
  dataUrl: string,
  opts: { kind?: ReferenceImage["kind"]; is_primary?: boolean } = {},
): Promise<ReferenceImage> {
  const res = await fetch(apiUrl(`/photo/identity/${encodeURIComponent(characterId)}/references`), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ dataUrl, ...opts }),
  });
  return (await json<{ reference: ReferenceImage }>(res)).reference;
}

export async function listPhotos(filter: { characterId?: string; sessionId?: string; limit?: number }) {
  const q = new URLSearchParams();
  if (filter.characterId) q.set("characterId", filter.characterId);
  if (filter.sessionId) q.set("sessionId", filter.sessionId);
  if (filter.limit) q.set("limit", String(filter.limit));
  const res = await fetch(`${apiUrl("/photo/images")}?${q}`, { headers: await authHeaders() });
  return (await json<{ images: Array<{ id: string; url: string; user_prompt: string; created_at: string }> }>(res)).images;
}

/** Streams generation events; resolves with the final image event (or throws). */
export async function generatePhoto(
  input: GeneratePhotoInput,
  { onEvent, signal }: { onEvent?: (e: PhotoEvent) => void; signal?: AbortSignal } = {},
): Promise<Extract<PhotoEvent, { type: "image" }>> {
  const res = await fetch(apiUrl("/photo/generate"), {
    method: "POST",
    headers: await authHeaders({ Accept: "text/event-stream" }),
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) await json(res);
  let image: Extract<PhotoEvent, { type: "image" }> | null = null;
  for await (const raw of readSseJsonStream(res.body)) {
    const e = raw as PhotoEvent;
    onEvent?.(e);
    if (e.type === "image") image = e;
    if (e.type === "error") {
      const err = new Error(e.error) as Error & { code?: string };
      err.code = e.code;
      throw err;
    }
  }
  if (!image) throw new Error("The photo stream ended without an image.");
  return image;
}

/** Same-origin URL for a stored generation (302s to a signed URL). */
export function photoFileUrl(imageId: string): string {
  return apiUrl(`/photo/images/${imageId}/file`);
}

/** Window event used by inline chat attachments to request a refinement. */
export const PHOTO_REFINE_EVENT = "anima:photo-refine";
export type PhotoRefineDetail = { imageId: string; characterId?: string; op: RefinementOp; value?: string };
export function requestPhotoRefine(detail: PhotoRefineDetail): void {
  window.dispatchEvent(new CustomEvent<PhotoRefineDetail>(PHOTO_REFINE_EVENT, { detail }));
}
