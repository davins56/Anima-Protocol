import { afterEach, describe, expect, it } from "vitest";
import {
  isIdentityTreatment,
  normalizeHudStyle,
  normalizePresentation,
  presentationTreatment,
  readExperienceExtras,
  treatmentKey,
} from "./presentation";
import { PRESET_FIELDS } from "@/lib/experiencePresets";

afterEach(() => {
  const ds = document.documentElement.dataset;
  delete ds.experienceCharacter;
  delete ds.experienceHud;
  delete ds.appearanceMotion;
});

describe("character presentation → 3D treatment", () => {
  it("covers exactly the Appearance Studio options", () => {
    for (const option of PRESET_FIELDS.character) expect(normalizePresentation(option)).toBe(option);
    for (const option of PRESET_FIELDS.hud) expect(normalizeHudStyle(option)).toBe(option);
    expect(normalizePresentation("evil")).toBe("portrait");
    expect(normalizeHudStyle(undefined)).toBe("minimal");
  });

  it("portrait leaves the vessel as authored", () => {
    expect(isIdentityTreatment(presentationTreatment("portrait"))).toBe(true);
    expect(isIdentityTreatment(presentationTreatment("nonsense"))).toBe(true);
  });

  it("hologram is a see-through tinted projection with rim and scan, never an outline", () => {
    const t = presentationTreatment("hologram");
    expect(t.hologram?.alpha).toBeLessThan(1);
    expect(t.hologram?.scan).toBeGreaterThan(0);
    expect(t.rim).not.toBeNull();
    expect(t.outline).toBeNull();
    expect(t.hologram?.drift).toBe(true);
    expect(presentationTreatment("hologram", { reducedMotion: true }).hologram?.drift).toBe(false);
  });

  it("netnavi outlines full views but drops the shell on the low tier and lite views", () => {
    expect(presentationTreatment("netnavi", { tier: "high" }).outline).not.toBeNull();
    expect(presentationTreatment("netnavi", { tier: "low" }).outline).toBeNull();
    expect(presentationTreatment("netnavi", { lite: true }).outline).toBeNull();
    expect(presentationTreatment("netnavi", { lite: true }).rim).not.toBeNull();
  });

  it("uses an accent when given and keys shader variants by what they inject", () => {
    expect(presentationTreatment("netnavi", { accent: "#ff00aa" }).rim?.color).toBe("#ff00aa");
    expect(treatmentKey(presentationTreatment("hologram"))).not.toBe(treatmentKey(presentationTreatment("netnavi")));
    expect(treatmentKey(presentationTreatment("netnavi", { lite: true }))).toBe(treatmentKey(presentationTreatment("netnavi")));
  });

  it("reads the applied extras and reduced motion from <html>", () => {
    expect(readExperienceExtras()).toMatchObject({ character: "portrait", hud: "minimal" });
    const ds = document.documentElement.dataset;
    ds.experienceCharacter = "netnavi";
    ds.experienceHud = "tactical";
    ds.appearanceMotion = "reduced";
    expect(readExperienceExtras()).toEqual({ character: "netnavi", hud: "tactical", reducedMotion: true });
  });
});
