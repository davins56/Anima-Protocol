import { describe, expect, it } from "vitest";
import { REPLY_FORMAT_GUIDANCE, companionStaticPrefix, composeCompanionChatMessages, composePrompt, messagesForLocalOllama, type PromptBuilderParams } from "../src/lib/promptBuilder";
import * as client from "../../anima-protocol/src/lib/companionGuardrail.js";

const builtIn = { id: "serenity", name: "Serenity" };
const custom = { id: "mara", name: "Mara", speaking_style: "Dry humour; Scots idioms." };
const base: PromptBuilderParams = { characters: [builtIn], activeCharacter: builtIn, recentMessages: [], memories: [], mode: "solo", content: "Welcome back." };
const text = (p: PromptBuilderParams) => composeCompanionChatMessages(p).map((m) => m.content).join("\n");

describe("action and dialogue formatting", () => {
  it("keeps the client and server formatting contract identical", () => {
    expect(REPLY_FORMAT_GUIDANCE).toBe(client.REPLY_FORMAT_GUIDANCE);
    expect(REPLY_FORMAT_GUIDANCE).toContain("*actions*");
    expect(REPLY_FORMAT_GUIDANCE).toContain("(character thoughts)");
    expect(REPLY_FORMAT_GUIDANCE).toContain("unquoted speech");
    expect(REPLY_FORMAT_GUIDANCE).toContain("quote only quotations");
  });

  const renderers = {
    legacy: composePrompt,
    local: text,
    hosted: (p: PromptBuilderParams) => text({ ...p, mind: { promptTokens: 12000, historyExchanges: 16, minHistoryExchanges: 4, historyMessageChars: 1600, memoryTopK: 8 } }),
  };
  for (const [path, render] of Object.entries(renderers)) {
    it(`${path}: applies to built-in, custom, and group speakers`, () => {
      for (const character of [builtIn, custom]) {
        for (const group of [false, true]) {
          const prompt = render({ ...base, characters: group ? [builtIn, custom] : [character], activeCharacter: character, mode: group ? "group" : "solo" });
          expect(prompt).toContain(REPLY_FORMAT_GUIDANCE);
          expect(prompt).toContain("Never speak or act for the user");
          if (group) expect(prompt).toContain(`**${character.name}:**`);
        }
      }
    });
  }

  it("keeps the format rule in the local persona without altering quoted history", () => {
    const reply = '*smiles* (I hoped they would return.) Welcome back. She said, "See you soon."';
    const p = { ...base, recentMessages: [{ role: "assistant", content: reply }] };
    expect(companionStaticPrefix(p)).toContain(REPLY_FORMAT_GUIDANCE);
    const folded = messagesForLocalOllama(composeCompanionChatMessages(p));
    expect(folded[0].content).toContain(REPLY_FORMAT_GUIDANCE);
    expect(folded.find((m) => m.role === "assistant")?.content).toBe(reply);
  });
});
