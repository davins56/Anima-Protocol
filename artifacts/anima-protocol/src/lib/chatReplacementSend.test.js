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

  it("skips a second mood write and a second user row on retry", () => {
    expect(server).toContain("turnSkipsAffect");
    expect(server).toContain("omitPersistedUserRow");
    expect(server).toContain("if (!turnSkipsAffect(metadata))");
    expect(server).toContain("if (skipAffect) return;");
  });
});
