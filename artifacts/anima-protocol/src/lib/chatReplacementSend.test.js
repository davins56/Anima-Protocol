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
    expect(fn).toContain("keepArrivals(source, latest.messages");
    expect(fn).toContain("activeSessionRef.current?.id === sessionId");
  });

  it("restores the previous thread when replacement fails before the stream", () => {
    const start = chat.indexOf("} else if (replyAction && isReplyReplaceFailed(err))");
    expect(start).toBeGreaterThan(-1);
    const branch = chat.slice(start, start + 2500);
    expect(branch).toContain("releaseDiscardedIds");
    expect(branch).toContain("messageData.priorMessages");
    expect(branch).toContain("return { started: false }");
  });

  it("skips a second mood write and a second user row on retry", () => {
    expect(server).toContain("turnSkipsAffect");
    expect(server).toContain("omitPersistedUserRow");
    expect(server).toContain("if (!turnSkipsAffect(metadata))");
    expect(server).toContain("if (skipAffect) return;");
  });
});
