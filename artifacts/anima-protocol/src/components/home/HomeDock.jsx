// @ts-check
import { MessageCircle, Users, Globe, User, Images } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { animaClient } from "@/api/animaClient";
import { DOCK_TABS, dockTabForPath } from "@/lib/mobileNav";
import { syncReservedTabBarHeight } from "@/lib/tabBarLayout";
import ExploreMenu from "./ExploreMenu";

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
  const [exploreOpen, setExploreOpen] = useState(false);
  const [recentSessionId, setRecentSessionId] = useState(/** @type {string | null} */ (null));
  const tabBarRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const routeActive = dockTabForPath(location.pathname, { exploreOpen });
  const activeId = activeIdProp !== undefined ? activeIdProp : routeActive;

  useLayoutEffect(() => {
    if (!isFixed) return undefined;
    const root = document.documentElement;
    const sync = () => {
      syncReservedTabBarHeight(root, {
        keyboardOpen: root.dataset.keyboardOpen === "true",
      });
    };
    sync();

    const node = tabBarRef.current;
    if (!node || typeof ResizeObserver !== "function") {
      return () => {
        if (root.dataset.keyboardOpen === "true") return;
        root.style.removeProperty("--tab-bar-height");
      };
    }

    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (root.dataset.keyboardOpen === "true") return;
      root.style.removeProperty("--tab-bar-height");
    };
  }, [isFixed]);

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

  const closeExplore = () => setExploreOpen(false);

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

  const bar = (
    <nav
      data-home-dock
      data-testid={isFixed ? "app-dock" : "home-dock"}
      aria-label={isFixed ? "Main" : "Home"}
      className="flex w-full max-w-2xl items-stretch border border-cyan-400/20 bg-black/70 backdrop-blur-md"
    >
      {DOCK_TABS.map(({ id, label }) => {
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
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors ${
              active
                ? "bg-cyan-400/10 text-cyan-300"
                : "text-cyan-400/70 hover:bg-cyan-400/5 hover:text-cyan-300"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.6} />
            <span className="font-mono text-[8px] uppercase tracking-[0.2em]">{label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      <ExploreMenu open={exploreOpen} onClose={closeExplore} />
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
