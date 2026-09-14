import { describe, expect, it } from "vitest";
import { characterNameFromSystem, namesMatch, normalizeCharacterKey, parseCharacterList } from "../src/dataset/characters";
import { fromAnimaBackup, fromChatMl, isAnimaBackup, isChatMlShape } from "../src/dataset/sources";
import { foldForeignSpeakers, splitExampleByCharacters } from "../src/dataset/split";
import type { TrainingExample } from "../src/dataset/types";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/llm/data/samples",
);

describe("character name matching", () => {
  it("treats Fallen Angel spellings as the same companion", () => {
    expect(namesMatch("Fallen Angel", "fallen-angel")).toBe(true);
    expect(namesMatch("FallenAngel", "Fallen Angel")).toBe(true);
    expect(namesMatch("Serenity", "serenity")).toBe(true);
  });

  it("does not match Angel to Fallen Angel", () => {
    expect(namesMatch("Angel", "Fallen Angel")).toBe(false);
    expect(namesMatch("Korra", "Serenity")).toBe(false);
  });

  it("parses a comma list", () => {
    expect(parseCharacterList("Serenity, Fallen Angel")).toEqual(["Serenity", "Fallen Angel"]);
    expect(parseCharacterList("")).toBeUndefined();
  });

  it("reads a companion name out of a system prompt", () => {
    expect(characterNameFromSystem("You are Serenity, a warm guardian.")).toBe("Serenity");
    expect(characterNameFromSystem("You are Fallen Angel: darkly luminous.")).toBe("Fallen Angel");
  });

  it("slugs fallen angel without spaces", () => {
    expect(normalizeCharacterKey("Fallen Angel")).toBe("fallenangel");
  });
});

describe("fold / split speakers", () => {
  const mixed: TrainingExample = {
    id: "mix",
    source: "test",
    character: { name: "Serenity" },
    conversation: [
      { role: "user", content: "Am I safe?" },
      { role: "assistant", content: "You are safe.", name: "Serenity" },
      { role: "assistant", content: "I keep the watch.", name: "Fallen Angel" },
      { role: "user", content: "Thank you both." },
      { role: "assistant", content: "Rest.", name: "Serenity" },
    ],
  };

  it("folds a foreign speaker into the next target reply", () => {
    const folded = foldForeignSpeakers(mixed.conversation, "Serenity");
    const assistant = folded.filter((t) => t.role === "assistant");
    expect(assistant).toHaveLength(2);
    expect(assistant[0]?.content).toBe("You are safe.");
    expect(assistant[1]?.content).toContain("Fallen Angel");
    expect(assistant[1]?.content).toContain("Rest.");
    expect(assistant.every((t) => t.name === "Serenity")).toBe(true);
  });

  it("emits one example per requested speaker who actually talked", () => {
    const split = splitExampleByCharacters(mixed, ["Serenity", "Fallen Angel", "Korra"]);
    expect(split.map((e) => e.character.name).sort()).toEqual(["Fallen Angel", "Serenity"]);
  });
});

describe("Anima Settings backup adapter", () => {
  it("detects the export shape", async () => {
    const backup = JSON.parse(
      await readFile(path.join(SAMPLES, "anima-backup.serenity-fallen-angel.json"), "utf8"),
    );
    expect(isAnimaBackup(backup)).toBe(true);
  });

  it("keeps Serenity + Fallen Angel and drops other companions by default", async () => {
    const backup = JSON.parse(
      await readFile(path.join(SAMPLES, "anima-backup.serenity-fallen-angel.json"), "utf8"),
    );
    const examples = fromAnimaBackup(backup);
    const names = new Set(examples.map((e) => e.character.name));
    expect(names.has("Serenity")).toBe(true);
    expect(names.has("Fallen Angel")).toBe(true);
    expect(names.has("Korra")).toBe(false);
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  it("attaches CharacterMemory facts to the matching companion", async () => {
    const backup = JSON.parse(
      await readFile(path.join(SAMPLES, "anima-backup.serenity-fallen-angel.json"), "utf8"),
    );
    const examples = fromAnimaBackup(backup);
    const serenity = examples.find((e) => e.character.name === "Serenity" && e.id.includes("comfort"));
    expect(serenity?.memory?.some((m) => /grieving/i.test(m))).toBe(true);
  });

  it("splits a crossover session so neither companion is trained on the other's voice", async () => {
    const backup = JSON.parse(
      await readFile(path.join(SAMPLES, "anima-backup.serenity-fallen-angel.json"), "utf8"),
    );
    const examples = fromAnimaBackup(backup);
    const group = examples.filter((e) => e.scenario?.id === "sess_crossover");
    expect(group).toHaveLength(2);
    for (const ex of group) {
      const named = ex.conversation.filter((t) => t.role === "assistant");
      expect(named.every((t) => t.name === ex.character.name)).toBe(true);
    }
  });

  it("keeps every companion when allCharacters is set", async () => {
    const backup = JSON.parse(
      await readFile(path.join(SAMPLES, "anima-backup.serenity-fallen-angel.json"), "utf8"),
    );
    const examples = fromAnimaBackup(backup, { allCharacters: true });
    expect(examples.some((e) => e.character.name === "Korra")).toBe(true);
  });
});

describe("ChatML adapter", () => {
  it("detects and converts messages[] JSON", async () => {
    const raw = JSON.parse(await readFile(path.join(SAMPLES, "chatml-fallen-angel.json"), "utf8"));
    expect(isChatMlShape(raw)).toBe(true);
    const example = fromChatMl(raw, "x", "import:x", "Fallen Angel");
    expect(example.character.name).toBe("Fallen Angel");
    expect(example.conversation.some((t) => t.role === "assistant")).toBe(true);
  });
});
