/**
 * Wiring guards for chat bugs that already shipped.
 * If a refactor breaks one, update it to the new wiring. Do not delete it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { messagesAfterDiscardingReply } from "./chatReplyActions";
import {
  composerFullyUnlocked,
  consumeHeldDraftForOpen,
  createComposerGate,
  sessionControlsLocked,
  writeHeldDraft,
} from "./heldChatSend";
import { dropLateTurnPlaceholder, dropTurnPlaceholder } from "./lateCompanionReply";
import { retainStreamingOnError } from "./retainStreamingOnError";
import { trimToLastFullSentence } from "./visibleAssistantReply";

const chatSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Chat.jsx"),
  "utf8",
);

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

const chat = stripComments(chatSource);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match `needle` with any whitespace, including a line break, between tokens. */
function findCode(source, needle, from = 0) {
  const pattern = needle
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s*");
  const match = new RegExp(pattern, "g");
  match.lastIndex = from;
  const found = match.exec(source);
  if (!found) return null;
  return { index: found.index, end: found.index + found[0].length };
}

function expectCode(source, needle) {
  const found = findCode(source, needle);
  expect(found, needle).not.toBeNull();
  return found;
}

function expectOrder(source, needles) {
  let from = 0;
  for (const needle of needles) {
    const found = findCode(source, needle, from);
    expect(found, needle).not.toBeNull();
    from = found.end;
  }
}

function matchingCloser(source, openIndex, open, close) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\" ) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function blockFromBrace(source, openIndex) {
  const close = matchingCloser(source, openIndex, "{", "}");
  expect(close).toBeGreaterThan(openIndex);
  return source.slice(openIndex, close + 1);
}

function enclosingBlock(source, needle) {
  const hit = expectCode(source, needle);
  const stack = [];
  let quote = null;
  for (let i = 0; i < hit.index; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") stack.push(i);
    else if (ch === "}") stack.pop();
  }
  expect(stack.length, needle).toBeGreaterThan(0);
  return blockFromBrace(source, stack[stack.length - 1]);
}

function arrowBlock(source, name) {
  const hit = expectCode(source, `const ${name} =`);
  const arrow = source.indexOf("=>", hit.index);
  const open = source.indexOf("{", arrow);
  return blockFromBrace(source, open);
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(String(key), String(value)),
    removeItem: (key) => map.delete(key),
  };
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
    const messages = [
      { turn_id: "older", role: "user", content: "earlier" },
      { turn_id: "turn_a", role: "user", content: "hello" },
      { turn_id: "turn_a", character_name: "__typing__", content: "..." },
      { late_turn_id: "turn_a", character_name: "__typing__", content: "..." },
      { turn_id: "turn_b", character_name: "__thinking__", content: "..." },
    ];
    const next = dropTurnPlaceholder(dropLateTurnPlaceholder(messages, "turn_a"), "turn_a");
    expect(next).toEqual([messages[0], messages[1], messages[4]]);

    expectCode(chat, "const composerBusy = isLoading || awaitingCompanion");
    expectCode(chat, "composerBusy || sessionControlsLocked(gateSnap, activeSession?.id)");

    const reopen = enclosingBlock(chat, "beginAwait(sid)");
    expectOrder(reopen, [
      "beginAwait(sid)",
      "setAwaitingCompanion(true)",
      "pollLateCompanionReply",
      "dropTurnPlaceholder( dropLateTurnPlaceholder(prev.messages, waitingTurnId), waitingTurnId",
      "setAwaitingCompanion(false)",
      'release("recovery_check_ended", awaitToken)',
    ]);

    const gaveUp = enclosingBlock(chat, "shouldCheckBackForCompanionReply(err)");
    const missed = (() => {
      const start = expectCode(gaveUp, "if (!adopted)");
      const end = findCode(gaveUp, "toastCouldNotReply()", start.end);
      expect(end, "toastCouldNotReply()").not.toBeNull();
      return gaveUp.slice(start.index, end.index);
    })();
    expectOrder(missed, [
      "dropTurnPlaceholder(",
      "dropLateTurnPlaceholder(prev.messages, turnId)",
    ]);
  });

  it("#545 a held follow-up auto-sends only after she is done", () => {
    const gate = createComposerGate();
    const started = gate.accept("sess", "hello");
    expect(gate.accept("sess", "you there?").action).toBe("held");
    expect(gate.takeHeld("sess")).toBeNull();
    const released = gate.release("reply_finished", started.ownerToken);
    expect(released.ignored).toBe(false);
    expect(gate.takeHeld("sess")).toBe("you there?");

    const flush = enclosingBlock(chat, "takeHeld(sid)");
    expectOrder(flush, [
      "isLoading || awaitingCompanion || sendingRef.current",
      "inFlightSessionId === sid",
      "busyRetrySessionId === sid",
      "takeHeld(sid)",
      "handleSendMessageRef.current?.(payload)",
    ]);
    expect(findCode(flush, "setComposerRestore")).toBeNull();
  });

  it("#546 a reload puts the held follow-up back in the box and does not auto-send it", () => {
    const storage = memoryStorage();
    writeHeldDraft(storage, "user_a", "sess", "you there?");
    const restored = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
    });
    expect(restored.action).toBe("restore_to_input");
    expect(restored.send).toBe(false);
    expect(restored.draft.text).toBe("you there?");

    const gate = createComposerGate();
    gate.accept("sess", "hello");
    gate.accept("sess", "still waiting");
    const live = consumeHeldDraftForOpen(storage, {
      userId: "user_a",
      sessionId: "sess",
      inMemoryPayload: gate.snapshot().heldBySession.sess.payload,
    });
    expect(live.action).toBe("keep_in_memory");
    expect(live.send).toBe(false);

    const restore = enclosingBlock(chat, "consumeHeldDraftForOpen(");
    expectOrder(restore, [
      "consumeHeldDraftForOpen(",
      'result.action === "restore_to_input"',
      "setComposerRestore",
    ]);
    expect(findCode(restore, "handleSendMessage")).toBeNull();
    expect(findCode(restore, "takeHeld")).toBeNull();
    expectCode(
      chat,
      "composerRestore?.sessionId === activeSession.id ? composerRestore : null",
    );
  });

  it("#564 Retry discards the old companion reply instead of sending the line again", () => {
    const next = messagesAfterDiscardingReply(
      [
        { id: "t1:user", turn_id: "t1", role: "user", content: "hello" },
        { id: "t1:assistant", turn_id: "t1", role: "assistant", content: "old reply" },
        { turn_id: "t1", role: "assistant", content: "...", character_name: "__typing__" },
        { id: "t2:assistant", turn_id: "t2", role: "assistant", content: "later" },
      ],
      { turnId: "t1" },
    );
    expect(next.map((message) => message.content)).toEqual(["hello", "later"]);

    const retry = arrowBlock(chat, "retryHungCompanionReply");
    expectOrder(retry, [
      "rememberSupersededReply(turnId, messageIds)",
      "messagesAfterDiscardingReply(source, { turnId, messageIds })",
      "handleSendMessageRef.current?.({",
      'replyAction: "retry"',
      "history: trimmed",
      'replacedTurnId: turnId || ""',
    ]);

    const stitchStart = expectCode(chat, "const stitchThread");
    const stitchEnd = findCode(chat, "const retryHungCompanionReply", stitchStart.end);
    expect(stitchEnd).not.toBeNull();
    expectOrder(chat.slice(stitchStart.index, stitchEnd.index), [
      "omitTurnIds: supersededTurnIdsRef.current",
      "omitMessageIds: supersededMessageIdsRef.current",
    ]);

    const metadataStart = expectCode(chat, "function replacementSendMetadata");
    const metadataEnd = findCode(chat, "export default function Chat", metadataStart.end);
    expect(metadataEnd).not.toBeNull();
    expectCode(chat.slice(metadataStart.index, metadataEnd.index), "replaced_turn_id: turnId");
    expectCode(
      chat,
      "reply_action: replyAction, skip_affect: true, ...replacementSendMetadata(messageData)",
    );

    const callRe = /retryHungCompanionReply\s*\(/g;
    const calls = [];
    let call;
    while ((call = callRe.exec(chat))) calls.push(call.index);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const at of calls) {
      const labelAt = chat.lastIndexOf("label:", at);
      expect(labelAt).toBeGreaterThan(-1);
      const between = chat.slice(labelAt, at);
      expect(between).toMatch(/label\s*:\s*["']Retry["']/);
      expect(between).not.toMatch(/handleSendMessage\s*\(/);
    }
  });

  it("#566 a dropped stream keeps the painted reply through the last full sentence", () => {
    expect(trimToLastFullSentence("You came back. I was thin")).toBe("You came back.");
    const { messages, retained } = retainStreamingOnError([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: "You came back. I was thin",
        character_name: "Aria",
        is_streaming: true,
      },
      { role: "assistant", content: "...", character_name: "__typing__" },
    ]);
    expect(retained).toMatchObject({
      content: "You came back.",
      is_streaming: false,
      reply_interrupted: true,
      cut_off: true,
    });
    expect(messages.map((message) => message.content)).toEqual(["hello", "You came back."]);

    const retain = expectCode(chat, "retainStreamingOnError(");
    const check = findCode(chat, "!retained && shouldCheckBackForCompanionReply(err)", retain.end);
    expect(check).not.toBeNull();
    expectOrder(chat.slice(retain.index, check.end), [
      "retainStreamingOnError(",
      "trimToLastFullSentence(",
      "finalizeAssistantReply(",
      "reply_interrupted: true",
      "cut_off: true",
      "!retained && shouldCheckBackForCompanionReply(err)",
    ]);

    const typingAt = chat.lastIndexOf('character_name !== "__typing__"', retain.index);
    expect(typingAt).toBeGreaterThan(-1);
    const filterAt = chat.lastIndexOf("filter(", typingAt);
    const filterOpen = chat.indexOf("(", filterAt);
    const filterClose = matchingCloser(chat, filterOpen, "(", ")");
    const callback = chat.slice(filterOpen, filterClose + 1);
    expect(callback).toMatch(/__typing__/);
    expect(callback).toMatch(/__thinking__/);
    expect(callback).not.toMatch(/is_streaming/);
  });
});
