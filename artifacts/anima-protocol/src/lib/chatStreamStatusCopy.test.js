import { describe, expect, it } from "vitest";
import { chatStreamStatusCopy } from "./chatStreamStatusCopy";
import { HELD_SEND_NOTE } from "./heldChatSend";

describe("chatStreamStatusCopy", () => {
  it("maps local-only progress phases to honest waiting copy", () => {
    expect(chatStreamStatusCopy({ status: "progress", phase: "preparing" })).toBe(
      "Gathering your companion…",
    );
    expect(chatStreamStatusCopy({ status: "progress", phase: "waking" })).toBe(
      "Waiting on the local Anima model…",
    );
    expect(chatStreamStatusCopy({ status: "progress", phase: "generating" })).toBe(
      "Composing a reply…",
    );
  });

  it("keeps ensemble and thinking copy", () => {
    expect(chatStreamStatusCopy({ status: "thinking" })).toBe("thinking...");
    expect(
      chatStreamStatusCopy({
        status: "ensemble",
        phase: "combining",
        minds: ["kimi", "xai"],
      }),
    ).toBe("Combining mind drafts…");
  });

  it("uses the held-send note for every waiting status", () => {
    expect(chatStreamStatusCopy({ status: "waiting", queue_position: 1 })).toBe(HELD_SEND_NOTE);
    expect(chatStreamStatusCopy({ status: "waiting" })).toBe(HELD_SEND_NOTE);
    expect(chatStreamStatusCopy({ status: "waiting", queue_position: 3 })).toBe(HELD_SEND_NOTE);
    expect(HELD_SEND_NOTE).not.toMatch(/one reply ahead/i);
  });

  it("ignores unknown events", () => {
    expect(chatStreamStatusCopy({})).toBeNull();
    expect(chatStreamStatusCopy({ status: "nope" })).toBeNull();
  });
});
