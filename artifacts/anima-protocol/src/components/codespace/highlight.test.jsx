import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { highlight } from "./highlight";
import CodeEditor from "./CodeEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe("Codespace highlight syntax highlighter", () => {
  it("escapes basic HTML tags and special characters", () => {
    const code = `<script>alert("xss")</script>`;
    const res = highlight(code, "javascript");
    expect(res).not.toContain("<script>");
    expect(res).not.toContain("</script>");
    expect(res).toContain("&lt;script&gt;");
  });

  it("safely handles XSS payloads in HTML language mode without unescaped tags", () => {
    const payload = `<img src=x onerror="alert(1)">`;
    const res = highlight(payload, "html");
    expect(res).not.toContain("<img");
    expect(res).toContain("&lt;<span class=\"tok-kw\">img</span>");
    expect(res).toContain("&lt;");
    expect(res).toContain("&gt;");
  });

  it("safely handles CSS language mode with embedded tags", () => {
    const payload = `p { content: "</style><script>alert(1)</script>"; }`;
    const res = highlight(payload, "css");
    expect(res).not.toContain("<script>");
    expect(res).not.toContain("</style>");
    expect(res).toContain("&lt;/style&gt;");
  });

  it("safely handles Python code with HTML payloads", () => {
    const payload = `def test():\n    return "<iframe src=javascript:alert(1)></iframe>"`;
    const res = highlight(payload, "python");
    expect(res).not.toContain("<iframe");
    expect(res).toContain("&lt;iframe");
  });

  it("handles regex substitution patterns without expanding ($1, $&, $`, $')", () => {
    const payload = `const x = "$1 $& $\` $'";`;
    const res = highlight(payload, "javascript");
    expect(res).toContain("$1");
    expect(res).toContain("$&amp;");
  });

  it("escapes JSON and Markdown inputs safely", () => {
    const payload = `{"key": "<script>alert('json')</script>"}`;
    expect(highlight(payload, "json")).toContain("&lt;script&gt;");
    expect(highlight(payload, "markdown")).toContain("&lt;script&gt;");
  });
});

describe("CodeEditor component security", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders code editor and sanitizes dangerous HTML before rendering", () => {
    const maliciousCode = `<img src=x onerror=alert('xss')><script>alert(1)</script>`;
    const { container } = render(
      <CodeEditor
        path="index.html"
        value={maliciousCode}
        onChange={() => {}}
      />
    );

    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    // Verify <script> and <img> elements were NOT created as executable DOM nodes inside pre
    expect(pre.querySelector("script")).toBeNull();
    expect(pre.querySelector("img")).toBeNull();
    // Text content should display the code as text
    expect(pre.textContent).toContain("<img");
    expect(pre.textContent).toContain("<script>");
  });
});
