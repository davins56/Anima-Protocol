import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pkgRoot = process.cwd();
const chat = readFileSync(path.join(pkgRoot, "src/pages/Chat.jsx"), "utf8");
const editFlow = readFileSync(path.join(pkgRoot, "src/lib/chatEditHandlers.js"), "utf8");
const retryFlow = readFileSync(path.join(pkgRoot, "src/lib/chatRewindHandlers.js"), "utf8");
const server = readFileSync(
  path.join(pkgRoot, "../api-server/src/routes/chat.ts"),
  "utf8",
);

describe("retry and edit stay on the one send path", () => {
  it("asks for a new reply and does not leave edit as a text-only rewrite", () => {
    expect(chat).toContain("editMessageFlow");
    expect(chat).toContain("regenerateMessageFlow");
    expect(editFlow).toContain('replyAction: "edit"');
    expect(retryFlow).toContain('replyAction: "retry"');
    expect(editFlow).not.toContain("content: newText");
    expect(chat).toContain("reply_action: replyAction, skip_affect: true");
    expect(chat).toContain('const omitUserRow = isContinue || replyAction === "retry"');
    expect(chat).toContain("actionsDisabled={replyActionsDisabled}");
  });

  it("hides a hung reply before the fresh read and restores every suffix id", () => {
    const start = chat.indexOf("const retryHungCompanionReply");
    const end = chat.indexOf("useEffect", start);
    const fn = chat.slice(start, end);
    const mark = fn.indexOf("rememberSupersededReply(turnId, knownIds)");
    const read = fn.indexOf("ChatSession.get(sessionId)");
    const claimed = fn.indexOf("hungRetryInFlightRef.current = true");
    expect(fn.indexOf("if (hungRetryInFlightRef.current) return")).toBeGreaterThan(-1);
    expect(claimed).toBeGreaterThan(-1);
    expect(claimed).toBeLessThan(read);
    expect(mark).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(mark);
    expect(fn).toContain("releaseDiscardedIds");
    expect(fn).toContain("suffix?.replacedTurnIds");
    expect(fn).toContain("keepArrivals(trimmed, again.messages");
    expect(fn).toContain("activeSessionRef.current?.id === sessionId");
    const restoreStart = fn.indexOf("const restore = async");
    const restoreEnd = fn.indexOf("rememberDiscardedIds", restoreStart);
    expect(restoreStart).toBeGreaterThan(-1);
    expect(restoreEnd).toBeGreaterThan(restoreStart);
    const restoreBody = fn.slice(restoreStart, restoreEnd);
    expect(restoreBody).toContain("messages: source");
    expect(restoreBody).toContain("keep_arrivals: true");
    const trimAt = fn.indexOf("messages: toSave");
    expect(trimAt).toBeGreaterThan(restoreEnd);
    expect(fn.slice(trimAt - 120, trimAt + 80)).not.toContain("keep_arrivals");
    expect(fn.indexOf("await restore()", trimAt)).toBeGreaterThan(trimAt);
  });

  it("restores the previous thread when replacement fails before the stream", () => {
    const helperStart = chat.indexOf("const restorePriorMessages");
    const helperEnd = chat.indexOf("if (settled)", helperStart);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = chat.slice(helperStart, helperEnd);
    expect(helper).toContain("keep_arrivals: true");
    expect(helper).toContain("messageData.priorMessages");
    const start = chat.indexOf("} else if (replyAction && isReplyReplaceFailed(err))");
    const end = chat.indexOf("return { started: false }", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = chat.slice(start, end + "return { started: false }".length);
    const fail = branch.indexOf("isReplyReplaceFailed(err)");
    const call = branch.indexOf("await restorePriorMessages();", fail);
    expect(call).toBeGreaterThan(fail);
    expect(branch.indexOf("return { started: false }", call)).toBeGreaterThan(call);
    expect(branch).toContain("releaseDiscardedIds");
  });

  it("skips a second mood write and a second user row on retry", () => {
    expect(server).toContain("turnSkipsAffect");
    expect(server).toContain("omitPersistedUserRow");
    expect(server).toContain("if (!turnSkipsAffect(metadata))");
    expect(server).toContain("if (skipAffect) return;");
  });
});
