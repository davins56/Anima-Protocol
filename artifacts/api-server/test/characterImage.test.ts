import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_IMAGE_LOOKUP_BUDGET_MS,
  titleMatchesName,
  WIKI_FETCH_TIMEOUT_MS,
} from "../src/routes/characterImage";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/routes/characterImage.ts"),
  "utf8",
);

describe("titleMatchesName", () => {
  it("accepts a title that shares a distinctive name token", () => {
    expect(titleMatchesName("Tony Stark (Marvel Cinematic Universe)", "Tony Stark")).toBe(true);
    expect(titleMatchesName("Steve Rogers (Marvel Cinematic Universe)", "Steve Rogers")).toBe(true);
    expect(titleMatchesName("Korra", "Korra")).toBe(true);
  });

  it("matches when only the surname or one token overlaps", () => {
    expect(titleMatchesName("T'Challa (Marvel Cinematic Universe)", "T'Challa")).toBe(true);
    expect(titleMatchesName("Bruce Banner (Marvel Cinematic Universe)", "Bruce Banner")).toBe(true);
  });

  it("rejects a franchise/show page that does not name the character", () => {
    expect(titleMatchesName("The Legend of Korra", "Asami Sato")).toBe(false);
    expect(titleMatchesName("The Legend of Korra", "Bolin")).toBe(false);
    expect(titleMatchesName("The Legend of Korra", "Lin Beifong")).toBe(false);
  });

  it("ignores short tokens and decides on the distinctive one", () => {
    // "ed" is too short to count; the decision rests on "stark", which is absent.
    expect(titleMatchesName("The Avengers", "Ed Stark")).toBe(false);
  });

  it("falls back to accepting when the name has no distinctive tokens", () => {
    expect(titleMatchesName("Anything", "Ed")).toBe(true);
  });
});

describe("character-image Worker budget", () => {
  it("caps each Wikipedia hop and fail-opens to url: null", () => {
    expect(WIKI_FETCH_TIMEOUT_MS).toBe(2500);
    expect(CHARACTER_IMAGE_LOOKUP_BUDGET_MS).toBe(6000);
    expect(src).toContain("AbortSignal.timeout(WIKI_FETCH_TIMEOUT_MS)");
    expect(src).toContain("CHARACTER_IMAGE_LOOKUP_BUDGET_MS");
    expect(src).toContain("res.json({ url: null })");
    expect(src).not.toContain('res.status(502).json({ error:');
  });
});
