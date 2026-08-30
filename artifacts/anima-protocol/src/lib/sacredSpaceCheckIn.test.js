import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      CheckIn: {
        create: vi.fn(),
        list: vi.fn(),
      },
    },
  },
}));

vi.mock("@/hooks/useCheckInRitual", () => ({
  setGlobalCheckInContext: vi.fn(),
}));

import { base44 } from "@/api/base44Client";
import { setGlobalCheckInContext } from "@/hooks/useCheckInRitual";
import {
  appearsInCheckInList,
  buildSacredSpaceCheckIn,
  moodFromRitualFocus,
  recordSacredSpaceCheckIn,
} from "./sacredSpaceCheckIn";

/** Union of keys the two existing CheckIn writers already persist. */
const EXISTING_CHECKIN_KEYS = new Set([
  "timestamp",
  "mood",
  "mood_intensity",
  "physical_state",
  "reflection",
  "gratitude",
  "mode_used",
  "session_id",
  "user_email",
  "check_in_date",
  "current_focus",
  "revelation",
  "freeform_note",
  "processed",
]);

describe("moodFromRitualFocus", () => {
  it("maps known Sacred Space focuses onto Check-In moods", () => {
    expect(moodFromRitualFocus("healing")).toBe("peaceful");
    expect(moodFromRitualFocus("clarity")).toBe("calm");
    expect(moodFromRitualFocus("love")).toBe("joyful");
    expect(moodFromRitualFocus("strength")).toBe("hopeful");
  });

  it("defaults unknown focuses to peaceful", () => {
    expect(moodFromRitualFocus("")).toBe("peaceful");
    expect(moodFromRitualFocus("mystery")).toBe("peaceful");
  });
});

describe("buildSacredSpaceCheckIn", () => {
  const now = new Date("2026-08-30T15:00:00.000Z");

  it("writes only existing CheckIn fields so Reflection Log keeps the row", () => {
    const payload = buildSacredSpaceCheckIn({
      reflection: "  I felt held.  ",
      gratitude: "the quiet",
      ritualFocus: "healing",
      characterName: "Serenity",
      userEmail: "dav@example.com",
      modeUsed: "serenity",
      now,
    });

    expect(Object.keys(payload).every((key) => EXISTING_CHECKIN_KEYS.has(key))).toBe(true);
    expect(payload).not.toHaveProperty("source");
    expect(payload).not.toHaveProperty("ritual_focus");
    expect(payload).not.toHaveProperty("character_id");
    expect(payload).not.toHaveProperty("character_name");
    expect(payload).toMatchObject({
      timestamp: "2026-08-30T15:00:00.000Z",
      check_in_date: "2026-08-30",
      mood: "peaceful",
      mood_intensity: 5,
      physical_state: "grounded",
      reflection: "I felt held.",
      gratitude: "the quiet",
      current_focus: "healing",
      freeform_note: "Sacred Space with Serenity",
      mode_used: "serenity",
      user_email: "dav@example.com",
      processed: false,
    });
    expect(appearsInCheckInList(payload)).toBe(true);
  });

  it("omits mode_used when the user's selected mode is unknown", () => {
    const payload = buildSacredSpaceCheckIn({ reflection: "note", now });
    expect(payload).not.toHaveProperty("mode_used");
  });

  it("synthesizes a reflection when the user skips the note so the list still keeps the entry", () => {
    const payload = buildSacredSpaceCheckIn({
      ritualFocus: "love",
      characterName: "Nyx",
      now,
    });
    expect(payload.reflection).toBe("Sacred Space with Nyx — love focus.");
    expect(payload.mood).toBe("joyful");
    expect(payload.current_focus).toBe("love");
    expect(appearsInCheckInList(payload)).toBe(true);
  });
});

describe("appearsInCheckInList", () => {
  it("drops in-chat ritual rows that have mood but no written reflection", () => {
    expect(
      appearsInCheckInList({
        mood: "calm",
        current_focus: "work",
        freeform_note: "",
      }),
    ).toBe(false);
  });

  it("keeps daily Check-In page rows", () => {
    expect(appearsInCheckInList({ reflection: "today was heavy", gratitude: "" })).toBe(true);
    expect(appearsInCheckInList({ reflection: "", gratitude: "sunlight" })).toBe(true);
  });
});

describe("recordSacredSpaceCheckIn", () => {
  beforeEach(() => {
    base44.entities.CheckIn.create.mockReset();
    setGlobalCheckInContext.mockReset();
  });

  it("creates a CheckIn and notifies listeners so the list can refresh without a reload", async () => {
    const created = {
      id: "ci-sacred-1",
      reflection: "I felt held.",
    };
    base44.entities.CheckIn.create.mockResolvedValue(created);

    const result = await recordSacredSpaceCheckIn({
      reflection: "I felt held.",
      ritualFocus: "healing",
      characterName: "Serenity",
      now: new Date("2026-08-30T15:00:00.000Z"),
    });

    expect(result).toEqual(created);
    expect(base44.entities.CheckIn.create).toHaveBeenCalledTimes(1);
    const body = base44.entities.CheckIn.create.mock.calls[0][0];
    expect(body.reflection).toBe("I felt held.");
    expect(body.current_focus).toBe("healing");
    expect(body).not.toHaveProperty("source");
    expect(appearsInCheckInList(body)).toBe(true);
    expect(setGlobalCheckInContext).toHaveBeenCalledWith(
      expect.stringMatching(/Focus: healing.*I felt held/),
    );
  });

  it("does not hide a failed create — callers see the rejection (no silent no-op)", async () => {
    base44.entities.CheckIn.create.mockRejectedValue(new Error("store 400"));
    await expect(
      recordSacredSpaceCheckIn({ reflection: "note" }),
    ).rejects.toThrow(/store 400/);
    expect(setGlobalCheckInContext).not.toHaveBeenCalled();
  });
});

describe("check-ins list after a Sacred Space save (failing path)", () => {
  it("includes the newly created Sacred Space CheckIn among listed rows", async () => {
    const existing = [
      { id: "ci-old", reflection: "yesterday", created_date: "2026-08-29" },
    ];
    const payload = buildSacredSpaceCheckIn({
      reflection: "The ritual settled my chest.",
      ritualFocus: "clarity",
      now: new Date("2026-08-30T15:00:00.000Z"),
    });
    const created = { id: "ci-new", created_date: payload.timestamp, ...payload };

    base44.entities.CheckIn.list.mockResolvedValue([created, ...existing]);
    const listed = await base44.entities.CheckIn.list("-created_date");
    const visible = (listed || []).filter(appearsInCheckInList);

    expect(visible.map((row) => row.id)).toEqual(["ci-new", "ci-old"]);
    expect(visible[0].current_focus).toBe("clarity");
    expect(visible[0].reflection).toMatch(/settled my chest/);
    expect(visible[0]).not.toHaveProperty("source");
  });
});
