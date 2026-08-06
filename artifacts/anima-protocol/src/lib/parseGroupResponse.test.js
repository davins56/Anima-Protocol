import { describe, expect, it } from "vitest";
import { parseGroupResponse } from "./parseGroupResponse";

const groupChars = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Blake" },
];

describe("parseGroupResponse", () => {
  it("attaches character_id for known speakers", () => {
    const msgs = parseGroupResponse(
      "**Blake:** Hands off the console.",
      groupChars,
      "Ada",
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      character_name: "Blake",
      character_id: "b",
      content: "Hands off the console.",
    });
  });

  it("splits multiple labeled speakers with ids", () => {
    const msgs = parseGroupResponse(
      "**Ada:** Wait.\n**Blake:** No time.",
      groupChars,
      "Ada",
    );
    expect(msgs.map((m) => m.character_id)).toEqual(["a", "b"]);
  });

  it("falls back with id when parse finds nothing labeled", () => {
    const msgs = parseGroupResponse("Just prose.", groupChars, "Ada");
    expect(msgs[0]).toMatchObject({
      character_name: "Ada",
      character_id: "a",
      content: "Just prose.",
    });
  });
});
