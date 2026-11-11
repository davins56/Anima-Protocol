import { describe, expect, it } from "vitest";
import {
  normalizeSensesSnapshot,
  readStoredSenses,
  SENSES_MAX_AGE_MS,
  sensesPercept,
  summarizeSenses,
} from "../src/lib/kernel/senses";

const NOW = Date.parse("2026-11-05T15:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

describe("senses: normalize", () => {
  it("keeps only whitelisted, bounded fields", () => {
    const snap = normalizeSensesSnapshot(
      {
        timezone: "America/New_York",
        calendar: [
          { title: "  Edit\nchapter 9  ", startsAt: at(-10), endsAt: at(40), attendees: ["x@y.z"] },
          { title: "Call", startsAt: at(120), endsAt: at(150) },
        ],
        device: { platform: "iOS 19<script>", battery: 1.7, charging: "yes", online: true, focusMode: false, imei: "1" },
        secret: "drop me",
      },
      NOW,
    );
    expect(snap.timezone).toBe("America/New_York");
    expect(snap.calendar).toEqual([
      { title: "Edit chapter 9", startsAt: at(-10), endsAt: at(40) },
      { title: "Call", startsAt: at(120), endsAt: at(150) },
    ]);
    expect(snap.device).toEqual({ platform: "iOS 19script", battery: 1, charging: null, online: true, focusMode: false });
    expect("secret" in snap).toBe(false);
    expect(snap.receivedAt).toBe(new Date(NOW).toISOString());
  });

  it("drops past, far-future, inverted, all-day and malformed blocks", () => {
    const snap = normalizeSensesSnapshot(
      {
        calendar: [
          { title: "past", startsAt: at(-120), endsAt: at(-60) },
          { title: "far", startsAt: at(60 * 72), endsAt: at(60 * 73) },
          { title: "inverted", startsAt: at(30), endsAt: at(10) },
          { title: "all day", startsAt: at(0), endsAt: at(60 * 24) },
          { title: "bad", startsAt: "soon", endsAt: at(10) },
          "nope",
        ],
      },
      NOW,
    );
    expect(snap.calendar).toEqual([]);
  });

  it("rejects an invalid timezone and caps the event count", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `b${i}`, startsAt: at(i * 10 + 5), endsAt: at(i * 10 + 9) }));
    const snap = normalizeSensesSnapshot({ timezone: "Not/AZone", calendar: many }, NOW);
    expect(snap.timezone).toBeNull();
    expect(snap.calendar).toHaveLength(8);
    expect(snap.calendar[0].title).toBe("b0");
  });
});

describe("senses: stored snapshot", () => {
  it("expires stale snapshots", () => {
    const fresh = normalizeSensesSnapshot({ calendar: [] }, NOW);
    expect(readStoredSenses(fresh, NOW + 60_000)).not.toBeNull();
    expect(readStoredSenses(fresh, NOW + SENSES_MAX_AGE_MS + 1)).toBeNull();
    expect(readStoredSenses({ receivedAt: "garbage" }, NOW)).toBeNull();
    expect(readStoredSenses(null, NOW)).toBeNull();
  });

  it("keeps the original received time", () => {
    const fresh = normalizeSensesSnapshot({}, NOW);
    expect(readStoredSenses(fresh, NOW + 3_600_000)?.receivedAt).toBe(new Date(NOW).toISOString());
  });
});

describe("senses: percept", () => {
  it("sees a current calendar block", () => {
    const snap = normalizeSensesSnapshot({ calendar: [{ title: "x", startsAt: at(-5), endsAt: at(25) }] }, NOW);
    expect(sensesPercept(snap, NOW)).toEqual({ busyNow: true, busyForMinutes: 25 });
  });

  it("treats focus mode as busy", () => {
    const snap = normalizeSensesSnapshot({ device: { focusMode: true } }, NOW);
    expect(sensesPercept(snap, NOW)).toEqual({ busyNow: true, busyForMinutes: 60 });
  });

  it("is free between blocks, and absent without a snapshot", () => {
    const snap = normalizeSensesSnapshot({ calendar: [{ title: "x", startsAt: at(30), endsAt: at(60) }] }, NOW);
    expect(sensesPercept(snap, NOW)).toEqual({ busyNow: false, busyForMinutes: null });
    expect(sensesPercept(null, NOW)).toBeNull();
  });
});

describe("senses: summary", () => {
  it("never exposes calendar titles", () => {
    const snap = normalizeSensesSnapshot({ calendar: [{ title: "Therapy", startsAt: at(30), endsAt: at(80) }] }, NOW);
    const summary = summarizeSenses(snap, NOW);
    expect(JSON.stringify(summary)).not.toContain("Therapy");
    expect(summary).toEqual({
      present: true,
      receivedAt: new Date(NOW).toISOString(),
      timezone: null,
      calendarBlocks: 1,
      busyNow: false,
      nextBlockInMinutes: 30,
      device: { platform: null, battery: null, charging: null, online: null, focusMode: null },
    });
    expect(summarizeSenses(null, NOW)).toEqual({ present: false });
  });
});
