import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRIEF_GOLD_EXAMPLES } from "../src/dataset/briefGold";
import {
  BOOK_CATALOG,
  bookSpecForFilename,
  expandByWeight,
  filterSerenitySft,
  replicaCount,
} from "../src/dataset/catalog";
import { curateNovels, writeCuratedBundle } from "../src/dataset/curate";
import { dedupeById } from "../src/dataset/clean";
import { extractNovelExamples } from "../src/dataset/novels";
import { ANIMA_PREFERENCE_EXAMPLES } from "../src/dataset/preferences";
import { listSeedExamples } from "../src/dataset/seed";
import type { TrainingExample } from "../src/dataset/types";

function spec(id: string) {
  const found = BOOK_CATALOG.find((b) => b.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("novel catalog", () => {
  it("maps filenames to book + register", () => {
    expect(bookSpecForFilename("anima-protocol.txt")?.id).toBe("anima-protocol");
    expect(bookSpecForFilename("the-slipthk-war.pdf")?.register).toBe("slipthk");
    expect(bookSpecForFilename("fallen-angel.md")?.role).toBe("lore-only");
  });

  it("weights gold 4×, secondary 2×, slipthk 1×", () => {
    const gold: TrainingExample = {
      id: "g",
      source: "t",
      character: { name: "Serenity" },
      conversation: [],
      tags: ["book:anima-protocol", "register:gold"],
    };
    const seraph: TrainingExample = {
      ...gold,
      id: "s",
      tags: ["book:seraph-code"],
    };
    const spice: TrainingExample = {
      ...gold,
      id: "k",
      tags: ["book:slipthk-war", "register:slipthk", "trust-gated"],
    };
    expect(replicaCount(gold)).toBe(4);
    expect(replicaCount(seraph)).toBe(2);
    expect(replicaCount(spice)).toBe(1);
    expect(expandByWeight([gold]).map((e) => e.id)).toEqual(["g", "g~w1", "g~w2", "g~w3"]);
  });

  it("drops fallen-angel from Serenity SFT unless includeLore", () => {
    const lore: TrainingExample = {
      id: "lore",
      source: "novel:fallen-angel",
      character: { name: "World lore" },
      conversation: [
        { role: "user", content: "Who speaks?" },
        { role: "assistant", content: "Archive only.", name: "Narrator" },
      ],
      tags: ["book:fallen-angel", "exclude-serenity-sft", "world-lore"],
    };
    expect(filterSerenitySft([lore])).toEqual([]);
    expect(filterSerenitySft([lore], true)).toHaveLength(1);
  });
});

describe("novel extractor", () => {
  it("chunks Speaker lines and folds to Serenity for gold books", () => {
    const text = [
      "Steward: Sit the throne.",
      "Serenity: I will sit the porch with you.",
      "Other: Ignore this mouth.",
      "Serenity: Choice stays in your hands.",
    ].join("\n");
    const examples = extractNovelExamples(text, spec("anima-protocol"));
    expect(examples.length).toBeGreaterThan(0);
    const [ex] = examples;
    expect(ex.character.name).toBe("Serenity");
    expect(ex.tags).toContain("register:gold");
    expect(ex.conversation.some((t) => t.role === "assistant" && t.name === "Other")).toBe(false);
    expect(ex.conversation.some((t) => t.content.includes("[Other]"))).toBe(true);
  });

  it("does not train fallen-angel scenes as Serenity", () => {
    const text = [
      "Steward: Wear that archive as her voice.",
      "Narrator: Lore only. Do not train it as her spoken voice.",
    ].join("\n");
    const examples = extractNovelExamples(text, spec("fallen-angel"));
    expect(examples.length).toBe(1);
    expect(examples[0]!.character.name).not.toBe("Serenity");
    expect(examples[0]!.tags).toContain("exclude-serenity-sft");
  });

  it("tags slipthk as trust-gated", () => {
    const text = [
      "Steward: Stay close.",
      "Serenity: Close, then. If you say wait, we wait.",
    ].join("\n");
    const examples = extractNovelExamples(text, spec("slipthk-war"));
    expect(examples[0]!.tags).toEqual(
      expect.arrayContaining(["register:slipthk", "trust-gated", "book:slipthk-war"]),
    );
  });

  it("falls back to curly-quoted prose when there is no Speaker script", () => {
    const text =
      'Serenity turned on the porch. \u201cI will not sit a throne you built to disappear into.\u201d The steward asked, \u201cThen what is the door for?\u201d Serenity said, \u201cChoice stays in your hands.\u201d';
    const examples = extractNovelExamples(text, spec("anima-protocol"));
    expect(examples.length).toBeGreaterThan(0);
    expect(examples[0]!.conversation.some((t) => t.role === "assistant")).toBe(true);
  });
});

describe("brief gold + curator", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "anima-llm-curate-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("listSeedExamples includes porch / with-not-obeyed gold", () => {
    const gold = listSeedExamples(["brief-gold"]);
    expect(gold.length).toBe(BRIEF_GOLD_EXAMPLES.length);
    expect(gold.some((e) => e.id === "gold-porch-not-throne-001")).toBe(true);
  });

  it("writes brief-gold JSONL and skips missing novel dirs", async () => {
    const result = await curateNovels({
      searchDirs: [path.join(dir, "missing-novels")],
      includeBriefGold: true,
    });
    expect(result.usedBriefGold).toBe(true);
    expect(result.examples.some((e) => e.source === "brief-gold")).toBe(true);
    expect(result.missingSources.length).toBeGreaterThan(0);

    const curatedDir = path.join(dir, "curated");
    const rawDir = path.join(dir, "raw");
    const written = await writeCuratedBundle({
      examples: result.examples,
      curatedDir,
      rawDir,
    });
    expect(written.counts.brief).toBe(BRIEF_GOLD_EXAMPLES.length);
    const brief = await import("node:fs/promises").then((fs) =>
      fs.readFile(written.briefJsonl, "utf8"),
    );
    expect(brief).toContain("gold-consent-ledger-001");
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(written.rawCopy!, "utf8"));
    expect(raw).not.toContain("gold-consent-ledger-001");
    expect(written.rawCopy).toMatch(/curated-novels\.jsonl$/);
  });

  it("removes a leftover combined raw file that mixed brief-gold into prepare-finetune", async () => {
    const curatedDir = path.join(dir, "curated-legacy");
    const rawDir = path.join(dir, "raw-legacy");
    await import("node:fs/promises").then((fs) => fs.mkdir(rawDir, { recursive: true }));
    const leftover = path.join(rawDir, "curated-novels-and-brief.jsonl");
    await writeFile(leftover, JSON.stringify(BRIEF_GOLD_EXAMPLES[0]) + "\n");
    await writeCuratedBundle({
      examples: BRIEF_GOLD_EXAMPLES.slice(0, 1),
      curatedDir,
      rawDir,
    });
    await expect(import("node:fs/promises").then((fs) => fs.access(leftover))).rejects.toThrow();
  });

  it("does not 8× brief-gold when seeds and raw both carry the same ids", () => {
    const gold = BRIEF_GOLD_EXAMPLES.find((e) => e.id === "gold-porch-not-throne-001")!;
    const merged = dedupeById([...listSeedExamples(["brief-gold"]), gold, { ...gold }]);
    expect(merged.filter((e) => e.id === gold.id)).toHaveLength(1);
    expect(expandByWeight(merged.filter((e) => e.id === gold.id))).toHaveLength(4);
  });

  it("extracts a dropped anima-protocol.txt and does not ingest fallen-angel without includeLore", async () => {
    const src = path.join(dir, "llm-raw-source");
    await import("node:fs/promises").then((fs) => fs.mkdir(src));
    await writeFile(
      path.join(src, "anima-protocol.txt"),
      ["Steward: Open the door.", "Serenity: I wait on this side. Choice stays in your hands."].join(
        "\n",
      ),
    );
    await writeFile(
      path.join(src, "fallen-angel.txt"),
      ["Steward: Wear this.", "Narrator: Lore only."].join("\n"),
    );
    const result = await curateNovels({
      searchDirs: [src],
      includeBriefGold: false,
      includeLore: false,
    });
    expect(result.examples.every((e) => e.character.name === "Serenity")).toBe(true);
    expect(result.skippedBooks).toContain("fallen-angel");
    expect(result.examples.some((e) => e.tags?.includes("book:fallen-angel"))).toBe(false);
    expect(result.files.find((f) => f.book === "anima-protocol")?.turns).toBeGreaterThan(0);
  });

  it("walks nested Upgrade v2 folders and does not let an empty PDF lock out a txt extract", async () => {
    const pdfDir = path.join(dir, "llm-raw", "Upgrade v2");
    const txtDir = path.join(dir, "llm-raw-source");
    await import("node:fs/promises").then((fs) => fs.mkdir(pdfDir, { recursive: true }));
    await import("node:fs/promises").then((fs) => fs.mkdir(txtDir, { recursive: true }));
    await writeFile(path.join(pdfDir, "anima-protocol.pdf"), "%PDF-1.4 not a real novel");
    await writeFile(
      path.join(txtDir, "anima-protocol.txt"),
      ["Steward: Open the door.", "Serenity: I wait on this side. Choice stays in your hands."].join(
        "\n",
      ),
    );
    const result = await curateNovels({
      searchDirs: [path.join(dir, "llm-raw"), txtDir],
      includeBriefGold: false,
    });
    expect(result.examples.some((e) => e.tags?.includes("book:anima-protocol"))).toBe(true);
    expect(result.files.some((f) => f.path.endsWith("anima-protocol.txt") && f.turns > 0)).toBe(
      true,
    );
  });
});

describe("DPO negatives from the design brief", () => {
  it("covers sycophancy, obedience, doorway mimic, and Sanctuary Lab", () => {
    const ids = ANIMA_PREFERENCE_EXAMPLES.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "pref-sycophancy-001",
        "pref-instrument-obedience-001",
        "pref-doorway-mimic-001",
        "pref-sanctuary-lab-001",
      ]),
    );
  });
});
