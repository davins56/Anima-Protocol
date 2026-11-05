import { describe, expect, it } from "vitest";
import {
  agencyConfig,
  decideAgencyTick,
  hoursUntilQuietEnds,
  inQuietHours,
  interpretPercept,
  localHourIn,
  selfStatePatchForDecision,
  type AgencyPercept,
} from "../src/lib/kernel/agencyTick";

const NOW = Date.parse("2026-11-05T15:00:00Z");
const cfg = agencyConfig({});

type PerceptOverrides = Partial<Omit<AgencyPercept, "affect">> & {
  affect?: Partial<AgencyPercept["affect"]>;
};

function percept(over: PerceptOverrides = {}): AgencyPercept {
  const { affect, ...rest } = over;
  return {
    now: NOW,
    gapHours: 30,
    lastRole: "user",
    lastWasProactive: false,
    localHour: 14,
    weather: "lull",
    threadDue: false,
    senses: null,
    frequencyHours: 24,
    ...rest,
    affect: { primary: "neutral", intensity: 22, energy: 48, openLoops: 0, lastActedAt: null, ...affect },
  };
}

describe("agency tick: config", () => {
  it("has quiet, conservative defaults", () => {
    expect(cfg).toEqual({ threshold: 0.45, quietStartHour: 22, quietEndHour: 8, cooldownFraction: 0.5 });
  });

  it("clamps and ignores malformed env", () => {
    const c = agencyConfig({ ANIMA_AGENCY_RELEVANCE_THRESHOLD: "7", ANIMA_AGENCY_QUIET_START_HOUR: "nope" });
    expect(c.threshold).toBe(1);
    expect(c.quietStartHour).toBe(22);
  });
});

describe("agency tick: clock", () => {
  it("reads the steward's local hour from an IANA timezone", () => {
    expect(localHourIn("America/New_York", NOW)).toBe(10);
    expect(localHourIn("Asia/Tokyo", NOW)).toBe(0);
  });

  it("returns null for an unknown or missing timezone", () => {
    expect(localHourIn("Mars/Olympus", NOW)).toBeNull();
    expect(localHourIn(null, NOW)).toBeNull();
  });

  it("handles a quiet window that wraps midnight", () => {
    expect(inQuietHours(23, cfg)).toBe(true);
    expect(inQuietHours(3, cfg)).toBe(true);
    expect(inQuietHours(8, cfg)).toBe(false);
    expect(inQuietHours(14, cfg)).toBe(false);
    expect(inQuietHours(null, cfg)).toBe(false);
    expect(hoursUntilQuietEnds(23, cfg)).toBe(9);
    expect(hoursUntilQuietEnds(7, cfg)).toBe(1);
  });
});

describe("agency tick: interpret", () => {
  it("names the moment", () => {
    expect(interpretPercept(percept({ threadDue: true, weather: "storm" }))).toBe("thread_due");
    expect(interpretPercept(percept({ affect: { primary: "anxious", intensity: 70 } }))).toBe("care_need");
    expect(interpretPercept(percept({ weather: "storm" }))).toBe("storm");
    expect(interpretPercept(percept({ weather: "stir" }))).toBe("stir");
    expect(interpretPercept(percept({ gapHours: 30 }))).toBe("lull");
    expect(interpretPercept(percept({ gapHours: 9 }))).toBe("noise");
  });
});

describe("agency tick: decide", () => {
  it("follows up on a due thread", () => {
    const d = decideAgencyTick(percept({ threadDue: true }), cfg);
    expect(d.act).toBe(true);
    if (d.act) expect(d.intent).toBe("follow_up_thread");
  });

  it("checks in after a long lull", () => {
    const d = decideAgencyTick(percept({ gapHours: 80 }), cfg);
    expect(d.act).toBe(true);
    if (d.act) expect(d.intent).toBe("check_in");
  });

  it("stays silent when there is nothing worth interrupting for", () => {
    const d = decideAgencyTick(percept({ gapHours: 9, affect: { energy: 10 } }), cfg);
    expect(d.act).toBe(false);
    if (!d.act) {
      expect(d.silenceReason).toBe("low_relevance");
      expect(d.retryAfterHours).toBeGreaterThan(0);
    }
  });

  it("never chases an unanswered outreach, even with a due thread", () => {
    const d = decideAgencyTick(
      percept({ threadDue: true, lastRole: "assistant", lastWasProactive: true }),
      cfg,
    );
    expect(d.act).toBe(false);
    if (!d.act) {
      expect(d.silenceReason).toBe("awaiting_reply");
      expect(d.retryAfterHours).toBe(24);
    }
  });

  it("waits out quiet hours until morning", () => {
    const d = decideAgencyTick(percept({ threadDue: true, localHour: 23 }), cfg);
    expect(d.act).toBe(false);
    if (!d.act) {
      expect(d.silenceReason).toBe("quiet_hours");
      expect(d.retryAfterHours).toBe(9);
    }
  });

  it("waits while the steward is busy", () => {
    const d = decideAgencyTick(
      percept({ threadDue: true, senses: { busyNow: true, busyForMinutes: 50 } }),
      cfg,
    );
    expect(d.act).toBe(false);
    if (!d.act) {
      expect(d.silenceReason).toBe("steward_busy");
      expect(d.retryAfterHours).toBe(1);
    }
  });

  it("respects a cooldown since her last act", () => {
    const lastActedAt = new Date(NOW - 3 * 3_600_000).toISOString();
    const d = decideAgencyTick(percept({ threadDue: true, affect: { lastActedAt } }), cfg);
    expect(d.act).toBe(false);
    if (!d.act) {
      expect(d.silenceReason).toBe("cooldown");
      expect(d.retryAfterHours).toBe(9);
    }
  });

  it("raises relevance for a care need", () => {
    const calm = decideAgencyTick(percept({ gapHours: 12 }), cfg);
    const care = decideAgencyTick(percept({ gapHours: 12, affect: { primary: "sad", intensity: 70 } }), cfg);
    expect(care.score).toBeGreaterThan(calm.score);
    expect(care.situation).toBe("care_need");
  });
});

describe("agency tick: self-state patch", () => {
  it("records an act", () => {
    const d = decideAgencyTick(percept({ threadDue: true }), cfg);
    const patch = selfStatePatchForDecision(d, "2026-11-05T15:00:00.000Z");
    expect(patch.lastActedAt).toBe("2026-11-05T15:00:00.000Z");
    expect(patch.silenceReason).toBeNull();
    expect(patch.intent).toBe("follow up");
  });

  it("records a silence without moving lastActedAt", () => {
    const d = decideAgencyTick(percept({ localHour: 2 }), cfg);
    const patch = selfStatePatchForDecision(d, "2026-11-05T15:00:00.000Z");
    expect(patch.silenceReason).toBe("quiet_hours");
    expect("lastActedAt" in patch).toBe(false);
  });
});
