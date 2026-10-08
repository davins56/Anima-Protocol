import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composerFullyUnlocked,
  createComposerGate,
  sessionControlsLocked,
} from "./heldChatSend";

/**
 * Replay tests for chat bugs whose page wiring was not pinned by the helper
 * suites. Each name cites the fixing PR. Reverting that wiring should fail
 * the matching test.
 */
const chat = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Chat.jsx"),
  "utf8",
);

function excerpt(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  expect(start, `missing ${startNeedle}`).toBeGreaterThan(-1);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end, `missing ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("chat bug replay", () => {
  it("#544 reopening a generating reply blocks a second send until the check ends", () => {
    const gate = createComposerGate();
    const token = gate.beginAwait("sess");
    expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(true);
    expect(gate.snapshot().continueLocked).toBe(true);
    expect(gate.snapshot().regenerateLocked).toBe(true);
    // A typed follow-up waits. Continue and Retry must not start another generate.
    expect(gate.accept("sess", "you there?").action).toBe("held");
    expect(gate.accept("sess", "").action).toBe("ignore");
    expect(
      gate.accept("sess", { text: "you there?", replyAction: "retry", history: [] }).action,
    ).toBe("ignore");
    expect(gate.takeHeld("sess")).toBeNull();
    // The same chat's effect re-running must not mint a new lock the first release cannot clear.
    expect(gate.beginAwait("sess")).toBe(token);

    const released = gate.release("recovery_check_ended", token);
    expect(released.ignored).toBe(false);
    expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
    expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(false);
    expect(gate.takeHeld("sess")).toBe("you there?");
  });

  it("#544 a failed reply and a reopened chat take the typing bubble down and unlock send", () => {
    expect(chat).toContain("const composerBusy = isLoading || awaitingCompanion;");
    expect(chat).toContain(
      "composerBusy || sessionControlsLocked(gateSnap, activeSession?.id)",
    );

    const reopen = excerpt(
      chat,
      "awaitingSessionRef.current = sid;",
      '}, [activeSession?.id, setActiveSession]);',
    );
    const awaitAt = reopen.indexOf("gateRef.current.beginAwait(sid)");
    const busyAt = reopen.indexOf("setAwaitingCompanion(true)");
    const pollAt = reopen.indexOf("pollLateCompanionReply");
    const dropAt = reopen.indexOf(
      "dropTurnPlaceholder(\n                  dropLateTurnPlaceholder(prev.messages, waitingTurnId),\n                  waitingTurnId,",
    );
    const clearAt = reopen.indexOf("setAwaitingCompanion(false)");
    const releaseAt = reopen.indexOf('gateRef.current.release("recovery_check_ended", awaitToken)');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(busyAt).toBeGreaterThan(awaitAt);
    expect(pollAt).toBeGreaterThan(busyAt);
    expect(dropAt).toBeGreaterThan(pollAt);
    expect(clearAt).toBeGreaterThan(dropAt);
    expect(releaseAt).toBeGreaterThan(clearAt);

    // A generic failure checks the saved turn, then takes that bubble down before Retry.
    expect(chat).toContain("if (!retained && shouldCheckBackForCompanionReply(err))");
    const gaveUp = excerpt(
      chat,
      "Failed, or still no text after the full wait.",
      "toastCouldNotReply();",
    );
    expect(gaveUp).toContain("dropTurnPlaceholder(");
    expect(gaveUp).toContain("dropLateTurnPlaceholder(prev.messages, turnId)");
  });

  it("#545 a held follow-up auto-sends only after she is done", () => {
    const flush = excerpt(
      chat,
      "// Send a follow-up that was held while this conversation was replying.",
      "// A reload drops the in-memory hold.",
    );
    const waitAt = flush.indexOf(
      "if (isLoading || awaitingCompanion || sendingRef.current) return;",
    );
    const inflightAt = flush.indexOf(
      "if (snap.inFlightSessionId === sid || snap.busyRetrySessionId === sid) return;",
    );
    const takeAt = flush.indexOf("const payload = gateRef.current.takeHeld(sid);");
    const sendAt = flush.indexOf("void handleSendMessageRef.current?.(payload);");
    expect(waitAt).toBeGreaterThan(-1);
    expect(inflightAt).toBeGreaterThan(waitAt);
    expect(takeAt).toBeGreaterThan(inflightAt);
    expect(sendAt).toBeGreaterThan(takeAt);
    expect(flush).not.toContain("setComposerRestore");
  });

  it("#546 a reload puts the held follow-up back in the box and does not auto-send it", () => {
    const restore = excerpt(
      chat,
      "// A reload drops the in-memory hold.",
      "// Helper: speak a message",
    );
    expect(restore).toContain("consumeHeldDraftForOpen(browserLocalStorage()");
    expect(restore).toContain('result.action === "restore_to_input"');
    expect(restore).toContain("setComposerRestore");
    expect(restore).not.toContain("handleSendMessage");
    expect(restore).not.toContain("takeHeld");
    expect(chat).toContain(
      "composerRestore?.sessionId === activeSession.id ? composerRestore : null",
    );
  });

  it("#564 Retry discards the old companion reply instead of sending the line again", () => {
    const stitch = excerpt(chat, "const stitchThread = ", "const retryHungCompanionReply");
    expect(stitch).toContain("omitTurnIds: supersededTurnIdsRef.current");
    expect(stitch).toContain("omitMessageIds: supersededMessageIdsRef.current");

    const retry = excerpt(chat, "const retryHungCompanionReply = ", "if (!sid) return undefined;");
    const discardAt = retry.indexOf("messagesAfterDiscardingReply(source, { turnId, messageIds })");
    const sendAt = retry.indexOf("void handleSendMessageRef.current?.({");
    expect(discardAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(discardAt);
    expect(retry.slice(sendAt)).toContain('replyAction: "retry"');
    expect(retry.slice(sendAt)).toContain("replacedTurnId: turnId || \"\"");
    expect(retry.slice(sendAt)).toContain("history: trimmed");
    expect(retry).toContain("rememberSupersededReply(turnId, messageIds)");

    const metadata = excerpt(chat, "function replacementSendMetadata", "export default function Chat");
    expect(metadata).toContain("replaced_turn_id: turnId");
    expect(chat).toContain(
      "reply_action: replyAction, skip_affect: true, ...replacementSendMetadata(messageData)",
    );

    for (const call of ["retryHungCompanionReply({\n                  sessionId,", "retryHungCompanionReply({\n                  sessionId: sendSessionId,"]) {
      const at = chat.indexOf(call);
      expect(at, call).toBeGreaterThan(-1);
      const around = chat.slice(at - 280, at);
      expect(around).toContain('label: "Retry"');
      expect(around).not.toContain("handleSendMessage(");
    }
  });

  it("#566 a dropped stream keeps the painted reply through the last full sentence", () => {
    const wipeAt = chat.indexOf("// Remove typing/thinking indicators on error");
    expect(wipeAt).toBeGreaterThan(-1);
    const wiped = chat.slice(wipeAt, chat.indexOf("));", wipeAt));
    expect(wiped).toContain('m.character_name !== "__typing__"');
    expect(wiped).toContain('m.character_name !== "__thinking__"');
    expect(wiped).not.toContain("is_streaming");

    const kept = excerpt(
      chat,
      "let retained = null;",
      "if (!retained && shouldCheckBackForCompanionReply(err))",
    );
    const retainAt = kept.indexOf("retainStreamingOnError(prev.messages || [])");
    const trimAt = kept.indexOf("trimToLastFullSentence(");
    expect(retainAt).toBeGreaterThan(-1);
    expect(trimAt).toBeGreaterThan(retainAt);
    expect(kept.slice(trimAt, trimAt + 180)).toContain("finalizeAssistantReply(");
    expect(kept).toContain("reply_interrupted: true");
    expect(kept).toContain("cut_off: true");
    expect(kept).toContain("messages: [...messages, retained]");
  });
});
