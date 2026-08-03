import { Link, useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, Users, Settings, Sparkles, Heart, Menu, X, BookOpen, Home } from "lucide-react";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { base44 } from "@/api/base44Client";

// Paths where we want to preserve scroll position across tab switches
const SCROLL_PRESERVED_PATHS = ["/", "/chat"];

// Per-tab last-visited path — maps tab root path → last full path visited within that tab
const TAB_ROOTS = ["/", "/characters", "/chronicles", "/animas", "/meditation", "/settings"];

function getTabRoot(pathname) {
  // Find the longest matching tab root
  return TAB_ROOTS.slice().sort((a, b) => b.length - a.length).find(root =>
    root === "/" ? pathname === "/" || pathname.startsWith("/chat") : pathname.startsWith(root)
  ) || "/";
}

function saveTabPath(tabRoot, pathname) {
  sessionStorage.setItem(`tab_path_${tabRoot.replace(/\//g, "_") || "root"}`, pathname);
}

function getTabPath(tabRoot) {
  return sessionStorage.getItem(`tab_path_${tabRoot.replace(/\//g, "_") || "root"}`) || tabRoot;
}

function saveScrollPosition(pathname) {
  const key = `scroll_pos_${pathname.replace(/\//g, "_") || "root"}`;
  const scrollEl = document.querySelector("[data-scroll-preserve]") || document.querySelector(".overflow-y-auto");
  if (scrollEl) sessionStorage.setItem(key, String(scrollEl.scrollTop));
}

function restoreScrollPosition(pathname) {
  const key = `scroll_pos_${pathname.replace(/\//g, "_") || "root"}`;
  const saved = sessionStorage.getItem(key);
  if (!saved) return;
  requestAnimationFrame(() => {
    const scrollEl = document.querySelector("[data-scroll-preserve]") || document.querySelector(".overflow-y-auto");
    if (scrollEl) scrollEl.scrollTop = parseInt(saved, 10);
  });
}

const tabs = [
  { path: "/home", label: "Home", icon: Home },
  { path: "/", label: "Chat", icon: MessageSquare, special: "chat" },
  { path: "/characters", label: "Characters", icon: Users },
  { path: "/chronicles", label: "Chronicles", icon: BookOpen },
  { path: "/animas", label: "Animas", icon: Sparkles },
  { path: "/meditation", label: "Sacred", icon: Heart },
  { path: "/settings", label: "Settings", icon: Settings },
];

export default function BottomTabBar({ onMenuClick }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { handleTabClick, getActiveTab } = useTabNavigation();
  const [open, setOpen] = useState(false);
  const [mostRecentSessionId, setMostRecentSessionId] = useState(null);

  // Save scroll when leaving a preserved path
  const handleTabNavigate = useCallback((toPath, fromPath) => {
    const isPreserved = SCROLL_PRESERVED_PATHS.some(p => fromPath.startsWith(p));
    if (isPreserved) saveScrollPosition(fromPath);
  }, []);

  // Restore scroll when arriving at a preserved path
  useEffect(() => {
    const isPreserved = SCROLL_PRESERVED_PATHS.some(p => location.pathname.startsWith(p));
    if (isPreserved) restoreScrollPosition(location.pathname);
  }, [location.pathname]);

  // Save the current path under its tab root whenever location changes
  useEffect(() => {
    const root = getTabRoot(location.pathname);
    saveTabPath(root, location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    base44.entities.ChatSession.list("-updated_date", 1).then(sessions => {
      if (sessions?.length > 0) setMostRecentSessionId(sessions[0].id);
    }).catch(() => {});
  }, []);

  const activeTab = getActiveTab(location.pathname);
  const activeTabData = tabs.find(t => t.path === activeTab) || tabs[0];
  const ActiveIcon = activeTabData.icon;

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Vertical nav drawer — mobile: full width from bottom; desktop: left-anchored panel */}
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed z-50 border border-primary/30 bg-black/95 backdrop-blur-md overflow-y-auto
              /* mobile */ bottom-0 left-0 right-0 border-t
              /* desktop */ lg:bottom-14 lg:right-2 lg:left-auto lg:rounded-lg lg:w-52 lg:border"
            style={{ maxHeight: "60dvh", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <div className="flex flex-col py-2">
              {tabs.map(({ path, label, icon: Icon, special }) => {
                const isActive = activeTab === path;
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={(e) => {
                      e.preventDefault();
                      handleTabNavigate(path, location.pathname);
                      // For Chat tab, always go to most recent session
                      if (special === "chat" && mostRecentSessionId) {
                        navigate(`/chat/${mostRecentSessionId}`);
                      } else {
                        // Restore last visited path within this tab
                        const savedPath = getTabPath(path);
                        navigate(savedPath);
                      }
                      setOpen(false);
                    }}
                    className={`flex items-center gap-4 px-6 py-4 transition-all border-b border-primary/10 last:border-b-0 ${
                      isActive
                        ? "text-primary bg-primary/10"
                        : "text-primary/40 hover:text-primary/70 hover:bg-primary/5"
                    }`}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className={`font-mono text-sm tracking-[0.2em] uppercase ${isActive ? "glow-text" : ""}`}>
                      {label}
                    </span>
                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </Link>
                );
              })}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* Bottom bar — mobile, tablet & desktop */}
       <div
        className="fixed bottom-0 z-[999] border-t border-primary/20 bg-black/95 backdrop-blur-md tab-bar flex items-center justify-between px-3 min-h-[44px]
          left-0 right-0"
       style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <button
           onClick={() => setOpen(!open)}
           className="p-2 text-primary/60 hover:text-primary transition-colors flex-shrink-0"
           aria-label="Toggle menu"
           type="button"
         >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" pointerEvents="none">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-3 text-primary">
          <ActiveIcon className="w-5 h-5" />
          <span className="font-mono text-xs tracking-[0.2em] uppercase glow-text">{activeTabData.label}</span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="p-2 text-primary/50 hover:text-primary transition-colors"
          aria-label="Navigation menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>
    </>
  );
}