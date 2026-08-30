import { Suspense, lazy } from "react";
import { BrowserRouter } from "react-router-dom";
import useViewportHeight from "@/hooks/useViewportHeight";
import Landing from "./pages/Landing";
import { PageLoader } from "./app/PageLoader";

// Clerk, Auth, and the ~170-file route map live here — not in the HTML
// entry chunk — so first paint of `/` does not wait on clerk-js.
const ProtocolApp = lazy(() => import("./ProtocolApp"));

function stripBase(pathname) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (base && pathname.startsWith(base)) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}

function isLandingPath(pathname) {
  const path = stripBase(pathname);
  return path === "/" || path === "";
}

/**
 * Returning operators already have a Clerk session cookie or a companion
 * flag. Do not flash the marketing Landing while ProtocolApp + Clerk boot.
 */
export function hasLikelySession() {
  try {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("anima_has_companion") === "1"
    ) {
      return true;
    }
    if (typeof document !== "undefined") {
      const match = document.cookie.match(/(?:^|;\s*)__client_uat=(\d+)/);
      if (match && Number(match[1]) > 0) {
        return true;
      }
    }
    if (typeof localStorage === "undefined") {
      return false;
    }
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || "";
      if (key.startsWith("__clerk") || key.includes("clerk")) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export default function App() {
  useViewportHeight();

  const showLandingShell =
    typeof window !== "undefined" &&
    isLandingPath(window.location.pathname) &&
    !hasLikelySession();

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Suspense fallback={showLandingShell ? <Landing /> : <PageLoader />}>
        <ProtocolApp />
      </Suspense>
    </BrowserRouter>
  );
}
