import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTINUE_IN_FIRST_PERSON,
  LEAN_SOLO_CLIENT_CONTEXT_MAX,
  buildLeanSoloClientContext,
  companionChatDeepMode,
} from "./leanCompanionChat";

describe("buildLeanSoloClientContext", () => {
  it("omits identity, transcript, and profile blocks", () => {
    const context = buildLeanSoloClientContext({
      loreContext: "WORLD STATE & LORE:\n- the harbor light is lit",
      lengthGuide: "Keep it conversational — 2-4 sentences.",
      imageInstruction: "IMAGE GENERATION: emit [IMAGE: …] when asked to draw.",
    });
    expect(context).toContain("harbor light");
    expect(context).toContain("2-4 sentences");
    expect(context).not.toMatch(/CHARACTER IDENTITY LOCK/);
    expect(context).not.toMatch(/Story so far/);
    expect(context).not.toMatch(/USER_PROFILE/);
  });

  it("returns empty when there are no extras so the server owns the prompt", () => {
    expect(buildLeanSoloClientContext({})).toBe("");
  });

  it("caps oversized extras", () => {
    const context = buildLeanSoloClientContext({
      loreContext: "LORE: " + "x".repeat(LEAN_SOLO_CLIENT_CONTEXT_MAX + 400),
    });
    expect(context.length).toBeLessThanOrEqual(LEAN_SOLO_CLIENT_CONTEXT_MAX);
    expect(context.endsWith("…")).toBe(true);
  });

  it("keeps length, image, and Continue extras when lore is oversized", () => {
    const context = buildLeanSoloClientContext({
      loreContext: "LORE: " + "x".repeat(LEAN_SOLO_CLIENT_CONTEXT_MAX + 400),
      lengthGuide: "Keep it conversational — 2-4 sentences.",
      imageInstruction: "IMAGE GENERATION: emit [IMAGE: …] when asked to draw.",
      isContinue: true,
      characterName: "Aria",
    });
    expect(context.length).toBeLessThanOrEqual(LEAN_SOLO_CLIENT_CONTEXT_MAX);
    expect(context).toContain("2-4 sentences");
    expect(context).toContain("IMAGE GENERATION");
    expect(context).toContain(CONTINUE_IN_FIRST_PERSON);
    expect(context).not.toMatch(/as Aria/);
  });

  it("adds a first-person continue line without a user transcript", () => {
    const context = buildLeanSoloClientContext({
      isContinue: true,
      characterName: "Aria",
    });
    expect(context).toBe(CONTINUE_IN_FIRST_PERSON);
    expect(context).not.toMatch(/continue the (?:scene|story)/i);
    expect(context).not.toMatch(/as Aria/);
  });

  it("sends that same first-person line when the chat box is empty", () => {
    const chat = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../pages/Chat.jsx"),
      "utf8",
    );
    const handler = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "./chatMessageHandler.js"),
      "utf8",
    );
    expect(chat).toContain("content: isContinue ? CONTINUE_IN_FIRST_PERSON : content");
    expect(chat).not.toContain("Make real decisions based on who you are");
    expect(handler).toContain("CONTINUE_IN_FIRST_PERSON");
    expect(handler).not.toContain("Make real decisions based on who you are");
  });

  it("caps an oversized trailing block instead of exceeding the budget", () => {
    const context = buildLeanSoloClientContext({
      imageInstruction: "IMAGE: " + "y".repeat(LEAN_SOLO_CLIENT_CONTEXT_MAX + 400),
    });
    expect(context.length).toBeLessThanOrEqual(LEAN_SOLO_CLIENT_CONTEXT_MAX);
    expect(context.startsWith("IMAGE:")).toBe(true);
    expect(context.endsWith("…")).toBe(true);
  });

  it("keeps the matrix safety clause when companion-mode text is oversized", () => {
    const context = buildLeanSoloClientContext({
      companionModeInstruction: "MODE: " + "z".repeat(LEAN_SOLO_CLIENT_CONTEXT_MAX),
      matrixSafetyClause:
        "HIGHEST-PRIORITY RULE (overrides everything above): In multi-aspect presence, keep it emotional only.",
    });
    expect(context.length).toBeLessThanOrEqual(LEAN_SOLO_CLIENT_CONTEXT_MAX);
    expect(context).toContain("HIGHEST-PRIORITY RULE");
    expect(context).toContain("emotional only");
  });
});

describe("companionChatDeepMode", () => {
  it("follows the session toggle only", () => {
    expect(companionChatDeepMode({ deep_mode: true })).toBe(true);
    expect(companionChatDeepMode({ deep_mode: false })).toBe(false);
    expect(companionChatDeepMode({})).toBe(false);
  });
});

describe("Chat.jsx lean 1:1 wiring", () => {
  const chat = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../pages/Chat.jsx"),
    "utf8",
  );

  it("sends lean solo extras instead of a second identity + transcript prompt", () => {
    expect(chat).toContain("buildLeanSoloClientContext(");
    expect(chat).toContain("userProfileContext,");
    expect(chat).toContain("behaviorConfigPromise");
    expect(chat).toContain("companionChatDeepMode(activeSession)");
    expect(chat).toContain("response_length: user?.settings?.ai_response_length || undefined");
    expect(chat).not.toMatch(
      /prompt = `You are \$\{char\.name\}[\s\S]*CHARACTER IDENTITY LOCK/,
    );
  });
});
