import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAnima: vi.fn(),
  listCharacter: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Anima: { list: mocks.listAnima },
      Character: { list: mocks.listCharacter },
    },
  },
}));

import {
  companionLookHref,
  companionPersistPatch,
  companionStoreEntity,
  isPersonalAnimaRecord,
  loadCompanionRecord,
  mergePersonalCompanions,
  selectPersonalAnima,
} from "./listPersonalAnimas";

describe("isPersonalAnimaRecord", () => {
  it("accepts explicit Anima flags and construct categories", () => {
    expect(isPersonalAnimaRecord({ _isAnima: true, name: "Serenity" })).toBe(
      true,
    );
    expect(isPersonalAnimaRecord({ category: "anima-construct" })).toBe(true);
    expect(isPersonalAnimaRecord({ category: "Anima" })).toBe(true);
  });

  it("accepts companions created from the AI Companion Generator", () => {
    expect(
      isPersonalAnimaRecord({
        name: "Nyx",
        universe: "Original",
        creation_method: "ai_prompt",
      }),
    ).toBe(true);
  });

  it("rejects roster characters and empty rows", () => {
    expect(isPersonalAnimaRecord(null)).toBe(false);
    expect(
      isPersonalAnimaRecord({ name: "Naruto", universe: "Naruto" }),
    ).toBe(false);
    expect(isPersonalAnimaRecord({ category: "warrior" })).toBe(false);
  });
});

describe("mergePersonalCompanions", () => {
  it("keeps generator-created characters even when an Anima already exists", () => {
    const merged = mergePersonalCompanions(
      [
        {
          id: "anima-1",
          name: "Serenity",
          created_date: "2026-01-01T00:00:00.000Z",
        },
      ],
      [
        {
          id: "char-nyx",
          name: "Nyx",
          creation_method: "ai_prompt",
          created_date: "2026-09-05T00:00:00.000Z",
        },
        {
          id: "char-naruto",
          name: "Naruto",
          universe: "Naruto",
          created_date: "2026-09-04T00:00:00.000Z",
        },
      ],
    );
    expect(merged.map((row) => row.id)).toEqual(["char-nyx", "anima-1"]);
    expect(companionStoreEntity(merged[0])).toBe("Character");
    expect(companionStoreEntity(merged[1])).toBe("Anima");
  });
});

describe("companionLookHref", () => {
  it("deep-links the look tab for a new companion", () => {
    expect(companionLookHref("char-nyx")).toBe(
      "/customise-anima?anima=char-nyx&tab=look",
    );
    expect(companionLookHref("")).toBe("/customise-anima?tab=look");
  });
});

describe("selectPersonalAnima", () => {
  const rows = [
    { id: "anima-1", name: "Lumen", assigned_user: "other@example.com" },
    { id: "anima-2", name: "Serenity", assigned_user: "operator@example.com" },
  ];

  it("honors a requested id, then assigned_user, then the first row", () => {
    expect(selectPersonalAnima(rows, "anima-1", { email: "operator@example.com" })?.id).toBe(
      "anima-1",
    );
    expect(selectPersonalAnima(rows, null, { email: "operator@example.com" })?.id).toBe(
      "anima-2",
    );
    expect(selectPersonalAnima(rows, null, { email: "nobody@example.com" })?.id).toBe(
      "anima-1",
    );
  });
});

describe("loadCompanionRecord", () => {
  beforeEach(() => {
    mocks.listAnima.mockReset().mockResolvedValue([]);
    mocks.listCharacter.mockReset().mockResolvedValue([]);
  });

  it("falls back to Character when Anima.list does not have the companion", async () => {
    mocks.listCharacter.mockResolvedValue([
      { id: "char-aelindra", name: "Aelindra", creation_method: "ai_prompt" },
    ]);

    const row = await loadCompanionRecord("char-aelindra", "Anima");
    expect(row?.name).toBe("Aelindra");
    expect(companionStoreEntity(row)).toBe("Character");
  });
});

describe("companionPersistPatch", () => {
  it("drops picker-only flags before a store write", () => {
    expect(
      companionPersistPatch({
        name: "Aelindra",
        avatar_url: "https://example.com/a.png",
        _storeEntity: "Character",
        _isAnima: true,
        _bundled: true,
      }),
    ).toEqual({
      name: "Aelindra",
      avatar_url: "https://example.com/a.png",
    });
  });
});
