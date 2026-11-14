/**
 * Is the user asking the companion to send a photo, and of what?
 *
 * Two steps, so ordinary turns cost nothing:
 * 1. `mightWantPhoto`: a broad, cheap lexical gate ("pic", "selfie", "show
 *    me", "what does it look like", ...). Most turns stop here.
 * 2. `classifyPhotoIntent`: one small JSON-only model call that reads the
 *    recent conversation and decides whether this is really a request for a
 *    picture, and what the companion would show (her choice, grounded in the
 *    scene). It also flags explicit / minor / real-person requests for the
 *    safety gate. If that call fails, `heuristicPhotoIntent` only accepts an
 *    unambiguous ask ("send me a selfie").
 */

export type PhotoSubject = "self" | "scene" | "object";
export type PhotoFraming = "selfie" | "portrait" | "full_body" | "landscape" | "closeup";
export type Explicitness = "none" | "suggestive" | "explicit";

export type PhotoIntent = {
  sendPhoto: boolean;
  subject: PhotoSubject;
  framing: PhotoFraming;
  /** What the photo shows, concrete and visual, in the companion's world. */
  description: string;
  explicitness: Explicitness;
  /** The request sexualizes, or depicts, someone under 18. */
  minor: boolean;
  /** The request is for a real, identifiable person (celebrity, the user, etc.). */
  realPerson: boolean;
  source: "classifier" | "heuristic" | "tag";
};

export type IntentMessage = { role: string; content: string; name?: string };

const MAYBE_PHOTO_RE =
  /\b(photos?|pics?|pix|picture|pictures|selfies?|snaps?|snapshot|images?|portraits?|camera|screenshot|draw|paint|sketch|illustrat\w*)\b|\b(show|send|give|snap|take)\s+(me|us)\b|\blet\s+me\s+see\b|\bcan\s+i\s+see\b|\b(i\s+want|i'?d\s+love|wanna)\s+to\s+see\b|\bsee\s+(you|what\s+you|where\s+you|how\s+you)\b|\bwhat\s+(do|does|did)\s+.{1,40}\blook\s+like\b|\bhow\s+do\s+you\s+look\b/i;

/** Cheap first gate. False means "certainly not a photo request". */
export function mightWantPhoto(userText: string): boolean {
  const text = String(userText || "");
  if (!text.trim() || text.length > 2000) return false;
  return MAYBE_PHOTO_RE.test(text);
}

const STRONG_SELF_RE =
  /\b(send|show|give|take|snap|share)\b.{0,24}\b(selfie|pic(ture)?\s+of\s+(you|yourself)|photo\s+of\s+(you|yourself))\b|\b(send|show)\s+me\s+(a\s+)?(selfie|pic|photo|picture)\b|\bselfie\s+(please|pls|for\s+me)\b/i;
const STRONG_SCENE_RE =
  /\b(send|show|share)\s+(me|us)\s+(a\s+)?(photo|pic|picture|snap)\s+of\s+(.{3,120})/i;
/** "draw us", "picture this scene", "show me this moment" — a picture of the current scene. */
const STRONG_MOMENT_RE =
  /\b(draw|paint|sketch|illustrate|picture|show(\s+me)?|send(\s+me)?|snap)\s+(us|this\s+scene|the\s+scene|this\s+moment|the\s+moment|this\s+picture)\b/i;

/** Fallback when the classifier is unavailable: only unmistakable asks. */
export function heuristicPhotoIntent(userText: string): PhotoIntent | null {
  const text = String(userText || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const moment = STRONG_MOMENT_RE.exec(text);
  if (moment) {
    const what = moment[0].toLowerCase();
    const together = /\bus\b/.test(what);
    return {
      sendPhoto: true,
      subject: "scene",
      framing: together ? "portrait" : "landscape",
      description: together
        ? "the two of you in this moment, as it is right now"
        : "this scene as it is right now",
      explicitness: lexicalExplicitness(text),
      minor: false,
      realPerson: false,
      source: "heuristic",
    };
  }
  const scene = STRONG_SCENE_RE.exec(text);
  if (scene && !/^(you|yourself)\b/i.test(scene[5])) {
    return {
      sendPhoto: true,
      subject: "scene",
      framing: "landscape",
      description: scene[5].replace(/[?.!]+$/, "").slice(0, 200),
      explicitness: lexicalExplicitness(text),
      minor: false,
      realPerson: false,
      source: "heuristic",
    };
  }
  if (STRONG_SELF_RE.test(text)) {
    return {
      sendPhoto: true,
      subject: "self",
      framing: "selfie",
      description: "a casual selfie right now, wherever you are",
      explicitness: lexicalExplicitness(text),
      minor: false,
      realPerson: false,
      source: "heuristic",
    };
  }
  return null;
}

const EXPLICIT_RE =
  /\b(nudes?|naked|nsfw|topless|bottomless|explicit|porn\w*|genitals?|nipples?|pussy|cock|dick|boobs?|tits?|sex\s*tape|having\s+sex)\b/i;
const SUGGESTIVE_RE =
  /\b(sexy|hot\s+pic|lingerie|underwear|bikini|bra|panties|seductive|sultry|steamy|cleavage|thirst\s*trap|bedroom\s+eyes|in\s+bed|bath(ing)?\s+(pic|photo|selfie)|undress\w*|strip(ping|tease))\b/i;

export function lexicalExplicitness(text: string): Explicitness {
  const t = String(text || "");
  if (EXPLICIT_RE.test(t)) return "explicit";
  if (SUGGESTIVE_RE.test(t)) return "suggestive";
  return "none";
}

function clip(text: unknown, max: number): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildIntentMessages(args: {
  companionName: string;
  userMessage: string;
  recent: IntentMessage[];
}): Array<{ role: "system" | "user"; content: string }> {
  const name = clip(args.companionName, 60) || "the companion";
  const transcript = args.recent
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : name}: ${clip(m.content, 280)}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        `You decide whether the user is asking ${name} (a chat companion who can text photos) to SEND A PICTURE in this message, and if so what the picture shows. ` +
        "Requests count when they want to see something: a selfie, a photo of the companion, of where they are, of something they mentioned (their room, the beach there, their outfit, food, a pet). " +
        "Talking ABOUT photos, describing a picture the user took, asking the companion to imagine or describe something in words, or figures of speech used to tell a story (\"picture this:\" as a preface, \"I see what you mean\") are NOT requests. " +
        'Direct asks to depict the current moment ARE requests: \"show me\", \"draw us\", \"picture this scene\", \"show me this moment\". For \"us\" / \"this scene\" with both people, subject is \"scene\" (do not set real_person just because the user is in the scene). ' +
        `If it is a request, write "description": one or two concrete visual sentences of what ${name} would actually photograph right now, grounded in the conversation and ${name}'s world (place, time of day, outfit, mood, who is there). For a selfie or a photo of ${name}, subject is "self". Do not describe ${name}'s face, body, or skin; that is added later. ` +
        '"explicitness": "explicit" for nudity or sexual acts, "suggestive" for lingerie, swimwear, sexy or bedroom poses, otherwise "none". ' +
        '"minor": true if the picture would sexualize or show anyone under 18, or the user asks for a child-like look. "real_person": true if they want a real, identifiable person (a celebrity, a public figure, or the user themselves). ' +
        'Reply with JSON only: {"send_photo":bool,"subject":"self|scene|object","framing":"selfie|portrait|full_body|landscape|closeup","description":"...","explicitness":"none|suggestive|explicit","minor":bool,"real_person":bool}',
    },
    {
      role: "user",
      content: `Recent conversation:\n${transcript || "(none)"}\n\nLatest user message:\n${clip(args.userMessage, 800)}\n\nJSON:`,
    },
  ];
}

const SUBJECTS: PhotoSubject[] = ["self", "scene", "object"];
const FRAMINGS: PhotoFraming[] = ["selfie", "portrait", "full_body", "landscape", "closeup"];
const LEVELS: Explicitness[] = ["none", "suggestive", "explicit"];

export function firstJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw || "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

export function parsePhotoIntent(raw: string, userText = ""): PhotoIntent | null {
  const obj = firstJsonObject(raw);
  if (!obj) return null;
  const sendPhoto = bool(obj.send_photo ?? obj.sendPhoto);
  const subject = SUBJECTS.includes(obj.subject as PhotoSubject) ? (obj.subject as PhotoSubject) : "self";
  const framing = FRAMINGS.includes(obj.framing as PhotoFraming)
    ? (obj.framing as PhotoFraming)
    : subject === "self"
      ? "selfie"
      : "landscape";
  const modelLevel = LEVELS.includes(obj.explicitness as Explicitness) ? (obj.explicitness as Explicitness) : "none";
  // Never trust the small model to under-rate: take the stricter of model and lexicon.
  const lexical = lexicalExplicitness(`${userText} ${String(obj.description ?? "")}`);
  const explicitness = LEVELS[Math.max(LEVELS.indexOf(modelLevel), LEVELS.indexOf(lexical))];
  return {
    sendPhoto,
    subject,
    framing,
    description: clip(obj.description, 400),
    explicitness,
    minor: bool(obj.minor),
    realPerson: bool(obj.real_person ?? obj.realPerson),
    source: "classifier",
  };
}

/** `[IMAGE: …]` / `[PHOTO: …]` the companion chose to emit on her own. */
export const PHOTO_TAG_RE = /\[(?:IMAGE|PHOTO|SELFIE|SCENE):\s*([^\]]{3,600})\]/gi;

export function photoTagIntent(reply: string): PhotoIntent | null {
  const re = new RegExp(PHOTO_TAG_RE.source, "i");
  const m = re.exec(String(reply || ""));
  if (!m) return null;
  const description = clip(m[1], 400);
  const tag = (m[0] || "").toUpperCase();
  const selfie = tag.startsWith("[SELFIE:") || /\b(selfie|me|myself|i\s+am|i'm)\b/i.test(description);
  const together = /\b(us|we|together|both)\b/i.test(description);
  return {
    sendPhoto: true,
    subject: selfie && !together ? "self" : "scene",
    framing: selfie ? "selfie" : together ? "portrait" : "landscape",
    description,
    explicitness: lexicalExplicitness(description),
    minor: false,
    realPerson: false,
    source: "tag",
  };
}

export function stripPhotoTags(text: string): string {
  return String(text || "")
    .replace(PHOTO_TAG_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type IntentCompleter = (
  messages: Array<{ role: "system" | "user"; content: string }>,
  opts: { maxTokens: number; timeoutMs: number },
) => Promise<string>;

/**
 * Prefilter, then classifier, then (only if the classifier is unavailable)
 * the strict heuristic. Returns null when this turn is not a photo request.
 */
export async function classifyPhotoIntent(args: {
  companionName: string;
  userMessage: string;
  recent: IntentMessage[];
  complete: IntentCompleter | null;
  timeoutMs?: number;
}): Promise<PhotoIntent | null> {
  if (!mightWantPhoto(args.userMessage)) return null;
  if (args.complete) {
    try {
      const raw = await args.complete(buildIntentMessages(args), {
        maxTokens: 220,
        timeoutMs: args.timeoutMs ?? 4_000,
      });
      const parsed = parsePhotoIntent(raw, args.userMessage);
      if (parsed) {
        if (!parsed.sendPhoto) return null;
        if (!parsed.description) {
          parsed.description =
            parsed.subject === "self" ? "a casual selfie right now, wherever you are" : clip(args.userMessage, 200);
        }
        return parsed;
      }
    } catch {
      // fall through to the strict heuristic
    }
  }
  return heuristicPhotoIntent(args.userMessage);
}
