import { describe, expect, it, vi } from "vitest";
import {
  anatomyCheckConfig,
  anatomyClause,
  anatomyFrom,
  anatomyNegativeTerms,
  buildImagePrompt,
  companionLook,
  composeSceneImagePrompt,
  countIn,
  hasAtypicalAnatomy,
  judgeAnatomy,
  renderWithAnatomyCheck,
  startCompanionPhoto,
  workersAiAnatomyVerifier,
  type AnatomyVerdict,
  type PhotoIntent,
  type SceneBrief,
} from "../src/lib/companionPhotos";
import { composePhotoPrompt, negativePrompt, photoAnatomy } from "../src/lib/photo/promptComposer";
import { buildFalRequest, pulidTrueCfg } from "../src/lib/photo/providerRouter";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function intent(over: Partial<PhotoIntent> = {}): PhotoIntent {
  return {
    sendPhoto: true,
    subject: "self",
    framing: "selfie",
    description: "a selfie in the garden",
    explicitness: "none",
    minor: false,
    realPerson: false,
    source: "heuristic",
    ...over,
  } as PhotoIntent;
}

const fourArmed = {
  id: "char_kali",
  name: "Vashti",
  appearance_prompts: { skin: "deep ebony", hair: "long black locs", eyes: "gold eyes" },
  appearance: "A tall warrior with four arms, gold armlets on every wrist.",
};

describe("anatomy reader", () => {
  it("reads explicit counts in many phrasings", () => {
    expect(countIn("She has four arms.", "arms")).toBe(4);
    expect(countIn("a four-armed goddess", "arms")).toBe(4);
    expect(countIn("4 muscular arms", "arms")).toBe(4);
    expect(countIn("with a second pair of arms below the first", "arms")).toBe(4);
    expect(countIn("three pairs of arms", "arms")).toBe(6);
    expect(countIn("a pair of feathered wings", "wings")).toBe(2);
    expect(countIn("a two-headed serpent", "heads")).toBe(2);
    expect(countIn("an all-seeing third eye", "eyes")).toBe(3);
  });

  it("ignores gestures and figures of speech", () => {
    expect(countIn("She wraps you in her arms, arms crossed when annoyed.", "arms")).toBeNull();
    expect(countIn("throws one arm around your shoulders", "arms")).toBeNull();
    expect(countIn("He stands two heads taller than you.", "heads")).toBeNull();
    expect(countIn("They met in the two wings of the palace.", "wings")).toBeNull();
    expect(countIn("closes one eye and grins", "eyes")).toBeNull();
    expect(countIn("only one arm since the war", "arms")).toBe(1);
  });

  it("first source wins per part; humans are not atypical", () => {
    const spec = anatomyFrom(["six arms", "four arms and angelic wings"]);
    expect(spec.counts.arms).toBe(6);
    expect(spec.counts.wings).toBe(2);
    expect(hasAtypicalAnatomy(anatomyFrom(["two arms, two legs, brown eyes"]))).toBe(false);
    expect(hasAtypicalAnatomy(anatomyFrom([""]))).toBe(false);
  });

  it("an explicit removal in a higher-priority field beats lore and built-in wings", () => {
    expect(countIn("casual clothes, no wings", "wings")).toBe(0);
    expect(countIn("a wingless fae", "wings")).toBe(0);
    expect(anatomyFrom(["casual clothes, no wings", "large crystalline angelic wings"]).counts.wings).toBe(0);
    const serenity = companionLook({ id: "anima_1", name: "Serenity", _isAnima: true, appearance_prompts: { outfit: "jeans and a hoodie, no wings" } });
    expect(serenity.anatomy?.counts.wings).toBe(0);
    expect(hasAtypicalAnatomy(serenity.anatomy)).toBe(false);
  });

  it("lore idioms never change the body; explicit lore counts of three or more do", () => {
    expect(hasAtypicalAnatomy(anatomyFrom([], ["She longs to spread her wings and trusts her third eye."]))).toBe(false);
    expect(anatomyFrom([], ["A pair of wings would set her free."]).counts.wings).toBeUndefined();
    expect(anatomyFrom([], ["Born with four arms, she was feared."]).counts.arms).toBe(4);
    expect(anatomyFrom(["a fox girl who has a fluffy tail"]).counts.tails).toBe(1);
    expect(anatomyFrom(["she has a tail"]).counts.tails).toBe(1);
  });

  it("states a horn count even when nothing else is unusual", () => {
    expect(anatomyClause("Ash", anatomyFrom(["two curved horns"]))).toContain("exactly two horns");
  });

  it("keeps the arm count even when Customise Anima set only skin and hair", () => {
    const look = companionLook(fourArmed);
    expect(look.source).toBe("appearance_prompts");
    expect(look.description).not.toContain("four arms");
    expect(look.anatomy?.counts.arms).toBe(4);
  });

  it("reads avatar seed and lore when no appearance field exists", () => {
    expect(companionLook({ id: "c1", name: "Ro", avatar_seed: "six-armed blue deity" }).anatomy?.counts.arms).toBe(6);
    expect(companionLook({ id: "c2", name: "Ro", backstory: "Born with four arms, she was feared." }).anatomy?.counts.arms).toBe(4);
  });
});

describe("anatomy clause", () => {
  it("states exact counts, the layout and the hand count", () => {
    const clause = anatomyClause("Vashti", anatomyFrom(["four arms"]));
    expect(clause).toContain("exactly four (4) arms in total");
    expect(clause).toContain("two upper arms at the shoulders and two lower arms just below them at the ribcage");
    expect(clause).toContain("exactly four hands");
    expect(clause).toMatch(/no additional or duplicated arms/);
  });

  it("keeps the phone in one hand for selfies", () => {
    expect(anatomyClause("Vashti", anatomyFrom(["four arms"]), { framing: "selfie" })).toContain("One hand holds the phone; the other three arms");
  });

  it("applies the standard arm count when no other count is specified", () => {
    expect(anatomyClause("Mia", undefined)).toContain("exactly two arms, one at each shoulder");
    expect(anatomyNegativeTerms(anatomyFrom(["brown hair"]))).toContain("extra arms");
  });

  it("goes right after the subject in the chat selfie prompt, before scene and look", () => {
    const look = companionLook(fourArmed);
    const p = buildImagePrompt({ companionName: "Vashti", look, intent: intent(), level: "sfw", preinstalled: false, hasReference: true });
    const anat = p.indexOf("Anatomy, must match exactly");
    expect(anat).toBeGreaterThan(0);
    expect(anat).toBeLessThan(p.indexOf("Scene:"));
    expect(anat).toBeLessThan(p.indexOf("Vashti: "));
  });

  it("survives a long scene in the scene prompt (inside the length cap)", () => {
    const brief: SceneBrief = {
      scene: "x ".repeat(400),
      setting: "a market",
      present: ["Vashti"],
      mood: "warm",
      orientation: "portrait",
      framing: "full_body",
      source: "template",
    };
    const p = composeSceneImagePrompt({
      companionName: "Vashti",
      look: companionLook(fourArmed),
      intent: intent({ framing: "full_body" }),
      brief,
      level: "sfw",
      preinstalled: false,
      hasReference: false,
    });
    expect(p).toContain("exactly four (4) arms");
    expect(p.indexOf("Anatomy")).toBeLessThan(p.indexOf("Scene:"));
  });
});

describe("length cap", () => {
  it("never cuts the safety clause or the anatomy, only the middle", () => {
    const long = { ...fourArmed, appearance_prompts: { ...fourArmed.appearance_prompts, outfit: "y ".repeat(300) } };
    const look = { ...companionLook(long), description: "z ".repeat(400), signature: "w ".repeat(150) };
    const brief: SceneBrief = {
      scene: "x ".repeat(200),
      setting: "s ".repeat(120),
      present: ["Vashti", "Sam"],
      mood: "warm",
      orientation: "portrait",
      framing: "selfie",
      source: "template",
    };
    const p = composeSceneImagePrompt({
      companionName: "Vashti",
      userName: "Sam",
      look,
      userAppearance: "short dark hair, " + "q ".repeat(150),
      intent: intent(),
      brief,
      level: "sfw",
      preinstalled: false,
      hasReference: true,
    });
    expect(p.length).toBeLessThanOrEqual(1900);
    expect(p).toContain("exactly four (4) arms");
    expect(p).toContain("do not lighten");
    expect(p.endsWith(".")).toBe(true);
  });

  it("puts standard anatomy before appearance in a selfie", () => {
    const look = companionLook({ id: "c", name: "Mia", appearance: "short red hair, green eyes" });
    const p = buildImagePrompt({ companionName: "Mia", look, intent: intent(), level: "sfw", preinstalled: false, hasReference: false });
    expect(p).toContain("Mia has exactly two arms");
    expect(p.indexOf("exactly two arms")).toBeLessThan(p.indexOf("Mia: short red hair"));
  });
});

describe("photo generator prompt (fal / Gemini)", () => {
  it("keeps the body plan even with a very long identity anchor", () => {
    const extra = Array.from({ length: 24 }, (_, i) => `descriptor ${i} ` + "k".repeat(110));
    const p = composePhotoPrompt({ characterName: "Vashti", descriptor: { extra }, anatomy: anatomyFrom(["four arms"]) });
    expect(p.length).toBeLessThanOrEqual(1800);
    expect(p).toContain("exactly four (4) arms");
    expect(p).toContain("Identity must match the reference face exactly");
  });

  it("puts the body plan right after the identity anchor", () => {
    const anatomy = photoAnatomy({ distinguishing_marks: ["four arms"] });
    const p = composePhotoPrompt({ characterName: "Vashti", descriptor: { hair_color: "black" }, userPrompt: "at the beach", anatomy });
    expect(p.startsWith("Portrait photo of Vashti")).toBe(true);
    expect(p.indexOf("exactly four (4) arms")).toBeLessThan(p.indexOf("at the beach"));
  });

  it("reads the descriptor itself when no spec is passed", () => {
    const p = composePhotoPrompt({ characterName: "Ro", descriptor: { extra: ["six-armed"] } });
    expect(p).toContain("exactly six (6) arms");
  });

  it("adds count-aware anatomy negatives for both body plans", () => {
    expect(negativePrompt(undefined, anatomyFrom(["four arms"]))).toContain("extra limbs");
    expect(negativePrompt()).toContain("extra limbs");
    expect(negativePrompt(undefined, anatomyFrom(["four arms"]))).toContain("more than four arms");
  });

  it("PuLID true CFG stays 1 unless the server opts in", () => {
    expect(pulidTrueCfg({})).toBe(1);
    expect(pulidTrueCfg({ FAL_PULID_TRUE_CFG: "2" })).toBe(2);
    expect(pulidTrueCfg({ FAL_PULID_TRUE_CFG: "99" })).toBe(5);
    const req = buildFalRequest({ strategy: "pulid", prompt: "p", negative: "n", referenceUrl: "https://x/y.jpg", config: {} });
    expect(req.input.true_cfg).toBe(1);
  });
});

describe("anatomy check", () => {
  const spec = anatomyFrom(["four arms"]);

  it("is off by default, Workers AI only, retries clamped to 2", () => {
    expect(anatomyCheckConfig({}).enabled).toBe(false);
    expect(anatomyCheckConfig({ ANIMA_PHOTO_ANATOMY_CHECK: "on" }).enabled).toBe(true);
    expect(anatomyCheckConfig({ ANIMA_PHOTO_ANATOMY_RETRIES: "9" }).maxRetries).toBe(2);
    expect(anatomyCheckConfig({ ANIMA_PHOTO_ANATOMY_CHECK_MODEL: "https://evil.example/v1" }).model).toMatch(/^@cf\//);
  });

  it("extra limbs always fail; missing ones only when the body is fully in frame", () => {
    expect(judgeAnatomy(spec, ["arms"], { arms: 6, torso_fully_visible: false }).status).toBe("mismatch");
    expect(judgeAnatomy(spec, ["arms"], { arms: 2, torso_fully_visible: false }).status).toBe("pass");
    expect(judgeAnatomy(spec, ["arms"], { arms: 2, torso_fully_visible: true }).status).toBe("mismatch");
    expect(judgeAnatomy(spec, ["arms"], { arms: null }).status).toBe("skipped");
    expect(judgeAnatomy(spec, ["arms"], {}).status).toBe("skipped");
    expect(judgeAnatomy(spec, ["arms"], null).status).toBe("skipped");
  });

  it("skips without a binding or when disabled", async () => {
    const on = anatomyCheckConfig({ ANIMA_PHOTO_ANATOMY_CHECK: "on" });
    const img = { bytes: JPEG, contentType: "image/jpeg" };
    expect(await workersAiAnatomyVerifier({ binding: undefined, config: on, name: "V", spec })(img)).toEqual({ status: "skipped", reason: "no_binding" });
    expect(await workersAiAnatomyVerifier({ binding: { run: vi.fn() }, config: anatomyCheckConfig({}), name: "V", spec })(img)).toEqual({ status: "skipped", reason: "off" });
  });

  it("flags a third arm on a standard companion even with a cropped torso", async () => {
    const binding = { run: vi.fn(async () => ({ response: '{"arms": 3, "torso_fully_visible": false}' })) };
    const verify = workersAiAnatomyVerifier({
      binding,
      config: anatomyCheckConfig({ ANIMA_PHOTO_ANATOMY_CHECK: "on" }),
      name: "Mia",
      spec: anatomyFrom([]),
    });
    expect(await verify({ bytes: JPEG, contentType: "image/jpeg" })).toMatchObject({
      status: "mismatch",
      observed: { arms: 3 },
      mismatches: ["arms"],
    });
  });

  it("sends the image to the configured Workers AI vision model and reads its JSON", async () => {
    const run = vi.fn(async () => ({ response: '{"arms": 6, "torso_fully_visible": true}' }));
    const verify = workersAiAnatomyVerifier({ binding: { run }, config: anatomyCheckConfig({ ANIMA_PHOTO_ANATOMY_CHECK: "on" }), name: "Vashti", spec });
    const v = await verify({ bytes: JPEG, contentType: "image/jpeg" });
    expect(v.status).toBe("mismatch");
    const [model, opts] = run.mock.calls[0] as unknown as [string, { messages: Array<{ content: unknown }> }];
    expect(model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(JSON.stringify(opts.messages)).toContain("data:image/jpeg;base64,");
  });

  it("a failing vision call passes the photo through", async () => {
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    const verify = workersAiAnatomyVerifier({ binding: { run }, config: anatomyCheckConfig({ ANIMA_PHOTO_ANATOMY_CHECK: "on" }), name: "V", spec });
    expect(await verify({ bytes: JPEG, contentType: "image/jpeg" })).toEqual({ status: "skipped", reason: "error" });
  });
});

describe("render, check, regenerate", () => {
  const mismatch = (score: number): AnatomyVerdict => ({ status: "mismatch", observed: { arms: 4 + score }, mismatches: ["arms"], score });
  const pass: AnatomyVerdict = { status: "pass", observed: { arms: 4 } };
  const bytes = { bytes: JPEG, contentType: "image/jpeg" };

  it("regenerates once on extra arms and returns the passing render", async () => {
    const render = vi.fn(async (attempt: number) => `img${attempt}`);
    const verify = vi.fn().mockResolvedValueOnce(mismatch(2)).mockResolvedValueOnce(pass);
    const out = await renderWithAnatomyCheck({ render, bytesOf: () => bytes, verify, maxRetries: 2 });
    expect(out).toMatchObject({ result: "img1", attempts: 2, check: "passed" });
    expect(render.mock.calls.map((c) => c[0])).toEqual([0, 1]);
  });

  it("never exceeds the retry bound and keeps the closest render", async () => {
    const render = vi.fn(async (attempt: number) => `img${attempt}`);
    const verify = vi.fn().mockResolvedValueOnce(mismatch(3)).mockResolvedValueOnce(mismatch(1)).mockResolvedValue(mismatch(2));
    const out = await renderWithAnatomyCheck({ render, bytesOf: () => bytes, verify, maxRetries: 2 });
    expect(render).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ result: "img1", attempts: 3, check: "failed" });
  });

  it("does not retry past the deadline", async () => {
    let t = 0;
    const now = () => t;
    const render = vi.fn(async () => {
      t += 20_000;
      return "img";
    });
    const verify = vi.fn().mockResolvedValue(mismatch(2));
    const out = await renderWithAnatomyCheck({ render, bytesOf: () => bytes, verify, maxRetries: 2, deadlineAt: 30_000, now });
    expect(render).toHaveBeenCalledTimes(1);
    expect(out.check).toBe("failed");
  });

  it("does not start a check that cannot finish before the deadline", async () => {
    let t = 0;
    const verify = vi.fn();
    const out = await renderWithAnatomyCheck({
      render: async () => {
        t = 40_000;
        return "img";
      },
      bytesOf: () => bytes,
      verify,
      maxRetries: 2,
      verifyBudgetMs: 8_000,
      deadlineAt: 43_000,
      now: () => t,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(out).toMatchObject({ result: "img", attempts: 1, check: "skipped" });
  });

  it("a retry that runs past the deadline is abandoned for the best render", async () => {
    vi.useFakeTimers();
    try {
      const render = vi.fn((attempt: number) => (attempt ? new Promise<string>(() => {}) : Promise.resolve("img0")));
      const verify = vi.fn().mockResolvedValue(mismatch(2));
      const p = renderWithAnatomyCheck({ render, bytesOf: () => bytes, verify, maxRetries: 1, deadlineAt: Date.now() + 30_000 });
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(p).resolves.toMatchObject({ result: "img0", check: "failed", attempts: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the best render when a retry throws (flagged / quota)", async () => {
    const render = vi.fn().mockResolvedValueOnce("img0").mockRejectedValueOnce(new Error("3030 flagged"));
    const out = await renderWithAnatomyCheck({ render, bytesOf: () => bytes, verify: vi.fn().mockResolvedValue(mismatch(2)), maxRetries: 1 });
    expect(out).toMatchObject({ result: "img0", check: "failed" });
  });

  it("skip renders once without reading bytes", async () => {
    const bytesOf = vi.fn();
    const verify = vi.fn();
    const out = await renderWithAnatomyCheck({ render: async () => "img", bytesOf, verify, skip: true, maxRetries: 2 });
    expect(out).toMatchObject({ attempts: 1, check: "off" });
    expect(bytesOf).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("chat photo with the anatomy check", () => {
  it("re-renders with a new seed, sends one photo and records the check (no prompt text)", async () => {
    const seeds: number[] = [];
    const binding = {
      run: vi.fn(async (_model: string, opts: Record<string, unknown>) => {
        const body = (opts.multipart as { body: ReadableStream }).body;
        const text = await new Response(body).text();
        const m = /name="seed"\r\n\r\n(\d+)/.exec(text);
        if (m) seeds.push(Number(m[1]));
        return { image: Buffer.from(JPEG).toString("base64") };
      }),
    };
    const verify = vi
      .fn()
      .mockResolvedValueOnce({ status: "mismatch", observed: { arms: 6 }, mismatches: ["arms"], score: 2 })
      .mockResolvedValueOnce({ status: "pass", observed: { arms: 4 } });
    const store = vi.fn(async () => ({ id: "up_1" }));
    const look = companionLook(fourArmed);
    const out = await startCompanionPhoto({
      plan: { action: "send", intent: intent(), level: "sfw", look, preinstalled: false },
      userId: "u_anatomy_test",
      characterId: "char_kali",
      companionName: "Vashti",
      character: fourArmed,
      turnId: "t1",
      binding,
      loadReference: async () => null,
      store: store as never,
      complete: null,
      anatomyConfig: { enabled: true, model: "@cf/x/y", maxRetries: 1, timeoutMs: 1000 },
      verifyAnatomy: verify,
    });
    expect(out.status).toBe("sent");
    expect(binding.run).toHaveBeenCalledTimes(2);
    expect(new Set(seeds).size).toBe(2);
    expect(store).toHaveBeenCalledTimes(1);
    if (out.status === "sent") {
      expect(out.anatomy).toMatchObject({ expected: { arms: 4 }, check: "passed", attempts: 2 });
    }
  });

  it("withholds a standard companion photo when the extra arm persists after retry", async () => {
    const character = { id: "char_mia", name: "Mia", appearance: "short red hair" };
    const binding = { run: vi.fn(async () => ({ image: Buffer.from(JPEG).toString("base64") })) };
    const store = vi.fn();
    const outcome = await startCompanionPhoto({
      plan: { action: "send", intent: intent(), level: "sfw", look: companionLook(character), preinstalled: false },
      userId: "u_anatomy_standard",
      characterId: character.id,
      companionName: "Mia",
      character,
      turnId: "t1",
      binding,
      loadReference: async () => null,
      store: store as never,
      complete: null,
      anatomyConfig: { enabled: true, model: "@cf/x/y", maxRetries: 1, timeoutMs: 1000 },
      verifyAnatomy: vi.fn().mockResolvedValue({ status: "mismatch", observed: { arms: 3 }, mismatches: ["arms"], score: 1 }),
    });
    expect(outcome).toMatchObject({ status: "failed", errorKind: "anatomy" });
    expect(binding.run).toHaveBeenCalledTimes(2);
    expect(store).not.toHaveBeenCalled();
  });
});
