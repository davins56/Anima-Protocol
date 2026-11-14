import { describe, expect, it } from "vitest";
import { LIVE_PRESENCE_MINUTES, latestActivityAt, livePresence } from "./continuity";

const NOW = Date.parse("2026-11-13T22:00:00.000Z");
const dreaming = { presence: "dreaming", presence_label: "Asami Sato is dreaming" };

describe("live presence beats the presence loaded at chat open", () => {
  it("shows 'here', not 'dreaming', while she is replying", () => {
    expect(livePresence(dreaming, { replying: true, now: NOW, name: "Asami Sato" })).toEqual({
      presence: "here",
      presence_label: "Asami Sato is here",
    });
  });

  it("shows 'here' when the chat had a message in the last few minutes", () => {
    const activeAt = NOW - 2 * 60_000;
    expect(livePresence(dreaming, { activeAt, now: NOW, name: "Asami Sato" })?.presence).toBe("here");
  });

  it("keeps the loaded presence once the chat has been quiet past the window", () => {
    const activeAt = NOW - (LIVE_PRESENCE_MINUTES + 1) * 60_000;
    expect(livePresence(dreaming, { activeAt, now: NOW, name: "Asami Sato" })).toEqual(dreaming);
  });

  it("finds the newest message time across timestamp shapes", () => {
    const at = latestActivityAt([
      { timestamp: "2026-11-13T21:00:00.000Z" },
      { created_date: "2026-11-13T21:58:00.000Z" },
      { content: "no time" },
    ]);
    expect(at).toBe(Date.parse("2026-11-13T21:58:00.000Z"));
    expect(latestActivityAt(null)).toBeNull();
  });
});
