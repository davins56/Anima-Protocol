import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";

const ROUTE_PANEL = ".app-shell-route";

function routePanel() {
  return /** @type {HTMLElement | null} */ (document.querySelector(ROUTE_PANEL));
}

/** Focus the main route panel (made focusable on demand). */
export function focusMainContent() {
  const panel = routePanel();
  if (!panel) return;
  if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
  if (!panel.id) panel.id = "main-content";
  panel.focus({ preventScroll: true });
}

/**
 * Skip links (visible on keyboard focus) plus focus management on navigation:
 * when the app section changes, focus moves to the new page's first heading
 * (or the route panel), so screen-reader and keyboard users land on the new
 * page instead of staying on the link they pressed. Thread switches inside
 * Chat (/chat/a -> /chat/b) keep focus where it is.
 */
export default function RouteFocus() {
  const location = useLocation();
  const section = location.pathname.split("/")[1] || "home";
  const previous = useRef(section);

  useEffect(() => {
    if (previous.current === section) return undefined;
    previous.current = section;
    // Wait for the lazy route to paint.
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      const panel = routePanel();
      const heading = /** @type {HTMLElement | null} */ (panel?.querySelector("h1, [data-route-heading]"));
      if (heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
        return;
      }
      if (tries++ < 10) {
        timer = window.setTimeout(attempt, 100);
        return;
      }
      focusMainContent();
    };
    timer = window.setTimeout(attempt, 50);
    return () => window.clearTimeout(timer);
  }, [section]);

  const onChat = section === "chat";
  const skipClass =
    "sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:px-4 focus:py-2 focus:bg-black focus:text-primary focus:border focus:border-primary/60 font-mono text-xs tracking-widest uppercase";

  return (
    <>
      <a
        href="#main-content"
        className={skipClass}
        onClick={(e) => {
          e.preventDefault();
          focusMainContent();
        }}
      >
        Skip to main content
      </a>
      {onChat ? (
        <a
          href="#chat-message"
          className={skipClass}
          onClick={(e) => {
            e.preventDefault();
            const box = /** @type {HTMLElement | null} */ (
              document.querySelector('[data-testid="chat-input-slot"] textarea')
            );
            box?.focus();
          }}
        >
          Skip to message box
        </a>
      ) : (
        <Link to="/chat" className={skipClass}>
          Skip to chat
        </Link>
      )}
    </>
  );
}
