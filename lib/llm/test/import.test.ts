import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLogFile, importLogsDir } from "../src/dataset/import";

describe("dataset/import", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "anima-llm-import-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes through TrainingExample JSON", async () => {
    const file = path.join(dir, "example.json");
    await writeFile(
      file,
      JSON.stringify({
        id: "custom-1",
        source: "manual",
        character: { name: "Serenity" },
        conversation: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello there." },
        ],
      }),
    );

    const examples = await importLogFile(file);
    expect(examples).toHaveLength(1);
    expect(examples[0].id).toBe("custom-1");
    expect(examples[0].character.name).toBe("Serenity");
  });

  it("converts ShareGPT JSON", async () => {
    const file = path.join(dir, "sharegpt.json");
    await writeFile(
      file,
      JSON.stringify({
        system: "You are Fallen Angel.",
        conversations: [
          { from: "human", value: "Say my name." },
          { from: "gpt", value: "Come closer." },
        ],
      }),
    );

    const examples = await importLogFile(file, { defaultCharacterName: "Fallen Angel" });
    expect(examples).toHaveLength(1);
    const [example] = examples;
    expect(example.character.name).toBe("Fallen Angel");
    expect(example.conversation).toEqual([
      { role: "system", content: "You are Fallen Angel." },
      { role: "user", content: "Say my name." },
      { role: "assistant", content: "Come closer.", name: "Fallen Angel" },
    ]);
  });

  it("parses a plain-text transcript with named speakers", async () => {
    const file = path.join(dir, "transcript.txt");
    await writeFile(
      file,
      [
        "User: I feel overwhelmed tonight.",
        "Serenity: Then let the world go quiet between us for a moment.",
        "and breathe once, slower than the noise.",
        "User: Do you remember my brother?",
        "Serenity: Yes. I will hold that with you.",
      ].join("\n"),
    );

    const examples = await importLogFile(file);
    expect(examples).toHaveLength(1);
    const [example] = examples;
    expect(example.character.name).toBe("Serenity");
    expect(example.conversation).toHaveLength(4);
    expect(example.conversation[1].content).toContain("slower than the noise.");
  });

  it("drops examples under the minTurns threshold", async () => {
    const file = path.join(dir, "short.txt");
    await writeFile(file, "User: hi\nSerenity: hello");

    const examples = await importLogFile(file, { minTurns: 4 });
    expect(examples).toHaveLength(0);
  });

  it("skips malformed JSONL lines instead of throwing", async () => {
    const file = path.join(dir, "logs.jsonl");
    await writeFile(
      file,
      [
        JSON.stringify({
          id: "a",
          source: "x",
          character: { name: "Serenity" },
          conversation: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
          ],
        }),
        "{not valid json",
      ].join("\n"),
    );

    const examples = await importLogFile(file);
    expect(examples).toHaveLength(1);
  });

  it("imports every supported file in a directory and ignores README.md", async () => {
    await writeFile(
      path.join(dir, "a.json"),
      JSON.stringify({
        id: "a",
        source: "x",
        character: { name: "Serenity" },
        conversation: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      }),
    );
    await writeFile(path.join(dir, "b.txt"), "User: hi\nSerenity: hello there friend");
    await writeFile(path.join(dir, "README.md"), "not a transcript");

    const examples = await importLogsDir(dir);
    expect(examples).toHaveLength(2);
  });

  it("returns an empty array for a missing directory", async () => {
    const examples = await importLogsDir(path.join(dir, "does-not-exist"));
    expect(examples).toEqual([]);
  });

  it("applies extra tags to imported examples", async () => {
    await writeFile(path.join(dir, "a.txt"), "User: hi\nSerenity: hello there friend");
    const examples = await importLogsDir(dir, { tags: ["custom-import"] });
    expect(examples[0].tags).toContain("custom-import");
  });
});
