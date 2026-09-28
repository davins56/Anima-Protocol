import { describe, expect, it } from "vitest";
import {
  AVOID_REPEAT_INSTRUCTION,
  capRecentMessagesForLlm,
  composeCompanionChatMessages,
  isRepeatedReply,
  messagesForLocalOllama,
  messagesForRepeatRetry,
  recentAssistantReplies,
  visiblePrefixRepeatsHistory,
  LOCAL_REPEAT_DETECT_CHARS,
} from "../src/lib/promptBuilder";

const GREETING = "Hello! I'm so glad you're here. How are you feeling today?";

const loopedHistory = [
  { id: "t1:user", role: "user", content: "hi there" },
  { id: "t1:assistant", role: "assistant", content: GREETING },
  { id: "t2:user", role: "user", content: "what's your favorite color" },
  { id: "t2:assistant", role: "assistant", content: `**Nova:** ${GREETING}` },
];

describe("isRepeatedReply", () => {
  it("matches the same reply across speaker labels, case, and punctuation", () => {
    expect(isRepeatedReply(`**Nova:** ${GREETING.toUpperCase()}`, [GREETING])).toBe(true);
    expect(isRepeatedReply(`${GREETING}!!`, ["x", GREETING])).toBe(true);
  });

  it("detects a copy in the first streamed characters", () => {
    const prior = "The room stays quiet while she watches the door and does not answer yet.";
    const opening = prior.slice(0, LOCAL_REPEAT_DETECT_CHARS + 8);
    expect(opening.length).toBeGreaterThanOrEqual(LOCAL_REPEAT_DETECT_CHARS);
    expect(visiblePrefixRepeatsHistory(opening, [prior])).toBe(true);
    expect(visiblePrefixRepeatsHistory(prior.slice(0, 12), [prior])).toBe(false);
    expect(
      visiblePrefixRepeatsHistory(
        "Blue, like the sky over the harbor, and nothing like that greeting.",
        [prior],
      ),
    ).toBe(false);
  });

  it("does not flag a longer reply that only starts with a short earlier beat", () => {
    const prior = "She nods once.";
    expect(prior.length).toBeGreaterThanOrEqual(12);
    expect(prior.length).toBeLessThan(LOCAL_REPEAT_DETECT_CHARS);
    const reply =
      "She nods once. The harbor bell is late, and she keeps the watch from the gate.";
    expect(reply.startsWith(prior)).toBe(true);
    expect(visiblePrefixRepeatsHistory(reply, [prior])).toBe(false);
  });

  it("does not match a different reply or a short one", () => {
    expect(isRepeatedReply("Blue, like the sky over the harbor.", [GREETING])).toBe(false);
    expect(isRepeatedReply("Okay.", ["Okay."])).toBe(false);
    expect(isRepeatedReply(`${GREETING} Also, tell me about your week and what made you smile.`, [GREETING])).toBe(false);
  });
});

describe("repeated assistant replies in history", () => {
  it("drops every copy of a reply that repeats in the window and keeps user turns", () => {
    const history = capRecentMessagesForLlm(loopedHistory as never);
    expect(history).toEqual([
      { role: "user", content: "hi there" },
      { role: "user", content: "what's your favorite color" },
    ]);
  });

  it("keeps distinct replies", () => {
    const history = capRecentMessagesForLlm([
      { role: "user", content: "hi" },
      { role: "assistant", content: GREETING },
      { role: "user", content: "color?" },
      { role: "assistant", content: "Blue, like the sky over the harbor." },
    ] as never);
    expect(history.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("does not replay the looped reply to the model", () => {
    const messages = composeCompanionChatMessages({
      characters: [{ id: "c1", name: "Nova" }],
      activeCharacter: { id: "c1", name: "Nova" },
      memories: [],
      recentMessages: loopedHistory,
      mode: "solo",
      content: "tell me a joke",
    } as never);
    expect(messages.some((m) => m.role === "assistant")).toBe(false);
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "tell me a joke" });
  });
});

describe("repeat regenerate", () => {
  it("lists the latest assistant replies", () => {
    expect(recentAssistantReplies(loopedHistory as never, 1)).toEqual([`**Nova:** ${GREETING}`]);
  });

  it("removes the repeated reply and puts the avoid-repeat line before the user turn", () => {
    const retry = messagesForRepeatRetry(
      [
        { role: "system", content: "persona" },
        { role: "user", content: "hi" },
        { role: "assistant", content: GREETING },
        { role: "user", content: "color?" },
        { role: "assistant", content: "Blue." },
        { role: "system", content: "answer last" },
        { role: "user", content: "tell me a joke" },
      ],
      GREETING,
    );
    expect(retry).toEqual([
      { role: "system", content: "persona" },
      { role: "user", content: "hi" },
      { role: "user", content: "color?" },
      { role: "assistant", content: "Blue." },
      { role: "system", content: "answer last" },
      { role: "system", content: AVOID_REPEAT_INSTRUCTION },
      { role: "user", content: "tell me a joke" },
    ]);
  });

  it("keeps the user line last when the local path folds the avoid-repeat line", () => {
    const userLine = "tell me a joke";
    const messages = composeCompanionChatMessages({
      characters: [{ id: "c1", name: "Nova" }],
      activeCharacter: { id: "c1", name: "Nova" },
      memories: [],
      recentMessages: loopedHistory,
      mode: "solo",
      content: userLine,
      userDisplayName: "Mara",
    } as never);
    const retry = messagesForRepeatRetry(messages, GREETING);
    expect(retry.at(-1)).toEqual({ role: "user", content: userLine });

    const local = messagesForLocalOllama(retry);
    const last = local.at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content.endsWith(userLine)).toBe(true);
    expect(last?.content).toContain(`[${AVOID_REPEAT_INSTRUCTION}]`);
    expect(last?.content.indexOf("Answer Mara's last message first")).toBeLessThan(
      last?.content.indexOf(AVOID_REPEAT_INSTRUCTION) ?? -1,
    );
    expect(last?.content.indexOf(AVOID_REPEAT_INSTRUCTION)).toBeLessThan(
      last?.content.lastIndexOf(userLine) ?? -1,
    );
    expect(local.map((message) => message.content).join("\n").split(userLine).length - 1).toBe(1);
    expect(local.slice(0, -1).some((message) => message.content.includes(userLine))).toBe(false);
  });
});
