import { describe, it, expect, vi } from "vitest";
import {
  parseImagePrompts,
  stripImageTags,
  userRequestedImage,
  enhanceImagePrompt,
  imageGenerationTagInstruction,
  resolveChatImageAttachments,
} from "./chatImageGeneration";

describe("chat image generation", () => {
  it("parses and strips [IMAGE:] tags", () => {
    const text = `A quiet look.\n[IMAGE: Korra at sunset on a cliff]\nWant to come closer?`;
    expect(parseImagePrompts(text)).toEqual(["Korra at sunset on a cliff"]);
    expect(stripImageTags(text)).toBe("A quiet look.\n\nWant to come closer?");
  });

  it("detects user image requests without matching ordinary chat", () => {
    expect(userRequestedImage("draw me standing in the rain")).toBe(true);
    expect(userRequestedImage("generate an image of the temple")).toBe(true);
    expect(userRequestedImage("show me a picture of us")).toBe(true);
    expect(userRequestedImage("what do you think about the rain")).toBe(false);
    expect(userRequestedImage("draw closer and listen")).toBe(false);
  });

  it("grounds prompts for onboard Animas and universe companions", () => {
    const anima = enhanceImagePrompt("moonlit garden", {
      name: "Serenity",
      _isAnima: true,
    });
    expect(anima).toMatch(/moonlit garden/i);
    expect(anima).toMatch(/Serenity/);
    expect(anima).toMatch(/luminous/);

    const series = enhanceImagePrompt("the South Pole", {
      name: "Korra",
      universe: "Avatar",
      _isAnima: false,
    });
    expect(series).toMatch(/Korra/);
    expect(series).toMatch(/Avatar/);
  });

  it("explains the tag so onboard and user-created AIs can generate", () => {
    const instruction = imageGenerationTagInstruction();
    expect(instruction).toMatch(/\[IMAGE:/);
    expect(instruction).toMatch(/cannot generate images/i);
  });

  it("uses the tag prompt when present", async () => {
    const generateImage = vi.fn(async ({ prompt }) => ({
      url: `data:image/png;base64,${prompt.slice(0, 8)}`,
    }));
    const result = await resolveChatImageAttachments({
      replyText: "[IMAGE: a silver netnavi in flight]",
      userText: "hello",
      character: { name: "Serenity", _isAnima: true },
      generateImage,
    });
    expect(result.source).toBe("tag");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].type).toBe("image");
    expect(generateImage.mock.calls[0][0].prompt).toMatch(/silver netnavi/i);
  });

  it("falls back to a user request when the model omitted the tag", async () => {
    const generateImage = vi.fn(async () => ({ url: "https://cdn.test/scene.png" }));
    const result = await resolveChatImageAttachments({
      replyText: "Of course — here.",
      userText: "draw me a portrait",
      character: { name: "Nyx", _isAnima: true },
      generateImage,
    });
    expect(result.source).toBe("request");
    expect(result.attachments[0].url).toBe("https://cdn.test/scene.png");
  });

  it("persists data URLs when a persist helper is provided", async () => {
    const generateImage = vi.fn(async () => ({ image: "data:image/png;base64,abc" }));
    const persistUrl = vi.fn(async () => "/api/storage/objects/scene.jpg");
    const result = await resolveChatImageAttachments({
      replyText: "[IMAGE: a lantern]",
      generateImage,
      persistUrl,
    });
    expect(result.attachments[0].url).toBe("/api/storage/objects/scene.jpg");
  });

  it("returns no attachments when generation yields nothing", async () => {
    const generateImage = vi.fn(async () => ({}));
    const result = await resolveChatImageAttachments({
      replyText: "[IMAGE: void]",
      generateImage,
    });
    expect(result.attachments).toEqual([]);
    expect(result.source).toBeNull();
  });
});
