import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editImageWithGemini,
  generateImageWithGemini,
  geminiImageModel,
  hasGeminiImageKey,
  isFreeImageFallbackEnabled,
} from "../src/lib/geminiImage";
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
  });
});

describe("hasGeminiImageKey / model", () => {
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_IMAGE_MODEL;
  });

  it("reads GEMINI_API_KEY or GOOGLE_API_KEY", () => {
    expect(hasGeminiImageKey()).toBe(false);
    process.env.GOOGLE_API_KEY = "goog-test";
    expect(hasGeminiImageKey()).toBe(true);
    process.env.GEMINI_API_KEY = "gem-test";
    expect(hasGeminiImageKey()).toBe(true);
  });

  it("defaults model to gemini-2.5-flash-image", () => {
    expect(geminiImageModel()).toBe("gemini-2.5-flash-image");
    process.env.GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
    expect(geminiImageModel()).toBe("gemini-2.5-flash-image-preview");
  });
});

describe("generateImageWithGemini", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  it("returns a data URL from inlineData", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: "image/png", data: b64 } }],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await generateImageWithGemini("cyberpunk anima");
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash-image");
    expect(result.image).toBe(`data:image/png;base64,${b64}`);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("gemini-2.5-flash-image:generateContent");
    expect((init as RequestInit).headers).toMatchObject({
      "x-goog-api-key": "test-key",
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.generationConfig.responseModalities).toEqual(["IMAGE"]);
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("1:1");
  });

  it("maps 429 to rate_limit", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED" } }), {
          status: 429,
        }),
      ),
    );
    await expect(generateImageWithGemini("busy")).rejects.toMatchObject({
      status: 429,
      code: "rate_limit",
    });
  });

  it("maps missing key to auth_error", async () => {
    await expect(generateImageWithGemini("no key")).rejects.toMatchObject({
      status: 503,
      code: "auth_error",
    });
  });

  it("maps safety block to content_policy", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }),
          { status: 200 },
        ),
      ),
    );
    await expect(generateImageWithGemini("blocked")).rejects.toMatchObject({
      code: "content_policy",
    });
  });
});

describe("editImageWithGemini", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("sends the source image as inlineData", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const outB64 = Buffer.from("out").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ inlineData: { mimeType: "image/png", data: outB64 } }] } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const src = "data:image/jpeg;base64,abc123";
    const result = await editImageWithGemini(src, "make skin deep ebony");
    expect(result.image).toContain(outB64);

    const body = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: "image/jpeg",
      data: "abc123",
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
