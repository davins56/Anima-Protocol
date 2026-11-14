// @ts-check
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useModelTutor } from "@/hooks/useModelTutor";
import { EXPLORE_MODULES, exploreModules } from "@/lib/mobileNav";

/**
 * @param {string} tabPath
 * @param {string} pathname
 */
function isItemActive(tabPath, pathname) {
  const pathOnly = tabPath.split("?")[0];
  if (pathOnly === "/") return pathname === "/";
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

/**
 * Searchable Explore overlay, opened from the World dock tab.
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export default function ExploreMenu({ open, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { isSteward } = useModelTutor();
  const modules = exploreModules(EXPLORE_MODULES, { isSteward });
  const [filter, setFilter] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const filterText = filter.trim().toLowerCase();
  const shownModules = filterText
    ? modules.filter(({ label }) => label.toLowerCase().includes(filterText))
    : modules;

  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);

  const handleSignOut = () => {
    onClose();
    setConfirmSignOut(true);
  };

  const confirmAndSignOut = async () => {
    setConfirmSignOut(false);
    try {
      await logout("/");
    } catch (err) {
      console.error("Sign out failed:", err);
      navigate("/");
    }
  };

  return (
    <>
      <AnimatePresence>
        {confirmSignOut && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-sm"
              onClick={() => setConfirmSignOut(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 8 }}
              transition={{ type: "spring", damping: 28, stiffness: 360 }}
              className="fixed left-1/2 top-1/2 z-[1001] w-[88%] max-w-xs -translate-x-1/2 -translate-y-1/2 bg-card border border-cyan-400/30 shadow-[0_0_30px_rgba(34,211,238,0.15)]"
              role="alertdialog"
              data-glass-surface="modal"
              aria-modal="true"
              aria-labelledby="signout-title"
            >
              <div className="px-5 py-3 border-b border-cyan-400/10">
                <span className="font-mono text-[11px] tracking-[0.3em] text-cyan-400/80 uppercase">// Confirm</span>
              </div>
              <div className="px-5 py-5">
                <p id="signout-title" className="text-sm text-cyan-100/90 leading-relaxed">
                  Sign out of Anima Protocol?
                </p>
              </div>
              <div className="flex border-t border-cyan-400/10">
                <button
                  type="button"
                  onClick={() => setConfirmSignOut(false)}
                  className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-cyan-400/50 hover:text-cyan-300 hover:bg-cyan-400/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmAndSignOut}
                  className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-red-400 hover:text-red-300 hover:bg-red-500/10 border-l border-cyan-400/10 transition-all"
                >
                  Sign Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
              data-no-swipe
              onClick={onClose}
            />
            <motion.div
              id="explore-menu"
              data-glass-surface="menu"
              data-testid="explore-menu"
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-cyan-400/20 max-h-[80dvh] overflow-y-auto overscroll-contain"
              role="dialog"
              aria-modal="true"
              aria-label="Explore"
              data-no-swipe
              data-scroll-preserve
              onTouchStartCapture={(e) => e.stopPropagation()}
              onTouchMoveCapture={(e) => e.stopPropagation()}
              onTouchEndCapture={(e) => e.stopPropagation()}
              style={{
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
                touchAction: "pan-y",
              }}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-400/10">
                <span className="font-mono text-[11px] tracking-[0.3em] text-cyan-400/80 uppercase">// Explore</span>
                <button type="button" onClick={onClose} aria-label="Close Explore" className="text-cyan-400/40 hover:text-cyan-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-4 py-2 border-b border-cyan-400/10">
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter pages…"
                  aria-label="Filter Explore pages"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="go"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && shownModules.length === 1 && !shownModules[0].signOut) {
                      navigate(shownModules[0].path);
                      onClose();
                    }
                  }}
                  data-testid="explore-filter"
                  className="w-full bg-input border border-border text-cyan-100/80 placeholder-cyan-400/25 font-mono text-base sm:text-xs px-3 py-2 focus:outline-none focus:border-cyan-400/50"
                />
              </div>
              <div
                className="grid grid-cols-3 gap-px bg-cyan-400/5 p-px"
                style={{ paddingBottom: "calc(var(--tab-bar-height, 72px) + 16px)" }}
                data-no-swipe
              >
                {shownModules.length === 0 && (
                  <p className="col-span-3 bg-card py-6 text-center font-mono text-[10px] tracking-widest uppercase text-cyan-400/40">
                    No pages match “{filter.trim()}”
                  </p>
                )}
                {shownModules.map(({ label, path, icon, signOut }) => {
                  const isActive = !signOut && isItemActive(path, location.pathname);
                  return (
                    <button
                      key={signOut ? "sign-out" : `${label}-${path}`}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={signOut ? handleSignOut : () => { navigate(path); onClose(); }}
                      className={`flex flex-col items-center justify-center gap-2 py-5 px-3 bg-card transition-all ${
                        isActive ? "bg-cyan-400/10 text-cyan-300" : "text-cyan-400/40 hover:bg-cyan-400/5 hover:text-cyan-300/80"
                      }`}
                    >
                      <span className="text-xl leading-none">{icon}</span>
                      <span className="font-mono text-[8px] tracking-[0.15em] uppercase text-center leading-tight">{label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
