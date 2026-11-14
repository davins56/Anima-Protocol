import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), logout: vi.fn(), wide: false, steward: false }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ logout: mocks.logout }) }));
vi.mock("@/hooks/useModelTutor", () => ({ useModelTutor: () => ({ isSteward: mocks.steward }) }));
vi.mock("@/api/animaClient", () => ({
  animaClient: { entities: { ChatSession: { list: async () => [] } } },
}));

import HomeDock from "./HomeDock";
import { DOCK_TABS, EXPLORE_MODULES, exploreModules } from "@/lib/mobileNav";
import { PRESET_FIELDS } from "@/lib/experiencePresets";
import {
  NAV_PATTERNS, NAV_RAIL_MIN_WIDTH, commandEntries, effectiveNavPattern, normalizeNavPattern,
} from "@/lib/navigationPattern";
import { RAIL_BOTTOM_RESERVATION, syncReservedTabBarHeight } from "@/lib/tabBarLayout";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readSrc = (rel) => readFileSync(join(srcRoot, rel), "utf8");
const root = document.documentElement;

function setPattern(value) {
  root.dataset.experienceNavigation = value;
}

function renderDock(path = "/chat") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HomeDock variant="fixed" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.wide = false;
  mocks.steward = false;
  window.matchMedia = vi.fn((query) => ({
    addListener: vi.fn(),
    removeListener: vi.fn(),
    matches: query.includes(`${NAV_RAIL_MIN_WIDTH}px`) ? mocks.wide : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete root.dataset.experienceNavigation;
  delete root.dataset.keyboardOpen;
  root.style.removeProperty("--tab-bar-height");
});

describe("navigation pattern options", () => {
  it("implements exactly the options the Appearance Studio setting offers", () => {
    expect([...NAV_PATTERNS]).toEqual(PRESET_FIELDS.navigation);
    expect(normalizeNavPattern("__proto__")).toBe("tabs");
  });

  it("uses the rail only on iPad-and-wider screens and falls back to tabs on phones", () => {
    expect(effectiveNavPattern("rail", { wide: true })).toBe("rail");
    expect(effectiveNavPattern("rail", { wide: false })).toBe("tabs");
    expect(effectiveNavPattern("command", { wide: false })).toBe("command");
    expect(effectiveNavPattern(undefined)).toBe("tabs");
    expect(NAV_RAIL_MIN_WIDTH).toBeLessThanOrEqual(820);
  });

  it("builds command entries from the dock and Explore (Settings yes, Sign Out no)", () => {
    const entries = commandEntries(DOCK_TABS, exploreModules(EXPLORE_MODULES, { isSteward: false }));
    const labels = entries.map((e) => e.label);
    expect(labels.slice(0, 5)).toEqual(["Talk", "People", "World", "You", "Moments"]);
    expect(labels).toContain("Settings");
    expect(labels).toContain("Home");
    expect(labels).not.toContain("Sign Out");
    expect(labels).not.toContain("Repo Workspace");
    expect(commandEntries(DOCK_TABS, exploreModules(EXPLORE_MODULES, { isSteward: true })).map((e) => e.label)).toContain("Repo Workspace");
    expect(commandEntries(DOCK_TABS, exploreModules(EXPLORE_MODULES), "sett").map((e) => e.label)).toEqual(["Settings"]);
  });
});

describe("Tabs (default)", () => {
  it("keeps the floating five-tab dock", () => {
    renderDock("/chat");
    expect(screen.getByTestId("app-dock")).toBeTruthy();
    expect(screen.queryByTestId("nav-rail")).toBeNull();
    expect(screen.queryByTestId("command-bar")).toBeNull();
    expect(root.dataset.navMode).toBe("tabs");
  });

  it("shows the five-tab dock when Rail is chosen on a phone", () => {
    setPattern("rail");
    renderDock("/chat");
    expect(screen.getByTestId("app-dock")).toBeTruthy();
    expect(screen.queryByTestId("nav-rail")).toBeNull();
    expect(root.dataset.navMode).toBe("tabs");
  });
});

describe("Rail", () => {
  beforeEach(() => {
    mocks.wide = true;
    setPattern("rail");
  });

  it("renders a side rail with the five destinations and no bottom bar", () => {
    renderDock("/chat");
    const rail = screen.getByTestId("nav-rail");
    expect(rail.classList.contains("nav-rail")).toBe(true);
    expect(within(rail).getAllByRole("button").map((b) => b.textContent)).toEqual(["Talk", "People", "World", "You", "Moments"]);
    expect(screen.queryByTestId("bottom-tab-bar")).toBeNull();
    expect(root.dataset.navMode).toBe("rail");
    expect(root.style.getPropertyValue("--nav-rail-width")).toBe("76px");
  });

  it.each([
    ["/chat/abc", "Talk"], ["/animas", "People"], ["/cyberworld", "World"],
    ["/settings", "You"], ["/memories", "Moments"],
  ])("marks the right rail tab active on %s", (path, label) => {
    renderDock(path);
    const rail = screen.getByTestId("nav-rail");
    expect(within(rail).getByRole("button", { name: label }).getAttribute("aria-current")).toBe("page");
    expect(within(rail).getAllByRole("button").filter((b) => b.getAttribute("aria-current")).length).toBe(1);
  });

  it("opens Explore (with Settings) from World and navigates from the rail", () => {
    renderDock("/chat");
    const rail = screen.getByTestId("nav-rail");
    fireEvent.click(within(rail).getByRole("button", { name: "World" }));
    const explore = screen.getByTestId("explore-menu");
    fireEvent.click(within(explore).getByRole("button", { name: /Settings/ }));
    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
    fireEvent.click(within(rail).getByRole("button", { name: "Moments" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/memories");
  });

  it("reserves only the home indicator under the chat composer (keyboard still zeroes it)", () => {
    renderDock("/chat");
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe(RAIL_BOTTOM_RESERVATION);
    syncReservedTabBarHeight(root, { keyboardOpen: true });
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("0px");
    syncReservedTabBarHeight(root, { keyboardOpen: false });
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe(RAIL_BOTTOM_RESERVATION);
  });

  it("shifts the shell right of the rail, keeps the safe-area insets, and clears on unmount", () => {
    const css = readSrc("index.css");
    expect(css).toMatch(/html\[data-nav-mode="rail"\] \.app-shell \{\s*padding-left: calc\(var\(--nav-rail-width, 76px\) \+ var\(--safe-left, env\(safe-area-inset-left, 0px\)\)\);/);
    expect(css).toMatch(/html\[data-nav-mode="rail"\] #explore-menu \{/);
    const { unmount } = renderDock("/chat");
    const style = screen.getByTestId("nav-rail").getAttribute("style");
    expect(style).toContain("env(safe-area-inset-bottom, 0px)");
    expect(style).toContain("env(safe-area-inset-top, 0px)");
    unmount();
    expect(root.dataset.navMode).toBeUndefined();
    expect(root.style.getPropertyValue("--nav-rail-width")).toBe("");
  });
});

describe("Command", () => {
  beforeEach(() => setPattern("command"));

  it("renders a compact command bar that still reserves its height for the composer", () => {
    renderDock("/settings");
    const bar = screen.getByTestId("bottom-tab-bar");
    expect(bar.classList.contains("tab-bar")).toBe(true);
    expect(bar.classList.contains("fixed-bottom-chrome")).toBe(true);
    expect(bar.getAttribute("style")).toContain("var(--safe-bottom, env(safe-area-inset-bottom, 0px))");
    expect(within(bar).getByTestId("command-bar")).toBeTruthy();
    expect(screen.getByTestId("command-current").textContent).toBe("You");
    expect(root.dataset.navMode).toBe("command");
  });

  it("marks Talk / World active by route", () => {
    renderDock("/chat/1");
    expect(screen.getByRole("button", { name: "Talk" }).getAttribute("aria-current")).toBe("page");
    cleanup();
    renderDock("/worldmap");
    expect(screen.getByRole("button", { name: "World" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Talk" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens the palette from the bar, filters, and navigates with Enter", () => {
    renderDock("/chat");
    fireEvent.click(screen.getByTestId("command-open"));
    const input = screen.getByTestId("command-input");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "sett" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("toggles with ⌘K / Ctrl+K, moves with arrows, and closes with Escape", () => {
    renderDock("/memories");
    act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });
    const palette = screen.getByTestId("command-palette");
    const options = within(palette).getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(palette.querySelector('[data-command-entry="moments"]').getAttribute("aria-current")).toBe("page");
    const input = screen.getByTestId("command-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).toBeNull();
    act(() => { fireEvent.keyDown(window, { key: "k", metaKey: true }); });
    expect(screen.getByTestId("command-palette")).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("routes dock entries through the dock handlers (World opens Explore, Talk opens chat)", () => {
    renderDock("/settings");
    fireEvent.click(screen.getByTestId("command-open"));
    fireEvent.click(screen.getByTestId("command-palette").querySelector('[data-command-entry="world"]'));
    expect(screen.getByTestId("explore-menu")).toBeTruthy();
    fireEvent.click(screen.getByTestId("command-open"));
    expect(screen.getByRole("button", { name: "World" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByTestId("command-palette").querySelector('[data-command-entry="talk"]'));
    expect(mocks.navigate).toHaveBeenCalledWith("/chat");
  });

  it("keeps the selection in view, traps Tab, and returns focus to the trigger", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderDock("/chat");
    const trigger = screen.getByTestId("command-open");
    trigger.focus();
    fireEvent.click(trigger);
    const input = screen.getByTestId("command-input");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const options = within(screen.getByTestId("command-palette")).getAllByRole("option");
    expect(options[options.length - 1].getAttribute("aria-selected")).toBe("true");
    expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
    const close = screen.getByRole("button", { name: "Close command palette" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    delete Element.prototype.scrollIntoView;
  });

  it("caps the palette list to the keyboard-visible viewport", () => {
    renderDock("/chat");
    fireEvent.click(screen.getByTestId("command-open"));
    expect(screen.getByRole("listbox").getAttribute("style")).toContain("var(--app-height, 100dvh)");
  });

  it("does not bind ⌘K in the other patterns", () => {
    setPattern("tabs");
    renderDock("/chat");
    act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });
});

describe("live switching", () => {
  it("follows Appearance Studio without a reload", async () => {
    mocks.wide = true;
    renderDock("/chat");
    expect(screen.getByTestId("app-dock")).toBeTruthy();
    await act(async () => { setPattern("rail"); await Promise.resolve(); });
    expect(await screen.findByTestId("nav-rail")).toBeTruthy();
    await act(async () => { setPattern("command"); await Promise.resolve(); });
    expect(await screen.findByTestId("command-bar")).toBeTruthy();
  });
});

describe("home floor", () => {
  it("keeps the in-flow home dock regardless of the pattern", () => {
    mocks.wide = true;
    setPattern("rail");
    render(<MemoryRouter initialEntries={["/"]}><HomeDock /></MemoryRouter>);
    expect(screen.getByTestId("home-dock")).toBeTruthy();
    expect(screen.queryByTestId("nav-rail")).toBeNull();
  });
});
