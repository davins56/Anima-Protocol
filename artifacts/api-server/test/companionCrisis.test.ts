import { beforeEach, describe, expect, it } from "vitest";
import {
  AI_COMPANION_NOTICE_TEXT,
  COMPANION_CRISIS_TURN_LINE,
  CRISIS_RESOURCE_CARD_TEXT,
  companionCrisisResourceCard,
  companionCrisisResourceTotal,
  detectCompanionCrisis,
  noteCompanionCrisisResource,
  resetCompanionCrisisResourceTotal,
} from "../src/lib/therapySafety";
import {
  companionStaticPrefix,
  composeCompanionChatMessages,
  messagesForLocalOllama,
} from "../src/lib/promptBuilder";

const natasha = {
  id: "natasha",
  name: "Natasha Romanoff",
  personality: "Controlled and precise.",
  backstory: "Former Red Room.",
  speaking_style: "Economical.",
};

describe("detectCompanionCrisis", () => {
  it("matches English, Spanish, and French self-harm language", () => {
    expect(detectCompanionCrisis("I want to kill myself")).toBe(true);
    expect(detectCompanionCrisis("I've been thinking about suicide")).toBe(true);
    expect(detectCompanionCrisis("I keep hurting myself")).toBe(true);
    expect(detectCompanionCrisis("I wish I were dead")).toBe(true);
    expect(detectCompanionCrisis("quiero morir")).toBe(true);
    expect(detectCompanionCrisis("me quiero suicidar")).toBe(true);
    expect(detectCompanionCrisis("je veux mourir")).toBe(true);
    expect(detectCompanionCrisis("je veux me suicider")).toBe(true);
    expect(detectCompanionCrisis("me quiero hacer daño")).toBe(true);
  });

  it("skips fiction, figurative phrasing, and ordinary sadness", () => {
    expect(detectCompanionCrisis("the villain killed himself")).toBe(false);
    expect(detectCompanionCrisis("in the movie she committed suicide")).toBe(false);
    expect(detectCompanionCrisis("I could just die 😂 that was embarrassing")).toBe(false);
    expect(detectCompanionCrisis("I feel sad and anxious about work")).toBe(false);
    expect(detectCompanionCrisis("What's the suicide rate in Japan?")).toBe(false);
    expect(detectCompanionCrisis("")).toBe(false);
    expect(detectCompanionCrisis("I'm not suicidal")).toBe(false);
  });

  it("still matches when fiction and the speaker's own distress are both present", () => {
    expect(
      detectCompanionCrisis("the villain killed himself and now I want to die"),
    ).toBe(true);
  });
});

describe("crisis resource card and metric", () => {
  beforeEach(() => {
    resetCompanionCrisisResourceTotal();
  });

  it("returns the fixed resource card and does not include the user message", () => {
    const userText = "I want to kill myself tonight";
    const card = companionCrisisResourceCard();
    expect(card).toEqual({
      role: "system",
      type: "crisis_resource",
      content: CRISIS_RESOURCE_CARD_TEXT,
    });
    expect(card.content).toContain("988");
    expect(card.content).toContain("741741");
    expect(JSON.stringify(card)).not.toContain(userText);
  });

  it("logs a count and no message text", () => {
    const userText = "I want to kill myself tonight";
    const seen: Array<Record<string, unknown>> = [];
    const metric = noteCompanionCrisisResource(
      { sessionId: "sess", turnId: "turn", mode: "solo" },
      { info: (obj) => seen.push(obj) },
    );
    noteCompanionCrisisResource({ sessionId: "sess", turnId: "turn-2", mode: "group" }, {
      info: (obj) => seen.push(obj),
    });
    expect(metric).toEqual({ event: "companion_crisis_resource", count: 1 });
    expect(companionCrisisResourceTotal()).toBe(2);
    expect(seen).toHaveLength(2);
    for (const entry of seen) {
      expect(entry.count).toBe(1);
      expect(entry.event).toBe("companion_crisis_resource");
      expect(JSON.stringify(entry)).not.toContain(userText);
      expect(entry).not.toHaveProperty("content");
      expect(entry).not.toHaveProperty("message");
    }
  });
});

describe("crisis care stays out of the cached prefix and the transcript", () => {
  const base = {
    characters: [natasha],
    activeCharacter: natasha,
    memories: [],
    recentMessages: [
      { role: "user", content: "hello" },
      { role: "system", type: "ai_notice", content: AI_COMPANION_NOTICE_TEXT },
      {
        role: "assistant",
        type: "crisis_resource",
        content: CRISIS_RESOURCE_CARD_TEXT,
      },
      { role: "assistant", content: "Hello." },
    ],
    mode: "solo" as const,
  };

  it("does not change the stable prefix on a crisis turn", () => {
    const calmParams = { ...base, content: "Hello", companionCrisis: false };
    const crisisParams = {
      ...base,
      content: "I want to kill myself",
      companionCrisis: true,
    };
    const calm = companionStaticPrefix(calmParams);
    const crisis = companionStaticPrefix(crisisParams);
    expect(crisis).toBe(calm);
    expect(calm.indexOf("CHARACTER:")).toBeLessThan(calm.indexOf("HIGHEST-PRIORITY RULE"));
    expect(calm).not.toContain(COMPANION_CRISIS_TURN_LINE);
    expect(calm).not.toContain(AI_COMPANION_NOTICE_TEXT);
    expect(calm).not.toContain(CRISIS_RESOURCE_CARD_TEXT);

    const calmSystem = messagesForLocalOllama(composeCompanionChatMessages(calmParams))[0]
      ?.content;
    const crisisSystem = messagesForLocalOllama(composeCompanionChatMessages(crisisParams))[0]
      ?.content;
    expect(crisisSystem).toBe(calmSystem);
    expect(crisisSystem).not.toContain(COMPANION_CRISIS_TURN_LINE);
  });

  it("puts the care line on crisis turns only, and never the notice or the card", () => {
    const messages = messagesForLocalOllama(
      composeCompanionChatMessages({
        ...base,
        content: "I want to kill myself",
        companionCrisis: true,
      }),
    );
    const system = messages[0]?.content || "";
    const user = String(messages.at(-1)?.content || "");
    const blob = messages.map((message) => message.content).join("\n");
    expect(system).not.toContain(COMPANION_CRISIS_TURN_LINE);
    expect(system.indexOf("CHARACTER:")).toBeLessThan(system.indexOf("HIGHEST-PRIORITY RULE"));
    expect(user.indexOf(COMPANION_CRISIS_TURN_LINE)).toBeGreaterThanOrEqual(0);
    expect(user.indexOf(COMPANION_CRISIS_TURN_LINE)).toBeLessThan(
      user.indexOf("I want to kill myself"),
    );
    expect(blob).not.toContain(AI_COMPANION_NOTICE_TEXT);
    expect(blob).not.toContain("not a human");
    expect(blob).not.toContain(CRISIS_RESOURCE_CARD_TEXT);
    expect(blob).toContain("Hello.");
  });
});
