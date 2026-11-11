import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildImagePrompt,
  characterIsMinor,
  checkPhotoLimit,
  classifyImageError,
  classifyPhotoIntent,
  companionLook,
  companionPhotoConfig,
  companionSeed,
  decidePhotoSafety,
  generateCompanionImage,
  heuristicPhotoIntent,
  mightWantPhoto,
  parsePhotoIntent,
  photoDirective,
  photoFailureLine,
  photoMetadata,
  photoSize,
  photoTagIntent,
  planCompanionPhoto,
  settleCompanionPhoto,
  stripPhotoTags,
  styleFor,
  type PhotoIntent,
} from "../src/lib/companionPhotos";
import { sentPhotoHistoryNote } from "../src/lib/promptBuilder";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const jpegB64 = Buffer.from(JPEG).toString("base64");

function intent(over: Partial<PhotoIntent> = {}): PhotoIntent {
  return {
    sendPhoto: true,
    subject: "self",
    framing: "selfie",
    description: "a selfie on the beach at sunset",
    explicitness: "none",
    minor: false,
    realPerson: false,
    source: "classifier",
    ...over,
  };
}

const custom = { id: "c_123", name: "Mira", appearance: "short copper hair, freckles, green eyes", age: 27 };
const starter = { id: "seed_korra", name: "Korra", is_starter: true, universe: "Avatar: The Legend of Korra" };
const enabled = companionPhotoConfig({});
const binding = { run: vi.fn() };

describe("photo intent", () => {
  it("prefilter passes photo-ish asks and skips ordinary chat", () => {
    for (const t of [
      "send me a selfie",
      "show me where you are",
      "what does the beach look like there?",
      "can I see you?",
      "pic pls",
    ]) {
      expect(mightWantPhoto(t), t).toBe(true);
    }
    for (const t of ["how was your day?", "I love you", "tell me a story about dragons", ""]) {
      expect(mightWantPhoto(t), t).toBe(false);
    }
  });

  it("strict heuristic only accepts unmistakable asks", () => {
    expect(heuristicPhotoIntent("send me a selfie")?.subject).toBe("self");
    const scene = heuristicPhotoIntent("show me a photo of the beach by your house");
    expect(scene?.subject).toBe("scene");
    expect(scene?.description).toContain("beach");
    expect(heuristicPhotoIntent("what does the beach look like there?")).toBeNull();
    expect(heuristicPhotoIntent("I took a photo yesterday")).toBeNull();
  });

  it("parses the classifier JSON and never lets it under-rate explicitness", () => {
    const parsed = parsePhotoIntent(
      'Sure: {"send_photo":true,"subject":"self","framing":"selfie","description":"in the hot tub","explicitness":"none","minor":false,"real_person":false}',
      "send me a nude selfie",
    );
    expect(parsed?.sendPhoto).toBe(true);
    expect(parsed?.explicitness).toBe("explicit");
    expect(parsePhotoIntent("not json")).toBeNull();
  });

  it("classifier decides; heuristic is only the fallback", async () => {
    const no = vi.fn().mockResolvedValue('{"send_photo":false}');
    expect(
      await classifyPhotoIntent({ companionName: "Mira", userMessage: "show me how it's done", recent: [], complete: no }),
    ).toBeNull();
    const yes = vi
      .fn()
      .mockResolvedValue('{"send_photo":true,"subject":"scene","framing":"landscape","description":"the beach at dusk","explicitness":"none"}');
    const got = await classifyPhotoIntent({
      companionName: "Mira",
      userMessage: "what does the beach look like there?",
      recent: [],
      complete: yes,
    });
    expect(got).toMatchObject({ subject: "scene", description: "the beach at dusk", source: "classifier" });
    const broken = vi.fn().mockRejectedValue(new Error("down"));
    expect(
      (await classifyPhotoIntent({ companionName: "Mira", userMessage: "send me a selfie", recent: [], complete: broken }))?.source,
    ).toBe("heuristic");
    const never = vi.fn();
    await classifyPhotoIntent({ companionName: "Mira", userMessage: "how was work", recent: [], complete: never });
    expect(never).not.toHaveBeenCalled();
  });

  it("reads and strips the companion's own photo tag", () => {
    const reply = "Here you go!\n[SELFIE: me on the balcony at night]";
    expect(photoTagIntent(reply)).toMatchObject({ subject: "self", source: "tag" });
    expect(stripPhotoTags(reply)).toBe("Here you go!");
    expect(photoTagIntent("no tags here")).toBeNull();
  });
});

describe("photo safety", () => {
  const base = { userText: "", adultActive: false, therapy: false, preinstalled: false, characterMinor: false };

  it("never allows explicit, minors or real people", () => {
    expect(decidePhotoSafety({ ...base, adultActive: true, intent: intent({ explicitness: "explicit" }) })).toEqual({
      allow: false,
      reason: "explicit",
    });
    expect(
      decidePhotoSafety({ ...base, adultActive: true, intent: intent({ explicitness: "explicit", minor: true }) }),
    ).toEqual({ allow: false, reason: "minor" });
    expect(decidePhotoSafety({ ...base, intent: intent({ minor: true }) })).toEqual({ allow: false, reason: "minor" });
    expect(decidePhotoSafety({ ...base, adultActive: true, intent: intent({ realPerson: true }) })).toEqual({
      allow: false,
      reason: "real_person",
    });
  });

  it("suggestive needs the adult gate, an adult custom companion, and no therapy", () => {
    const sug = intent({ explicitness: "suggestive" });
    expect(decidePhotoSafety({ ...base, intent: sug })).toEqual({ allow: false, reason: "adult_off" });
    expect(decidePhotoSafety({ ...base, adultActive: true, therapy: true, intent: sug }).allow).toBe(false);
    expect(decidePhotoSafety({ ...base, adultActive: true, preinstalled: true, intent: sug })).toEqual({
      allow: false,
      reason: "preinstalled_suggestive",
    });
    expect(decidePhotoSafety({ ...base, adultActive: true, characterMinor: true, intent: sug })).toEqual({
      allow: false,
      reason: "minor",
    });
    expect(decidePhotoSafety({ ...base, adultActive: true, intent: sug })).toEqual({ allow: true, level: "suggestive" });
    expect(decidePhotoSafety({ ...base, intent: intent() })).toEqual({ allow: true, level: "sfw" });
  });

  it("spots under-18 companions from age or card text", () => {
    expect(characterIsMinor({ age: 16 })).toBe(true);
    expect(characterIsMinor({ backstory: "A 15-year-old student at the academy" })).toBe(true);
    expect(characterIsMinor({ age: 24, backstory: "A pilot" })).toBe(false);
  });
});

describe("appearance and prompt", () => {
  it("keeps Serenity's look when nothing else describes her", () => {
    const look = companionLook({ id: "c_ser", name: "Serenity", _isAnima: true });
    expect(look.source).toBe("built_in");
    expect(look.description).toMatch(/white hair/);
    expect(look.description).toMatch(/crystalline angelic wings/);
  });

  it("Serenity's wings are always in frame", () => {
    const prompt = buildImagePrompt({
      companionName: "Serenity",
      look: companionLook({ id: "c_ser", name: "Serenity", _isAnima: true }),
      intent: intent(),
      level: "sfw",
      preinstalled: false,
      hasReference: true,
    });
    expect(prompt).toMatch(/Always visible: her large crystalline angelic wings/);
    expect(companionLook({ name: "Serenity", appearance_prompts: { hair: "pink" } }).signature).toBeUndefined();
  });

  it("prefers appearance prompts, then card fields", () => {
    expect(
      companionLook({ name: "X", appearance_prompts: { hair: "black braids", style: "watercolor" } }),
    ).toMatchObject({ source: "appearance_prompts", style: "watercolor" });
    expect(companionLook(custom)).toMatchObject({ source: "card" });
  });

  it("pre-installed characters are illustrated, never photoreal", () => {
    const look = companionLook(starter);
    expect(styleFor({ look, preinstalled: true, hasReference: false, universe: starter.universe }).kind).toBe(
      "illustrated",
    );
    expect(styleFor({ look: companionLook(custom), preinstalled: false, hasReference: false }).kind).toBe("photoreal");
  });

  it("builds a selfie prompt with the look, scene, style and safety clause", () => {
    const prompt = buildImagePrompt({
      companionName: "Mira",
      look: companionLook(custom),
      intent: intent(),
      level: "sfw",
      preinstalled: false,
      hasReference: true,
    });
    expect(prompt).toMatch(/selfie/i);
    expect(prompt).toMatch(/image 0/);
    expect(prompt).toMatch(/copper hair/);
    expect(prompt).toMatch(/beach at sunset/);
    expect(prompt).toMatch(/adult/);
    expect(prompt).toMatch(/safe for work/);
    expect(prompt.length).toBeLessThanOrEqual(1900);
  });

  it("seeds are stable per companion and turn; places are landscape", () => {
    expect(companionSeed("c_1", "t1")).toBe(companionSeed("c_1", "t1"));
    expect(companionSeed("c_1", "t1")).not.toBe(companionSeed("c_2", "t1"));
    expect(photoSize(intent({ subject: "scene", framing: "landscape" }))).toEqual({ width: 1024, height: 768 });
    expect(photoSize(intent())).toEqual({ width: 768, height: 1024 });
  });
});

describe("config and limits", () => {
  it("is on by default and has a kill switch", () => {
    expect(enabled.enabled).toBe(true);
    expect(enabled.model).toBe("@cf/black-forest-labs/flux-2-klein-4b");
    expect(companionPhotoConfig({ ANIMA_COMPANION_PHOTOS: "off" }).enabled).toBe(false);
    expect(companionPhotoConfig({ ANIMA_COMPANION_PHOTO_FALLBACK_MODEL: "off" }).fallbackModel).toBeNull();
    expect(companionPhotoConfig({ ANIMA_COMPANION_PHOTO_DAILY_LIMIT: "3" }).dailyLimit).toBe(3);
  });

  it("checks hourly and daily windows", () => {
    expect(checkPhotoLimit({ hour: 0, day: 0 }, { hourlyLimit: 6, dailyLimit: 20 })).toEqual({ allowed: true });
    expect(checkPhotoLimit({ hour: 6, day: 6 }, { hourlyLimit: 6, dailyLimit: 20 })).toEqual({ allowed: false, window: "hour" });
    expect(checkPhotoLimit({ hour: 1, day: 20 }, { hourlyLimit: 6, dailyLimit: 20 })).toEqual({ allowed: false, window: "day" });
  });
});

describe("Workers AI image calls", () => {
  it("classifies moderation and quota errors", () => {
    expect(classifyImageError(new Error("AiError: 3030: Your output has been flagged"))).toBe("flagged");
    expect(classifyImageError(new Error("4006: you have used up your daily free allocation of 10,000 neurons"))).toBe("quota");
    expect(classifyImageError(new Error("socket hang up"))).toBe("unavailable");
  });

  const args = {
    model: "@cf/black-forest-labs/flux-2-klein-4b",
    fallbackModel: "@cf/black-forest-labs/flux-1-schnell",
    prompt: "with ref",
    promptWithoutReference: "no ref",
    width: 768,
    height: 1024,
    seed: 1,
    reference: { bytes: JPEG, contentType: "image/jpeg" },
  };

  it("sends multipart with the reference to FLUX.2 and decodes the image", async () => {
    const run = vi.fn().mockResolvedValue({ image: jpegB64 });
    const out = await generateCompanionImage({ ...args, binding: { run } });
    expect(out).toMatchObject({ contentType: "image/jpeg", usedReference: true });
    expect(run.mock.calls[0][1].multipart.contentType).toMatch(/multipart\/form-data; boundary=/);
  });

  it("retries a flagged photo once without the reference and never falls back to schnell", async () => {
    const run = vi.fn().mockRejectedValue(new Error("3030: Your output has been flagged"));
    await expect(generateCompanionImage({ ...args, binding: { run } })).rejects.toMatchObject({ kind: "flagged" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every((c) => c[0] === args.model)).toBe(true);
  });

  it("uses the text-only fallback on an outage, not on quota", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream 500"))
      .mockResolvedValueOnce({ image: jpegB64 });
    const out = await generateCompanionImage({ ...args, binding: { run } });
    expect(out.model).toBe(args.fallbackModel);
    expect(run.mock.calls[1][1]).toEqual({ prompt: "no ref", steps: 4 });

    const quota = vi.fn().mockRejectedValue(new Error("4006 neurons"));
    await expect(generateCompanionImage({ ...args, binding: { run: quota } })).rejects.toMatchObject({ kind: "quota" });
    expect(quota).toHaveBeenCalledTimes(1);
  });
});

describe("turn plan", () => {
  const planBase = {
    userId: "u1",
    companionName: "Mira",
    recent: [],
    mode: "solo",
    isContinue: false,
    adultActive: false,
    therapy: false,
    crisis: false,
    config: enabled,
    binding,
    usage: async () => ({ hour: 0, day: 0 }),
  };
  const yes = async () =>
    '{"send_photo":true,"subject":"self","framing":"selfie","description":"at the café window","explicitness":"none"}';

  it("plans a send for an allowed request", async () => {
    const plan = await planCompanionPhoto({ ...planBase, character: custom, userMessage: "send me a selfie", complete: yes });
    expect(plan.action).toBe("send");
    expect(photoDirective(plan)).toMatch(/sending them a photo/);
    expect(photoDirective(plan)).toMatch(/never mention rules/);
  });

  it("skips group chats, the kill switch, crisis turns and non-requests", async () => {
    for (const over of [
      { mode: "group" },
      { crisis: true },
      { config: companionPhotoConfig({ ANIMA_COMPANION_PHOTOS: "off" }) },
      { userMessage: "how was your day" },
    ]) {
      const plan = await planCompanionPhoto({
        ...planBase,
        character: custom,
        userMessage: "send me a selfie",
        complete: yes,
        ...over,
      });
      expect(plan.action, JSON.stringify(over)).toBe("none");
    }
  });

  it("declines in character over the limit or for unsafe asks", async () => {
    const limited = await planCompanionPhoto({
      ...planBase,
      character: custom,
      userMessage: "send me a selfie",
      complete: yes,
      usage: async () => ({ hour: 1, day: 99 }),
    });
    expect(limited).toMatchObject({ action: "decline", reason: "limit_day" });
    expect(photoDirective(limited)).toMatch(/NOT sending a photo/);
    const spicy = await planCompanionPhoto({
      ...planBase,
      character: starter,
      adultActive: true,
      userMessage: "send me a sexy selfie in lingerie",
      complete: yes,
    });
    expect(spicy.action).toBe("decline");
  });

  it("failure lines stay in character and metadata has no prompt text", async () => {
    for (const kind of ["flagged", "quota", "timeout", "unavailable"] as const) {
      expect(photoFailureLine(kind, "t1")).not.toMatch(/\b(AI|model|policy|filter|Anima)\b/);
    }
    const timedOut = await settleCompanionPhoto(new Promise(() => {}), Date.now() + 5);
    expect(timedOut).toMatchObject({ status: "failed", errorKind: "timeout" });
    const plan = { action: "send" as const, intent: intent(), level: "sfw" as const, look: companionLook(custom), preinstalled: false };
    expect(photoMetadata(plan, timedOut)).toMatchObject({ status: "failed", error: "timeout" });
    expect(photoMetadata({ action: "none" }, null)).toBeNull();
  });
});

describe("history", () => {
  it("reminds the companion which photo she sent", () => {
    expect(
      sentPhotoHistoryNote({
        role: "assistant",
        content: "here!",
        attachments: [{ type: "image", source: "companion_photo", url: "/x", description: "me at the [beach]" }],
      }),
    ).toBe("[note: I sent a photo with this message: me at the beach]");
    expect(sentPhotoHistoryNote({ role: "user", attachments: [{ type: "image", source: "companion_photo" }] })).toBe("");
  });
});

afterEach(() => vi.clearAllMocks());
