import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function readPage(name) {
  for (const ext of [".jsx", ".tsx"]) {
    const rel = `pages/${name}${ext}`;
    if (existsSync(join(srcRoot, rel))) return readSrc(rel);
  }
  throw new Error(`page not found: ${name}`);
}

const SCROLL_RE = /overflow-y-auto|overflow-y-scroll|overflow-auto/;

describe("viewport shell contract", () => {
  const css = readSrc("index.css");
  const shell = readSrc("ProtocolApp.jsx");
  const html = readFileSync(join(srcRoot, "..", "index.html"), "utf8");

  it("locks html/body/#root to the visible viewport instead of a raw 100vh clip", () => {
    expect(css).toMatch(/html, body, #root/);
    expect(css).toMatch(/overflow:\s*hidden/);
    expect(css).toMatch(/height:\s*100dvh/);
    expect(css).toMatch(/height:\s*var\(--app-height,\s*100dvh\)/);
    expect(css).toMatch(/max-height:\s*var\(--app-height,\s*100dvh\)/);
  });

  it("defines a scrollable app-shell-main and a fill layout for Chat-like pages", () => {
    expect(css).toContain(".app-shell {");
    expect(css).toContain(".app-shell-main {");
    expect(css).toContain(".app-page-fill {");
    const mainBlock = css.slice(css.indexOf(".app-shell-main {"), css.indexOf(".app-page-fill {"));
    expect(mainBlock).toMatch(/min-height:\s*0/);
    expect(mainBlock).toMatch(/overflow-y:\s*auto/);
    expect(mainBlock).toMatch(/overflow-x:\s*hidden/);
    const fillBlock = css.slice(css.indexOf(".app-page-fill {"));
    expect(fillBlock).toMatch(/overflow:\s*hidden/);
    expect(fillBlock).toMatch(/min-height:\s*0/);
  });

  it("keeps h-screen-safe on the dvh / --app-height stack, not a lone 100vh", () => {
    const block = css.slice(css.indexOf(".h-screen-safe {"), css.indexOf(".min-h-screen-safe {"));
    expect(block).toContain("100vh");
    expect(block).toContain("100dvh");
    expect(block).toContain("var(--app-height, 100dvh)");
  });

  it("wires ProtocolApp to the shell classes and visible-viewport hook", () => {
    expect(shell).toContain("useViewportHeight()");
    expect(shell).toContain('className="app-shell flex flex-col h-screen-safe"');
    expect(shell).toContain("app-shell-main");
    expect(shell).toContain("flex-1 min-h-0 flex flex-col");
    expect(shell).toMatch(/showChrome && !isHomeFloor/);
    expect(shell).toContain("var(--tab-bar-height, 0px)");
  });

  it("does not use a locked 100vh on html/body in the document entry", () => {
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).not.toMatch(/height:\s*100vh/);
  });
});

describe("representative page scroll contract", () => {
  it("Home / Check-In / Sacred Space / Reflection Log / Customiser can scroll", () => {
    expect(readPage("MainHome")).toMatch(SCROLL_RE);
    expect(readPage("CheckIn")).toMatch(SCROLL_RE);
    expect(readPage("Meditation")).toMatch(SCROLL_RE);
    expect(readPage("ReflectionLog")).toMatch(SCROLL_RE);
    expect(readPage("CustomiseAnima")).toMatch(SCROLL_RE);
  });

  it("Check-In keeps the submit row in the scrolling column", () => {
    const page = readPage("CheckIn");
    expect(page).toContain("Record Check-in");
    expect(page).toMatch(/flex-1 min-h-0 overflow-y-auto/);
    expect(page).toContain("pb-8");
    expect(page).toContain("await recordDailyResonanceCheckIn");
    expect(page).toContain('navigate("/reflection-log")');
    expect(page).toContain('role="alert"');
    expect(page).toMatch(/finally\s*\{[\s\S]*setSaving\(false\)/);
  });

  it("Chat fills the shell and keeps the visualViewport keyboard path", () => {
    const chat = readPage("Chat");
    expect(chat).toContain("app-page-fill");
    expect(chat).toContain("overflow-hidden");
    expect(chat).toMatch(/overflow-y-auto/);
    expect(chat).toContain("h-screen-safe");
    expect(chat).toContain("--app-height");
    expect(chat).toContain("visualViewport.height");
    expect(chat).toMatch(/Do not add keyboard\s+height, 100vh/);
    expect(chat).toContain("data-keyboard-open");
  });

  it("PageLoader fills the remaining column instead of a second 100vh stack", () => {
    const loader = readSrc("app/PageLoader.jsx");
    expect(loader).toContain("flex-1 min-h-0 h-full");
    expect(loader).not.toContain("h-screen-safe");
  });
});
