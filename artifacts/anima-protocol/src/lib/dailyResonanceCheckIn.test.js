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
import { appearsInCheckInList } from "./sacredSpaceCheckIn";
import {
  buildDailyResonanceCheckIn,
  recordDailyResonanceCheckIn,
} from "./dailyResonanceCheckIn";

describe("buildDailyResonanceCheckIn", () => {
  const now = new Date("2026-08-30T15:00:00.000Z");

  it("writes a list-visible payload when the operator skips optional notes", () => {
    const payload = buildDailyResonanceCheckIn({
      mood: "calm",
      moodIntensity: 4,
      physicalState: "tired",
      reflection: "   ",
      gratitude: "",
      modeUsed: "companion",
      userEmail: "dav@example.com",
      now,
    });

    expect(payload).toMatchObject({
      timestamp: "2026-08-30T15:00:00.000Z",
      check_in_date: "2026-08-30",
      mood: "calm",
      mood_intensity: 4,
      physical_state: "tired",
      gratitude: "",
      mode_used: "companion",
      source: "daily_resonance",
      user_email: "dav@example.com",
    });
    expect(payload.reflection).toBe("Daily Resonance — calm (4/10), body tired.");
    expect(appearsInCheckInList(payload)).toBe(true);
  });

  it("keeps a written reflection instead of synthesizing one", () => {
    const payload = buildDailyResonanceCheckIn({
      reflection: "  today was heavy  ",
      gratitude: "sunlight",
      now,
    });
    expect(payload.reflection).toBe("today was heavy");
    expect(payload.gratitude).toBe("sunlight");
    expect(appearsInCheckInList(payload)).toBe(true);
  });
});

describe("recordDailyResonanceCheckIn", () => {
  beforeEach(() => {
    base44.entities.CheckIn.create.mockReset();
    setGlobalCheckInContext.mockReset();
  });

  it("awaits create and notifies listeners so the log can refresh without a reload", async () => {
    const created = { id: "ci-daily-1", reflection: "today was heavy" };
    base44.entities.CheckIn.create.mockResolvedValue(created);

    const result = await recordDailyResonanceCheckIn({
      reflection: "today was heavy",
      mood: "sad",
      now: new Date("2026-08-30T15:00:00.000Z"),
    });

    expect(result).toEqual(created);
    expect(base44.entities.CheckIn.create).toHaveBeenCalledTimes(1);
    const body = base44.entities.CheckIn.create.mock.calls[0][0];
    expect(appearsInCheckInList(body)).toBe(true);
    expect(setGlobalCheckInContext).toHaveBeenCalledWith(
      expect.stringMatching(/User mood: sad.*today was heavy/),
    );
  });

  it("does not hide a failed create — callers see the rejection (no silent no-op)", async () => {
    base44.entities.CheckIn.create.mockRejectedValue(new Error("store 400"));
    await expect(
      recordDailyResonanceCheckIn({ reflection: "note" }),
    ).rejects.toThrow(/store 400/);
    expect(setGlobalCheckInContext).not.toHaveBeenCalled();
  });
});

describe("Record Check-in button save → row appears in list filter", () => {
  it("includes the newly created Daily Resonance CheckIn among listed rows", async () => {
    const existing = [
      { id: "ci-old", reflection: "yesterday", created_date: "2026-08-29" },
    ];
    const payload = buildDailyResonanceCheckIn({
      mood: "hopeful",
      moodIntensity: 6,
      physicalState: "grounded",
      now: new Date("2026-08-30T15:00:00.000Z"),
    });
    const created = { id: "ci-new", created_date: payload.timestamp, ...payload };

    base44.entities.CheckIn.create.mockResolvedValue(created);
    await recordDailyResonanceCheckIn({
      mood: "hopeful",
      moodIntensity: 6,
      physicalState: "grounded",
      now: new Date("2026-08-30T15:00:00.000Z"),
    });

    base44.entities.CheckIn.list.mockResolvedValue([created, ...existing]);
    const listed = await base44.entities.CheckIn.list("-created_date");
    const visible = (listed || []).filter(appearsInCheckInList);

    expect(visible.map((row) => row.id)).toEqual(["ci-new", "ci-old"]);
    expect(visible[0].source).toBe("daily_resonance");
    expect(visible[0].reflection).toMatch(/hopeful/);
    expect(appearsInCheckInList(base44.entities.CheckIn.create.mock.calls[0][0])).toBe(
      true,
    );
  });
});
