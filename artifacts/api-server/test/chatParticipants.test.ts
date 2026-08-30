import { describe, expect, it } from "vitest";
import {
  resolveActiveCharacterId,
  resolveActiveCharacterName,
} from "../src/lib/chatParticipants";

describe("resolveActiveCharacterId", () => {
  it("uses a requested id that is a conversation participant", () => {
    expect(resolveActiveCharacterId("b", ["a", "b", "c"])).toBe("b");
  });

  it("falls back to the first participant when none is requested", () => {
    expect(resolveActiveCharacterId(null, ["a", "b"])).toBe("a");
    expect(resolveActiveCharacterId(undefined, ["a", "b"])).toBe("a");
    expect(resolveActiveCharacterId("", ["a", "b"])).toBe("a");
  });

  it("ignores a requested id outside the conversation participants", () => {
    expect(resolveActiveCharacterId("outsider", ["a", "b"])).toBe("a");
  });

  it("returns null when there are no participants", () => {
    expect(resolveActiveCharacterId("a", [])).toBe(null);
    expect(resolveActiveCharacterId(null, [])).toBe(null);
  });
});

describe("resolveActiveCharacterName", () => {
  it("keeps the client name when the requested id was accepted", () => {
    expect(
      resolveActiveCharacterName({
        requestedId: "b",
        resolvedId: "b",
        requestedName: "Blake",
        loadedName: "Other",
      }),
    ).toBe("Blake");
  });

  it("drops a client name tied to a rejected non-participant id", () => {
    expect(
      resolveActiveCharacterName({
        requestedId: "outsider",
        resolvedId: "a",
        requestedName: "Outsider Name",
        loadedName: "Ada",
      }),
    ).toBe("Ada");
  });

  it("returns null when neither name is available", () => {
    expect(
      resolveActiveCharacterName({
        requestedId: "outsider",
        resolvedId: "a",
        requestedName: "Outsider Name",
        loadedName: null,
      }),
    ).toBe(null);
  });
});
