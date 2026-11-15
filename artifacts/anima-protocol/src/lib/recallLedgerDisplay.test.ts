import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANDIDATE_DISCLAIMER,
  errorMessage,
  formatHappenedAgo,
  formatRecallScores,
  formatRecalledAt,
  memoryTypeLabel,
  recallForgetPath,
  turnLinkageNote,
  withheldNote,
} from "./recallLedgerDisplay";

describe("recall ledger display", () => {
  afterEach(() => vi.useRealTimers());

  it("labels known memory types and title-cases unknown ones", () => {
    expect(memoryTypeLabel("turn")).toBe("Conversation");
    expect(memoryTypeLabel("emotional_beat")).toBe("Feeling");
    expect(memoryTypeLabel("document_chunk")).toBe("Document");
    expect(memoryTypeLabel("custom_flag")).toBe("Custom Flag");
    expect(memoryTypeLabel("")).toBe("Memory");
  });

  it("describes how long ago a memory happened", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T22:00:00Z"));
    expect(formatHappenedAgo("2026-11-10T21:50:00Z")).toBe("10 minutes ago");
    expect(formatHappenedAgo("2026-11-09T22:00:00Z")).toBe("yesterday");
    expect(formatHappenedAgo("2026-04-01T10:00:00Z")).toBe("7 months ago");
    expect(formatHappenedAgo(null, 90)).toBe("a minute ago");
  });

  it("formats a compact score line and omits a missing similarity", () => {
    expect(
      formatRecallScores({ score: 0.7132, similarity: 0.8211, recency: 0.12, emotional_weight: 0.9 }),
    ).toBe("Score 71% · Match 82% · Recency 12% · Feeling 90%");
    expect(
      formatRecallScores({ score: 0.5, similarity: null, recency: null, emotional_weight: 0.2 }),
    ).toBe("Score 50% · Feeling 20%");
  });

  it("keeps withheld counts as a quiet note", () => {
    expect(withheldNote({ retracted: 0, unattributable: 0 })).toBeNull();
    expect(withheldNote({ retracted: 1, unattributable: 0 })).toBe("1 forgotten memory isn't shown.");
    expect(withheldNote({ retracted: 2, unattributable: 1 })).toBe("3 memories aren't shown.");
  });

  it("explains turn linkage without calling a group a turn", () => {
    expect(turnLinkageNote("none")).toBeNull();
    expect(turnLinkageNote("partial")).toMatch(/specific reply/);
    expect(turnLinkageNote("full")).toMatch(/grouped with the reply/);
    expect(turnLinkageNote("turn_id")).toMatch(/grouped with the reply/);
  });

  it("maps API errors to friendly copy, including memory not set up yet", () => {
    expect(errorMessage("companion_not_found")).toBe("This companion could not be found.");
    expect(errorMessage("memory_schema_missing")).toBe("Memory not set up yet.");
    expect(errorMessage("server_error")).toMatch(/could not be loaded/i);
  });

  it("builds a Forget-this path that jumps to What she remembers", () => {
    expect(
      recallForgetPath({
        characterId: "char_aeland_01",
        companionName: "Aeland",
        returnTo: "/chat/sess_9f2",
        eventId: "0d4b1a7e-2c4f-4b8e-9a51-3f7e2d9c8b10",
        preview: "User: I finally called my dad back.",
      }),
    ).toBe(
      "/what-she-remembers/char_aeland_01?name=Aeland&from=%2Fchat%2Fsess_9f2&memory=0d4b1a7e-2c4f-4b8e-9a51-3f7e2d9c8b10&q=User%3A+I+finally+called+my+dad+back.",
    );
  });

  it("formats a same-day recall time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T22:14:03Z"));
    const label = formatRecalledAt("2026-11-10T22:14:03Z", new Date("2026-11-10T22:14:03Z"));
    expect(label).toMatch(/:\d{2}/);
    expect(CANDIDATE_DISCLAIMER).toMatch(/candidate/i);
  });
});
