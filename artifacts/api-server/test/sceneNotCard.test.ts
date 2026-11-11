import { describe, expect, it } from "vitest";
import {
  composeCompanionChatMessages,
  messagesForLocalOllama,
} from "../src/lib/promptBuilder";

/**
 * iPhone chat, Oct 12 2026: a long scene, then Natasha answered by reciting
 * her card ("I am Natasha Romanoff, a former KGB assassin…"). The 0.5B model
 * was reading the identity lock and the backstory label as a script.
 */
const natasha = {
  id: "natasha",
  name: "Natasha Romanoff",
  universe: "Marvel Cinematic Universe",
  personality:
    "Controlled, observant, and fiercely pragmatic. Her loyalty, once given, is absolute.",
  backstory:
    "Former KGB assassin and Black Widow trained in the Red Room, defected to S.H.I.E.L.D. after Clint Barton gave her a choice. Spent years building a chosen family out of the Avengers. After the Blip she held the remaining team together for five years. Gave her life at Vormir so Clint could return to his family.",
  speaking_style: "Economical. Almost never talks about herself unprompted.",
};

const userLine =
  "We are happily married and I, using my metaphysical abilities, built us a home befitting royalty";

describe("scene over character card", () => {
  it("keeps the latest scene last and does not hand the card over as a speech", () => {
    const prior = Array.from({ length: 22 }, (_, exchange) => [
      {
        role: "user",
        content: `SCENE_USER_${exchange} the house we built`,
        seq: exchange * 2,
      },
      {
        role: "assistant",
        content: `SCENE_ASSISTANT_${exchange} she stayed in the room with him`,
        seq: exchange * 2 + 1,
        character_name: "Natasha Romanoff",
      },
    ]).flat();
    // The chat route loads the last 24 stored rows, oldest first.
    const recentMessages = prior.slice(-24);

    const local = messagesForLocalOllama(
      composeCompanionChatMessages({
        characters: [natasha],
        activeCharacter: natasha,
        memories: [],
        recentMessages,
        mode: "solo",
        content: userLine,
        userDisplayName: "Davin",
      }),
    );

    const system = String(local[0]?.content || "");
    const last = local.at(-1);
    const packed = local.map((message) => message.content).join("\n");
    const cardAt = packed.indexOf("Red Room");
    const sceneAt = packed.indexOf("SCENE_USER_21");
    const askAt = packed.lastIndexOf(userLine);

    expect(local[0]?.role).toBe("system");
    expect(last?.role).toBe("user");
    expect(String(last?.content).endsWith(userLine)).toBe(true);
    expect(packed.split(userLine).length - 1).toBe(1);

    expect(sceneAt).toBeGreaterThan(cardAt);
    expect(askAt).toBeGreaterThan(sceneAt);
    expect(packed.indexOf("SCENE_USER_21")).toBeGreaterThanOrEqual(0);
    expect(packed).toContain("SCENE_ASSISTANT_21");
    expect(packed).not.toContain("SCENE_USER_10");

    expect(system).toContain("Red Room");
    expect(system).toContain("Private past (do not recite):");
    expect(system).toContain("Speak in first person as Natasha Romanoff.");
    expect(system).toContain("Do not introduce yourself or recite this card unless they ask.");
    expect(system).not.toContain("I am Natasha Romanoff.");
    expect(system).not.toContain("My own past:");
    expect(system).not.toMatch(/You are Natasha/i);

    const afterSystem = local.slice(1).map((message) => message.content).join("\n");
    expect(afterSystem).not.toContain("Red Room");
    expect(afterSystem).not.toContain("Private past (do not recite):");
    expect(String(last?.content)).toContain(
      "Continue that scene in your own first person. Do not introduce yourself or retell your past unless they asked.",
    );
    expect(String(last?.content).indexOf("Continue that scene")).toBeLessThan(
      String(last?.content).lastIndexOf(userLine),
    );
  });
});
