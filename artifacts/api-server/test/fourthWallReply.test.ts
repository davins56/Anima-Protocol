import { describe, expect, it } from "vitest";
import {
  inWorldFourthWallDeflection,
  inWorldRetryReminder,
  isFourthWallReply,
} from "../src/lib/fourthWallReply";

const SCREENSHOT =
  "Ah, yes, that's a fascinating tale. In the Marvel Cinematic Universe, Vormir is a place of great power and intrigue. It's a world where the Avengers come together to fight their own battles against the Thanos-led Monolith. The Vormirians are a people who have lived for centuries, and they have a history steeped in mythology and legends.";

const IN_WORLD = "Vormir? I don't talk about Vormir. Not with anyone.";

describe("fourth-wall replies", () => {
  it("catches the encyclopedia screenshot and passes an in-world refusal", () => {
    expect(isFourthWallReply(SCREENSHOT)).toBe(true);
    expect(isFourthWallReply(IN_WORLD)).toBe(false);
    expect(isFourthWallReply("")).toBe(false);
    expect(isFourthWallReply("The stone asks for a life. I already paid.")).toBe(false);
  });

  it("matches the narrow franchise phrases and ignores ordinary talk", () => {
    expect(isFourthWallReply("That's the MCU version of the story.")).toBe(true);
    expect(isFourthWallReply("In the movies she dies there.")).toBe(true);
    expect(isFourthWallReply("In the films they never show the climb.")).toBe(true);
    expect(isFourthWallReply("In the comics the cliff is red.")).toBe(true);
    expect(isFourthWallReply("In the franchise it is a set piece.")).toBe(true);
    expect(isFourthWallReply("This fictional universe keeps the stone.")).toBe(true);
    expect(isFourthWallReply("I saw a film of dust on the glass.")).toBe(false);
    expect(isFourthWallReply("The comic timing of that joke was awful.")).toBe(false);
    expect(isFourthWallReply("Come stand with me. The wind here is worse than it looks.")).toBe(false);
  });

  it("keeps the retry reminder off the cached prefix and out of a third-person lecture", () => {
    const reminder = inWorldRetryReminder("Natasha Romanoff");
    expect(reminder).toContain("Stay Natasha Romanoff");
    expect(reminder).toContain("physically in your world");
    expect(reminder).not.toMatch(/cinematic universe/i);
    expect(reminder).not.toMatch(/\bmcu\b/i);
    expect(reminder).not.toContain("She studies");
    expect(inWorldFourthWallDeflection("Natasha Romanoff")).toContain("Natasha Romanoff");
    expect(inWorldFourthWallDeflection("Natasha Romanoff")).not.toMatch(/cinematic universe/i);
  });
});
