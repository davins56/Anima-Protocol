/**
 * What the companion looks like, for the image prompt, and the avatar bytes
 * to hand the image model as an identity reference.
 *
 * Text, first match wins:
 * 1. `appearance_prompts` from Customise Anima (skin, hair, eyes, outfit, style).
 * 2. Explicit card fields (`appearance`, `physical_description`, `looks`, …).
 * 3. The built-in Animas' canonical look (Serenity, Aeland, Scarlet).
 * 4. Sentences about looks mined from the personality / backstory.
 * The avatar reference (FLUX.2) carries the face and art style either way.
 */
import { builtInKeyFor } from "../companions/builtIn";
import { getUploadedImage, objectPathForUploadId } from "../imageUploads";
import { assetsBinding } from "../assetsBinding";

export type CompanionLook = {
  /** Comma-joined visual anchors (no name). Empty when nothing is known. */
  description: string;
  /** Art style hint from the card (Customise Anima → Art Style), if any. */
  style: string;
  source: "appearance_prompts" | "card" | "built_in" | "mined" | "none";
  /** Features that must show in every photo of her (built-in Animas). */
  signature?: string;
};

/**
 * The model drops small-in-frame features (wings in a selfie) unless told
 * they are always there. Not applied when the user customised her look.
 */
const BUILT_IN_SIGNATURES: Record<string, string> = {
  serenity: "her large crystalline angelic wings, visible behind her shoulders, and her soft white hair",
  aeland: "her long black braids and softly glowing violet eyes",
  scarlet: "her wild crimson-red hair and glowing amber eyes",
};

const BUILT_IN_LOOKS: Record<string, string> = {
  serenity:
    "a luminous angelic woman with soft white hair, gentle violet-silver eyes and warm golden-brown skin, " +
    "large crystalline angelic wings that catch the light, a faint halo glow, flowing white-and-silver gown with gold and amethyst jewellery",
  aeland:
    "a serene woman with long black braided hair, softly glowing violet eyes and warm tan skin, " +
    "deep indigo gown with lavender accents, a faint misty aura",
  scarlet:
    "a fierce woman with wild crimson-red hair, glowing amber eyes and fair warm skin, " +
    "black bodysuit with orange flame accents and a choker, a subtle flame aura",
};

const CARD_FIELDS = [
  "appearance",
  "physical_appearance",
  "physical_description",
  "visual_description",
  "appearance_description",
  "looks",
  "look",
] as const;

const LOOK_WORDS =
  /\b(hair|eyes?|skin|freckles?|tattoos?|scars?|wings?|horns?|tail|ears|beard|glasses|tall|short|petite|muscular|slender|wears|wearing|dressed|outfit|cloak|armor|armour|robe|gown|jacket|halo|glow(ing)?|complexion)\b/i;

function clean(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f<>[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function fromAppearancePrompts(raw: unknown): { text: string; style: string } {
  if (!raw || typeof raw !== "object") return { text: "", style: "" };
  const p = raw as Record<string, unknown>;
  const parts = [
    p.skin && `${clean(p.skin, 80)} skin`,
    p.hair && clean(p.hair, 120),
    p.eyes && clean(p.eyes, 80),
    p.outfit && `wearing ${clean(p.outfit, 140)}`,
  ].filter(Boolean) as string[];
  return { text: parts.join(", "), style: clean(p.style, 120) };
}

/** Sentences from free text that describe how someone looks. */
export function minedLookSentences(text: string, max = 260): string {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 220 && LOOK_WORDS.test(s));
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return clean(out, max);
}

export function companionLook(character: Record<string, unknown> | null | undefined): CompanionLook {
  const look = baseLook(character);
  const c = (character || {}) as Record<string, unknown>;
  const key = builtInKeyFor(c.name);
  if (key && look.source !== "appearance_prompts" && (c._isAnima === true || !/^seed_/i.test(String(c.id ?? "")))) {
    return { ...look, signature: BUILT_IN_SIGNATURES[key] };
  }
  return look;
}

function baseLook(character: Record<string, unknown> | null | undefined): CompanionLook {
  const c = (character || {}) as Record<string, unknown>;
  const prompts = fromAppearancePrompts(c.appearance_prompts);
  if (prompts.text) return { description: prompts.text, style: prompts.style, source: "appearance_prompts" };
  for (const field of CARD_FIELDS) {
    const v = clean(c[field], 400);
    if (v) return { description: v, style: prompts.style, source: "card" };
  }
  const key = builtInKeyFor(c.name);
  if (key && (c._isAnima === true || !/^seed_/i.test(String(c.id ?? "")))) {
    return { description: BUILT_IN_LOOKS[key], style: prompts.style, source: "built_in" };
  }
  const mined = minedLookSentences(`${String(c.backstory ?? "")} ${String(c.personality ?? "")}`);
  if (mined) return { description: mined, style: prompts.style, source: "mined" };
  return { description: "", style: prompts.style, source: "none" };
}

export type ReferenceImage = { bytes: Uint8Array; contentType: string };

const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const REFERENCE_TIMEOUT_MS = 5_000;

function imageType(contentType: string | null | undefined): string | null {
  const t = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (t === "image/jpg") return "image/jpeg";
  return t === "image/jpeg" || t === "image/png" || t === "image/webp" ? t : null;
}

async function readResponse(res: Response): Promise<ReferenceImage | null> {
  if (!res.ok) return null;
  const type = imageType(res.headers.get("content-type"));
  if (!type) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.byteLength || buf.byteLength > MAX_REFERENCE_BYTES) return null;
  return { bytes: buf, contentType: type };
}

/**
 * Avatar bytes for the image model, or null. Handles the app's own avatar
 * storage (`/api/storage/objects/uploads/:id`), bundled seed avatars served
 * by the Worker's static assets, data URLs, and public https URLs.
 */
export async function loadReferenceImage(
  avatarUrl: unknown,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<ReferenceImage | null> {
  const url = String(avatarUrl ?? "").trim();
  if (!url) return null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const dataMatch = /^data:(image\/[a-z+.-]+);base64,(.+)$/is.exec(url);
    if (dataMatch) {
      const type = imageType(dataMatch[1]);
      if (!type) return null;
      const bytes = new Uint8Array(Buffer.from(dataMatch[2].replace(/\s+/g, ""), "base64"));
      return bytes.byteLength && bytes.byteLength <= MAX_REFERENCE_BYTES ? { bytes, contentType: type } : null;
    }
    const upload = /(?:^|\/api\/storage)?\/objects\/uploads\/([A-Za-z0-9-]{8,80})(?:$|[?#])/.exec(url);
    if (upload && !/^https?:\/\//i.test(url)) {
      const stored = await getUploadedImage(objectPathForUploadId(upload[1]));
      const type = imageType(stored?.contentType);
      if (!stored || !type) return null;
      return { bytes: new Uint8Array(Buffer.from(stored.dataBase64, "base64")), contentType: type };
    }
    const signal = AbortSignal.timeout(REFERENCE_TIMEOUT_MS);
    if (url.startsWith("/")) {
      if (!assetsBinding) return null;
      const path = url.split(/[?#]/)[0];
      return await readResponse(await assetsBinding.fetch(new Request(`https://assets.local${path}`, { signal })));
    }
    if (/^https:\/\//i.test(url)) {
      return await readResponse(await fetchImpl(url, { signal, redirect: "follow" }));
    }
  } catch {
    return null;
  }
  return null;
}
