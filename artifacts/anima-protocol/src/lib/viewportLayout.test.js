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
    const mainBlock = css.slice(css.indexOf(".app-shell-main {"), css.indexOf(".app-shell-route {"));
    expect(mainBlock).toMatch(/display:\s*flex/);
    expect(mainBlock).toMatch(/flex-direction:\s*column/);
    expect(mainBlock).toMatch(/flex:\s*1 1 0%/);
    expect(mainBlock).toMatch(/min-height:\s*0/);
    expect(mainBlock).toMatch(/overflow-y:\s*auto/);
    expect(mainBlock).toMatch(/overflow-x:\s*hidden/);
    expect(css).toContain(".app-shell-route {");
    const fillBlock = css.slice(css.indexOf(".app-page-fill {"));
    const fillOnly = fillBlock.slice(0, fillBlock.indexOf("}"));
    expect(fillOnly).toMatch(/overflow:\s*hidden/);
    expect(fillOnly).toMatch(/min-height:\s*0/);
    expect(fillOnly).toMatch(/flex:\s*1 1 0%/);
    expect(fillOnly).not.toMatch(/height:\s*100%/);
  });

  it("keeps h-screen-safe on the dvh / --app-height stack, not a lone 100vh", () => {
    const block = css.slice(css.indexOf(".h-screen-safe {"), css.indexOf(".min-h-screen-safe {"));
    expect(block).toContain("100vh");
    expect(block).toContain("100dvh");
    expect(block).toContain("var(--app-height, 100dvh)");
  });

  it("sizes keyboard-open overlays to --app-height and hides bottom chrome", () => {
    expect(css).toContain("html[data-keyboard-open] .fixed-bottom-chrome");
    expect(css).toContain(".h-app-viewport {");
    const overlay = css.slice(css.indexOf(".h-app-viewport {"), css.indexOf(".justify-safe-center {"));
    expect(overlay).toContain("var(--app-height, 100dvh)");
    expect(overlay).toContain("max-height:");
    expect(css).toContain(".justify-safe-center {");
    expect(css).toMatch(/justify-content:\s*safe center/);
    expect(css).toMatch(/Do not also add the keyboard inset as padding/);
  });

  it("wires ProtocolApp to the shell classes and visible-viewport hook", () => {
    expect(shell).toContain("useViewportHeight()");
    expect(shell).toContain('className="app-shell flex flex-col h-screen-safe"');
    expect(shell).toContain("app-shell-main");
    expect(shell).toContain("app-shell-route");
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
  it("Home / Check-In / Sacred Space / Reflection Log / Customiser / Landing can scroll", () => {
    expect(readPage("MainHome")).toMatch(SCROLL_RE);
    expect(readPage("CheckIn")).toMatch(SCROLL_RE);
    expect(readPage("Meditation")).toMatch(SCROLL_RE);
    expect(readPage("ReflectionLog")).toMatch(SCROLL_RE);
    expect(readPage("CustomiseAnima")).toMatch(SCROLL_RE);
    expect(readPage("Landing")).toMatch(SCROLL_RE);
    expect(readPage("Landing")).not.toMatch(/min-h-\[100dvh\]/);
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

  it("New Session picker scrolls inside the modal and clears the tab bar", () => {
    const modal = readSrc("components/chat/NewSessionModal.jsx");
    expect(modal).toContain('data-testid="new-session-character-scroller"');
    expect(modal).toContain("createPortal");
    expect(modal).toContain("document.body");
    expect(modal).toMatch(/z-\[1000\]/);
    expect(modal).toContain("h-app-viewport");
    expect(modal).toContain('height: "var(--app-height, 100dvh)"');
    expect(modal).toContain("justify-end");
    expect(modal).toMatch(
      /data-testid="new-session-overlay"[\s\S]*?justify-end/,
    );
    expect(modal).toMatch(/overflow-y-auto/);
    expect(modal).toMatch(/min-h-0/);
    expect(modal).toContain(
      "pb-[calc(var(--tab-bar-height,56px)+env(safe-area-inset-bottom,0px)+1rem)]",
    );
    expect(modal).not.toContain("pb-[calc(var(--tab-bar-height,0px)+1rem)]");
    expect(modal).toContain("max-h-full");
    expect(modal).toContain("overflow-hidden");
    expect(modal).not.toMatch(/max-h-\[90vh\]/);
    expect(modal).not.toMatch(/h-screen(?!-)/);

    const chooser = readSrc("components/stories/StoryCharacterChooser.jsx");
    expect(chooser).toContain("createPortal");
    expect(chooser).toContain("document.body");
    expect(chooser).toMatch(/z-\[1000\]/);
    expect(chooser).toContain("h-app-viewport");
    expect(chooser).toContain("justify-end");
    expect(chooser).toContain(
      "pb-[calc(var(--tab-bar-height,56px)+env(safe-area-inset-bottom,0px)+1rem)]",
    );
    expect(chooser).not.toMatch(/\bz-50\b/);
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
    expect(chat).not.toMatch(/height:\s*"100dvh"/);
    expect(chat).toContain('height: "var(--app-height, 100dvh)"');
  });

  it("keeps the in-flow chat composer flush above the tab bar when the keyboard is closed", () => {
    const shell = readSrc("ProtocolApp.jsx");
    const chat = readPage("Chat");
    const css = readSrc("index.css");

    // `--tab-bar-height` already includes the home indicator. Reserving that
    // once on `.app-shell-main` is enough for the fixed tab bar.
    expect(css).toMatch(
      /--tab-bar-height:\s*calc\(56px \+ env\(safe-area-inset-bottom/,
    );
    expect(shell).toContain("var(--tab-bar-height, 0px)");
    expect(shell).toMatch(/showChrome && !isHomeFloor/);

    // A second `--safe-bottom` pad on `.app-shell` lifted the composer and
    // left a black gap (home-indicator tall) above the tab bar.
    const shellOpen = shell.slice(shell.indexOf("app-shell flex flex-col"));
    const shellStyle = shellOpen.slice(0, shellOpen.indexOf("</div>"));
    expect(shellStyle).toContain("paddingTop");
    expect(shellStyle).not.toMatch(/paddingBottom:\s*"var\(--safe-bottom/);
    expect(css).toMatch(/do not add `--safe-bottom` here/i);

    // Composer is in-flow; ProtocolApp owns the tab bar. Extra tab-bar /
    // safe-area padding on Chat was the other half of the double-count.
    expect(chat).toContain('data-testid="chat-composer"');
    expect(chat).toContain('paddingBottom: "0"');
    expect(chat).not.toMatch(/<BottomTabBar/);
    expect(chat).not.toMatch(
      /paddingBottom:\s*['"]var\(--tab-bar-height/,
    );
    expect(chat).toContain(
      'bottom: "calc(var(--tab-bar-height, 56px) + 0.5rem)"',
    );
    expect(chat).not.toContain('bottom: "5.5rem"');
    // height: 100% on the Chat column fights the padded flex parent and
    // extends the composer under the reserved tab-bar pad.
    expect(chat).not.toMatch(/height:\s*"100%"/);
    expect(chat).not.toMatch(/flex flex-col h-full overflow-hidden/);
    expect(chat).toMatch(/flex flex-col flex-1 min-h-0 overflow-hidden/);
  });

  it("keeps ChatInput above the tab bar when lg+ Memory Recall is showing", () => {
    const chat = readPage("Chat");
    const css = readSrc("index.css");
    const tabBar = readSrc("components/layout/BottomTabBar.jsx");
    const input = readSrc("components/chat/ChatInput.jsx");

    // This is the confirmed iPad viewport: Memory Recall paints, the tab
    // bar paints, and ChatInput must stay in the padded column — not
    // under HOME / CHAT / BOARD / MAP / MORE.
    expect(chat).toMatch(/hidden lg:block[\s\S]*MemoryRecallPanel/);
    expect(tabBar).not.toMatch(/\blg:hidden\b/);
    expect(css).not.toMatch(
      /@media\s*\(\s*min-width:\s*1024px\s*\)[\s\S]{0,240}--tab-bar-height:\s*0px/,
    );
    expect(css).toContain("Do not zero this");

    // Extras (Speak / chips / Memory Recall) can scroll; the text box is
    // a sibling under them so a tall lg stack cannot push it into the bar.
    expect(chat).toContain('data-testid="chat-composer-extras"');
    expect(chat).toContain('data-testid="chat-input-slot"');
    expect(input).toContain('data-testid="chat-input"');
    const extrasIdx = chat.indexOf('data-testid="chat-composer-extras"');
    const composer = chat.slice(extrasIdx);
    const memoryIdx = composer.indexOf("<MemoryRecallPanel");
    const slotIdx = composer.indexOf('data-testid="chat-input-slot"');
    const inputIdx = composer.indexOf("<ChatInput\n");
    expect(extrasIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeGreaterThan(-1);
    expect(slotIdx).toBeGreaterThan(memoryIdx);
    expect(inputIdx).toBeGreaterThan(slotIdx);

    // Whole-composer flex-shrink-0 was the overflow that hid ChatInput.
    const composerAttr = chat.indexOf('data-testid="chat-composer"');
    const composerTagStart = chat.lastIndexOf("<div", composerAttr);
    const composerTag = chat.slice(composerTagStart, chat.indexOf(">", composerAttr));
    expect(composerTag).toContain('data-testid="chat-composer"');
    expect(composerTag).not.toContain("flex-shrink-0");
    expect(composerTag).toContain("min-h-0");
  });

  it("keeps reserved --tab-bar-height in sync with the painted tab bar", () => {
    const css = readSrc("index.css");
    const tabBar = readSrc("components/layout/BottomTabBar.jsx");
    const chat = readPage("Chat");

    // The bar is fixed at every width — no lg:hidden. Zeroing the CSS
    // variable at ≥1024px was the iPad bug (Memory Recall visible, ChatInput
    // under HOME / CHAT / BOARD / MAP / MORE).
    expect(tabBar).toContain("fixed-bottom-chrome");
    expect(tabBar).toContain("fixed bottom-0");
    expect(tabBar).not.toMatch(/\blg:hidden\b/);
    expect(tabBar).toContain("syncReservedTabBarHeight");
    expect(tabBar).toContain('data-testid="bottom-tab-bar"');
    expect(css).not.toMatch(
      /@media\s*\(\s*min-width:\s*1024px\s*\)[\s\S]{0,240}--tab-bar-height:\s*0px/,
    );
    expect(css).toContain("Do not zero this");
    expect(css).toContain("at a desktop breakpoint");

    // Chat stays in-flow and does not mount a second tab bar.
    expect(chat).toContain('data-testid="chat-composer"');
    expect(chat).not.toMatch(/<BottomTabBar/);
    expect(chat).not.toContain("components/layout/BottomTabBar");
  });

  it("does not leave overlay chrome on a leftover 100dvh", () => {
    const sidebar = readSrc("components/layout/Sidebar.jsx");
    const lore = readSrc("components/lore/LoreBrowserPanel.jsx");
    expect(sidebar).not.toMatch(/height:\s*"100dvh"/);
    expect(sidebar).toContain("h-app-viewport");
    expect(sidebar).toContain("var(--app-height, 100dvh)");
    expect(lore).not.toContain("h-[100dvh]");
    expect(lore).toContain("h-app-viewport");
    expect(readSrc("components/chat/ChatInput.jsx")).toMatch(
      /do not add 100vh, keyboard padding/,
    );
  });

  it("start-aligns overflowing NetBattle and Emotional Onboarding columns", () => {
    const battle = readPage("NetBattle");
    expect(battle).toContain("overflow-y-auto");
    expect(battle).toContain("justify-safe-center");
    expect(battle).not.toMatch(/overflow-y-auto[^"']*justify-center/);
    const onboarding = readSrc("components/onboarding/EmotionalOnboarding.jsx");
    expect(onboarding).toContain("overflow-y-auto");
    expect(onboarding).toContain("justify-safe-center");
    expect(onboarding).not.toMatch(/overflow-y-auto[^"']*justify-center/);
  });

  it("lets relationship graph legend and details scroll on a narrow column", () => {
    const force = readPage("CharacterRelationshipForceGraph");
    expect(force).toContain("overflow-y-auto lg:overflow-hidden");
    expect(force).not.toContain("max-h-[45%]");
    expect(force).not.toContain("max-h-40");
    expect(force).toContain("h-[min(50dvh,360px)]");
    const interactive = readPage("InteractiveGraphVisualization");
    expect(interactive).toContain("overflow-y-auto lg:overflow-hidden");
    expect(interactive).not.toContain("max-h-[45%]");
    expect(interactive).toContain("h-[min(50dvh,360px)]");
  });

  it("PageLoader fills the remaining column instead of a second 100vh stack", () => {
    const loader = readSrc("app/PageLoader.jsx");
    expect(loader).toContain("flex-1 min-h-0 h-full");
    expect(loader).not.toContain("h-screen-safe");
  });
});

describe("edge-to-edge fill contract (iOS 26 / notched iPhone)", () => {
  const css = readSrc("index.css");
  const shell = readSrc("ProtocolApp.jsx");
  const html = readFileSync(join(srcRoot, "..", "index.html"), "utf8");

  it("declares viewport-fit=cover so safe-area insets resolve at all", () => {
    // env(safe-area-inset-*) stays 0 without this, so every inset below is a
    // no-op and the notch/home-indicator handling silently does nothing.
    expect(html).toMatch(/viewport-fit=cover/);
  });

  it("paints the root element, not just body", () => {
    // iOS 26 floats Safari chrome over the canvas; the strip behind it is
    // painted from the root element.
    const htmlBlock = css.slice(css.indexOf("  html {"), css.indexOf("  html, body, #root"));
    expect(htmlBlock).toMatch(/background-color:\s*hsl\(var\(--background\)\)/);
  });

  it("exposes a full-screen backdrop sized by --app-height-max", () => {
    expect(css).toContain(".app-viewport-backdrop {");
    const backdrop = css.slice(css.indexOf(".app-viewport-backdrop {"));
    const block = backdrop.slice(0, backdrop.indexOf("}"));
    expect(block).toMatch(/position:\s*fixed/);
    expect(block).toMatch(/height:\s*var\(--app-height-max,\s*100lvh\)/);
    expect(block).toMatch(/background-color:\s*hsl\(var\(--background\)\)/);
    // Decorative only — it must never intercept taps.
    expect(block).toMatch(/pointer-events:\s*none/);

    // And it has to actually be rendered, behind the interactive shell.
    expect(shell).toContain('className="app-viewport-backdrop"');
    expect(shell).toMatch(/app-viewport-backdrop[\s\S]{0,120}aria-hidden/);
  });

  it("gives --app-height-max a CSS-only fallback before JS measures", () => {
    expect(css).toMatch(/--app-height-max:\s*100lvh/);
  });

  it("insets the shell horizontally for landscape notches", () => {
    const block = css.slice(css.indexOf(".app-shell {"));
    const shellBlock = block.slice(0, block.indexOf("}"));
    expect(shellBlock).toMatch(
      /padding-left:\s*var\(--safe-left,\s*env\(safe-area-inset-left,\s*0px\)\)/,
    );
    expect(shellBlock).toMatch(
      /padding-right:\s*var\(--safe-right,\s*env\(safe-area-inset-right,\s*0px\)\)/,
    );
  });

  it("keeps the fixed tab bar clear of the home indicator", () => {
    const tabBar = readSrc("components/layout/BottomTabBar.jsx");
    expect(tabBar).toContain(
      'paddingBottom: "var(--safe-bottom, env(safe-area-inset-bottom, 0px))"',
    );
  });

  it("does not double-count the home indicator under in-flow bottom chrome", () => {
    // `--tab-bar-height` = 56px + safe-area. The shell must not also apply
    // `--safe-bottom`, or the chat composer sits a home-indicator-height
    // above the tab bar when the keyboard is closed.
    const css = readSrc("index.css");
    expect(css).toMatch(
      /--tab-bar-height:\s*calc\(56px \+ env\(safe-area-inset-bottom/,
    );
    expect(css).toContain("Do not also pad `.app-shell` with");
  });
});
