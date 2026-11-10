import { describe, expect, it } from "vitest";
import { composerHint, shouldSendOnEnter } from "./composerKeys";

describe("shouldSendOnEnter", () => {
  it("keeps desktop behavior: Enter sends, Shift+Enter is a newline", () => {
    expect(shouldSendOnEnter({ key: "Enter" }, false)).toBe(true);
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: true }, false)).toBe(false);
    expect(shouldSendOnEnter({ key: "a" }, false)).toBe(false);
  });

  it("lets Enter insert a newline on touch-first devices", () => {
    expect(shouldSendOnEnter({ key: "Enter" }, true)).toBe(false);
    expect(shouldSendOnEnter({ key: "Enter", metaKey: true }, true)).toBe(true);
    expect(shouldSendOnEnter({ key: "Enter", ctrlKey: true }, true)).toBe(true);
  });

  it("never sends while an IME is composing", () => {
    expect(shouldSendOnEnter({ key: "Enter", nativeEvent: { isComposing: true } }, false)).toBe(false);
    expect(shouldSendOnEnter({ key: "Enter", keyCode: 229 }, false)).toBe(false);
  });

  it("describes the right keys", () => {
    expect(composerHint(false)).toMatch(/Enter to send/);
    expect(composerHint(true)).not.toMatch(/Enter to send/);
  });
});
