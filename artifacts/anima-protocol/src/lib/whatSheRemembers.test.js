import { describe, expect, it } from "vitest";
import {
  findMemoryForHighlight,
  memoryEmptyLine,
  memoryScreenTitle,
  presentMemoryReview,
  safeMemoryReturn,
  sessionMemoryTargets,
  whatSheRemembersPath,
} from "./whatSheRemembers";

describe("what she remembers paths", () => {
  it("builds a chat return path and drops off-site returns", () => {
    expect(
      whatSheRemembersPath({
        characterId: "natasha",
        companionName: "Natasha",
        returnTo: "/chat/sess-1",
      }),
    ).toBe("/what-she-remembers/natasha?name=Natasha&from=%2Fchat%2Fsess-1");
    expect(safeMemoryReturn("https://evil.test")).toBeNull();
    expect(safeMemoryReturn("//evil.test")).toBeNull();
  });
  it("carries a memory highlight and preview on the path", () => {
    expect(
      whatSheRemembersPath({
        characterId: "natasha",
        companionName: "Natasha",
        returnTo: "/chat/sess-1",
        memoryId: "evt-1",
        preview: "Natasha kept the key.",
      }),
    ).toBe(
      "/what-she-remembers/natasha?name=Natasha&from=%2Fchat%2Fsess-1&memory=evt-1&q=Natasha+kept+the+key.",
    );
  });


  it("names the menu entry from the companion in a solo or group chat", () => {
    expect(
      sessionMemoryTargets(
        { id: "sess-1", mode: "solo", character_id: "natasha" },
        [{ id: "natasha", name: "Natasha" }],
      ),
    ).toEqual([
      {
        id: "natasha",
        name: "Natasha",
        label: "What she remembers",
        to: "/what-she-remembers/natasha?name=Natasha&from=%2Fchat%2Fsess-1",
      },
    ]);
    expect(
      sessionMemoryTargets(
        { id: "sess-2", mode: "group", group_character_ids: ["natasha", "clint"] },
        [
          { id: "natasha", name: "Natasha" },
          { id: "clint", name: "Clint" },
        ],
      ).map((item) => item.label),
    ).toEqual(["What Natasha remembers", "What Clint remembers"]);
  });
});

describe("presentMemoryReview", () => {
  it("pulls a mis-filed user fact out of her memories and keeps proposals locked", () => {
    const shown = presentMemoryReview({
      about_you: [],
      companion: [
        {
          fact_id: "user-name",
          text: "The human's name is Sam.",
          about: "user",
          section: "companion",
          editable: true,
        },
        {
          fact_id: "her-key",
          text: "Natasha kept the key.",
          about: "companion",
          section: "companion",
          memory_class: "episodic",
          editable: true,
        },
      ],
      core: [
        {
          fact_id: "core-name",
          text: "Protected identity proposal.",
          about: "companion",
          section: "core",
          memory_class: "core",
          protected: true,
          editable: true,
        },
      ],
    });
    expect(shown.about_you.map((item) => item.fact_id)).toEqual(["user-name"]);
    expect(shown.companion.map((item) => item.fact_id)).toEqual(["her-key"]);
    expect(shown.core).toEqual([
      expect.objectContaining({ fact_id: "core-name", editable: false, protected: true }),
    ]);

    const protectedMoment = presentMemoryReview({
      about_you: [],
      companion: [
        {
          fact_id: "her-promise",
          text: "She kept a quiet promise.",
          about: "companion",
          section: "companion",
          memory_class: "episodic",
          protected: true,
          editable: false,
        },
      ],
      core: [],
    });
    expect(protectedMoment.companion.map((item) => item.fact_id)).toEqual(["her-promise"]);
    expect(protectedMoment.core).toEqual([]);
    expect(memoryScreenTitle("Natasha")).toBe("What Natasha remembers");
    expect(memoryEmptyLine("Natasha")).toBe("Natasha hasn't remembered anything yet.");
  });
});

describe("findMemoryForHighlight", () => {
  const review = {
    about_you: [],
    companion: [
      {
        fact_id: "her-key",
        event_id: "evt-99",
        text: "Natasha kept the key.",
        section: "companion",
        about: "companion",
        memory_class: "episodic",
        editable: true,
        protected: false,
      },
    ],
    core: [],
  };

  it("matches by fact id, event id, or preview text", () => {
    expect(findMemoryForHighlight(review, { memoryId: "her-key" }).fact_id).toBe("her-key");
    expect(findMemoryForHighlight(review, { memoryId: "evt-99" }).fact_id).toBe("her-key");
    expect(findMemoryForHighlight(review, { preview: "Natasha kept the key." }).fact_id).toBe("her-key");
    expect(findMemoryForHighlight(review, { memoryId: "missing", preview: "no such sentence here" })).toBeNull();
  });
});
