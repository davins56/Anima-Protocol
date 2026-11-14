import { describe, expect, it } from "vitest";
import {
  collectAddressTerms,
  findAddressedSpeakers,
  isCharacterAddressed,
  pickNextSpeakers,
} from "./pickNextSpeakers";

const ada = { id: "a", name: "Ada" };
const blake = { id: "b", name: "Blake" };
const cass = { id: "c", name: "Cass" };
const cast = [ada, blake, cass];

describe("isCharacterAddressed / findAddressedSpeakers", () => {
  it("matches @mentions and whole-word names", () => {
    expect(isCharacterAddressed("Hey @Blake, what now?", "Blake")).toBe(true);
    expect(isCharacterAddressed("Ada, look at this", "Ada")).toBe(true);
    expect(isCharacterAddressed("nothing to see", "Cass")).toBe(false);
  });

  it("matches a message that starts with the character's name", () => {
    expect(isCharacterAddressed("Blake, are you okay?", blake)).toBe(true);
  });

  it("is case-insensitive and diacritic-tolerant", () => {
    const jose = { id: "j", name: "José" };
    expect(isCharacterAddressed("jose, can you hear me?", jose)).toBe(true);
    expect(isCharacterAddressed("José, a question", { id: "j", name: "Jose" })).toBe(true);
  });

  it("does not trigger on a name inside a longer word", () => {
    expect(isCharacterAddressed("The cassava is ripe today", "Cass")).toBe(false);
    expect(isCharacterAddressed("An adaptation of the plan", "Ada")).toBe(false);
    expect(isCharacterAddressed("blackberries for later", "Blake")).toBe(false);
  });

  it("matches nicknames and aliases", () => {
    const tony = { id: "t", name: "Tony Stark", nickname: "Tony", aliases: ["Iron Man"] };
    expect(isCharacterAddressed("Iron Man, suit up", tony)).toBe(true);
    expect(isCharacterAddressed("Tony, you coming?", tony)).toBe(true);
    expect(findAddressedSpeakers("@iron man stay close", [tony]).map((c) => c.id)).toEqual(["t"]);
  });

  it("returns multiple addressees in the order they were addressed", () => {
    const ordered = findAddressedSpeakers("Cass, then @Ada, then Blake — thoughts?", cast);
    expect(ordered.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
});

describe("pickNextSpeakers", () => {
  it("honors a forced participant id", () => {
    const pick = pickNextSpeakers({
      participants: cast,
      forceCharacterId: "c",
      rng: () => 0.99,
    });
    expect(pick).toMatchObject({ reason: "forced", next: { id: "c" } });
    expect(pick.speakers).toHaveLength(1);
  });

  it("never repeats the last speaker when another option exists", () => {
    const seen = new Set();
    for (let i = 0; i < 8; i += 1) {
      const pick = pickNextSpeakers({
        participants: cast,
        lastSpeakerId: "b",
        rng: () => (i / 8) * 0.999,
      });
      expect(pick.reason).toBe("random");
      expect(pick.next.id).not.toBe("b");
      seen.add(pick.next.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("allows a repeat in a single-member group", () => {
    const pick = pickNextSpeakers({
      participants: [ada],
      lastSpeakerId: "a",
      latestMessage: "keep going",
      rng: () => 0.5,
    });
    expect(pick).toMatchObject({ reason: "random", next: { id: "a" } });
  });

  it("picks a single addressed character", () => {
    const pick = pickNextSpeakers({
      participants: cast,
      lastSpeakerId: "a",
      latestMessage: "Blake, cover me",
      rng: () => 0.99,
    });
    expect(pick.reason).toBe("addressed");
    expect(pick.next.id).toBe("b");
    expect(pick.speakers.map((c) => c.id)).toEqual(["b"]);
  });

  it("queues multiple addresses in order, then returns to random", () => {
    const userTurn = { role: "user", content: "Ada, Blake, then Cass — go." };
    const first = pickNextSpeakers({
      participants: cast,
      latestMessage: userTurn.content,
      rng: () => 0,
    });
    expect(first.reason).toBe("addressed");
    expect(first.speakers.map((c) => c.id)).toEqual(["a", "b", "c"]);

    const second = pickNextSpeakers({
      participants: cast,
      recentMessages: [
        userTurn,
        { role: "assistant", character_id: "a", character_name: "Ada", content: "I'm in." },
      ],
      rng: () => 0,
    });
    expect(second.speakers.map((c) => c.id)).toEqual(["b", "c"]);

    const third = pickNextSpeakers({
      participants: cast,
      recentMessages: [
        userTurn,
        { role: "assistant", character_id: "a", character_name: "Ada", content: "I'm in." },
        { role: "assistant", character_id: "b", character_name: "Blake", content: "Ready." },
      ],
      rng: () => 0,
    });
    expect(third.speakers.map((c) => c.id)).toEqual(["c"]);

    const after = pickNextSpeakers({
      participants: cast,
      recentMessages: [
        userTurn,
        { role: "assistant", character_id: "a", character_name: "Ada", content: "I'm in." },
        { role: "assistant", character_id: "b", character_name: "Blake", content: "Ready." },
        { role: "assistant", character_id: "c", character_name: "Cass", content: "Done." },
      ],
      rng: () => 0,
    });
    expect(after.reason).toBe("random");
    expect(after.next.id).not.toBe("c");
  });

  it("honors @mentions", () => {
    const pick = pickNextSpeakers({
      participants: cast,
      latestMessage: "What do you think, @Cass?",
      rng: () => 0.99,
    });
    expect(pick).toMatchObject({ reason: "addressed", next: { id: "c" } });
  });

  it("honors a nickname or alias", () => {
    const tony = { id: "t", name: "Tony Stark", nickname: "Shellhead", aliases: ["Iron Man"] };
    const pick = pickNextSpeakers({
      participants: [...cast, tony],
      latestMessage: "Shellhead, you're up",
      rng: () => 0.99,
    });
    expect(pick).toMatchObject({ reason: "addressed", next: { id: "t" } });
  });

  it("lets one character address another", () => {
    const pick = pickNextSpeakers({
      participants: cast,
      recentMessages: [
        { role: "user", content: "Keep talking." },
        {
          role: "assistant",
          character_id: "a",
          character_name: "Ada",
          content: "Blake, can you take this?",
        },
      ],
      rng: () => 0.99,
    });
    expect(pick).toMatchObject({ reason: "addressed", next: { id: "b" } });
  });

  it("does not treat a name hidden inside another word as an address", () => {
    const pick = pickNextSpeakers({
      participants: cast,
      lastSpeakerId: "a",
      latestMessage: "The cassava and the adaptation are ready.",
      rng: () => 0,
    });
    expect(pick.reason).toBe("random");
    expect(pick.next.id).not.toBe("a");
  });

  it("returns fallback when the group is empty", () => {
    expect(pickNextSpeakers({ participants: [] }).reason).toBe("fallback");
  });

  it("lets a new unaddressed user message cancel a leftover address queue", () => {
    const pick = pickNextSpeakers({
      participants: cast,
      recentMessages: [
        { role: "user", content: "Ada, Blake, go." },
        { role: "assistant", character_id: "a", character_name: "Ada", content: "Here." },
        { role: "user", content: "Anyway, how's the weather?" },
      ],
      rng: () => 0,
    });
    expect(pick.reason).toBe("random");
  });
});

describe("collectAddressTerms", () => {
  it("includes the first name of a multi-word official name", () => {
    expect(collectAddressTerms({ id: "t", name: "Tony Stark" })).toEqual(
      expect.arrayContaining(["Tony Stark", "Tony"]),
    );
  });
});
