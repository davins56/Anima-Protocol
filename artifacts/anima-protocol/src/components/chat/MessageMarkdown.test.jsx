import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ROLEPLAY_ACTION_CLASS } from "./messageMarkdownUtils";
import MessageMarkdown from "./MessageMarkdown";
import { renderItalicText } from "./renderItalicText";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("MessageMarkdown", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders headings, bold, lists, task lists, blockquotes, tables and links", async () => {
    const source = [
      "# Title",
      "",
      "A **bold** word and a [safe link](https://example.com/docs).",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "",
      "> quoted",
      "",
      "- [x] done",
      "- [ ] later",
      "",
      "| Col | Val |",
      "| --- | --- |",
      "| A   | 1   |",
    ].join("\n");

    const { container } = mount(<MessageMarkdown content={source} />);
    await flush();

    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("h1")?.className).toContain("md-h1");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    const link = container.querySelector("a.md-link");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector("ul")).toBeTruthy();
    expect(container.querySelector("ol")).toBeTruthy();
    expect(container.querySelector("blockquote")?.textContent).toContain("quoted");
    const boxes = [...container.querySelectorAll("input[type='checkbox']")];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[0].disabled).toBe(true);
    expect(boxes[1].checked).toBe(false);
    const wrap = container.querySelector(".md-table-wrap");
    expect(wrap).toBeTruthy();
    expect(container.querySelector("table.md-table")?.textContent).toContain("Col");
  });

  it("keeps roleplay *action* italic styling identical to renderItalicText", () => {
    const md = mount(<MessageMarkdown content={"Hello *smiles softly* there"} />);
    const mdEm = md.container.querySelector("em");
    expect(mdEm).toBeTruthy();
    expect(mdEm.textContent).toBe("smiles softly");
    expect(mdEm.className).toBe(ROLEPLAY_ACTION_CLASS);

    const italic = mount(<div>{renderItalicText("Hello *smiles softly* there")}</div>);
    const legacyEm = italic.container.querySelector("em");
    expect(legacyEm.textContent).toBe("smiles softly");
    expect(legacyEm.className).toBe(mdEm.className);
    expect(legacyEm.className).toBe("text-primary/70 opacity-75");
  });

  it("does not render raw HTML or dangerous URLs, and does not load markdown images", async () => {
    const source = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "",
      "Click [here](javascript:alert(1)) now.",
      "",
      "Also [data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==).",
      "",
      "![tracking pixel](https://evil.example/pixel.png)",
    ].join("\n");

    const { container } = mount(<MessageMarkdown content={source} />);
    await flush();

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("[src]")).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain("javascript:");
    // Raw HTML is escaped as text, not executed. "onerror" may appear in that
    // escaped source string, but never as a live attribute.
    expect(container.innerHTML).toContain("&lt;script&gt;");
    expect(container.innerHTML).toContain("&lt;img");
    expect(container.textContent).toContain("[image: tracking pixel]");
    expect(container.textContent).not.toContain("https://evil.example/pixel.png");
  });

  it("renders an unclosed mid-stream fence as a code block with a copy button and language label", async () => {
    const { container } = mount(<MessageMarkdown content={"Intro\n```js\nconst x = 1"} />);
    await flush();

    const block = container.querySelector("[data-testid='message-code-block']");
    expect(block).toBeTruthy();
    expect(block.textContent).toContain("const x = 1");
    expect(block.textContent).toMatch(/js/i);
    const copy = [...block.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") || "").toLowerCase().includes("copy"),
    );
    expect(copy).toBeTruthy();
    expect(copy.getAttribute("aria-label")).toBe("Copy code");
    const pre = block.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(pre.getAttribute("role")).toBe("region");
    // The closer we append for parsing must not appear as a raw fence in the code.
    expect(pre.textContent.trim()).toBe("const x = 1");
  });

  it("renders inline and display math (including mid-stream unclosed $$)", async () => {
    const { container, root } = mount(<MessageMarkdown content={"Energy $E=mc^2$ today"} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Wait for lazy KaTeX (fallback first, then typeset).
    for (let i = 0; i < 20; i += 1) {
      if (container.querySelector("[data-testid='message-math']")) break;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    }
    const inlineMath = container.querySelector("[data-testid='message-math']");
    expect(inlineMath || container.querySelector("[data-testid='message-math-fallback']")).toBeTruthy();
    expect(container.textContent).toMatch(/E\s*=\s*mc\^2|E=mc|mc\^2|mc2/);

    act(() => {
      root.render(<MessageMarkdown content={"$$\na^2 + b^2"} />);
    });
    for (let i = 0; i < 20; i += 1) {
      if (container.querySelector("[data-testid='message-math']") || container.querySelector(".katex")) break;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    }
    expect(
      container.querySelector("[data-testid='message-math']") ||
        container.querySelector("[data-testid='message-math-fallback']") ||
        container.querySelector(".katex"),
    ).toBeTruthy();
    expect(container.textContent).toMatch(/a\s*\^2|a2|b\^2|b2|\+/);
  });
});
