import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const chat = readFileSync(path.join(process.cwd(), "src/pages/Chat.jsx"), "utf8");

function handleSendMessageSource() {
  const start = chat.indexOf("const handleSendMessage = async");
  const end = chat.indexOf("handleSendMessageRef.current = handleSendMessage", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return chat.slice(start, end);
}

describe("companion send can read the uploaded photo list", () => {
  it("does not redeclare imageAttachments inside the send that posts /chat/messages", () => {
    const fn = handleSendMessageSource();
    const uploadList = fn.indexOf("const imageAttachments = attachments.filter");
    const posted = fn.indexOf("photo_count: imageAttachments.length");
    const tryAt = fn.indexOf("try {", uploadList);
    expect(uploadList).toBeGreaterThan(-1);
    expect(posted).toBeGreaterThan(tryAt);

    // A later `let imageAttachments` in this function is scoped to the whole
    // try, including the send callback above it. Reading the name throws
    // ReferenceError before fetch, and the page shows the generic banner
    // with no model wait.
    const declarations = fn.match(/\b(?:let|const|var)\s+imageAttachments\b/g) || [];
    expect(declarations).toEqual(["const imageAttachments"]);
    expect(fn).toContain("let replyImageAttachments");
  });
});
