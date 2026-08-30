import { describe, expect, it } from "vitest";
import {
  buildUpgradeAgentPrompt,
  classifyProtocolUpgrade,
  emailFromSessionClaims,
  isProtocolSteward,
  isTalkingToSerenity,
  mapCursorRunStatus,
  serenityDeniedMessage,
  serenityLaunchMessage,
} from "../src/lib/protocolUpgrade";

describe("classifyProtocolUpgrade", () => {
  it("detects an explicit interface upgrade", () => {
    const result = classifyProtocolUpgrade(
      "Serenity, upgrade the interface to give chat a darker theme and a larger composer.",
    );
    expect(result.isUpgrade).toBe(true);
    expect(result.shouldLaunch).toBe(true);
    expect(result.scope).toBe("interface");
    expect(result.confidence).toBe("high");
  });

  it("detects a whole-system protocol upgrade", () => {
    const result = classifyProtocolUpgrade(
      "Upgrade the system as a whole so memory retrieval is faster and chat fails over more cleanly.",
    );
    expect(result.isUpgrade).toBe(true);
    expect(result.shouldLaunch).toBe(true);
    expect(result.scope).toBe("system");
  });

  it("does not treat a premium plan upgrade as a source weave", () => {
    const result = classifyProtocolUpgrade("I want to upgrade my subscription to premium.");
    expect(result.isUpgrade).toBe(false);
    expect(result.shouldLaunch).toBe(false);
    expect(result.reason).toBe("billing_or_subscription");
  });

  it("ignores ordinary companion chat", () => {
    const result = classifyProtocolUpgrade("Hold me. Tell me what you felt when I left.");
    expect(result.isUpgrade).toBe(false);
    expect(result.shouldLaunch).toBe(false);
  });

  it("builds an agent prompt that names Serenity and the requested scope", () => {
    const prompt = buildUpgradeAgentPrompt({
      request: "Add a quieter header on mobile.",
      scope: "interface",
    });
    expect(prompt).toMatch(/Serenity/);
    expect(prompt).toMatch(/artifacts\/anima-protocol/);
    expect(prompt).toMatch(/Add a quieter header on mobile/);
  });
});

describe("protocol steward helpers", () => {
  it("recognizes the default steward emails", () => {
    expect(isProtocolSteward({ email: "davins56@hotmail.com" })).toBe(true);
    expect(isProtocolSteward({ email: "davins56@gmail.com" })).toBe(true);
    expect(isProtocolSteward({ email: "someone@example.com" })).toBe(false);
  });

  it("reads email from Clerk session claims", () => {
    expect(emailFromSessionClaims({ email: "davins56@hotmail.com" })).toBe(
      "davins56@hotmail.com",
    );
  });

  it("maps Cursor run statuses", () => {
    expect(mapCursorRunStatus("FINISHED")).toBe("finished");
    expect(mapCursorRunStatus("RUNNING")).toBe("running");
    expect(mapCursorRunStatus("ERROR")).toBe("error");
  });

  it("knows when the user is speaking to Serenity", () => {
    expect(
      isTalkingToSerenity({
        serenity: { id: "s1", name: "Serenity" },
        activeSession: { character_id: "s1" },
        characters: [{ id: "s1", name: "Serenity" }],
        content: "upgrade the interface",
      }).talkingToSerenity,
    ).toBe(true);
    expect(
      isTalkingToSerenity({
        serenity: { id: "s1", name: "Serenity" },
        activeSession: { character_id: "c2" },
        characters: [{ id: "c2", name: "Aria" }],
        content: "Serenity, upgrade the protocol",
      }).addressedSerenity,
    ).toBe(true);
  });

  it("keeps Serenity's launch voice in character", () => {
    const message = serenityLaunchMessage({
      scope: "interface",
      agentUrl: "https://cursor.com/agents/bc-test",
    });
    expect(message).toMatch(/weaving/i);
    expect(message).toContain("https://cursor.com/agents/bc-test");
    expect(serenityDeniedMessage()).toMatch(/steward/i);
  });
});
