import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSceneBriefMessages,
  buildSceneImagePrompt,
  checkSpontaneousCooldown,
  companionLook,
  companionPhotoConfig,
  composeSceneImagePrompt,
  extractSkinTone,
  heuristicPhotoIntent,
  mightWantPhoto,
  parsePhotoSize,
  parseSceneBrief,
  photoSize,
  photoTagIntent,
  planCompanionPhoto,
  resetPhotoLimitsForTests,
  spontaneousPhotoDirective,
  templateSceneBrief,
  userAppearanceFromFacts,
  type PhotoIntent,
  type PhotoPlan,
} from "../src/lib/companionPhotos";

function intent(over: Partial<PhotoIntent> = {}): PhotoIntent {
  return {
    sendPhoto: true,
    subject: "scene",
    framing: "portrait",
    description: "the two of you on a quiet beach at sunset",
    explicitness: "none",
    minor: false,
    realPerson: false,
    source: "classifier",
    ...over,
  };
}

const mira = {
  id: "c_123",
  name: "Mira",
  appearance: "short copper hair, freckles, green eyes, warm olive skin",
  age: 27,
};
const enabled = companionPhotoConfig({});
const binding = { run: vi.fn() };

afterEach(() => {
  vi.clearAllMocks();
  resetPhotoLimitsForTests();
});

describe("request triggers", () => {
  it("treats 'show me', 'draw us', and 'picture this scene' as photo asks", () => {
    for (const t of ["show me", "draw us", "picture this scene", "show me this moment", "sketch this scene"]) {
      expect(mightWantPhoto(t), t).toBe(true);
    }
  });

  it("heuristic accepts draw-us and picture-this-scene when the classifier is down", () => {
    const us = heuristicPhotoIntent("draw us");
    expect(us).toMatchObject({ sendPhoto: true, subject: "scene", framing: "portrait", source: "heuristic" });
    expect(us?.description).toMatch(/two of you|this moment/i);
    const scene = heuristicPhotoIntent("picture this scene");
    expect(scene).toMatchObject({ sendPhoto: true, subject: "scene", source: "heuristic" });
    expect(heuristicPhotoIntent("picture this: once upon a time")).toBeNull();
  });
});

describe("scene prompt builder", () => {
  const recent = [
    { role: "user", content: "Let's walk down to the beach." },
    { role: "assistant", content: "The sun is dropping and the water's so calm. I'm glad you're here with me." },
    { role: "user", content: "Draw us." },
  ];

  it("template fallback covers scene, setting, who is present, and mood", () => {
    const brief = templateSceneBrief({
      companionName: "Mira",
      userName: "Davin",
      userMessage: "draw us",
      recent,
      intent: intent(),
    });
    expect(brief.source).toBe("template");
    expect(brief.scene).toMatch(/beach|sunset/i);
    expect(brief.setting).toMatch(/beach/i);
    expect(brief.present).toEqual(expect.arrayContaining(["Mira", "Davin"]));
    expect(brief.mood).toMatch(/warm|peaceful|tender|calm/i);
    expect(brief.orientation).toBe("portrait");
  });

  it("parses a model brief and falls back field-by-field", () => {
    const fallback = templateSceneBrief({
      companionName: "Mira",
      userName: "Davin",
      recent,
      intent: intent(),
    });
    const parsed = parseSceneBrief(
      'Sure: {"scene":"they sit in the sand watching the tide","setting":"a quiet beach at sunset","present":["Mira","Davin"],"mood":"tender","orientation":"portrait"}',
      fallback,
    );
    expect(parsed).toMatchObject({
      source: "model",
      scene: "they sit in the sand watching the tide",
      setting: "a quiet beach at sunset",
      present: ["Mira", "Davin"],
      mood: "tender",
      orientation: "portrait",
    });
    expect(parseSceneBrief("not json", fallback)).toEqual(fallback);
  });

  it("injects appearance and skin tone verbatim, lists who is present, and states the mood", () => {
    const look = companionLook(mira);
    expect(look.skinTone).toMatch(/warm olive skin/);
    const brief = templateSceneBrief({
      companionName: "Mira",
      userName: "Davin",
      userMessage: "draw us",
      recent,
      intent: intent(),
    });
    const prompt = composeSceneImagePrompt({
      companionName: "Mira",
      userName: "Davin",
      look,
      userAppearance: "short dark curly hair, deep brown skin, a light beard",
      intent: intent(),
      brief,
      level: "sfw",
      preinstalled: false,
      hasReference: true,
    });
    expect(prompt).toMatch(/Mira's appearance \(use verbatim\): short copper hair, freckles, green eyes, warm olive skin/);
    expect(prompt).toMatch(/Mira's skin tone, exactly: warm olive skin/);
    expect(prompt).toMatch(/Davin's appearance \(use verbatim/);
    expect(prompt).toMatch(/deep brown skin/);
    expect(prompt).toMatch(/Who is present: Mira, Davin/);
    expect(prompt).toMatch(/Mood:/);
    expect(prompt).toMatch(/do not lighten, whiten, pale, or shift undertones/i);
    expect(prompt).toMatch(/image 0/);
    expect(prompt.length).toBeLessThanOrEqual(1900);
  });

  it("does not invent the user's looks when memory facts have none", () => {
    const brief = templateSceneBrief({
      companionName: "Mira",
      userName: "Davin",
      userMessage: "draw us",
      recent,
      intent: intent(),
    });
    const prompt = composeSceneImagePrompt({
      companionName: "Mira",
      userName: "Davin",
      look: companionLook(mira),
      userAppearance: "",
      intent: intent(),
      brief,
      level: "sfw",
      preinstalled: false,
      hasReference: false,
    });
    expect(prompt).toMatch(/face is turned away or not identifiable/);
    expect(prompt).not.toMatch(/Davin's appearance/);
  });

  it("uses the template when the background model fails, and the model brief when it succeeds", async () => {
    const look = companionLook(mira);
    const failed = await buildSceneImagePrompt({
      companionName: "Mira",
      userName: "Davin",
      userMessage: "draw us",
      recent,
      intent: intent(),
      look,
      level: "sfw",
      preinstalled: false,
      hasReference: false,
      complete: async () => {
        throw new Error("down");
      },
    });
    expect(failed.brief.source).toBe("template");
    expect(failed.prompt).toMatch(/warm olive skin/);

    const ok = await buildSceneImagePrompt({
      companionName: "Mira",
      userName: "Davin",
      userMessage: "draw us",
      recent,
      intent: intent(),
      look,
      level: "sfw",
      preinstalled: false,
      hasReference: false,
      complete: async () =>
        '{"scene":"a shared picnic on the sand","setting":"beach at dusk","present":["Mira","Davin"],"mood":"joyful","orientation":"landscape"}',
    });
    expect(ok.brief).toMatchObject({ source: "model", mood: "joyful", orientation: "landscape" });
    expect(ok.prompt).toMatch(/shared picnic on the sand/);
  });

  it("asks the background model for JSON and includes identity plus recent turns", () => {
    const messages = buildSceneBriefMessages({
      companionName: "Mira",
      userName: "Davin",
      userMessage: "draw us",
      recent,
      intent: intent(),
      identityText: "Identity anchor — you are Mira. Core traits: warm, witty.",
      look: companionLook(mira),
    });
    expect(messages[0]?.content).toMatch(/JSON only/);
    expect(messages[1]?.content).toMatch(/Identity anchor/);
    expect(messages[1]?.content).toMatch(/Let's walk down to the beach/);
  });
});

describe("appearance consistency", () => {
  it("extracts skin tone from a card or appearance prompts", () => {
    expect(extractSkinTone("a woman with soft white hair and warm golden-brown skin, crystalline wings")).toMatch(
      /warm golden-brown skin/,
    );
    expect(extractSkinTone("", "deep brown")).toBe("deep brown skin");
    expect(extractSkinTone("green eyes, copper hair")).toBe("");
  });

  it("takes the user's appearance only from memory facts that describe how they look", () => {
    const facts = [
      "Davin lives in Brooklyn.",
      "Davin has short dark curly hair, deep brown skin, and a light beard.",
      "He prefers tea to coffee.",
    ];
    expect(userAppearanceFromFacts(facts, "Davin")).toMatch(/short dark curly hair/);
    expect(userAppearanceFromFacts(facts, "Davin")).toMatch(/deep brown skin/);
    expect(userAppearanceFromFacts(["Davin lives in Brooklyn.", "He prefers tea to coffee."], "Davin")).toBe("");
  });
});

describe("size selection", () => {
  it("picks high-res portrait, landscape, or square from the scene, and honors env sizes", () => {
    expect(photoSize(intent({ subject: "self", framing: "selfie" }))).toEqual({ width: 1024, height: 1536 });
    expect(photoSize(intent({ subject: "scene", framing: "landscape" }))).toEqual({ width: 1536, height: 1024 });
    expect(photoSize(intent(), undefined, { orientation: "square" })).toEqual({ width: 1024, height: 1024 });
    const custom = companionPhotoConfig({
      ANIMA_COMPANION_PHOTO_SIZE_LANDSCAPE: "1920x1080",
      ANIMA_COMPANION_PHOTO_SIZE_PORTRAIT: "1080x1920",
    });
    expect(photoSize(intent({ subject: "scene", framing: "landscape" }), custom.sizes)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(photoSize(intent(), custom.sizes)).toEqual({ width: 1080, height: 1920 });
    // Clamp to the Workers AI FLUX.2 range (256–1920).
    expect(parsePhotoSize("4000x4000", { width: 1024, height: 1024 })).toEqual({ width: 1920, height: 1920 });
    expect(parsePhotoSize("100x100", { width: 1024, height: 1024 })).toEqual({ width: 256, height: 256 });
  });
});

describe("spontaneous cooldown and limits", () => {
  const planBase = {
    userId: "u1",
    character: mira,
    companionName: "Mira",
    userMessage: "this is beautiful",
    recent: [] as Array<{ role: string; content: string }>,
    mode: "solo",
    isContinue: false,
    adultActive: false,
    therapy: false,
    crisis: false,
    config: enabled,
    binding,
    usage: async () => ({ hour: 0, day: 0 }),
    characterId: "c_123",
    sessionId: "s1",
    complete: async () => '{"send_photo":false}',
  };
  const tag = photoTagIntent("I want you to have this.\n[IMAGE: the two of us on the balcony at dusk, warm and quiet]");

  it("reads a companion [IMAGE:] or [SCENE:] tag as a spontaneous intent", () => {
    expect(tag).toMatchObject({ sendPhoto: true, source: "tag", subject: "scene" });
    expect(photoTagIntent("[SCENE: the harbor at night]")).toMatchObject({ source: "tag", framing: "landscape" });
  });

  it("sends a tagged photo when spontaneous photos are on and the cooldown is clear", async () => {
    const plan = await planCompanionPhoto({
      ...planBase,
      intent: tag,
      spontaneous: { lastAt: null, exchangesSince: 99, exchangesKnown: true },
    });
    expect(plan.action).toBe("send");
  });

  it("skips a tagged photo silently when the feature is off, the cooldown is active, or a rate limit is hit", async () => {
    const off = await planCompanionPhoto({
      ...planBase,
      intent: tag,
      config: companionPhotoConfig({ ANIMA_COMPANION_PHOTO_SPONTANEOUS: "off" }),
    });
    expect(off.action).toBe("none");

    const cooling = await planCompanionPhoto({
      ...planBase,
      intent: tag,
      spontaneous: { lastAt: Date.now() - 60_000, exchangesSince: 99, exchangesKnown: true },
    });
    expect(cooling.action).toBe("none");

    const fewTurns = await planCompanionPhoto({
      ...planBase,
      intent: tag,
      spontaneous: { lastAt: Date.now() - 60 * 60_000, exchangesSince: 2, exchangesKnown: true },
    });
    expect(fewTurns.action).toBe("none");

    const limited = await planCompanionPhoto({
      ...planBase,
      intent: tag,
      usage: async () => ({ hour: 6, day: 6 }),
      spontaneous: { lastAt: null, exchangesSince: 99, exchangesKnown: true },
    });
    expect(limited.action).toBe("none");
  });

  it("still declines an explicit requested photo, but skips an explicit spontaneous tag silently", async () => {
    const requested = await planCompanionPhoto({
      ...planBase,
      userMessage: "send me a nude selfie",
      intent: intent({ subject: "self", framing: "selfie", explicitness: "explicit", source: "classifier" }),
    });
    expect(requested).toMatchObject({ action: "decline", reason: "explicit" });

    const tagged = await planCompanionPhoto({
      ...planBase,
      intent: { ...tag!, explicitness: "explicit" },
      spontaneous: { lastAt: null, exchangesSince: 99, exchangesKnown: true },
    });
    expect(tagged.action).toBe("none");
  });

  it("cooldown helper allows the first photo and then enforces both windows", () => {
    const limits = { spontaneousMinExchanges: 8, spontaneousCooldownMs: 20 * 60_000 };
    expect(checkSpontaneousCooldown(null, limits)).toBe(true);
    expect(checkSpontaneousCooldown({ lastAt: Date.now() - 1000, exchangesSince: 99, exchangesKnown: true }, limits)).toBe(
      false,
    );
    expect(
      checkSpontaneousCooldown({ lastAt: Date.now() - 30 * 60_000, exchangesSince: 2, exchangesKnown: true }, limits),
    ).toBe(false);
    expect(
      checkSpontaneousCooldown({ lastAt: Date.now() - 30 * 60_000, exchangesSince: 8, exchangesKnown: true }, limits),
    ).toBe(true);
    // If the ledger is down, only the time window applies once it has elapsed.
    expect(
      checkSpontaneousCooldown({ lastAt: Date.now() - 30 * 60_000, exchangesSince: 0, exchangesKnown: false }, limits),
    ).toBe(true);
  });

  it("omits the mind tag instruction when a photo is already planned or spontaneous photos are off", () => {
    const none: PhotoPlan = { action: "none" };
    expect(
      spontaneousPhotoDirective({ plan: none, userId: "u1", characterId: "c_123", sessionId: "s1", mode: "solo" }),
    ).toMatch(/\[IMAGE:/);
    expect(
      spontaneousPhotoDirective({
        plan: none,
        userId: "u1",
        mode: "solo",
        config: companionPhotoConfig({ ANIMA_COMPANION_PHOTO_SPONTANEOUS: "off" }),
      }),
    ).toBe("");
    expect(
      spontaneousPhotoDirective({
        plan: { action: "send", intent: intent(), level: "sfw", look: companionLook(mira), preinstalled: false },
        userId: "u1",
        mode: "solo",
      }),
    ).toBe("");
  });
});
