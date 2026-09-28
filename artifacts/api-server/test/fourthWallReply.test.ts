import { describe, expect, it } from "vitest";
import { LLM_LOCAL_FIRST_TOKEN_MS } from "../src/lib/chatTimeouts";
import {
  FOURTH_WALL_RETRY_ELAPSED_LIMIT_MS,
  FOURTH_WALL_RETRY_MAX_TOKENS,
  fourthWallRetryAllowed,
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

  it("matches only the clear narration phrases", () => {
    expect(isFourthWallReply("That's the MCU version of the story.")).toBe(true);
    expect(isFourthWallReply("In the movies she dies there.")).toBe(true);
    expect(isFourthWallReply("In the films they never show the climb.")).toBe(true);
    expect(isFourthWallReply("In the comics the cliff is red.")).toBe(true);
    expect(isFourthWallReply("In the franchise it is a set piece.")).toBe(true);
    expect(isFourthWallReply("MCU version of the cliff.")).toBe(false);
    expect(isFourthWallReply("This cinematic universe keeps the stone.")).toBe(false);
    expect(isFourthWallReply("This fictional universe keeps the stone.")).toBe(false);
    expect(isFourthWallReply("In the movie she dies there.")).toBe(false);
    expect(isFourthWallReply("I saw a film of dust on the glass.")).toBe(false);
    expect(isFourthWallReply("The comic timing of that joke was awful.")).toBe(false);
    expect(isFourthWallReply("Come stand with me. The wind here is worse than it looks.")).toBe(false);
  });

  it("keeps the retry reminder off a third-person lecture", () => {
    const reminder = inWorldRetryReminder("Natasha Romanoff");
    expect(reminder).toContain("Stay Natasha Romanoff.");
    expect(reminder).toContain(
      "You live in your own world. The person talking to you has stepped into it and is here with you now.",
    );
    expect(reminder).toContain(
      "Speak in first person about your life and places as things you know firsthand. Never mention films, comics, a franchise, or a story.",
    );
    expect(reminder).not.toMatch(/cinematic universe/i);
    expect(reminder).not.toMatch(/\bmcu\b/i);
  });

  it("caps the backup short and skips it after half of the 90s budget", () => {
    expect(FOURTH_WALL_RETRY_MAX_TOKENS).toBeLessThanOrEqual(32);
    expect(FOURTH_WALL_RETRY_ELAPSED_LIMIT_MS).toBe(LLM_LOCAL_FIRST_TOKEN_MS / 2);
    expect(fourthWallRetryAllowed(0)).toBe(true);
    expect(fourthWallRetryAllowed(FOURTH_WALL_RETRY_ELAPSED_LIMIT_MS - 1)).toBe(true);
    expect(fourthWallRetryAllowed(FOURTH_WALL_RETRY_ELAPSED_LIMIT_MS)).toBe(false);
    expect(fourthWallRetryAllowed(LLM_LOCAL_FIRST_TOKEN_MS)).toBe(false);
    expect(fourthWallRetryAllowed(Number.NaN)).toBe(false);
  });
});
