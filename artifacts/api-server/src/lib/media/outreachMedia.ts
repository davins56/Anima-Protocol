/**
 * Proactive media, runtime half (switch `media`). Decides whether an outreach
 * the agency tick (or the proactive clock) already approved should carry a
 * photo or a voice note, produces it, and returns the chat attachment.
 * Never blocks the text: any failure returns null and the message goes out
 * as text. Caps are counted from chat_messages, so no new table.
 */
import { getPool } from "@workspace/db";
import { hasGeminiImageKey } from "../geminiImage";
import { isKernelFeatureEnabled } from "../kernelFeatures";
import { logger } from "../logger";
import { hasFalKey } from "../photo/falClient";
import { generatePhoto, type PhotoEvent } from "../photo/generatePhoto";
import {
  chooseOutreachMedia,
  outreachMediaConfig,
  outreachPhotoPrompt,
  type OutreachMediaKind,
} from "./outreachMediaCore";
import { synthesizeVoiceClip, voiceClipProvider, withTimeout } from "./voiceClip";

const PHOTO_TIMEOUT_MS = 90_000;

export type OutreachAttachment = {
  type: "image" | "audio";
  url: string;
  name: string;
  photo_id?: string;
  character_id?: string;
  transcript?: string;
};

export type OutreachMedia = { kind: OutreachMediaKind; attachment: OutreachAttachment };

/** Public origin the photo pipeline signs reference URLs against when no request is in flight. */
export function appOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.ANIMA_APP_ORIGIN || env.BILLING_APP_ORIGIN || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/.test(raw) ? raw : "https://anima-protocol.com";
}

export async function countOutreachMediaToday(userId: string): Promise<{ photo: number; voice: number }> {
  const { rows } = await getPool().query<{ kind: string; n: number }>(
    `SELECT metadata ->> 'media_kind' AS kind, count(*)::int AS n
       FROM chat_messages
      WHERE user_id = $1
        AND metadata ->> 'source' = 'proactive_push'
        AND metadata ->> 'media_kind' IN ('photo', 'voice')
        AND created_at > now() - interval '24 hours'
      GROUP BY 1`,
    [userId],
  );
  const out = { photo: 0, voice: 0 };
  for (const r of rows) if (r.kind === "photo" || r.kind === "voice") out[r.kind] = Number(r.n) || 0;
  return out;
}

async function producePhoto(args: {
  userId: string;
  characterId: string;
  characterName: string;
  sessionId: string;
  content: string;
}): Promise<OutreachAttachment | null> {
  const got: { imageId: string | null; failure: string | null } = { imageId: null, failure: null };
  const emit = (e: PhotoEvent) => {
    if (e.type === "image") got.imageId = e.imageId;
    if (e.type === "error") got.failure = e.error;
  };
  await generatePhoto(
    {
      userId: args.userId,
      characterId: args.characterId,
      characterName: args.characterName,
      sessionId: args.sessionId,
      prompt: outreachPhotoPrompt(args.characterName, args.content),
      origin: appOrigin(),
      signal: withTimeout(undefined, PHOTO_TIMEOUT_MS),
    },
    emit,
  );
  const imageId = got.imageId;
  if (!imageId) {
    if (got.failure) logger.info({ failure: got.failure }, "outreach media: photo not produced");
    return null;
  }
  return {
    type: "image",
    url: `/api/photo/images/${imageId}/file`,
    name: "Photo",
    photo_id: imageId,
    character_id: args.characterId,
  };
}

async function produceVoice(args: { userId: string; characterId: string; content: string }): Promise<OutreachAttachment> {
  const clip = await synthesizeVoiceClip({ userId: args.userId, characterId: args.characterId, text: args.content });
  return { type: "audio", url: clip.url, name: "Voice note", transcript: clip.transcript };
}

/** Decide, produce, return. Null means "send text only", including on any failure. */
export async function maybeOutreachMedia(args: {
  userId: string;
  characterId: string;
  characterName: string;
  sessionId: string;
  content: string;
  situation: string | null;
  intent: "follow_up_thread" | "check_in" | null;
  random?: () => number;
}): Promise<OutreachMedia | null> {
  if (!isKernelFeatureEnabled("media")) return null;
  const random = args.random ?? Math.random;
  try {
    const usedToday = await countOutreachMediaToday(args.userId);
    const kind = chooseOutreachMedia(
      {
        situation: args.situation,
        intent: args.intent,
        usedToday,
        available: { photo: hasFalKey() || hasGeminiImageKey(), voice: voiceClipProvider() != null },
        roll: random(),
        pickRoll: random(),
      },
      outreachMediaConfig(),
    );
    if (!kind) return null;
    const attachment =
      kind === "photo"
        ? await producePhoto(args)
        : await produceVoice({ userId: args.userId, characterId: args.characterId, content: args.content });
    return attachment ? { kind, attachment } : null;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "outreach media failed; sending text only");
    return null;
  }
}
