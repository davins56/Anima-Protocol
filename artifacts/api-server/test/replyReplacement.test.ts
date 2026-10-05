import { describe, expect, it } from "vitest";
import {
  omitPersistedUserRow,
  replyActionOf,
  turnSkipsAffect,
} from "../src/lib/replyReplacement";

describe("reply replacement affect guard", () => {
  it("recognises only retry and edit", () => {
    expect(replyActionOf("retry")).toBe("retry");
    expect(replyActionOf("edit")).toBe("edit");
    expect(replyActionOf("continue")).toBeNull();
    expect(replyActionOf(true)).toBeNull();
  });

  it("skips mood and memory for retry and edit, and for an explicit skip flag", () => {
    expect(turnSkipsAffect({ reply_action: "retry" })).toBe(true);
    expect(turnSkipsAffect({ reply_action: "edit" })).toBe(true);
    expect(turnSkipsAffect({ skip_affect: true })).toBe(true);
    expect(turnSkipsAffect({ reply_action: "continue" })).toBe(false);
    expect(turnSkipsAffect({})).toBe(false);
    expect(turnSkipsAffect(null)).toBe(false);
  });

  it("does not persist a second user row on retry or continue", () => {
    expect(omitPersistedUserRow({ reply_action: "retry" })).toBe(true);
    expect(omitPersistedUserRow({ is_continue: true })).toBe(true);
    expect(omitPersistedUserRow({ reply_action: "edit" })).toBe(false);
    expect(omitPersistedUserRow({})).toBe(false);
  });
});
