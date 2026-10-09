import { describe, expect, it } from "vitest";
import {
  COMPOSER_TERMINAL_REASONS,
  HELD_DRAFT_MAX_AGE_MS,
  HELD_SEND_NOTE,
  RESTORED_HELD_ATTACHMENT_NOTE,
  RESTORED_HELD_NOTE,
  browserLocalStorage,
  clearHeldDraft,
  clearHeldDraftIfUnchanged,
  combineOutgoingPayload,
  composerFullyUnlocked,
  composerTerminalReason,
  consumeHeldDraftForOpen,
  createComposerGate,
  dropAppliedComposerRestore,
  heldDraftStorageKey,
  isConversationBusyError,
  isReplyReplaceFailed,
  liveTurnStillBlocking,
  mergeDraftIntoComposer,
  omitTurnMessages,
  readHeldDraft,
  sessionControlsLocked,
  writeHeldDraft,
} from "./heldChatSend";

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

function throwingStorage(method) {
  const storage = memoryStorage();
  return new Proxy(storage, {
    get(target, prop) {
      if (prop === method) {
        return () => {
          throw new Error("QuotaExceededError");
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function gateWithStorage(storage, userId) {
  return createComposerGate({
    onHeldChange(sessionId, payload) {
      if (payload == null) clearHeldDraft(storage, userId, sessionId);
      else writeHeldDraft(storage, userId, sessionId, payload);
    },
  });
}

function sendThenHold(gate, sessionId, first, ...rest) {
  const started = gate.accept(sessionId, first);
  expect(started.action).toBe("send");
  for (const next of rest) {
    expect(gate.accept(sessionId, next).action).toBe("held");
  }
  return started;
}

describe("held chat send", () => {
  it("auto-sends the held message after the reply completes", () => {
    const gate = createComposerGate();
    const started = sendThenHold(gate, "sess", "hello", "you there?");
    const released = gate.release("reply_finished", started.ownerToken);
    expect(released.ignored).toBe(false);
    expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
    expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(false);
    expect(gate.takeHeld("sess")).toBe("you there?");
    expect(gate.snapshot().heldBySession.sess).toBeUndefined();
  });

  it("sends the held message after an error, the 90s timeout, and the recovery check", () => {
    for (const reason of ["error", "first_token_timeout", "recovery_check_ended"]) {
      const gate = createComposerGate();
      const started = sendThenHold(gate, "sess", "first", "still here");
      gate.release(reason, started.ownerToken);
      expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
      expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(false);
      expect(gate.takeHeld("sess")).toBe("still here");
    }
    expect(COMPOSER_TERMINAL_REASONS).toEqual([
      "reply_finished",
      "error",
      "first_token_timeout",
      "recovery_check_ended",
    ]);
  });

  it("does not queue a retry or edit as another user turn while she is replying", () => {
    const gate = createComposerGate();
    gate.accept("sess", "hello");
    const retry = gate.accept("sess", { text: "hello", replyAction: "retry", history: [] });
    const edit = gate.accept("sess", { text: "rewritten", replyAction: "edit", history: [] });
    expect(retry.action).toBe("ignore");
    expect(edit.action).toBe("ignore");
    expect(gate.snapshot().heldBySession.sess).toBeUndefined();
  });

  it("keeps the text box usable while Continue and regenerate stay locked", () => {
    const gate = createComposerGate();
    sendThenHold(gate, "sess", "hello", "one more");
    const snap = gate.snapshot();
    expect(snap.textLocked).toBe(false);
    expect(snap.continueLocked).toBe(true);
    expect(snap.regenerateLocked).toBe(true);
    expect(sessionControlsLocked(snap, "sess")).toBe(true);
    expect(snap.heldBySession.sess.text).toBe("one more");
    expect(snap.heldBySession.sess.text).not.toMatch(/one reply ahead/i);
  });

  it("combines several follow-ups into one turn", () => {
    const gate = createComposerGate();
    sendThenHold(gate, "sess", "hello", "you there?", "I miss you");
    expect(gate.snapshot().heldBySession.sess.text).toBe("you there?\n\nI miss you");
    expect(combineOutgoingPayload("a", { text: "b", attachments: [{ type: "image" }] })).toEqual({
      text: "a\n\nb",
      attachments: [{ type: "image" }],
    });
  });

  it("cancel drops the held message so nothing sends when the reply ends", () => {
    const gate = createComposerGate();
    const started = sendThenHold(gate, "sess", "hello", "wait", "actually never mind");
    const heldId = gate.snapshot().heldBySession.sess.id;
    gate.cancel("sess", heldId);
    expect(gate.snapshot().heldBySession.sess).toBeUndefined();
    gate.release("reply_finished", started.ownerToken);
    expect(gate.takeHeld("sess")).toBeNull();
    expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
  });

  it("keeps a busy refusal held and retries only after the in-flight turn clears", () => {
    const gate = createComposerGate();
    const started = sendThenHold(gate, "sess", "hello", "also this");
    const busy = Object.assign(
      new Error("The companion is still finishing the last reply. Wait a moment, then try again."),
      { code: "conversation_busy", status: 409 },
    );
    expect(isConversationBusyError(busy)).toBe(true);
    expect(composerTerminalReason(busy)).toBe("error");
    gate.noteBusy("sess", "hello", started.ownerToken);
    const snap = gate.snapshot();
    expect(snap.textLocked).toBe(false);
    expect(snap.busyRetrySessionId).toBe("sess");
    expect(sessionControlsLocked(snap, "sess")).toBe(true);
    expect(snap.heldBySession.sess.text).toBe("hello\n\nalso this");
    expect(gate.takeHeld("sess")).toBeNull();
    expect(gate.accept("sess", "and this").action).toBe("held");
    expect(gate.snapshot().heldBySession.sess.text).toBe("hello\n\nalso this\n\nand this");

    expect(liveTurnStillBlocking({ turn_id: "t1", persistence_status: "pending" })).toBe(true);
    expect(
      liveTurnStillBlocking({
        turn_id: "t1",
        persistence_status: "pending",
        assistant_content: "I'm here.",
      }),
    ).toBe(false);
    expect(liveTurnStillBlocking({ turn_id: "t1", persistence_status: "failed" })).toBe(false);
    expect(liveTurnStillBlocking(null)).toBe(false);

    gate.clearBusyRetry("sess");
    expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(false);
    expect(gate.takeHeld("sess")).toBe("hello\n\nalso this\n\nand this");
  });

  it("does not treat a busy refusal as a hard error toast path", () => {
    expect(isConversationBusyError(new Error("No LLM provider has remaining quota."))).toBe(false);
    expect(isConversationBusyError(null)).toBe(false);
    expect(
      isReplyReplaceFailed(
        Object.assign(new Error("Could not replace the previous reply. Try again."), {
          code: "reply_replace_failed",
          status: 503,
        }),
      ),
    ).toBe(true);
    expect(isReplyReplaceFailed(Object.assign(new Error("busy"), { code: "conversation_busy" }))).toBe(
      false,
    );
    expect(isReplyReplaceFailed(null)).toBe(false);
    const removed = omitTurnMessages(
      [
        { turn_id: "keep", role: "user", content: "earlier" },
        { turn_id: "turn_busy", role: "user", content: "hello" },
        { turn_id: "turn_busy", character_name: "__thinking__", content: "..." },
      ],
      "turn_busy",
    );
    expect(removed.map((message) => message.content)).toEqual(["earlier"]);
  });

  it("maps timeout and recovery onto unlock reasons", () => {
    const timeout = Object.assign(new Error("The companion took too long to reply."), {
      code: "chat_stream_timeout",
    });
    expect(composerTerminalReason(timeout)).toBe("first_token_timeout");
    expect(composerTerminalReason(timeout, { recovered: true })).toBe("recovery_check_ended");
    expect(composerTerminalReason(new Error("nope"))).toBe("error");
  });

  it("uses one waiting note", () => {
    expect(HELD_SEND_NOTE).toBe("Sends when she's done");
    expect(HELD_SEND_NOTE).not.toMatch(/one reply ahead/i);
  });

  it("persists a held follow-up per account and clears it when that turn sends", () => {
    const storage = memoryStorage();
    const gate = gateWithStorage(storage, "user_a");
    const started = sendThenHold(gate, "sess", "hello", "you there?", "I miss you");
    expect(readHeldDraft(storage, "user_a", "sess")?.text).toBe("you there?\n\nI miss you");
    expect(readHeldDraft(storage, "user_b", "sess")).toBeNull();
    expect(heldDraftStorageKey("user_a", "sess")).not.toBe(heldDraftStorageKey("user_b", "sess"));
    gate.release("reply_finished", started.ownerToken);
    expect(gate.takeHeld("sess")).toBe("you there?\n\nI miss you");
    expect(readHeldDraft(storage, "user_a", "sess")).toBeNull();
  });

  it("clears the saved follow-up when the hold is cancelled", () => {
    const storage = memoryStorage();
    const gate = gateWithStorage(storage, "user_a");
    sendThenHold(gate, "sess", "hello", "wait", "actually never mind");
    expect(readHeldDraft(storage, "user_a", "sess")?.text).toBe("wait\n\nactually never mind");
    const heldId = gate.snapshot().heldBySession.sess.id;
    gate.cancel("sess", heldId);
    expect(readHeldDraft(storage, "user_a", "sess")).toBeNull();
    expect(gate.takeHeld("sess")).toBeNull();
  });

  it("restores a saved draft into the composer after reload and does not send it", () => {
    const storage = memoryStorage();
    const sent = [];
    const gate = gateWithStorage(storage, "user_a");
    sendThenHold(gate, "sess", "hello", {
      text: "look at this",
      attachments: [
        { url: "/api/storage/objects/uploads/pic", type: "image", name: "pic.png" },
        { type: "pdf", id: "pdf_1", name: "notes.pdf" },
        { url: "blob:http://localhost/temp", type: "image", name: "local.png" },
      ],
    });
    const saved = readHeldDraft(storage, "user_a", "sess");
    expect(saved?.text).toBe("look at this");
    expect(saved?.attachments).toEqual([
      { url: "/api/storage/objects/uploads/pic", type: "image", name: "pic.png" },
    ]);
    expect(saved?.droppedAttachmentCount).toBe(2);

    const reloaded = createComposerGate();
    const result = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      inMemoryPayload: reloaded.snapshot().heldBySession.sess?.payload ?? null,
      alreadyClaimed: false,
    });
    expect(result.action).toBe("restore_to_input");
    expect(result.send).toBe(false);
    const merged = mergeDraftIntoComposer({ text: "", attachments: [] }, result.draft);
    expect(merged.text).toBe("look at this");
    expect(merged.attachments).toEqual([
      { url: "/api/storage/objects/uploads/pic", type: "image", name: "pic.png" },
    ]);
    expect(merged.note).toBe(RESTORED_HELD_ATTACHMENT_NOTE);
    expect(sent).toEqual([]);
    expect(reloaded.takeHeld("sess")).toBeNull();
    expect(readHeldDraft(storage, "user_a", "sess")?.text).toBe("look at this");
    reloaded.release("reply_finished", 1);
    expect(reloaded.takeHeld("sess")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("restores again on a later reload, and drops the copy after it is sent", () => {
    const storage = memoryStorage();
    const savedAt = Date.now();
    writeHeldDraft(storage, "user_a", "sess", "you there?", savedAt);
    const first = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      alreadyClaimed: false,
    });
    expect(first.action).toBe("restore_to_input");
    expect(first.send).toBe(false);
    expect(readHeldDraft(storage, "user_a", "sess")?.text).toBe("you there?");

    const again = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      alreadyClaimed: false,
    });
    expect(again.action).toBe("restore_to_input");
    expect(again.draft.text).toBe("you there?");
    expect(mergeDraftIntoComposer({ text: "you there?", attachments: [] }, again.draft).text).toBe(
      "you there?",
    );

    clearHeldDraftIfUnchanged(storage, "user_a", "sess", first.draft.savedAt);
    const afterSend = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      alreadyClaimed: false,
    });
    expect(afterSend.action).toBe("none");
    expect(afterSend.claim).toBe(false);
    expect(readHeldDraft(storage, "user_a", "sess")).toBeNull();
  });

  it("does not delete a newer draft saved by another tab", () => {
    const storage = memoryStorage();
    const older = Date.now() - 5_000;
    const newer = Date.now();
    writeHeldDraft(storage, "user_a", "sess", "first", older);
    const read = readHeldDraft(storage, "user_a", "sess", newer);
    expect(read.savedAt).toBe(older);
    writeHeldDraft(storage, "user_a", "sess", "from the other tab", newer);
    const cleared = clearHeldDraftIfUnchanged(storage, "user_a", "sess", read.savedAt);
    expect(cleared.reason).toBe("changed");
    expect(readHeldDraft(storage, "user_a", "sess")?.text).toBe("from the other tab");
  });

  it("does not treat an empty look as claimed, so a later save can restore", () => {
    const storage = memoryStorage();
    const first = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      alreadyClaimed: false,
    });
    expect(first).toMatchObject({ action: "none", claim: false, send: false });
    writeHeldDraft(storage, "user_a", "sess", "from the other tab");
    const later = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      alreadyClaimed: first.claim,
    });
    expect(later.action).toBe("restore_to_input");
    expect(later.draft.text).toBe("from the other tab");
    expect(dropAppliedComposerRestore({ token: "user_a:sess" }, { token: "user_a:sess" })).toBeNull();
  });

  it("keeps an in-memory hold on the auto-send path instead of copying it into the box", () => {
    const storage = memoryStorage();
    const gate = gateWithStorage(storage, "user_a");
    const started = sendThenHold(gate, "sess", "hello", "you there?");
    const result = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      inMemoryPayload: gate.snapshot().heldBySession.sess.payload,
      alreadyClaimed: false,
    });
    expect(result.action).toBe("keep_in_memory");
    expect(result.send).toBe(false);
    gate.release("reply_finished", started.ownerToken);
    expect(gate.takeHeld("sess")).toBe("you there?");
  });

  it("appends a restored line when the box already has text", () => {
    const merged = mergeDraftIntoComposer(
      { text: "already typing", attachments: [] },
      { text: "you there?", attachments: [], droppedAttachmentCount: 0 },
    );
    expect(merged.text).toBe("already typing\n\nyou there?");
    expect(merged.note).toBe(RESTORED_HELD_NOTE);

    const same = mergeDraftIntoComposer(
      { text: "you there?", attachments: [] },
      { text: "you there?", attachments: [], droppedAttachmentCount: 0 },
    );
    expect(same.text).toBe("you there?");
    expect(same.note).toBe("");
  });

  it("drops a saved follow-up older than 24 hours", () => {
    const storage = memoryStorage();
    const now = Date.now();
    writeHeldDraft(storage, "user_a", "sess-old", "yesterday", now - HELD_DRAFT_MAX_AGE_MS - 1000);
    writeHeldDraft(storage, "user_a", "sess-fresh", "today", now);
    expect(readHeldDraft(storage, "user_a", "sess-old", now)).toBeNull();
    expect(storage.getItem(heldDraftStorageKey("user_a", "sess-old"))).toBeNull();
    expect(readHeldDraft(storage, "user_a", "sess-fresh", now)?.text).toBe("today");
    expect(storage.getItem(heldDraftStorageKey("user_a", "sess-old"))).toBeNull();
  });

  it("keeps chatting when storage is missing or throws", () => {
    expect(writeHeldDraft(null, "user_a", "sess", "hi").ok).toBe(false);
    expect(readHeldDraft(null, "user_a", "sess")).toBeNull();
    expect(clearHeldDraft(null, "user_a", "sess").ok).toBe(false);
    expect(() => writeHeldDraft(throwingStorage("setItem"), "user_a", "sess", "hi")).not.toThrow();
    expect(writeHeldDraft(throwingStorage("setItem"), "user_a", "sess", "hi").ok).toBe(false);
    expect(readHeldDraft(throwingStorage("getItem"), "user_a", "sess")).toBeNull();
    expect(clearHeldDraft(throwingStorage("removeItem"), "user_a", "sess").ok).toBe(false);

    const gate = createComposerGate({
      onHeldChange() {
        throw new Error("QuotaExceededError");
      },
    });
    const started = sendThenHold(gate, "sess", "hello", "you there?");
    expect(gate.snapshot().heldBySession.sess.text).toBe("you there?");
    gate.release("reply_finished", started.ownerToken);
    expect(gate.takeHeld("sess")).toBe("you there?");
    expect(browserLocalStorage()).not.toBeNull();
  });

  it("does not let an older turn unlock a newer send", () => {
    const gate = createComposerGate();
    const first = gate.accept("sess-a", "hello");
    gate.detachSession("sess-a");
    const second = gate.accept("sess-b", "other chat");
    expect(gate.release("reply_finished", first.ownerToken).ignored).toBe(true);
    expect(gate.snapshot().inFlightSessionId).toBe("sess-b");
    expect(sessionControlsLocked(gate.snapshot(), "sess-b")).toBe(true);
    gate.release("reply_finished", second.ownerToken);
    expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
  });
});
