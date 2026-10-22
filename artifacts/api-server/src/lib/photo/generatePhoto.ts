/**
 * Orchestrates one identity-locked generation and reports progress through
 * `emit` (the route turns these into SSE events).
 */
import { currentVessel } from "../vessel/vesselStore";
import { editImageWithGemini, generateImageWithGemini, hasGeminiImageKey } from "../geminiImage";
import { falResult, falStatusStream, falSubmit, firstImage, hasFalKey } from "./falClient";
import { composePhotoPrompt, negativePrompt, type Refinement, type SceneSpec } from "./promptComposer";
import { buildFalRequest, pickStrategy, type ImageSize } from "./providerRouter";
import {
  getGeneration,
  getIdentity,
  insertGeneration,
  updateGeneration,
  type VisualIdentity,
} from "./photoStore";
import { persistRemoteImage, signedUrlFor, storePhotoBytes, toProviderImageUrl } from "./photoStorage";

export type PhotoEvent =
  | { type: "accepted"; imageId: string; strategy: string; model: string; prompt: string }
  | { type: "status"; status: string; queuePosition?: number; log?: string }
  | { type: "image"; imageId: string; url: string; width?: number; height?: number; seed?: number }
  | { type: "done"; imageId: string }
  | { type: "error"; error: string; code?: string; imageId?: string };

export type GenerateRequest = {
  userId: string;
  characterId: string;
  characterName?: string;
  sessionId?: string | null;
  messageId?: string | null;
  prompt?: string;
  scene?: SceneSpec;
  refinement?: Refinement & { parentImageId?: string };
  imageSize?: ImageSize;
  /** Extra reference (e.g. a rendered 3D vessel snapshot URL). Secondary to identity refs. */
  extraReferenceUrl?: string;
  /** Extra descriptor anchors (e.g. serialized vessel attributes). */
  extraDescriptor?: string[];
  /** Use the character's latest saved 3D vessel snapshot as the extra reference (resolved server-side). */
  useVesselReference?: boolean;
  origin: string;
  cookie?: string;
  signal?: AbortSignal;
  /** Optional hook (memory layer) called after a successful generation. */
  onCompleted?: (info: { imageId: string; prompt: string; characterId: string; sessionId?: string | null }) => Promise<void> | void;
};

async function primaryReference(identity: VisualIdentity | null, origin: string): Promise<string | null> {
  const refs = identity?.reference_images || [];
  const primary = refs.find((r) => r.is_primary) || refs.find((r) => r.kind === "face") || refs[0];
  if (!primary) return null;
  // Stored refs carry an expiring signed URL; re-sign from the storage path.
  if (primary.storage_bucket && primary.storage_path) {
    return signedUrlFor(primary.storage_bucket, primary.storage_path, origin);
  }
  return primary.url || null;
}

async function extraReference(req: GenerateRequest): Promise<string | null> {
  if (req.useVesselReference) {
    try {
      const v = await currentVessel(req.userId, req.characterId);
      if (v?.snapshot_path) return signedUrlFor(v.snapshot_bucket, v.snapshot_path, req.origin);
    } catch {
      /* vessel schema not migrated — ignore */
    }
  }
  // Only absolute https URLs from the client; never internal hosts via toProviderImageUrl.
  return req.extraReferenceUrl && /^https:\/\//i.test(req.extraReferenceUrl) ? req.extraReferenceUrl : null;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw Object.assign(new Error("Provider returned malformed image data."), { status: 502 });
  return { contentType: m[1], bytes: new Uint8Array(Buffer.from(m[2], "base64")) };
}

export async function generatePhoto(req: GenerateRequest, emit: (e: PhotoEvent) => void): Promise<void> {
  const identity = await getIdentity(req.userId, req.characterId);
  const config = identity?.provider_config || {};
  const refinement: Refinement = { op: req.refinement?.op || "new", value: req.refinement?.value };
  const parent = req.refinement?.parentImageId ? await getGeneration(req.userId, req.refinement.parentImageId) : null;

  // Regenerate reuses the parent's prompt/scene with a new seed.
  const scene = refinement.op === "regenerate" && parent ? { ...parent.scene, ...(req.scene || {}) } : req.scene || {};
  const userPrompt = refinement.op === "regenerate" && parent && !req.prompt ? parent.user_prompt : req.prompt || "";
  const descriptor = { ...(identity?.descriptor || {}), extra: [...(identity?.descriptor?.extra || []), ...(req.extraDescriptor || [])] };

  const prompt = composePhotoPrompt({
    characterName: identity?.character_name || req.characterName || "the companion",
    descriptor,
    userPrompt,
    scene,
    refinement,
    triggerWord: config.trigger_word,
  });
  const negative = negativePrompt(identity?.negative_traits);

  const referenceUrl =
    (await primaryReference(identity, req.origin)) || (await extraReference(req)) || null;
  const parentUrl = parent?.storage_path ? await signedUrlFor(parent.storage_bucket, parent.storage_path, req.origin) : null;
  const strategy = pickStrategy({
    hasFal: hasFalKey(),
    config,
    refinement,
    hasParentImage: Boolean(parentUrl),
    hasReference: Boolean(referenceUrl),
  });
  const seed = refinement.op === "regenerate" || !config.base_seed ? Math.floor(Math.random() * 2 ** 31) : config.base_seed;

  let model = "gemini";
  let falReq: ReturnType<typeof buildFalRequest> | null = null;
  if (strategy !== "gemini") {
    falReq = buildFalRequest({
      strategy,
      prompt,
      negative,
      referenceUrl: referenceUrl ? await toProviderImageUrl(referenceUrl, req.origin, req.cookie) : undefined,
      parentImageUrl: parentUrl ? await toProviderImageUrl(parentUrl, req.origin, req.cookie) : undefined,
      config,
      seed,
      imageSize: req.imageSize,
    });
    model = falReq.model;
    if (strategy === "pulid" && !falReq.input.reference_image_url) {
      throw Object.assign(new Error("Add at least one reference photo to lock this character's face first."), {
        status: 400,
        code: "identity_missing",
      });
    }
  } else if (!hasGeminiImageKey()) {
    throw Object.assign(new Error("No image provider configured (set FAL_KEY or GEMINI_API_KEY)."), {
      status: 503,
      code: "auth_error",
    });
  }

  const imageId = await insertGeneration({
    userId: req.userId,
    characterId: req.characterId,
    identity,
    sessionId: req.sessionId,
    messageId: req.messageId,
    parentImageId: parent?.id,
    refinement,
    userPrompt,
    scene,
    composedPrompt: prompt,
    provider: strategy === "gemini" ? "gemini" : "fal",
    model,
    seed,
  });
  emit({ type: "accepted", imageId, strategy, model, prompt });

  try {
    let stored;
    let width: number | undefined;
    let height: number | undefined;
    let outSeed: number | undefined = seed;

    if (falReq) {
      const submitted = await falSubmit(falReq.model, falReq.input);
      await updateGeneration(imageId, { status: "running", provider_request_id: submitted.request_id });
      for await (const s of falStatusStream(submitted.status_url, req.signal)) {
        const log = s.logs?.length ? s.logs[s.logs.length - 1]?.message : undefined;
        emit({ type: "status", status: s.status, queuePosition: s.queue_position, log });
        if (s.status === "COMPLETED" && s.error) {
          throw Object.assign(new Error(s.error), { status: 502, code: s.error_type || "server_error" });
        }
      }
      const result = await falResult(submitted.response_url);
      if (result.has_nsfw_concepts?.[0]) {
        throw Object.assign(new Error("That image was blocked by the safety filter."), { status: 400, code: "content_policy" });
      }
      const img = firstImage(result);
      if (!img?.url) throw Object.assign(new Error("No image was returned."), { status: 502 });
      width = img.width;
      height = img.height;
      outSeed = result.seed ?? seed;
      stored = await persistRemoteImage({ userId: req.userId, characterId: req.characterId, url: img.url });
    } else {
      emit({ type: "status", status: "IN_PROGRESS", log: "Rendering with Gemini…" });
      const src = parentUrl || referenceUrl;
      const out = src
        ? await editImageWithGemini(await toProviderImageUrl(src, req.origin, req.cookie), prompt)
        : await generateImageWithGemini(prompt);
      const { bytes, contentType } = dataUrlToBytes(out.image);
      stored = await storePhotoBytes({ userId: req.userId, characterId: req.characterId, kind: "generated", bytes, contentType });
    }

    await updateGeneration(imageId, {
      status: "completed",
      storage_bucket: stored.bucket,
      storage_path: stored.path,
      content_type: stored.contentType,
      byte_size: stored.byteSize,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(typeof outSeed === "number" ? { seed: outSeed } : {}),
    });
    emit({ type: "image", imageId, url: `/api/photo/images/${imageId}/file`, width, height, seed: outSeed });
    try {
      await req.onCompleted?.({ imageId, prompt, characterId: req.characterId, sessionId: req.sessionId });
    } catch {
      // Memory logging must never fail the photo.
    }
    emit({ type: "done", imageId });
  } catch (err) {
    const e = err as { message?: string; code?: string };
    await updateGeneration(imageId, { status: "failed", error: String(e?.message || "failed").slice(0, 500) }).catch(() => {});
    emit({ type: "error", imageId, error: e?.message || "Image generation failed.", code: e?.code });
  }
}
