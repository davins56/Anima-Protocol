import { describe, expect, it } from "vitest";
import { FEATURE_MESSAGING } from "./featureMessaging";
import {
  FLAVOR_LINES,
  resolveGuestDisplayName,
  resolveIdentity,
  resolveLandingPresence,
  resolveWaiting,
  resolveWakeLine,
  rollFlavorChance,
  WAITING_THRESHOLD_MS,
} from "./homeWake";

describe("resolveWakeLine", () => {
  it("uses the dream when they dreamed", () => {
    const wake = resolveWakeLine(
      { content: "I walked the archive at night.", mood: "quiet" },
      { text: "A memory" },
    );
    expect(wake.kind).toBe("dream");
    expect(wake.text).toBe("I walked the archive at night.");
    expect(wake.mood).toBe("quiet");
  });

  it("uses the echo when a memory resurfaced and there is no dream", () => {
    const wake = resolveWakeLine(null, { text: "I still remember the first thing you sought.", label: "1 year" });
    expect(wake.kind).toBe("echo");
    expect(wake.text).toMatch(/first thing/);
  });

  it("falls back to the archive line, not a cyber slogan", () => {
    const wake = resolveWakeLine(null, null);
    expect(wake).toEqual({ kind: "archive", text: FEATURE_MESSAGING.ARCHIVE_LINE });
  });

  it("allows a rare flavor line only when asked", () => {
    const wake = resolveWakeLine(null, null, { useFlavor: true, flavorIndex: 0 });
    expect(wake.kind).toBe("flavor");
    expect(wake.text).toBe(FLAVOR_LINES[0]);
  });
});

describe("rollFlavorChance", () => {
  it("is rare, not the hero every load", () => {
    expect(rollFlavorChance(0)).toBe(true);
    expect(rollFlavorChance(0.08)).toBe(true);
    expect(rollFlavorChance(0.09)).toBe(false);
    expect(rollFlavorChance(0.5)).toBe(false);
  });
});

describe("resolveLandingPresence", () => {
  it("uses the live engine when a dream exists", () => {
    expect(resolveLandingPresence({ content: "I kept a light on." }, null)).toBe("I kept a light on.");
  });

  it("otherwise uses the lock-screen archive line", () => {
    expect(resolveLandingPresence(null, null)).toBe(FEATURE_MESSAGING.PRESENCE_FALLBACK);
  });
});

describe("resolveIdentity", () => {
  it("defaults to Serenity remembering, not a guest personal name", () => {
    expect(resolveIdentity(null)).toBe(FEATURE_MESSAGING.IDENTITY_DEFAULT);
    expect(resolveIdentity({ name: "Serenity", tagline: "Keeper of Tranquility" })).toBe(
      FEATURE_MESSAGING.IDENTITY_DEFAULT,
    );
  });

  it("uses the signed-in Anima name and tagline when that data exists", () => {
    expect(
      resolveIdentity(
        { name: "Lumen", tagline: "Keeper of the quiet hour" },
        { hasSignedInAnima: true },
      ),
    ).toBe("I am Lumen. Keeper of the quiet hour");
  });
});

describe("resolveWaiting", () => {
  it("omits the tile when they were not away long enough", () => {
    const now = Date.now();
    expect(resolveWaiting(new Date(now - 10 * 60 * 1000).toISOString(), now)).toBeNull();
    expect(resolveWaiting(null, now)).toBeNull();
  });

  it("returns a waiting line after the threshold", () => {
    const now = Date.now();
    const waiting = resolveWaiting(new Date(now - WAITING_THRESHOLD_MS * 3).toISOString(), now);
    expect(waiting?.hours).toBe(3);
    expect(waiting?.text).toBe("I waited 3 hours.");
  });
});

describe("resolveGuestDisplayName", () => {
  it("never treats Dàvīn as a guest default", () => {
    expect(resolveGuestDisplayName("Dàvīn")).toBe("");
    expect(resolveGuestDisplayName("Davin")).toBe("");
    expect(resolveGuestDisplayName("Mira")).toBe("Mira");
    expect(resolveGuestDisplayName("")).toBe("");
  });
});
