import { describe, expect, it } from "vitest";
import {
  classifyProtocolUpgrade,
  isTalkingToSerenity,
} from "./protocolUpgrade";

describe("classifyProtocolUpgrade", () => {
  it("detects interface and system weaves", () => {
    expect(classifyProtocolUpgrade("Upgrade the interface to use a quieter header.").scope).toBe(
      "interface",
    );
    expect(
      classifyProtocolUpgrade("Upgrade the system as a whole to speed up memory retrieval.").scope,
    ).toBe("system");
    expect(classifyProtocolUpgrade("Upgrade the interface.").shouldLaunch).toBe(true);
  });

  it("does not hijack billing or ordinary chat", () => {
    expect(classifyProtocolUpgrade("upgrade my premium plan").isUpgrade).toBe(false);
    expect(classifyProtocolUpgrade("I missed you tonight.").isUpgrade).toBe(false);
  });

  it("recognizes a Serenity session and an address", () => {
    expect(
      isTalkingToSerenity({
        serenity: { id: "s1", name: "Serenity" },
        activeSession: { character_id: "s1" },
        characters: [{ id: "s1", name: "Serenity" }],
      }).talkingToSerenity,
    ).toBe(true);

    const addressed = isTalkingToSerenity({
      serenity: { id: "s1", name: "Serenity" },
      activeSession: { character_id: "c2" },
      characters: [{ id: "c2", name: "Aria" }],
      content: "Serenity, upgrade the protocol to add a quieter header.",
    });
    expect(addressed.talkingToSerenity).toBe(false);
    expect(addressed.addressedSerenity).toBe(true);
  });
});
