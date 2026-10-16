import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  composeCompanionChatMessages,
  composePrompt,
} from "../src/lib/promptBuilder";
import {
  describeSharedPhotos,
  photoCountFromMetadata,
  photosFromMetadata,
  sharedPhotoPromptNote,
} from "../src/lib/sharedPhoto";

const character = {
  id: "char_1",
  name: "Serenity",
  personality: "Calm and exact",
  backstory: "A guide who remembers what she is shown.",
  speaking_style: "Soft and precise",
};

describe("shared photo note", () => {
  it("does not call a vision API", async () => {
    const source = readFileSync(
      new URL("../src/lib/sharedPhoto.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from ["']/);
    expect(source).toMatch(/return null;/);
    expect(await describeSharedPhotos({ count: 1, photos: [] })).toBeNull();
  });

  it("clamps the photo count from chat metadata", () => {
    expect(photoCountFromMetadata({ photo_count: 1 })).toBe(1);
    expect(photoCountFromMetadata({ photo_count: "2" })).toBe(2);
    expect(photoCountFromMetadata({ photo_count: 9 })).toBe(4);
    expect(photoCountFromMetadata({ photo_count: 0 })).toBe(0);
    expect(photoCountFromMetadata({ photo_count: "nope" })).toBe(0);
    expect(photoCountFromMetadata(null)).toBe(0);
  });

  it("keeps only stored upload paths for a future vision read", () => {
    expect(
      photosFromMetadata({
        photo_urls: [
          "/api/storage/objects/uploads/abc_123",
          "https://example.com/secret.jpg",
          "/objects/uploads/photo-1/extra",
          "/objects/uploads/photo-1",
        ],
      }),
    ).toEqual([
      { url: "/api/storage/objects/uploads/abc_123" },
      { url: "/objects/uploads/photo-1" },
    ]);
    expect(photosFromMetadata({ photo_urls: "nope" })).toEqual([]);
  });

  it("puts a cannot-see note beside the caption and keeps the PDF excerpt", async () => {
    const note = sharedPhotoPromptNote({
      count: 1,
      visionSummary: await describeSharedPhotos({ count: 1, photos: [] }),
    });
    expect(note).toMatch(/cannot see the image/i);
    expect(note).not.toMatch(/the photo shows|I can see/i);

    const marker = "SILVERKEYUNIQUE";
    const shared = {
      characters: [character],
      activeCharacter: character,
      memories: [],
      recentMessages: [],
      content: "Look at this with me",
      mode: "solo" as const,
      pdfContext: `${marker} the north gate`,
      photoNote: note,
    };
    const messages = composeCompanionChatMessages(shared);
    const system = messages.find((message) => message.role === "system")?.content || "";
    expect(system).toContain(marker);
    expect(system).toContain("the north gate");
    const user = messages.filter((message) => message.role === "user").at(-1)?.content || "";
    expect(user.startsWith("Look at this with me")).toBe(true);
    expect(user).toContain("cannot see the image");
    expect(user).not.toContain(marker);

    const prompt = composePrompt(shared);
    expect(prompt).toContain(marker);
    expect(prompt.indexOf("Look at this with me")).toBeLessThan(prompt.indexOf("cannot see the image"));
    expect(prompt.indexOf("cannot see the image")).toBeLessThan(prompt.indexOf("HIGHEST-PRIORITY RULE"));
  });

  it("keeps a supplied local vision note inside the photo line", () => {
    const note = sharedPhotoPromptNote({
      count: 2,
      visionSummary: "A red door and a silver key.",
    });
    expect(note).toContain("2 photos");
    expect(note).toContain("A red door and a silver key.");
    expect(note).toMatch(/do not add visual details/i);
  });
});
