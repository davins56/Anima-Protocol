import { describe, expect, it } from "vitest";
import {
  displayNameFromAccount,
  firstNonEmpty,
  mergeAccountIdentity,
} from "./accountIdentity";

describe("firstNonEmpty", () => {
  it("skips blank strings and returns the first trimmed value", () => {
    expect(firstNonEmpty("", "  ", "ada@example.com")).toBe("ada@example.com");
    expect(firstNonEmpty(null, undefined, "  Seeker  ")).toBe("Seeker");
    expect(firstNonEmpty("", "   ")).toBe("");
  });
});

describe("mergeAccountIdentity", () => {
  it("keeps Clerk email/name when the store profile is empty strings", () => {
    const merged = mergeAccountIdentity(
      { id: "user_1", email: "davins56@hotmail.com", full_name: "Dàvīn Smith" },
      { id: "user_1", email: "", full_name: "", role: "User" },
      { email: "", full_name: "", selected_mode: "companion", display_name: "" },
    );
    expect(merged.email).toBe("davins56@hotmail.com");
    expect(merged.full_name).toBe("Dàvīn Smith");
    expect(merged.display_name).toBe("Dàvīn Smith");
    expect(merged.selected_mode).toBe("companion");
    expect(merged.role).toBe("User");
  });

  it("prefers a saved display_name over Clerk full_name", () => {
    const merged = mergeAccountIdentity(
      { full_name: "Dàvīn Smith", display_name: "" },
      { display_name: "Operator", settings: { theme_mode: "dark" } },
    );
    expect(merged.display_name).toBe("Operator");
    expect(merged.full_name).toBe("Dàvīn Smith");
    expect(merged.settings).toEqual({ theme_mode: "dark" });
  });
});

describe("displayNameFromAccount", () => {
  it("falls back from display_name to full_name", () => {
    expect(displayNameFromAccount({ display_name: "Op", full_name: "Ada" })).toBe(
      "Op",
    );
    expect(displayNameFromAccount({ full_name: "Ada" })).toBe("Ada");
  });
});
