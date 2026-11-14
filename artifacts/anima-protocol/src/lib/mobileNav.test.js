import { describe, expect, it } from "vitest";
import {
  DOCK_TABS,
  dockOrExploreReach,
  dockTabForPath,
  exploreModules,
  EXPLORE_MODULES,
  hidesAppDock,
  LEGACY_BAR_DESTINATIONS,
  PRIMARY_TABS,
} from "@/lib/mobileNav";

describe("dock tabs", () => {
  it("keeps a five-tab footer with Explore folded into World", () => {
    expect(DOCK_TABS.map((t) => t.label)).toEqual([
      "Talk",
      "People",
      "World",
      "You",
      "Moments",
    ]);
    expect(DOCK_TABS.find((t) => t.id === "world").opensExplore).toBe(true);
    expect(PRIMARY_TABS.some((t) => t.path === "/")).toBe(false);
    expect(EXPLORE_MODULES.some((m) => m.label === "Home" && m.path === "/")).toBe(true);
    expect(EXPLORE_MODULES.some((m) => m.label === "Settings" && m.path === "/settings")).toBe(true);
  });
});

describe("dockTabForPath", () => {
  it("maps chat, companions, world/explore, settings/profile, and memories/moments", () => {
    expect(dockTabForPath("/chat")).toBe("talk");
    expect(dockTabForPath("/chat/sess-1")).toBe("talk");
    expect(dockTabForPath("/animas")).toBe("people");
    expect(dockTabForPath("/characters")).toBe("people");
    expect(dockTabForPath("/groups")).toBe("people");
    expect(dockTabForPath("/companion-generator")).toBe("people");
    expect(dockTabForPath("/explore")).toBe("world");
    expect(dockTabForPath("/cyberworld")).toBe("world");
    expect(dockTabForPath("/worldmap")).toBe("world");
    expect(dockTabForPath("/constellation")).toBe("world");
    expect(dockTabForPath("/settings")).toBe("you");
    expect(dockTabForPath("/profile")).toBe("you");
    expect(dockTabForPath("/memories")).toBe("moments");
    expect(dockTabForPath("/moments/a1")).toBe("moments");
  });

  it("treats an open Explore menu as the World tab and leaves home unselected", () => {
    expect(dockTabForPath("/chat", { exploreOpen: true })).toBe("world");
    expect(dockTabForPath("/")).toBeNull();
    expect(dockTabForPath("/sign-in")).toBeNull();
  });
});

describe("hidesAppDock", () => {
  it("hides auth and onboarding routes, not chat or home", () => {
    expect(hidesAppDock("/sign-in")).toBe(true);
    expect(hidesAppDock("/sign-up/sso")).toBe(true);
    expect(hidesAppDock("/onboarding")).toBe(true);
    expect(hidesAppDock("/legacy-onboarding")).toBe(true);
    expect(hidesAppDock("/chat")).toBe(false);
    expect(hidesAppDock("/")).toBe(false);
  });
});

describe("exploreModules catalogue", () => {
  it("keeps Home and Settings, and drops other dock roots and non-steward codespaces", () => {
    const visible = exploreModules(EXPLORE_MODULES);
    const paths = visible.map((m) => m.path.split("?")[0]);
    expect(paths).toContain("/");
    expect(paths).toContain("/settings");
    expect(visible.some((m) => m.label === "Settings")).toBe(true);
    expect(paths).not.toContain("/chat");
    expect(paths).not.toContain("/animas");
    expect(paths).not.toContain("/memories");
    expect(paths).not.toContain("/codespace");
    expect(exploreModules(EXPLORE_MODULES, { isSteward: true }).map((m) => m.path)).toContain(
      "/repo-codespace",
    );
  });
});

describe("legacy six-tab bar reachability", () => {
  it("reaches every old-bar destination from the dock or Explore", () => {
    for (const dest of LEGACY_BAR_DESTINATIONS) {
      if (dest.signOut) {
        expect(
          EXPLORE_MODULES.some((m) => m.signOut && m.label === "Sign Out"),
          "Sign Out should stay in Explore",
        ).toBe(true);
        continue;
      }
      const reach = dockOrExploreReach(dest.path, { isSteward: Boolean(dest.stewardOnly) });
      expect(
        reach.dock || reach.explore,
        `${dest.label} (${dest.path}) should be reachable from the dock or Explore`,
      ).toBe(true);
    }
  });

  it("lists Settings in Explore and keeps You as the /settings dock tab", () => {
    expect(dockOrExploreReach("/settings")).toEqual({ dock: true, explore: true });
    expect(dockTabForPath("/settings")).toBe("you");
    expect(DOCK_TABS.find((t) => t.id === "you").path).toBe("/settings");
  });
});
