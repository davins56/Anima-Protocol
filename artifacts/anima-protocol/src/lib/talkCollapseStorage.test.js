import { afterEach, describe, expect, it } from "vitest";
import {
  TALK_COLLAPSE_ANON_ID,
  TALK_COLLAPSE_PREFIX,
  readTalkCollapsed,
  talkCollapseStorageKey,
  talkCollapseUserId,
  writeTalkCollapsed,
} from "./talkCollapseStorage";

afterEach(() => {
  localStorage.clear();
});

describe("talkCollapseStorage", () => {
  it("builds a per-user, per-section key and falls back to anon", () => {
    expect(talkCollapseUserId("user_clerk123")).toBe("user_clerk123");
    expect(talkCollapseUserId("  ")).toBe(TALK_COLLAPSE_ANON_ID);
    expect(talkCollapseUserId(null)).toBe(TALK_COLLAPSE_ANON_ID);
    expect(talkCollapseUserId(undefined)).toBe(TALK_COLLAPSE_ANON_ID);
    expect(talkCollapseStorageKey("user_clerk123", "header")).toBe(
      `${TALK_COLLAPSE_PREFIX}:user_clerk123:header`,
    );
    expect(talkCollapseStorageKey(undefined, "resonance")).toBe(
      `${TALK_COLLAPSE_PREFIX}:anon:resonance`,
    );
  });

  it("persists and reads collapsed state independently per section", () => {
    expect(readTalkCollapsed("user_a", "header")).toBe(false);
    writeTalkCollapsed("user_a", "header", true);
    writeTalkCollapsed("user_a", "resonance", false);
    expect(readTalkCollapsed("user_a", "header")).toBe(true);
    expect(readTalkCollapsed("user_a", "resonance")).toBe(false);
    expect(localStorage.getItem("anima:talk:collapse:user_a:header")).toBe("1");
    expect(localStorage.getItem("anima:talk:collapse:user_a:resonance")).toBe("0");
  });

  it("keeps collapse state isolated between users", () => {
    writeTalkCollapsed("user_a", "header", true);
    expect(readTalkCollapsed("user_b", "header")).toBe(false);
    expect(readTalkCollapsed(null, "header")).toBe(false);
  });
});
