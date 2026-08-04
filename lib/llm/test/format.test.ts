import { describe, expect, it } from "vitest";
import {
  buildSystemMessage,
  listSeedExamples,
  toAlpaca,
  toJsonl,
  toMessages,
  toPreferencePair,
  toShareGpt,
} from "../src/dataset";

describe("dataset formatters", () => {
  const example = listSeedExamples(["serenity"])[0]!;

  it("builds a system message with memory and voice", () => {
    const system = buildSystemMessage(example);
    expect(system).toContain("Serenity");
    expect(system).toMatch(/memory|Memory/i);
  });

  it("emits ShareGPT conversations", () => {
    const sg = toShareGpt(example);
    expect(sg.conversations[0]?.from).toBe("system");
    expect(sg.conversations.some((c) => c.from === "human")).toBe(true);
    expect(sg.conversations.some((c) => c.from === "gpt")).toBe(true);
  });

  it("emits ChatML messages with leading system", () => {
    const cm = toMessages(example);
    expect(cm.messages[0]?.role).toBe("system");
    expect(cm.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("emits Alpaca with last assistant as output", () => {
    const alpaca = toAlpaca(example);
    expect(alpaca.output.length).toBeGreaterThan(20);
    expect(alpaca.system).toContain("Serenity");
  });

  it("serializes JSONL", () => {
    const jsonl = toJsonl([example], "sharegpt");
    const lines = jsonl.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).conversations).toBeTruthy();
  });

  it("builds preference pairs for DPO/ORPO", () => {
    const pair = toPreferencePair(example, "chosen reply", "rejected reply");
    expect(pair.chosen).toBe("chosen reply");
    expect(pair.rejected).toBe("rejected reply");
    expect(pair.system).toContain("Serenity");
  });
});
