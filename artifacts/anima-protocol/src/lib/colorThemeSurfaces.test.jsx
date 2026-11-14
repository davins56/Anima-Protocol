import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ChatBackground from "@/components/chat/ChatBackground.jsx";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const channels =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
    [c, 0, x];
  return channels.map((v) => Math.round((v + m) * 255));
}

function relativeLuminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe("color theme surfaces", () => {
  const css = readSrc("index.css");

  it("defines a coherent light token set with WCAG AA text contrast on the canvas", () => {
    expect(css).toMatch(/:root\.light\s*\{[^}]*--background:\s*220 25% 96%/s);
    expect(css).toMatch(/:root\.light\s*\{[^}]*--foreground:\s*220 25% 12%/s);
    expect(css).toMatch(/:root\.light\s*\{[^}]*--primary:\s*185 100% 26%/s);
    expect(css).toMatch(/:root\.light\s*\{[^}]*--muted-foreground:\s*220 16% 32%/s);
    expect(css).toMatch(/:root\.light\s*\{[^}]*--anima-bg-canvas:\s*#F2F4F7/s);
    const canvas = hslToRgb(220, 25, 96);
    const fg = hslToRgb(220, 25, 12);
    const primary = hslToRgb(185, 100, 26);
    const muted = hslToRgb(220, 16, 32);
    expect(contrast(fg, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primary, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primary, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps scanlines from clobbering the canvas and remaps hardcoded dark surfaces in light mode", () => {
    const scan = css.slice(css.indexOf(".scanline {"), css.indexOf(".font-mono-hud"));
    expect(scan).toMatch(/background-image:\s*repeating-linear-gradient/);
    expect(scan).not.toMatch(/^\s*background:/m);
    expect(css).toContain("Color Theme vs Chat Background");
    expect(css).toContain("data-chat-background-layer");
    expect(css).toMatch(/:root\.light \.bg-\\\[\\#090912\\]/);
    expect(css).toMatch(/:root\.light \.bg-black\\\/40/);
    expect(css).toMatch(/:root\.light \[data-chat-background-layer\] \.bg-black\\\/40/);
  });

  it("themes the root shell and browser chrome tokens", () => {
    expect(css).toMatch(/html \{[^}]*background-color:\s*hsl\(var\(--background\)\)/s);
    const shell = css.slice(css.indexOf(".app-shell {"), css.indexOf(".app-shell-main {"));
    expect(shell).toMatch(/background-color:\s*hsl\(var\(--background\)\)/);
    const html = readFileSync(join(srcRoot, "..", "index.html"), "utf8");
    expect(html).toMatch(/<html lang="en" class="dark">/);
    expect(html).toMatch(/meta name="theme-color"/);
    expect(html).toContain("app-color-scheme");
  });

  it("does not hardcode dark fills on the shared chrome that Color Theme must repaint", () => {
    const files = [
      "pages/Settings.jsx",
      "pages/MainHome.jsx",
      "components/home/HomeDock.jsx",
      "components/home/ExploreMenu.jsx",
      "components/home/HomeFloorSheets.jsx",
    ];
    for (const rel of files) {
      const src = readSrc(rel);
      expect(src, rel).not.toMatch(/bg-\[#090912\]/);
      expect(src, rel).not.toMatch(/bg-\[#050505\]/);
    }
    expect(readSrc("components/home/HomeDock.jsx")).toMatch(/bg-card/);
    expect(readSrc("pages/Settings.jsx")).toMatch(/bg-card/);
    expect(readSrc("pages/Settings.jsx")).not.toMatch(/bg-black\/40/);
    expect(readSrc("pages/Settings.jsx")).not.toMatch(/bg-black\/60/);
  });
});

describe("chat background layer", () => {
  afterEach(() => cleanup());

  it("keeps a named scene (Nebula) independent of Color Theme tokens", () => {
    const { container } = render(<ChatBackground theme="nebula" />);
    const scene = container.querySelector("[data-chat-background-layer]");
    expect(scene).toBeTruthy();
    expect(scene.className).toMatch(/from-purple-900/);
    expect(scene.className).toMatch(/to-\[#0c0920\]/);
    expect(scene.className).not.toMatch(/to-background/);
  });

  it("lets the default chat canvas follow Color Theme", () => {
    const { container } = render(<ChatBackground theme="default" />);
    const scene = container.querySelector("[data-chat-background-layer]");
    expect(scene).toBeTruthy();
    expect(scene.hasAttribute("data-chat-theme-default")).toBe(true);
    expect(scene.className).toMatch(/bg-background/);
  });

  it("keeps a dimmer on a custom chat photo so Color Theme cannot wash it out", () => {
    const { container } = render(
      <ChatBackground theme="custom" imageUrl="https://example.com/bg.jpg" />,
    );
    const scene = container.querySelector("[data-chat-background-layer]");
    expect(scene).toBeTruthy();
    expect(scene.querySelector(".bg-black\\/40")).toBeTruthy();
  });
});
