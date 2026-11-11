import { describe, expect, it } from "vitest";
import { composePhotoPrompt, identityAnchor, refinementClause } from "../src/lib/photo/promptComposer";
import { buildFalRequest, pickStrategy } from "../src/lib/photo/providerRouter";

const serenity = {
  age_range: "mid-20s",
  skin_tone: "warm golden",
  eye_color: "luminous cyan",
  hair_color: "silver",
  hair_style: "long flowing",
  distinguishing_marks: ["faint halo glow"],
  style: "photoreal",
};

describe("photo prompt composer", () => {
  it("always leads with the locked identity anchor", () => {
    const p = composePhotoPrompt({ characterName: "Serenity", descriptor: serenity, userPrompt: "on a rooftop at dusk" });
    expect(p.startsWith("Portrait photo of Serenity, mid-20s years old")).toBe(true);
    expect(p).toContain("luminous cyan eyes");
    expect(p).toContain("on a rooftop at dusk");
    expect(p).toContain("photorealistic");
  });

  it("puts the trigger word first for LoRA identities", () => {
    expect(identityAnchor("Linda Winings", {}, "lnd4w")).toBe("lnd4w, Linda Winings");
  });

  it("scopes refinements to one attribute", () => {
    expect(refinementClause({ op: "outfit", value: "red silk dress" })).toContain("change only the outfit");
    expect(refinementClause({ op: "regenerate" })).toBe("");
  });

  it("strips markup and control chars from user text", () => {
    const p = composePhotoPrompt({ characterName: "Aelindra", descriptor: {}, userPrompt: "<script>x</script>\u0000hi" });
    expect(p).not.toContain("<");
  });
});

describe("provider router", () => {
  it("falls back to gemini without FAL_KEY", () => {
    expect(pickStrategy({ hasFal: false, config: {}, hasParentImage: false, hasReference: true })).toBe("gemini");
  });
  it("edits the parent image for outfit/expression refinements", () => {
    expect(
      pickStrategy({ hasFal: true, config: {}, refinement: { op: "expression" }, hasParentImage: true, hasReference: true }),
    ).toBe("kontext");
  });
  it("prefers a trained LoRA over zero-shot PuLID", () => {
    expect(pickStrategy({ hasFal: true, config: { lora_url: "https://x/lora.safetensors" }, hasParentImage: false, hasReference: true })).toBe("lora");
    expect(pickStrategy({ hasFal: true, config: {}, hasParentImage: false, hasReference: true })).toBe("pulid");
  });
  it("builds a PuLID request with the reference face", () => {
    const r = buildFalRequest({ strategy: "pulid", prompt: "p", negative: "n", referenceUrl: "https://r", config: {} });
    expect(r.model).toBe("fal-ai/flux-pulid");
    expect(r.input.reference_image_url).toBe("https://r");
  });
});
