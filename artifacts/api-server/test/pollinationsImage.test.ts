import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPollinationsImageUrl,
  generateImageWithPollinations,
  isFreeImageFallbackEnabled,
  pollinationsModel,
} from "../src/lib/pollinationsImage";
import { shouldFallbackToFreeImage } from "../src/routes/openai/functions";

describe("isFreeImageFallbackEnabled", () => {
  afterEach(() => {
    delete process.env.IMAGE_FREE_FALLBACK;
  });

  it("defaults to enabled", () => {
    delete process.env.IMAGE_FREE_FALLBACK;
    expect(isFreeImageFallbackEnabled()).toBe(true);
  });

  it("can be disabled via env", () => {
    process.env.IMAGE_FREE_FALLBACK = "off";
    expect(isFreeImageFallbackEnabled()).toBe(false);
    process.env.IMAGE_FREE_FALLBACK = "false";
    expect(isFreeImageFallbackEnabled()).toBe(false);
    process.env.IMAGE_FREE_FALLBACK = "0";
    expect(isFreeImageFallbackEnabled()).toBe(false);
  });
});

describe("buildPollinationsImageUrl", () => {
  afterEach(() => {
    delete process.env.POLLINATIONS_BASE_URL;
    delete process.env.POLLINATIONS_MODEL;
  });

  it("encodes the prompt and defaults to flux at 1024", () => {
    const url = buildPollinationsImageUrl("a neon anima portrait");
    expect(url).toContain("https://image.pollinations.ai/prompt/");
    expect(url).toContain(encodeURIComponent("a neon anima portrait"));
    expect(url).toContain("model=flux");
    expect(url).toContain("width=1024");
    expect(url).toContain("height=1024");
    expect(url).toContain("nologo=true");
    expect(url).toContain("private=true");
  });

  it("honors model override", () => {
    process.env.POLLINATIONS_MODEL = "turbo";
    expect(pollinationsModel()).toBe("turbo");
    const url = buildPollinationsImageUrl("test", { model: "turbo" });
    expect(url).toContain("model=turbo");
  });
});

describe("generateImageWithPollinations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a data URL from the fetched image bytes", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG markers
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      ),
    );

    const result = await generateImageWithPollinations("cyberpunk anima");
    expect(result.provider).toBe("pollinations");
    expect(result.model).toBe("flux");
    expect(result.image).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("maps upstream 429 to rate_limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow down", { status: 429 })),
    );
    await expect(generateImageWithPollinations("busy")).rejects.toMatchObject({
      status: 429,
      code: "rate_limit",
    });
  });

  it("rejects empty prompts", async () => {
    await expect(generateImageWithPollinations("   ")).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("shouldFallbackToFreeImage", () => {
  it("falls back for auth, rate limit, and server errors", () => {
    expect(shouldFallbackToFreeImage("auth_error")).toBe(true);
    expect(shouldFallbackToFreeImage("rate_limit")).toBe(true);
    expect(shouldFallbackToFreeImage("server_error")).toBe(true);
  });

  it("does not fall back for content policy", () => {
    expect(shouldFallbackToFreeImage("content_policy")).toBe(false);
  });
});
