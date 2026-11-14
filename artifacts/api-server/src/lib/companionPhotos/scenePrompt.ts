/**
 * Scene-prompt builder: turn recent chat + the companion's look (and the
 * user's look, only when memory facts have it) into a structured image
 * prompt. One background-model call; a deterministic template if that
 * call fails or is unavailable.
 */
import { SKIN_TONE_GUARD, userAppearanceFromFacts, type CompanionLook } from "./appearance";
import { orientationOf, styleFor } from "./imagePrompt";
import { firstJsonObject, type IntentCompleter, type IntentMessage, type PhotoFraming, type PhotoIntent } from "./intent";
import { safetyClause } from "./safety";
import type { PhotoOrientation } from "./config";

export type SceneBrief = {
  scene: string;
  setting: string;
  present: string[];
  mood: string;
  orientation: PhotoOrientation;
  framing?: PhotoFraming;
  source: "model" | "template";
};

const MAX_PROMPT = 1900;
const ORIENTATIONS: PhotoOrientation[] = ["portrait", "landscape", "square"];
const FRAMINGS: PhotoFraming[] = ["selfie", "portrait", "full_body", "landscape", "closeup"];

const PLACE_RE =
  /\b(?:at|in|on|by|near|outside|inside)\s+(?:the\s+)?([a-z][a-z0-9' -]{2,40})/i;
const MOOD_WORDS: Array<[RegExp, string]> = [
  [/\b(laugh|laughing|giggle|playful|teasing|fun)\b/i, "playful"],
  [/\b(kiss|romantic|tender|love|softly|intimate)\b/i, "tender"],
  [/\b(sad|cry|tears?|heartbroken|grief|melancholy)\b/i, "melancholic"],
  [/\b(angry|tense|fight|argu|upset|sharp)\b/i, "tense"],
  [/\b(excited|thrilled|celebrat|joy|happy|beaming)\b/i, "joyful"],
  [/\b(calm|quiet|peaceful|still|gentle|soft)\b/i, "peaceful"],
  [/\b(sunset|golden|warm|cozy|fireside)\b/i, "warm"],
  [/\b(night|moon|starlight|midnight)\b/i, "quiet nighttime"],
];

function clean(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f<>[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function clipTranscript(recent: IntentMessage[], companionName: string, n = 12): string {
  return recent
    .slice(-n)
    .map((m) => `${m.role === "user" ? "User" : companionName}: ${clean(m.content, 280)}`)
    .join("\n");
}

export function orientationFor(intent: PhotoIntent, brief?: Pick<SceneBrief, "orientation"> | null): PhotoOrientation {
  return orientationOf(intent, brief);
}

function guessMood(text: string): string {
  for (const [re, mood] of MOOD_WORDS) if (re.test(text)) return mood;
  return "calm";
}

function guessSetting(text: string, fallback: string): string {
  const m = PLACE_RE.exec(text);
  if (m) return clean(m[0], 80);
  return fallback;
}

function togetherIn(text: string): boolean {
  return /\b(us|we|together|both(?: of us)?|you and me|me and you|two of (?:you|us))\b/i.test(text);
}

/** Deterministic brief from the last messages and the classified intent. */
export function templateSceneBrief(args: {
  companionName: string;
  userName?: string;
  userMessage?: string;
  recent: IntentMessage[];
  intent: PhotoIntent;
}): SceneBrief {
  const name = clean(args.companionName, 60) || "the companion";
  const user = clean(args.userName, 60) || "the user";
  const haystack = [args.intent.description, args.userMessage, ...args.recent.slice(-12).map((m) => m.content)]
    .map((t) => String(t || ""))
    .join(" \n ");
  const together = args.intent.subject === "scene" && togetherIn(`${args.intent.description} ${args.userMessage || ""}`);
  const present = together ? [name, user] : args.intent.subject === "self" ? [name] : [name];
  const scene = clean(args.intent.description, 280) || (together ? `${name} and ${user} in this moment` : `${name} right now`);
  const setting = guessSetting(haystack, together ? "together in this moment" : "wherever they are right now");
  const mood = guessMood(haystack);
  const orientation = orientationFor(args.intent);
  return {
    scene,
    setting,
    present,
    mood,
    orientation,
    framing: args.intent.framing,
    source: "template",
  };
}

export function buildSceneBriefMessages(args: {
  companionName: string;
  userName?: string;
  userMessage?: string;
  recent: IntentMessage[];
  intent: PhotoIntent;
  identityText?: string;
  look: CompanionLook;
}): Array<{ role: "system" | "user"; content: string }> {
  const name = clean(args.companionName, 60) || "the companion";
  const user = clean(args.userName, 60) || "the user";
  const transcript = clipTranscript(args.recent, name, 12);
  const identity = clean(args.identityText, 500);
  const look = clean(args.look.description, 200);
  return [
    {
      role: "system",
      content:
        `You summarize the recent conversation into a brief for a single still image of a moment in ${name}'s world. ` +
        "Write concrete visual facts only: the scene (what is happening), the setting (place, time of day, weather, light), who is present (names only), the mood, and a framing orientation. " +
        `Do not describe ${name}'s face, body, skin, hair or clothes — those are added later verbatim. Do not invent people who are not in the conversation. ` +
        `If the user asked to be in the picture ("us", "draw us", "this scene together"), include both ${name} and ${user} in "present". ` +
        'orientation: "portrait" for people, "landscape" for places, "square" when neither fits. ' +
        'Reply with JSON only: {"scene":"...","setting":"...","present":["..."],"mood":"...","orientation":"portrait|landscape|square","framing":"selfie|portrait|full_body|landscape|closeup"}',
    },
    {
      role: "user",
      content:
        (identity ? `Identity / what is known:\n${identity}\n\n` : "") +
        (look ? `${name}'s look is already known; do not repeat it.\n\n` : "") +
        `Recent conversation:\n${transcript || "(none)"}\n\n` +
        `Latest user message: ${clean(args.userMessage, 500) || "(none)"}\n` +
        `Already decided: subject=${args.intent.subject}, framing=${args.intent.framing}, description=${clean(args.intent.description, 280) || "(none)"}\n\nJSON:`,
    },
  ];
}

export function parseSceneBrief(raw: string, fallback: SceneBrief): SceneBrief {
  const obj = firstJsonObject(raw);
  if (!obj) return fallback;
  const present = Array.isArray(obj.present)
    ? obj.present.map((p) => clean(p, 60)).filter(Boolean).slice(0, 6)
    : fallback.present;
  const orientation = ORIENTATIONS.includes(obj.orientation as PhotoOrientation)
    ? (obj.orientation as PhotoOrientation)
    : fallback.orientation;
  const framing = FRAMINGS.includes(obj.framing as PhotoFraming) ? (obj.framing as PhotoFraming) : fallback.framing;
  return {
    scene: clean(obj.scene, 280) || fallback.scene,
    setting: clean(obj.setting, 160) || fallback.setting,
    present: present.length ? present : fallback.present,
    mood: clean(obj.mood, 80) || fallback.mood,
    orientation,
    framing,
    source: "model",
  };
}

export type ScenePromptInput = {
  companionName: string;
  userName?: string;
  universe?: string;
  look: CompanionLook;
  /** Only when memory facts describe how the user looks. */
  userAppearance?: string;
  intent: PhotoIntent;
  brief: SceneBrief;
  level: "sfw" | "suggestive";
  preinstalled: boolean;
  hasReference: boolean;
};

/**
 * Final image prompt: structured scene + each person's canonical appearance
 * injected verbatim (including skin tone) + the lightening guard.
 */
export function composeSceneImagePrompt(input: ScenePromptInput): string {
  const name = clean(input.companionName, 60) || "the companion";
  const user = clean(input.userName, 60) || "the user";
  const brief = input.brief;
  const look = clean(input.look.description, 420);
  const skin = clean(input.look.skinTone, 80);
  const signature = clean(input.look.signature, 200);
  const userLook = clean(input.userAppearance, 320);
  const present = brief.present.length ? brief.present : [name];
  const userPresent = present.some((p) => p.toLowerCase() === user.toLowerCase() || /\b(user|me|you)\b/i.test(p));
  const style = styleFor(input);
  const ofCompanion = present.some((p) => p.toLowerCase() === name.toLowerCase()) || input.intent.subject === "self";
  const parts: string[] = [];

  const framing = brief.framing || input.intent.framing;
  if (framing === "selfie") parts.push(`A casual smartphone selfie taken at arm's length of ${present.join(" and ")}.`);
  else if (framing === "portrait" || framing === "closeup" || framing === "full_body") {
    parts.push(
      `${framing === "full_body" ? "A full-body photo" : framing === "closeup" ? "A close-up photo" : "A natural portrait"} of ${present.join(" and ")}.`,
    );
  } else {
    parts.push(`A photo of this scene, featuring ${present.join(" and ")}.`);
  }

  if (brief.scene) parts.push(`Scene: ${clean(brief.scene, 280)}.`);
  if (brief.setting) parts.push(`Setting: ${clean(brief.setting, 160)}.`);
  parts.push(`Who is present: ${present.join(", ")}.`);
  if (brief.mood) parts.push(`Mood: ${clean(brief.mood, 80)}.`);

  if (ofCompanion && input.hasReference) {
    parts.push(`${name} is the exact same character as in image 0 (same face, hair, features, colors and outfit style).`);
  }
  if (look) parts.push(`${name}'s appearance (use verbatim): ${look}.`);
  if (skin) parts.push(`${name}'s skin tone, exactly: ${skin}.`);
  if (signature) parts.push(`Always visible: ${signature}.`);

  if (userPresent) {
    if (userLook) {
      parts.push(`${user}'s appearance (use verbatim, only what is known): ${userLook}.`);
      const userSkin = skinFrom(userLook);
      if (userSkin) parts.push(`${user}'s skin tone, exactly: ${userSkin}.`);
    } else {
      parts.push(
        `${user} is present but their face is turned away or not identifiable; do not invent facial features, a likeness, or a skin tone that was not given.`,
      );
    }
  }

  parts.push(SKIN_TONE_GUARD);
  parts.push(style.text);
  parts.push(safetyClause(input.level, ofCompanion));
  return parts.join(" ").slice(0, MAX_PROMPT);
}

function skinFrom(text: string): string {
  const m = String(text || "").match(/\b((?:[\w-]+(?:[\s-]+|\s+and\s+)){0,5}(?:skin(?:\s+tone)?|complexion))\b/i);
  return m ? clean(m[1], 80) : "";
}

export async function buildSceneImagePrompt(args: {
  companionName: string;
  userName?: string;
  userMessage?: string;
  recent: IntentMessage[];
  intent: PhotoIntent;
  identityText?: string;
  look: CompanionLook;
  userAppearance?: string;
  universe?: string;
  level: "sfw" | "suggestive";
  preinstalled: boolean;
  hasReference: boolean;
  complete?: IntentCompleter | null;
  timeoutMs?: number;
}): Promise<{ prompt: string; brief: SceneBrief }> {
  const fallback = templateSceneBrief(args);
  let brief = fallback;
  if (args.complete) {
    try {
      const raw = await args.complete(buildSceneBriefMessages(args), {
        maxTokens: 280,
        timeoutMs: args.timeoutMs ?? 4_000,
      });
      brief = parseSceneBrief(raw, fallback);
    } catch {
      brief = fallback;
    }
  }
  const userAppearance = args.userAppearance ?? userAppearanceFromFacts(args.identityText || "", args.userName);
  return {
    brief,
    prompt: composeSceneImagePrompt({
      companionName: args.companionName,
      userName: args.userName,
      universe: args.universe,
      look: args.look,
      userAppearance,
      intent: args.intent,
      brief,
      level: args.level,
      preinstalled: args.preinstalled,
      hasReference: args.hasReference,
    }),
  };
}
