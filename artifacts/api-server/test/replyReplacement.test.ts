import { describe, expect, it } from "vitest";
import {
  messageTurnId,
  omitPersistedUserRow,
  replacedFromMessageIdOf,
  replacedMessageIdsOf,
  replyActionOf,
  shouldDiscardStoredMessage,
  turnMetadataReplaced,
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

  it("drops her reply and a listed edit, and keeps his line when only the turn matches", () => {
    expect(turnMetadataReplaced({ replaced: true })).toBe(true);
    expect(turnMetadataReplaced({ replaced: "true" })).toBe(false);
    expect(messageTurnId({ id: "turn_old:assistant:1" })).toBe("turn_old");
    expect(messageTurnId({ id: "turn_a:b:assistant:1" })).toBe("turn_a:b");
    expect(messageTurnId({ metadata: { turn_id: "turn_meta" } })).toBe("turn_meta");
    expect(replacedFromMessageIdOf({ replaced_from_message_id: " anchor " })).toBe("anchor");
    expect(replacedFromMessageIdOf({ replaced_from_message_id: "x".repeat(201) })).toBe("");
    expect(replacedMessageIdsOf({ replaced_message_ids: [" a ", "a", ""] })).toEqual(["a"]);
    expect(replacedMessageIdsOf(null)).toEqual([]);
    expect(
      replacedMessageIdsOf({
        replaced_message_ids: Array.from({ length: 45 }, (_, index) => `id-${index}`),
      }),
    ).toHaveLength(40);
    const boundary = { fromSeq: 2, messageIds: ["early", "late-user"], turnId: "t1" };
    expect(shouldDiscardStoredMessage({ id: "early", role: "user", seq: 0 }, boundary)).toBe(false);
    expect(shouldDiscardStoredMessage({ id: "late-user", role: "user", seq: 4 }, boundary)).toBe(true);
    expect(
      shouldDiscardStoredMessage({ id: "keep", role: "assistant", seq: 1, turn_id: "other" }, boundary),
    ).toBe(false);
    const target = { turnId: "turn_old", messageIds: ["edited-user"] };
    expect(
      shouldDiscardStoredMessage(
        { id: "turn_old:assistant", role: "assistant", turn_id: "turn_old" },
        target,
      ),
    ).toBe(true);
    expect(
      shouldDiscardStoredMessage({ id: "turn_old:user", role: "user", turn_id: "turn_old" }, target),
    ).toBe(false);
    expect(
      shouldDiscardStoredMessage({ id: "edited-user", role: "user" }, target),
    ).toBe(true);
    expect(
      shouldDiscardStoredMessage({ id: "turn_other:assistant", role: "assistant" }, target),
    ).toBe(false);
  });
});
