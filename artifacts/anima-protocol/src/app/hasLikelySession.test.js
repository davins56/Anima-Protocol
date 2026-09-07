import { afterEach, describe, expect, it } from "vitest";
import { hasLikelySession } from "../App.full.jsx";

describe("hasLikelySession", () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = "__client_uat=; Max-Age=0; path=/";
  });

  it("is false for a cold guest", () => {
    expect(hasLikelySession()).toBe(false);
  });

  it("is true when a companion was already opened this tab", () => {
    sessionStorage.setItem("anima_has_companion", "1");
    expect(hasLikelySession()).toBe(true);
  });

  it("is true when Clerk reports a signed-in client uat", () => {
    document.cookie = "__client_uat=1710000000; path=/";
    expect(hasLikelySession()).toBe(true);
  });

  it("is false when Clerk uat is zero (signed out)", () => {
    document.cookie = "__client_uat=0; path=/";
    expect(hasLikelySession()).toBe(false);
  });
});
