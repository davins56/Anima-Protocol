import { describe, expect, it } from "vitest";
import {
  messageHasCodeFence,
  messageHasMath,
  prepareStreamingMarkdown,
  sanitizeHref,
} from "./messageMarkdownUtils";

describe("sanitizeHref", () => {
  it("allows http, https, mailto, tel, and relative URLs", () => {
    expect(sanitizeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(sanitizeHref("http://example.com")).toBe("http://example.com");
    expect(sanitizeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(sanitizeHref("tel:+15551212")).toBe("tel:+15551212");
    expect(sanitizeHref("#section")).toBe("#section");
    expect(sanitizeHref("/chat/abc")).toBe("/chat/abc");
    expect(sanitizeHref("./rel")).toBe("./rel");
    expect(sanitizeHref("../up")).toBe("../up");
  });

  it("rejects javascript, data, vbscript, file, and protocol-relative URLs", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeHref("JAVASCRIPT:alert(1)")).toBeUndefined();
    expect(sanitizeHref(" data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toBeUndefined();
    expect(sanitizeHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(sanitizeHref("file:///etc/passwd")).toBeUndefined();
    expect(sanitizeHref("//evil.example/hook")).toBeUndefined();
    expect(sanitizeHref("javascript:alert(1)\u0000")).toBeUndefined();
  });
});

describe("messageHasCodeFence / messageHasMath", () => {
  it("detects fenced blocks and math delimiters", () => {
    expect(messageHasCodeFence("hello")).toBe(false);
    expect(messageHasCodeFence("```js\nconst x = 1\n```")).toBe(true);
    expect(messageHasCodeFence("~~~\nplain\n~~~")).toBe(true);
    expect(messageHasMath("hello")).toBe(false);
    expect(messageHasMath("costs $5 today")).toBe(false);
    expect(messageHasMath("Einstein: $E=mc^2$")).toBe(true);
    expect(messageHasMath("$$a^2 + b^2$$")).toBe(true);
    expect(messageHasMath("\\(x\\)")).toBe(true);
    expect(messageHasMath("\\[x\\]")).toBe(true);
  });
});

describe("prepareStreamingMarkdown", () => {
  it("closes an unclosed backtick fence", () => {
    const out = prepareStreamingMarkdown("intro\n```js\nconst x = 1");
    expect(out).toBe("intro\n```js\nconst x = 1\n```");
  });

  it("closes an unclosed tilde fence and unclosed $$", () => {
    expect(prepareStreamingMarkdown("~~~\ncode")).toBe("~~~\ncode\n~~~");
    expect(prepareStreamingMarkdown("see\n$$\nE = mc^2")).toBe("see\n$$\nE = mc^2$$");
  });

  it("leaves already-closed fences and math alone", () => {
    const fenced = "```js\nconst x = 1\n```\nafter";
    expect(prepareStreamingMarkdown(fenced)).toBe(fenced);
    const math = "$$E=mc^2$$ done";
    expect(prepareStreamingMarkdown(math)).toBe(math);
  });

  it("does not treat a $$ inside a closed fence as math, and does not auto-close a lone $", () => {
    const inside = "```\nconst x = $$\n```";
    expect(prepareStreamingMarkdown(inside)).toBe(inside);
    expect(prepareStreamingMarkdown("It costs $")).toBe("It costs $");
  });

  it("closes an unclosed \\[ display-math delimiter", () => {
    expect(prepareStreamingMarkdown("\\[a^2 + b^2")).toBe("\\[a^2 + b^2\\]");
  });
});
