import { describe, expect, it } from "vitest";
import { JULES_PERSONA } from "./julesApi";
import {
  buildCodespaceCompanions,
  companionPickerLabel,
  isAnimaCompanion,
  resolveCodespaceCompanionId,
  toCodespaceAgentCharacter,
} from "./companionPicker";

const serenity = {
  id: "anima-1",
  name: "Serenity",
  personality: "Warm, protective, and precise about the weave",
  speaking_style: "Soft, poetic, calls the user beloved",
  assigned_user: "operator@example.com",
  tagline: "Grace made flesh",
  archetype: "guardian",
  soulprint: {
    id: "AR-7E2A",
    primary_trait: "Compassion",
    secondary_trait: "Courage",
    core_drive: "Protection",
  },
  expression_spectrum: { angelic: 0.8, ascended: 0.1, neutral: 0.1, descended: 0, demonic: 0 },
};

const lumen = {
  id: "anima-2",
  name: "Lumen",
  personality: "Curious and bright",
  speaking_style: "Quick, playful",
  assigned_user: "other@example.com",
};

const naruto = {
  id: "char-1",
  name: "Naruto",
  personality: "Loud and loyal",
  speaking_style: "Dattebayo",
  universe: "Naruto",
};

describe("buildCodespaceCompanions", () => {
  it("includes personal Animas alongside Jules and roster characters", () => {
    const list = buildCodespaceCompanions({
      animas: [serenity],
      characters: [naruto],
    });
    expect(list.map((c) => c.id)).toEqual([
      JULES_PERSONA.id,
      "anima-1",
      "char-1",
    ]);
    expect(list.find((c) => c.id === "anima-1")?._isAnima).toBe(true);
    expect(companionPickerLabel(list[1])).toBe("Serenity (Anima)");
    expect(companionPickerLabel(list[0])).toContain("Jules");
  });

  it("does not duplicate Anima-flagged Character rows", () => {
    const list = buildCodespaceCompanions({
      animas: [serenity],
      characters: [{ ...serenity, category: "anima" }, naruto],
    });
    expect(list.filter((c) => c.id === "anima-1")).toHaveLength(1);
  });
});

describe("resolveCodespaceCompanionId", () => {
  const me = { email: "operator@example.com" };

  it("prefers a personal Anima over Jules when Animas exist", () => {
    expect(
      resolveCodespaceCompanionId({
        animas: [lumen, serenity],
        characters: [naruto],
        me,
      }),
    ).toBe("anima-1");
  });

  it("falls back to Jules when no personal Animas exist", () => {
    expect(
      resolveCodespaceCompanionId({
        animas: [],
        characters: [naruto],
        me,
      }),
    ).toBe(JULES_PERSONA.id);
  });

  it("restores a saved Anima id after load", () => {
    expect(
      resolveCodespaceCompanionId({
        savedId: "anima-2",
        animas: [serenity, lumen],
        characters: [naruto],
        me,
      }),
    ).toBe("anima-2");
  });

  it("honors ?anima= over the assigned default", () => {
    expect(
      resolveCodespaceCompanionId({
        requestedId: "anima-2",
        animas: [serenity, lumen],
        me,
      }),
    ).toBe("anima-2");
  });

  it("keeps a saved Jules selection", () => {
    expect(
      resolveCodespaceCompanionId({
        savedId: JULES_PERSONA.id,
        animas: [serenity],
        me,
      }),
    ).toBe(JULES_PERSONA.id);
  });
});

describe("toCodespaceAgentCharacter", () => {
  it("includes Anima personality, voice, and short soulprint/expression snippets", () => {
    const payload = toCodespaceAgentCharacter({
      ...serenity,
      _isAnima: true,
      _companionKind: "anima",
    });
    expect(payload).toMatchObject({
      name: "Serenity",
      personality: serenity.personality,
      speaking_style: serenity.speaking_style,
      is_anima: true,
      tagline: "Grace made flesh",
      archetype: "guardian",
    });
    expect(payload.soulprint).toContain("AR-7E2A");
    expect(payload.soulprint).toContain("Compassion");
    expect(payload.expression).toBe("Angelic");
  });

  it("does not mark Jules as an Anima", () => {
    expect(isAnimaCompanion(JULES_PERSONA)).toBe(false);
    expect(toCodespaceAgentCharacter(JULES_PERSONA)).toEqual({
      name: JULES_PERSONA.name,
      personality: JULES_PERSONA.personality,
      speaking_style: JULES_PERSONA.speaking_style,
    });
  });
});
