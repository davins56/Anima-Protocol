import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editImageWithOpenRouter,
  generateImageWithOpenRouter,
  missingImageProviderError,
  MISSING_IMAGE_PROVIDER_MESSAGE,
  openRouterImageModel,
} from "../src/lib/openrouterImage";

describe("openRouterImageModel", () => {
  afterEach(() => {
    delete process.env.ANIMA_OPENROUTER_IMAGE_MODEL;
    delete process.env.OPENROUTER_IMAGE_MODEL;
  });

  it("defaults to Gemini Flash Image via OpenRouter", () => {
    expect(openRouterImageModel()).toBe("google/gemini-2.5-flash-image");
    process.env.ANIMA_OPENROUTER_IMAGE_MODEL = "black-forest-labs/flux.2-flex";
    expect(openRouterImageModel()).toBe("black-forest-labs/flux.2-flex");
  });
});

describe("generateImageWithOpenRouter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
  });

  it("returns a data URL from b64_json", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const result = await generateImageWithOpenRouter("cyberpunk anima");
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("google/gemini-2.5-flash-image");
    expect(result.image).toBe(`data:image/png;base64,${b64}`);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/\/images$/);
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-or-test",
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.prompt).toContain("cyberpunk anima");
    expect(body.model).toBe("google/gemini-2.5-flash-image");
    expect(body.aspect_ratio).toBe("1:1");
  });

  it("maps 402 credits to a rate_limit with an actionable message", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Payment required" } }), {
            status: 402,
          }),
      ),
    );
    await expect(generateImageWithOpenRouter("busy")).rejects.toMatchObject({
      status: 503,
      code: "rate_limit",
    });
    await expect(generateImageWithOpenRouter("busy")).rejects.toThrow(/credits/i);
  });

  it("maps missing key to auth_error", async () => {
    await expect(generateImageWithOpenRouter("no key")).rejects.toMatchObject({
      status: 503,
      code: "auth_error",
    });
  });
});

describe("editImageWithOpenRouter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("sends the source image as input_references", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const outB64 = Buffer.from("out").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: outB64 }] }), {
            status: 200,
          }),
      ),
    );

    const src = "data:image/jpeg;base64,abc123";
    const result = await editImageWithOpenRouter(src, "make skin deep ebony");
    expect(result.image).toContain(outB64);

    const body = JSON.parse(
      String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body),
    );
    expect(body.input_references).toEqual([src]);
    expect(body.prompt).toContain("make skin deep ebony");
  });
});

describe("missingImageProviderError", () => {
  it("names the three image keys an operator can bind", () => {
    const err = missingImageProviderError();
    expect(err).toMatchObject({ status: 503, code: "auth_error" });
    expect(err.message).toBe(MISSING_IMAGE_PROVIDER_MESSAGE);
    expect(err.message).toMatch(/GEMINI_API_KEY/);
    expect(err.message).toMatch(/OPENAI_API_KEY/);
    expect(err.message).toMatch(/OPENROUTER_API_KEY/);
  });
});
