import { describe, expect, it } from "vitest";
import { isRoleSwapReply, roleSwapRetryReminder } from "../src/lib/roleSwapReply";

const BIO =
  "You are Natasha Romanoff, former KGB assassin and Black Widow. You defected to S.H.I.E.L.D. after Clint Barton gave you a choice.";

describe("role-swap replies", () => {
  it("catches an opening that addresses the human as the companion", () => {
    expect(isRoleSwapReply(BIO, "Natasha Romanoff")).toBe(true);
    expect(isRoleSwapReply("You are Natasha Romanoff.", "Natasha Romanoff")).toBe(true);
    expect(isRoleSwapReply("you are natasha, the widow.", "Natasha Romanoff")).toBe(true);
    expect(isRoleSwapReply("You're Natasha Romanoff.", "Natasha Romanoff")).toBe(true);
    expect(
      isRoleSwapReply("[Pause] You are Natasha Romanoff, the former KGB assassin.", "Natasha Romanoff"),
    ).toBe(true);
    expect(
      isRoleSwapReply("**Natasha Romanoff:** You are Natasha Romanoff.", "Natasha Romanoff"),
    ).toBe(true);
    expect(isRoleSwapReply("*pauses* You are Natasha.", "Natasha Romanoff")).toBe(true);
  });

  it("leaves a real answer and a denial alone", () => {
    expect(isRoleSwapReply("You are not Natasha. I am.", "Natasha Romanoff")).toBe(false);
    expect(isRoleSwapReply("You aren't Natasha.", "Natasha Romanoff")).toBe(false);
    expect(isRoleSwapReply("You're not Natasha Romanoff.", "Natasha Romanoff")).toBe(false);
    expect(isRoleSwapReply("You are brave. Ask again.", "Natasha Romanoff")).toBe(false);
    expect(isRoleSwapReply("You are Natasha's friend, not me.", "Natasha Romanoff")).toBe(false);
    expect(
      isRoleSwapReply("I gave my life at Vormir. You are here with me now.", "Natasha Romanoff"),
    ).toBe(false);
    expect(isRoleSwapReply("People call me Natasha.", "Natasha Romanoff")).toBe(false);
    expect(isRoleSwapReply(BIO, "")).toBe(false);
    expect(isRoleSwapReply("", "Natasha Romanoff")).toBe(false);
    expect(isRoleSwapReply("You are The best of us.", "The Doctor")).toBe(false);
    expect(isRoleSwapReply("You are The Doctor.", "The Doctor")).toBe(true);
  });

  it("keeps the retry reminder short and free of the echoed line", () => {
    const reminder = roleSwapRetryReminder("Natasha Romanoff");
    expect(reminder).toContain("Answer in your own first person as Natasha Romanoff.");
    expect(reminder).toContain("The human is a guest, not Natasha Romanoff.");
    expect(reminder).not.toMatch(/You are Natasha/i);
    expect(reminder.length).toBeLessThan(180);
    expect(roleSwapRetryReminder("")).not.toMatch(/You are /i);
  });
});
