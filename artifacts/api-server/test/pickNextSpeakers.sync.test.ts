import { describe, expect, it } from "vitest";
import * as server from "../src/lib/pickNextSpeakers";
import * as client from "../../anima-protocol/src/lib/pickNextSpeakers.js";

const tony = { id: "t", name: "Tony Stark", nickname: "Shellhead", aliases: ["Iron Man"] };
const cast = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Blake" },
  { id: "c", name: "Cass" },
  tony,
];

const cases: { label: string; params: Record<string, unknown> }[] = [
  { label: "forced", params: { participants: cast, forceCharacterId: "c", rng: () => 0.99 } },
  { label: "no-repeat", params: { participants: cast, lastSpeakerId: "b", rng: () => 0.2 } },
  { label: "single member", params: { participants: [cast[0]], lastSpeakerId: "a", rng: () => 0.5 } },
  { label: "single address", params: { participants: cast, latestMessage: "Blake, cover me", rng: () => 0.99 } },
  {
    label: "multi address leftover",
    params: {
      participants: cast,
      recentMessages: [
        { role: "user", content: "Ada, Blake, then Cass — go." },
        { role: "assistant", character_id: "a", character_name: "Ada", content: "I'm in." },
      ],
      rng: () => 0,
    },
  },
  { label: "mention", params: { participants: cast, latestMessage: "Hey @Cass", rng: () => 0 } },
  { label: "nickname", params: { participants: cast, latestMessage: "Shellhead, you're up", rng: () => 0 } },
  {
    label: "character-to-character",
    params: {
      participants: cast,
      recentMessages: [
        { role: "assistant", character_id: "a", character_name: "Ada", content: "Blake, can you take this?" },
      ],
      rng: () => 0.99,
    },
  },
  {
    label: "false positive",
    params: {
      participants: cast,
      lastSpeakerId: "a",
      latestMessage: "The cassava and the adaptation are ready.",
      rng: () => 0,
    },
  },
];

describe("pickNextSpeakers client/server sync", () => {
  it("agrees on address detection fixtures", () => {
    const messages = [
      "Hey @Blake, what now?",
      "jose, can you hear me?",
      "The cassava is ripe today",
      "Iron Man, suit up",
      "Cass, then @Ada, then Blake — thoughts?",
    ];
    for (const message of messages) {
      expect(client.findAddressedSpeakers(message, cast).map((c) => c.id)).toEqual(
        server.findAddressedSpeakers(message, cast).map((c) => c.id),
      );
    }
  });

  it("agrees on pick results", () => {
    for (const fixture of cases) {
      const fromClient = client.pickNextSpeakers(fixture.params);
      const fromServer = server.pickNextSpeakers(fixture.params);
      expect({ label: fixture.label, ...fromClient, speakers: fromClient.speakers.map((c) => c.id), next: fromClient.next?.id }).toEqual(
        { label: fixture.label, ...fromServer, speakers: fromServer.speakers.map((c) => c.id), next: fromServer.next?.id },
      );
    }
  });
});
