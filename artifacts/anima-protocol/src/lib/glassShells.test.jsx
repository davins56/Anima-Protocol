import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyActiveExtras, activeExtrasKey } from "./experienceRuntime";

vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("@/hooks/useModelTutor", () => ({ useModelTutor: () => ({ isSteward: false }) }));
vi.mock("@/api/animaClient", () => ({
  animaClient: { entities: { ChatSession: { list: async () => [] } } },
}));

import HomeDock from "@/components/home/HomeDock";
import MobileHeader from "@/components/layout/MobileHeader";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = rel => readFileSync(join(srcRoot, rel), "utf8");
const css = readSrc("styles/glass-shells.css");

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const ch = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return ch.map(v => (v + m) * 255);
}
const lum = rgb => {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
const tint = selector => {
  const block = css.slice(css.indexOf(selector + " {"));
  return Number(block.match(/--glass-tint:\s*([\d.]+)/)[1]);
};

function storage(values) {
  const rows = new Map([[activeExtrasKey("u1"), JSON.stringify(values)]]);
  return { getItem: k => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v) };
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.experienceShell;
});

describe("frosted / glass shells: setting → root", () => {
  it("writes the chosen shell onto <html> and falls back to solid", () => {
    applyActiveExtras("u1", document, storage({ shell: "glass" }));
    expect(document.documentElement.dataset.experienceShell).toBe("glass");
    applyActiveExtras("u1", document, storage({ shell: "frosted" }));
    expect(document.documentElement.dataset.experienceShell).toBe("frosted");
    applyActiveExtras(null, document, storage({}));
    expect(document.documentElement.dataset.experienceShell).toBe("solid");
  });

  it("is loaded app-wide after the theme tokens", () => {
    const main = readSrc("main.jsx");
    expect(main.indexOf("./styles/glass-shells.css")).toBeGreaterThan(main.indexOf("./index.css"));
    expect(main.indexOf("./styles/glass-shells.css")).toBeGreaterThan(main.indexOf("./styles/appearance-studio.css"));
    // The old bubble-only rules (fixed dark rgba, wrong in Light) are gone.
    expect(readSrc("index.css")).not.toMatch(/data-experience-shell="glass"\] \[data-message-bubble\]/);
  });
});

describe("frosted / glass shells: tokens", () => {
  it("defines blur, tint, saturation and border tokens for frosted and glass only", () => {
    for (const shell of ["frosted", "glass"]) {
      const block = css.slice(css.indexOf(`html[data-experience-shell="${shell}"] {`)).split("}")[0];
      for (const token of ["--glass-tint", "--glass-blur", "--glass-saturate", "--glass-border"]) {
        expect(block, `${shell} ${token}`).toContain(token);
      }
    }
    expect(css).not.toMatch(/data-experience-shell="solid"/);
  });

  it("tints with the theme's own surface colour, never a fixed dark rgba", () => {
    expect(css).toMatch(/background-color:\s*hsl\(var\(--card\) \/ var\(--glass-tint\)\)/);
    expect(css).toMatch(/background-color:\s*hsl\(var\(--popover\) \/ var\(--glass-tint\)\)/);
    expect(css).not.toMatch(/rgba\(16,\s*25,\s*40/);
    expect(css).toMatch(/html\.light\[data-experience-shell="glass"\]/);
  });

  it("keeps body text AA (4.5:1) over a worst-case white or black backdrop in Dark and Light", () => {
    const dark = { card: hslToRgb(220, 20, 6), fg: hslToRgb(185, 100, 80) };
    const light = { card: [255, 255, 255], fg: hslToRgb(220, 25, 12), muted: hslToRgb(220, 16, 32) };
    for (const shell of ["frosted", "glass"]) {
      const d = tint(`html[data-experience-shell="${shell}"]`);
      const l = tint(`html.light[data-experience-shell="${shell}"]`);
      expect(contrast(dark.fg, over(dark.card, [255, 255, 255], d)), `dark ${shell}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light.fg, over(light.card, [0, 0, 0], l)), `light ${shell}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light.muted, over(light.card, [0, 0, 0], l)), `light muted ${shell}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("falls back to a solid surface without backdrop-filter or when transparency is reduced", () => {
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{\s*html\[data-experience-shell\]\[data-experience-shell\] \{ --glass-tint: 1;/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\), \(forced-colors: active\)\s*\{\s*html\[data-experience-shell\]\[data-experience-shell\] \{ --glass-tint: 1;/);
    expect(css).toMatch(/-webkit-backdrop-filter: blur\(var\(--glass-blur\)\)/);
  });

  it("styles every shared surface and blurs cards on ::before so fixed children keep the viewport", () => {
    for (const sel of ["[data-glass-surface]", ".bg-card", ".bg-card\\/80", ".bg-card\\/90", ".bg-popover", "[data-message-bubble]"]) {
      expect(css, sel).toContain(sel);
    }
    expect(css).toMatch(/::before \{[^}]*backdrop-filter: blur\(var\(--glass-blur\)\)/s);
    expect(css).toMatch(/@layer components \{[^}]*position: relative;\s*isolation: isolate;/s);
    expect(css).toMatch(/backdrop-filter: none;/);
  });
});

describe("frosted / glass shells: surfaces opt in", () => {
  it("marks the floating dock and the Explore menu", () => {
    render(<MemoryRouter initialEntries={["/chat"]}><HomeDock variant="fixed" /></MemoryRouter>);
    expect(screen.getByTestId("app-dock").getAttribute("data-glass-surface")).toBe("dock");
    fireEvent.click(screen.getByRole("button", { name: "World" }));
    expect(screen.getByTestId("explore-menu").getAttribute("data-glass-surface")).toBe("menu");
  });

  it("marks the route header", () => {
    const { container } = render(<MemoryRouter initialEntries={["/settings"]}><MobileHeader /></MemoryRouter>);
    expect(container.querySelector('[data-glass-surface="header"]')).toBeTruthy();
  });

  it("marks dialogs (portaled)", () => {
    render(<Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Hi</DialogTitle></DialogContent></Dialog>);
    expect(screen.getByRole("dialog").getAttribute("data-glass-surface")).toBe("modal");
  });

  it("marks sheets, popovers, menus and the chat header in source", () => {
    const expectations = {
      "components/ui/sheet.jsx": "sheet", "components/ui/drawer.jsx": "sheet",
      "components/ui/alert-dialog.jsx": "modal", "components/ui/popover.jsx": "popover",
      "components/ui/select.jsx": "popover", "components/ui/dropdown-menu.jsx": "popover",
      "components/home/HomeFloorSheets.jsx": "sheet", "components/chat/ChatToolbar.jsx": "header",
    };
    for (const [rel, kind] of Object.entries(expectations)) {
      expect(readSrc(rel), rel).toContain(`data-glass-surface="${kind}"`);
    }
  });
});
