import { describe, expect, it } from "vitest";
import { chatStreamStatusCopy } from "./chatStreamStatusCopy";

describe("chatStreamStatusCopy", () => {
  it("maps local-only progress phases to honest waiting copy", () => {
    expect(chatStreamStatusCopy({ status: "progress", phase: "preparing" })).toBe(
      "Gathering your companion…",
    );
    expect(chatStreamStatusCopy({ status: "progress", phase: "waking" })).toBe(
      "Waking the local Anima model…",
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

  it("ignores unknown events", () => {
    expect(chatStreamStatusCopy({})).toBeNull();
    expect(chatStreamStatusCopy({ status: "nope" })).toBeNull();
  });
});
