import { afterEach, describe, expect, it } from "vitest";
import { buildCompanionPrompt, leanGroupPromptEnabled } from "../src/lib/promptBuilder";

const aeland = { id: "c1", name: "Aeland", universe: "Anima", personality: "Steady and curious." };
const scarlet = { id: "c2", name: "Scarlet", universe: "Ember", personality: "Fierce and warm." };
const FAT = "GROUP SCENE FROM CLIENT: You are everyone. Full character sheets follow... CLIENT_ONLY_MARKER";

function build(mode: "group" | "solo") {
  return buildCompanionPrompt({
    systemPrompt: FAT,
    characters: [aeland, scarlet],
    activeCharacter: aeland,
    memories: [],
    recentMessages: [],
    mode,
    content: "Hi both.",
    isCrossover: true,
  } as any);
}

afterEach(() => {
  delete process.env.ANIMA_LEAN_GROUP_PROMPT;
});

describe("lean per-character group prompt (ANIMA_LEAN_GROUP_PROMPT)", () => {
  it("is off by default and keeps the client scene", () => {
    expect(leanGroupPromptEnabled()).toBe(false);
    expect(build("group")).toContain("CLIENT_ONLY_MARKER");
  });

  it("when on, drops the client's group text but keeps the server's speaker lock", () => {
    process.env.ANIMA_LEAN_GROUP_PROMPT = "1";
    const off = (() => {
      delete process.env.ANIMA_LEAN_GROUP_PROMPT;
      return build("group");
    })();
    process.env.ANIMA_LEAN_GROUP_PROMPT = "1";
    const lean = build("group");
    expect(lean).not.toContain("CLIENT_ONLY_MARKER");
    expect(lean).toContain("I speak only as Aeland");
    expect(lean).toContain("Scarlet");
    expect(lean.length).toBeLessThan(off.length);
  });

  it("never affects solo turns", () => {
    process.env.ANIMA_LEAN_GROUP_PROMPT = "1";
    expect(build("solo")).toContain("CLIENT_ONLY_MARKER");
  });
});
