// @ts-check
import { MessageCircle, Users, Globe, User, Images, Command } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { animaClient } from "@/api/animaClient";
import { DOCK_TABS, dockTabForPath } from "@/lib/mobileNav";
import { syncReservedTabBarHeight } from "@/lib/tabBarLayout";
import { useNavigationPattern } from "@/hooks/useNavigationPattern";
import { NAV_RAIL_WIDTH } from "@/lib/navigationPattern";
import ExploreMenu from "./ExploreMenu";
import CommandPalette from "./CommandPalette";

const ICONS = {
  talk: MessageCircle,
  people: Users,
  world: Globe,
  you: User,
  moments: Images,
};

/**
 * Shared five-tab footer: Talk, People, World, You, Moments.
 *
 * `variant="inline"` sits in the home floor column.
 * `variant="fixed"` is the floating chrome on every other signed-in route.
 * World always opens the Explore menu so it is reachable from every screen.
 *
 * The fixed variant follows Appearance Studio → Navigation
 * (lib/navigationPattern.js): `tabs` (this bottom dock), `rail` (side rail
 * on ≥768px, tabs on phones) or `command` (compact command bar + ⌘K
 * palette). Every mechanic uses the same handlers, destinations and
 * route → tab mapping. Home keeps its in-flow dock.
 *
 * @param {{
 *   variant?: "inline" | "fixed",
 *   activeId?: string | null,
 *   onTalk?: () => void,
 *   onPeople?: () => void,
 *   onWorld?: () => void,
 *   onYou?: () => void,
 *   onMoments?: () => void,
 * }} props
 */
export default function HomeDock({
  variant = "inline",
  activeId: activeIdProp,
  onTalk,
  onPeople,
  onWorld,
  onYou,
  onMoments,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isFixed = variant === "fixed";
  const pattern = useNavigationPattern();
  const mode = isFixed ? pattern : "tabs";
  const [exploreOpen, setExploreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recentSessionId, setRecentSessionId] = useState(/** @type {string | null} */ (null));
  const tabBarRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const routeActive = dockTabForPath(location.pathname, { exploreOpen });
  const activeId = activeIdProp !== undefined ? activeIdProp : routeActive;

  useLayoutEffect(() => {
    if (!isFixed) return undefined;
    const root = document.documentElement;
    root.dataset.navMode = mode;
    if (mode === "rail") root.style.setProperty("--nav-rail-width", NAV_RAIL_WIDTH);
    else root.style.removeProperty("--nav-rail-width");
    const sync = () => {
      syncReservedTabBarHeight(root, {
        keyboardOpen: root.dataset.keyboardOpen === "true",
      });
    };
    sync();

    const release = () => {
      delete root.dataset.navMode;
      root.style.removeProperty("--nav-rail-width");
      if (root.dataset.keyboardOpen === "true") return;
      root.style.removeProperty("--tab-bar-height");
    };

    const node = tabBarRef.current;
    if (!node || typeof ResizeObserver !== "function") return release;

    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      observer.disconnect();
      release();
    };
  }, [isFixed, mode]);

  // Command: ⌘K / Ctrl+K toggles the palette; Escape closes it anywhere.
  useEffect(() => {
    if (mode !== "command") {
      setPaletteOpen(false);
      return undefined;
    }
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setExploreOpen(false);
        setPaletteOpen((open) => !open);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  useEffect(() => {
    if (!isFixed) return undefined;
    let cancelled = false;
    animaClient.entities.ChatSession.list("-updated_date", 1)
      .then((sessions) => {
        if (!cancelled && sessions?.length > 0) setRecentSessionId(sessions[0].id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isFixed]);

  const closeExplore = () => {
    setExploreOpen(false);
    setPaletteOpen(false);
  };

  const handlers = {
    talk: () => {
      closeExplore();
      if (onTalk) return onTalk();
      if (recentSessionId) navigate(`/chat/${recentSessionId}`);
      else navigate("/chat");
    },
    people: () => {
      closeExplore();
      if (onPeople) return onPeople();
      navigate("/animas");
    },
    world: () => {
      // Explore lives on World in both variants, including home, so the
      // menu is reachable from every screen. onWorld is unused for the
      // dock button (kept in the signature so older call sites typecheck).
      void onWorld;
      setPaletteOpen(false);
      setExploreOpen((open) => !open);
    },
    you: () => {
      closeExplore();
      if (onYou) return onYou();
      navigate("/settings");
    },
    moments: () => {
      closeExplore();
      if (onMoments) return onMoments();
      navigate("/memories");
    },
  };

  /** @param {{ id: string, label: string }} tab @param {"row" | "rail"} layout */
  const tabButton = ({ id, label }, layout) => {
    const Icon = ICONS[id];
    const active = activeId === id;
    const isWorld = id === "world";
    return (
      <button
        key={id}
        type="button"
        onClick={handlers[id]}
        aria-current={active ? "page" : undefined}
        aria-expanded={isWorld ? exploreOpen : undefined}
        aria-haspopup={isWorld ? "dialog" : undefined}
        aria-controls={isWorld ? "explore-menu" : undefined}
        className={`flex min-w-0 flex-col items-center justify-center gap-1 transition-colors ${
          layout === "rail" ? "w-full py-3" : "flex-1 py-3"
        } ${
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.6} />
        <span className="font-mono text-[8px] uppercase tracking-[0.2em]">{label}</span>
      </button>
    );
  };

  /** @param {import("@/lib/navigationPattern").CommandEntry} entry */
  const onCommand = (entry) => {
    setPaletteOpen(false);
    if (entry.kind === "tab") {
      handlers[/** @type {keyof typeof handlers} */ (entry.id)]?.();
      return;
    }
    setExploreOpen(false);
    if (entry.path) navigate(entry.path);
  };

  const overlays = (
    <>
      <ExploreMenu open={exploreOpen} onClose={closeExplore} />
      {mode === "command" && (
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={onCommand} />
      )}
    </>
  );

  if (mode === "rail") {
    return (
      <>
        {overlays}
        <nav
          ref={/** @type {any} */ (tabBarRef)}
          data-home-dock
          data-nav-rail
          data-glass-surface="dock"
          data-testid="nav-rail"
          aria-label="Main"
          className="nav-rail fixed left-0 top-0 bottom-0 z-[999] flex flex-col items-stretch justify-center gap-1 border-r border-border bg-card/80 backdrop-blur-md text-foreground"
          style={{
            width: `calc(var(--nav-rail-width, ${NAV_RAIL_WIDTH}) + var(--safe-left, env(safe-area-inset-left, 0px)))`,
            paddingLeft: "var(--safe-left, env(safe-area-inset-left, 0px))",
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {DOCK_TABS.map((tab) => tabButton(tab, "rail"))}
        </nav>
      </>
    );
  }

  if (mode === "command") {
    const current = DOCK_TABS.find((t) => t.id === activeId);
    const talkActive = activeId === "talk";
    const worldActive = activeId === "world";
    return (
      <>
        {overlays}
        <div
          ref={tabBarRef}
          data-testid="bottom-tab-bar"
          className="tab-bar fixed-bottom-chrome fixed bottom-0 left-0 right-0 z-[999] flex justify-center"
          style={{
            paddingLeft: "1rem",
            paddingRight: "1rem",
            paddingTop: "6px",
            paddingBottom: "calc(6px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))",
          }}
        >
          <nav
            data-home-dock
            data-command-bar
            data-glass-surface="dock"
            data-testid="command-bar"
            aria-label="Main"
            className="flex w-full max-w-md items-stretch rounded-full border border-border bg-card/80 backdrop-blur-md text-foreground overflow-hidden"
          >
            <button
              type="button"
              onClick={handlers.talk}
              aria-current={talkActive ? "page" : undefined}
              aria-label="Talk"
              className={`flex items-center justify-center px-4 py-2.5 ${talkActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary"}`}
            >
              <MessageCircle className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              data-testid="command-open"
              onClick={() => {
                setExploreOpen(false);
                setPaletteOpen((open) => !open);
              }}
              aria-haspopup="dialog"
              aria-expanded={paletteOpen}
              aria-label={`Go to… (current: ${current ? current.label : "Home"})`}
              className="flex min-w-0 flex-1 items-center gap-2 border-x border-border px-4 py-2.5 text-left text-muted-foreground hover:text-primary"
            >
              <Command className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] truncate">Go to…</span>
              <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.2em] text-[hsl(var(--primary))]" data-testid="command-current">
                {current ? current.label : ""}
              </span>
            </button>
            <button
              type="button"
              onClick={handlers.world}
              aria-current={worldActive ? "page" : undefined}
              aria-label="World"
              aria-expanded={exploreOpen}
              aria-haspopup="dialog"
              aria-controls="explore-menu"
              className={`flex items-center justify-center px-4 py-2.5 ${worldActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-primary"}`}
            >
              <Globe className="h-[18px] w-[18px]" />
            </button>
          </nav>
        </div>
      </>
    );
  }

  const bar = (
    <nav
      data-home-dock
      data-glass-surface="dock"
      data-testid={isFixed ? "app-dock" : "home-dock"}
      aria-label={isFixed ? "Main" : "Home"}
      className="flex w-full max-w-2xl items-stretch border border-border bg-card/80 backdrop-blur-md text-foreground"
    >
      {DOCK_TABS.map((tab) => tabButton(tab, "row"))}
    </nav>
  );

  return (
    <>
      {overlays}
      {isFixed ? (
        <div
          ref={tabBarRef}
          data-testid="bottom-tab-bar"
          className="tab-bar fixed-bottom-chrome fixed bottom-0 left-0 right-0 z-[999] flex justify-center"
          style={{
            paddingLeft: "1rem",
            paddingRight: "1rem",
            paddingTop: "8px",
            paddingBottom: "calc(8px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))",
          }}
        >
          {bar}
        </div>
      ) : (
        bar
      )}
    </>
  );
}
