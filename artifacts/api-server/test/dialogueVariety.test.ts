import { describe, expect, it } from "vitest";
import { dialogueTurnNote, DIALOGUE_PATTERN_NOTE } from "../src/lib/dialogueVariety";
import { companionStaticPrefix, composeCompanionChatMessages, composePrompt, messagesForLocalOllama, type PromptBuilderParams } from "../src/lib/promptBuilder";

const speaker = { id: "serenity", name: "Serenity" };
const asks = [
  { role: "assistant", content: "I like the sea. What do you think?", character_id: "serenity" },
  { role: "user", content: "It's calm." },
  { role: "assistant", content: "It is. Tell me more.", character_id: "serenity" },
];

describe("dialogue ending variety", () => {
  it("nudges repeated questions or invitations without copying history into instructions", () => {
    expect(dialogueTurnNote({ messages: asks, speaker, group: false, careOrTherapy: false })).toBe(DIALOGUE_PATTERN_NOTE);
    expect(DIALOGUE_PATTERN_NOTE).toContain("needed clarification or safety");
    expect(DIALOGUE_PATTERN_NOTE).not.toContain(asks[0].content);
  });

  it("does not react to a single question or a varied sequence", () => {
    for (const messages of [[], asks.slice(0, 1), [...asks, { role: "assistant", content: "The tide is turning.", character_id: "serenity" }]]) {
      expect(dialogueTurnNote({ messages, speaker, group: false, careOrTherapy: false })).toBe("");
    }
  });

  it("recognizes questions with formatting, quotes, and non-Latin question marks", () => {
    const messages = ["**Really?**", "How so？", "كيف؟"].map((content) => ({ role: "assistant", content }));
    expect(dialogueTurnNote({ messages, speaker, group: false, careOrTherapy: false })).toBe(DIALOGUE_PATTERN_NOTE);
  });

  it("uses only the active speaker's history in group chats", () => {
    expect(dialogueTurnNote({ messages: asks, speaker: { id: "scarlet", name: "Scarlet" }, group: true, careOrTherapy: false })).toBe("");
    expect(dialogueTurnNote({ messages: asks, group: true, careOrTherapy: false })).toBe("");
    expect(dialogueTurnNote({ messages: asks, speaker, group: true, careOrTherapy: false })).toBe(DIALOGUE_PATTERN_NOTE);
    const sameNameOtherId = asks.map((m) => ({ ...m, character_name: "Serenity", character_id: "other" }));
    expect(dialogueTurnNote({ messages: sameNameOtherId, speaker, group: true, careOrTherapy: false })).toBe("");
  });

  it("supports older name-only history, but ignores unattributed group replies", () => {
    const messages = ["What next?", "Tell me more."].map((content) => ({ role: "assistant", content, characterName: "SERENITY" }));
    expect(dialogueTurnNote({ messages, speaker, group: true, careOrTherapy: false })).toBe(DIALOGUE_PATTERN_NOTE);
    expect(dialogueTurnNote({ messages: messages.map(({ content, role }) => ({ content, role })), speaker, group: true, careOrTherapy: false })).toBe("");
  });

  it("leaves care and therapy questions to their own safety contract", () => {
    expect(dialogueTurnNote({ messages: asks, speaker, group: false, careOrTherapy: true })).toBe("");
  });
});

const custom = { id: "custom", name: "Mara", speaking_style: "Scots idioms, dry humour, contractions; plain when serious." };
const base: PromptBuilderParams = { characters: [speaker], activeCharacter: speaker, memories: [], recentMessages: asks, mode: "solo", content: "The tide is peaceful." };
const renderers = {
  legacy: (p: PromptBuilderParams) => composePrompt(p),
  local: (p: PromptBuilderParams) => composeCompanionChatMessages(p).map((m) => m.content).join("\n"),
  hosted: (p: PromptBuilderParams) => composeCompanionChatMessages({ ...p, mind: { promptTokens: 12000, historyExchanges: 16, minHistoryExchanges: 4, historyMessageChars: 1600, memoryTopK: 8 } }).map((m) => m.content).join("\n"),
};

describe("all companion prompt paths", () => {
  for (const [path, render] of Object.entries(renderers)) {
    it(`${path}: allows complete replies and character dialect for built-in and custom companions`, () => {
      for (const character of [speaker, custom]) {
        const prompt = render({ ...base, characters: [character], activeCharacter: character });
        expect(prompt).toContain("No stock questions or invitations");
        expect(prompt).toContain("this character's dialect and idioms");
        expect(prompt).toContain("Never speak or act for the user");
        if (character === custom) expect(prompt).toContain(custom.speaking_style);
      }
    });

    it(`${path}: detects repeated endings but stays out of care/therapy turns`, () => {
      expect(render(base)).toContain(DIALOGUE_PATTERN_NOTE);
      expect(render({ ...base, companionCrisis: true })).not.toContain(DIALOGUE_PATTERN_NOTE);
      expect(render({ ...base, mode: "therapy" })).not.toContain(DIALOGUE_PATTERN_NOTE);
      const other = { id: "scarlet", name: "Scarlet" };
      expect(render({ ...base, characters: [speaker, other], activeCharacter: other, mode: "group" })).not.toContain(DIALOGUE_PATTERN_NOTE);
    });
  }

  it("keeps the reminder out of the cached local prefix and folds it into the current turn", () => {
    const messages = composeCompanionChatMessages(base);
    expect(messages.at(-3)?.content).toBe(DIALOGUE_PATTERN_NOTE);
    const folded = messagesForLocalOllama(messages);
    expect(folded.filter((m) => m.role === "system")).toHaveLength(1);
    expect(folded[0].content).not.toContain(DIALOGUE_PATTERN_NOTE);
    expect(folded.at(-1)?.content).toContain(DIALOGUE_PATTERN_NOTE);
    expect(folded.at(-1)?.content.endsWith(base.content)).toBe(true);
    expect(companionStaticPrefix(base)).toBe(companionStaticPrefix({ ...base, recentMessages: [] }));
  });
});
