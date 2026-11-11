/**
 * Companion photos inside one chat turn (routes/chat.ts):
 *
 *   planCompanionPhoto   before the prompt: is this a photo request, is it
 *                        allowed, is the user under their limit?
 *   photoDirective       one line for the companion: write a caption for the
 *                        photo you are sending / decline in character.
 *   startCompanionPhoto  kicks off generation while the text streams.
 *   settleCompanionPhoto after the text: wait (bounded) for the photo, then
 *                        an attachment for the message or an in-character
 *                        failure line.
 *   recordPhotoMemory    a memory_events note so she remembers what she sent.
 */
import { aiBinding, type WorkersAiBinding } from "../aiBinding";
import { isPreinstalledCharacter } from "../companions/builtIn";
import { storeUploadedImage, UPLOADS_PATH_PREFIX } from "../imageUploads";
import { appendMemoryEvent } from "../memoryCore/memoryCore";
import { extractWorkersAiText, workersAiBackgroundModel } from "../workersAi";
import { companionLook, loadReferenceImage, type CompanionLook } from "./appearance";
import { companionPhotoConfig, isMultipartImageModel, type CompanionPhotoConfig } from "./config";
import { buildImagePrompt, companionSeed, photoSize } from "./imagePrompt";
import { classifyPhotoIntent, type IntentCompleter, type IntentMessage, type PhotoIntent } from "./intent";
import { checkPhotoLimit, notePhotoSent, notePhotoStarted, photoUsage } from "./rateLimit";
import { characterIsMinor, decidePhotoSafety, type PhotoBlockReason } from "./safety";
import { classifyImageError, generateCompanionImage, type ImageErrorKind } from "./workersAiImage";

export type PhotoDeclineReason = PhotoBlockReason | "limit_hour" | "limit_day";

export type PhotoPlan =
  | { action: "none" }
  | {
      action: "send";
      intent: PhotoIntent;
      level: "sfw" | "suggestive";
      look: CompanionLook;
      preinstalled: boolean;
    }
  | { action: "decline"; intent: PhotoIntent; reason: PhotoDeclineReason; preinstalled: boolean };

export type CompanionPhotoAttachment = {
  type: "image";
  url: string;
  name: string;
  source: "companion_photo";
  character_id: string;
  description: string;
  model: string;
  width: number;
  height: number;
};

export type PhotoOutcome =
  | { status: "sent"; attachment: CompanionPhotoAttachment; usedReference: boolean; ms: number }
  | { status: "failed"; errorKind: PhotoFailureKind; ms: number };

export type PhotoFailureKind = ImageErrorKind | "timeout" | "storage";

type Character = Record<string, unknown>;

function hasImageBinding(binding: WorkersAiBinding | undefined): binding is WorkersAiBinding {
  return typeof binding?.run === "function";
}

/** Whether chat photos can run on this deployment (no secrets in the answer). */
export function companionPhotosAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return companionPhotoConfig(env).enabled && hasImageBinding(aiBinding);
}

/** The background model, JSON-only, bounded. */
export function workersAiIntentCompleter(binding: WorkersAiBinding | undefined = aiBinding): IntentCompleter | null {
  if (!hasImageBinding(binding)) return null;
  return async (messages, opts) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("photo intent timed out")), opts.timeoutMs);
    });
    try {
      const out = await Promise.race([
        binding.run(workersAiBackgroundModel(), {
          messages,
          max_tokens: opts.maxTokens,
          temperature: 0,
        }),
        timeout,
      ]);
      return extractWorkersAiText(out);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export async function planCompanionPhoto(input: {
  userId: string;
  character: Character | null | undefined;
  companionName: string;
  userMessage: string;
  recent: IntentMessage[];
  mode: string;
  isContinue: boolean;
  adultActive: boolean;
  therapy: boolean;
  crisis: boolean;
  config?: CompanionPhotoConfig;
  complete?: IntentCompleter | null;
  binding?: WorkersAiBinding | undefined;
  usage?: (userId: string) => Promise<{ hour: number; day: number }>;
  /** Already-known intent (the companion's own [IMAGE: …] tag): skip classification. */
  intent?: PhotoIntent | null;
}): Promise<PhotoPlan> {
  const config = input.config ?? companionPhotoConfig();
  const binding = input.binding ?? aiBinding;
  if (!config.enabled || !hasImageBinding(binding)) return { action: "none" };
  if (input.mode !== "solo" || input.isContinue || input.crisis || !input.character) return { action: "none" };
  const intent =
    input.intent ??
    (await classifyPhotoIntent({
      companionName: input.companionName,
      userMessage: input.userMessage,
      recent: input.recent,
      complete: input.complete === undefined ? workersAiIntentCompleter(binding) : input.complete,
    }));
  if (!intent) return { action: "none" };
  const preinstalled = isPreinstalledCharacter(input.character);
  const safety = decidePhotoSafety({
    intent,
    userText: input.userMessage,
    adultActive: input.adultActive,
    therapy: input.therapy,
    preinstalled,
    characterMinor: characterIsMinor(input.character),
  });
  if (!safety.allow) return { action: "decline", intent, reason: safety.reason, preinstalled };
  const usage = await (input.usage ?? photoUsage)(input.userId);
  const limit = checkPhotoLimit(usage, config);
  if (!limit.allowed) {
    return { action: "decline", intent, reason: limit.window === "day" ? "limit_day" : "limit_hour", preinstalled };
  }
  return { action: "send", intent, level: safety.level, look: companionLook(input.character), preinstalled };
}

const NO_META =
  "Stay fully in character: never mention rules, filters, policies, systems, models or being an AI.";

/** One instruction for the reply, or "" when this turn has no photo. */
export function photoDirective(plan: PhotoPlan): string {
  if (plan.action === "none") return "";
  if (plan.action === "send") {
    const what = plan.intent.description || (plan.intent.subject === "self" ? "a selfie" : "what you see right now");
    return (
      `PHOTO: With this message you are sending them a photo you just took: ${what}. ` +
      "Write a short, natural caption in your own voice (one to three sentences), the way you would text it alongside the photo. " +
      "Do not describe the picture in detail, do not write tags, brackets or stage directions about sending it, and never say you cannot send photos. " +
      NO_META
    );
  }
  const why: Record<PhotoDeclineReason, string> = {
    explicit: "They asked for an explicit photo. You won't send that kind of picture; turn it down warmly or playfully, without a lecture, and keep the moment going.",
    adult_off: "They asked for a suggestive photo. You keep your photos sweet rather than spicy here; decline lightly and offer a different, wholesome photo instead.",
    preinstalled_suggestive: "They asked for a suggestive photo. You don't send that kind of picture; decline lightly and offer a different, wholesome photo instead.",
    minor: "They asked for a picture you will never send. Decline firmly but kindly and move the conversation somewhere else.",
    real_person: "They asked for a photo of a real person. You only share pictures of yourself and your own world; say so lightly and offer one of those instead.",
    limit_hour: "They asked for a photo, but you've already sent several just now. Say you'll send another in a little while, lightly.",
    limit_day: "They asked for a photo, but you've sent plenty today. Say you'll send more tomorrow, lightly.",
  };
  return `PHOTO: You are NOT sending a photo with this message. ${why[plan.reason]} Do not pretend a photo is attached. ${NO_META}`;
}

export function startCompanionPhoto(input: {
  plan: Extract<PhotoPlan, { action: "send" }>;
  userId: string;
  characterId: string;
  companionName: string;
  character: Character;
  turnId: string;
  config?: CompanionPhotoConfig;
  binding?: WorkersAiBinding;
  loadReference?: typeof loadReferenceImage;
  store?: typeof storeUploadedImage;
}): Promise<PhotoOutcome> {
  const config = input.config ?? companionPhotoConfig();
  const binding = input.binding ?? aiBinding;
  const startedAt = Date.now();
  const release = notePhotoStarted(input.userId);
  return (async (): Promise<PhotoOutcome> => {
    if (!hasImageBinding(binding)) return { status: "failed", errorKind: "unavailable", ms: 0 };
    const { plan } = input;
    const wantRef = config.useAvatarReference && isMultipartImageModel(config.model);
    const reference = wantRef
      ? await (input.loadReference ?? loadReferenceImage)(input.character.avatar_url ?? input.character.image_url)
      : null;
    const base = {
      companionName: input.companionName,
      universe: typeof input.character.universe === "string" ? input.character.universe : undefined,
      look: plan.look,
      intent: plan.intent,
      level: plan.level,
      preinstalled: plan.preinstalled,
    };
    const { width, height } = photoSize(plan.intent);
    let image;
    try {
      image = await generateCompanionImage({
        binding,
        model: config.model,
        fallbackModel: config.fallbackModel,
        prompt: buildImagePrompt({ ...base, hasReference: Boolean(reference) }),
        promptWithoutReference: buildImagePrompt({ ...base, hasReference: false }),
        width,
        height,
        seed: companionSeed(input.characterId, input.turnId),
        reference,
      });
    } catch (err) {
      return { status: "failed", errorKind: classifyImageError(err), ms: Date.now() - startedAt };
    }
    let stored;
    try {
      stored = await (input.store ?? storeUploadedImage)(input.userId, {
        contentType: image.contentType,
        dataBase64: Buffer.from(image.bytes).toString("base64"),
      });
    } catch {
      return { status: "failed", errorKind: "storage", ms: Date.now() - startedAt };
    }
    notePhotoSent(input.userId);
    return {
      status: "sent",
      usedReference: image.usedReference,
      ms: Date.now() - startedAt,
      attachment: {
        type: "image",
        url: `/api/storage${UPLOADS_PATH_PREFIX}${stored.id}`,
        name: `Photo from ${input.companionName}`,
        source: "companion_photo",
        character_id: input.characterId,
        description: plan.intent.description.slice(0, 400),
        model: image.model,
        width,
        height,
      },
    };
  })()
    .catch((): PhotoOutcome => ({ status: "failed", errorKind: "unavailable", ms: Date.now() - startedAt }))
    .finally(release);
}

/** Wait for the photo, but never longer than the deadline. */
export async function settleCompanionPhoto(job: Promise<PhotoOutcome>, deadlineAt: number): Promise<PhotoOutcome> {
  const wait = Math.max(0, deadlineAt - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PhotoOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: "failed", errorKind: "timeout", ms: wait }), wait);
  });
  try {
    return await Promise.race([job, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const FAILURE_LINES: Record<"flagged" | "quota" | "other", string[]> = {
  flagged: [
    "Hm, that shot didn't come out right, so I'm keeping it to myself. Ask me for a different one?",
    "Okay, that one's not going out. Let me take a better one for you later.",
  ],
  quota: [
    "My camera's out of juice for today. I'll send you one later, promise.",
    "Ugh, the photo won't go through right now. Remind me later and I'll send one.",
  ],
  other: [
    "Ugh, the photo won't send right now. Try asking me again in a bit?",
    "Hm, my picture didn't go through. Ask me again in a minute?",
  ],
};

/** In-character line appended to the reply when the photo could not be sent. */
export function photoFailureLine(kind: PhotoFailureKind, salt: string): string {
  const bucket = kind === "flagged" ? "flagged" : kind === "quota" ? "quota" : "other";
  const lines = FAILURE_LINES[bucket];
  let h = 0;
  for (let i = 0; i < salt.length; i++) h = (h * 31 + salt.charCodeAt(i)) >>> 0;
  return lines[h % lines.length];
}

/** Turn ledger / done-payload summary (no prompt text, no secrets). */
export function photoMetadata(plan: PhotoPlan, outcome: PhotoOutcome | null): Record<string, unknown> | null {
  if (plan.action === "none") return null;
  if (plan.action === "decline") return { status: "declined", reason: plan.reason, source: plan.intent.source };
  if (!outcome) return { status: "pending", source: plan.intent.source };
  if (outcome.status === "sent") {
    return {
      status: "sent",
      source: plan.intent.source,
      level: plan.level,
      model: outcome.attachment.model,
      used_reference: outcome.usedReference,
      url: outcome.attachment.url,
      ms: outcome.ms,
    };
  }
  return { status: "failed", source: plan.intent.source, error: outcome.errorKind, ms: outcome.ms };
}

/** Memory stream note so the companion remembers what she sent. */
export async function recordPhotoMemory(input: {
  userId: string;
  characterId: string;
  sessionId: string;
  turnId: string;
  attachment: CompanionPhotoAttachment;
  append?: typeof appendMemoryEvent;
}): Promise<void> {
  const description = input.attachment.description || "a photo";
  await (input.append ?? appendMemoryEvent)({
    userId: input.userId,
    characterId: input.characterId,
    eventType: "note",
    content: `I sent them a photo I took: ${description}`,
    payload: {
      kind: "companion_photo",
      turn_id: input.turnId,
      url: input.attachment.url,
      description,
      model: input.attachment.model,
    },
    emotionalWeight: 0.55,
    conversationId: input.sessionId,
    dedupeKey: `photo:${input.turnId}`,
    source: "chat",
  });
}
