// @ts-check
import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, BookOpen, Globe, Grid3x3, Home, X } from "lucide-react";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

const ALL_MODULES = [
  { label: "Sign Out", path: "/", icon: "⎋", signOut: true },
  { label: "Chat", path: "/chat", icon: "💬" },
  { label: "Hall of Origins", path: "/origins", icon: "✨" },
  { label: "Memory Crystals", path: "/memory-crystals", icon: "💎" },
  { label: "Codespace", path: "/codespace", icon: "⌨" },
  { label: "Settings", path: "/settings", icon: "⚙" },
  { label: "Storyboard", path: "/storyboard", icon: "📋" },
  { label: "Narrative", path: "/narrative", icon: "📊" },
  { label: "Flowchart", path: "/flowchart", icon: "⧖" },
  { label: "What-If", path: "/what-if", icon: "✦" },
  { label: "Quest Journal", path: "/quest-journal", icon: "📜" },
  { label: "World Map", path: "/worldmap", icon: "🌐" },
  { label: "Locations", path: "/locationsmap", icon: "📍" },
  { label: "Calendar", path: "/integrated-calendar", icon: "📅" },
  { label: "Chronicles", path: "/chronicles", icon: "⏳" },
  { label: "World Codex", path: "/worldcodex", icon: "📖" },
  { label: "Lore Book", path: "/lorebook", icon: "📚" },
  { label: "Journals", path: "/journals", icon: "📔" },
  { label: "Session Wiki", path: "/wiki", icon: "🗂" },
  { label: "Global Wiki", path: "/globalwiki", icon: "🌍" },
  { label: "Memory Map", path: "/memory-map", icon: "🧠" },
  { label: "Inventory", path: "/inventory", icon: "🎒" },
  { label: "Characters", path: "/characters", icon: "👥" },
  { label: "Check-In", path: "/check-in", icon: "✚" },
  { label: "Reflect Log", path: "/reflection-log", icon: "📝" },
];

const PINNED_TABS = [
  { path: "/", label: "Home", Icon: Home },
  { path: "/chat", label: "Chat", Icon: MessageSquare },
  { path: "/storyboard", label: "Board", Icon: BookOpen },
  { path: "/worldmap", label: "Map", Icon: Globe },
];

/**
 * @param {string} tabPath
 * @param {string} pathname
 */
function isTabActive(tabPath, pathname) {
  if (tabPath === "/") return pathname === "/";
  if (tabPath === "/chat") return pathname === "/chat" || pathname.startsWith("/chat/");
  return pathname === tabPath || pathname.startsWith(tabPath + "/");
}

export default function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [mostRecentSessionId, setMostRecentSessionId] = useState(null);

  useEffect(() => {
    base44.entities.ChatSession.list("-updated_date", 1).then(sessions => {
      if (sessions?.length > 0) setMostRecentSessionId(sessions[0].id);
    }).catch(() => {});
  }, []);

  const handleChatNav = () => {
    navigate("/chat");
  };

  const handleSignOut = () => {
    setOpen(false);
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
      {/* Sign Out Confirmation */}
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
              className="fixed left-1/2 top-1/2 z-[1001] w-[88%] max-w-xs -translate-x-1/2 -translate-y-1/2 bg-[#090912] border border-primary/30 shadow-[0_0_30px_rgba(34,211,238,0.15)]"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="signout-title"
            >
              <div className="px-5 py-3 border-b border-primary/10">
                <span className="font-mono text-[11px] tracking-[0.3em] text-primary/80 uppercase">// Confirm</span>
              </div>
              <div className="px-5 py-5">
                <p id="signout-title" className="text-sm text-primary/90 leading-relaxed">
                  Sign out of Anima Protocol?
                </p>
              </div>
              <div className="flex border-t border-primary/10">
                <button
                  onClick={() => setConfirmSignOut(false)}
                  className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-primary/50 hover:text-primary/80 hover:bg-primary/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAndSignOut}
                  className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-red-400 hover:text-red-300 hover:bg-red-500/10 border-l border-primary/10 transition-all"
                >
                  Sign Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* All Modules Overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed bottom-[52px] left-0 right-0 z-50 bg-[#090912] border-t border-primary/20 max-h-[65dvh] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10">
                <span className="font-mono text-[11px] tracking-[0.3em] text-primary/80 uppercase">// All Modules</span>
                <button onClick={() => setOpen(false)} className="text-primary/40 hover:text-primary transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-px bg-primary/5 p-px">
                {ALL_MODULES.map(({ label, path, icon, signOut }) => {
                  const isActive = isTabActive(path, location.pathname);
                  return (
                    <button
                      key={path}
                      onClick={signOut ? handleSignOut : () => { navigate(path); setOpen(false); }}
                      className={`flex flex-col items-center justify-center gap-2 py-5 px-3 bg-[#090912] transition-all ${
                        isActive ? "bg-primary/10 text-primary" : "text-primary/40 hover:bg-primary/5 hover:text-primary/70"
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

      {/* Bottom Tab Bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[999] bg-[#090912]/95 backdrop-blur-md border-t border-primary/20 flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", minHeight: "52px" }}
      >
        {PINNED_TABS.map(({ path, label, Icon }) => {
          const active = isTabActive(path, location.pathname);
          return (
            <button
              key={path}
              onClick={path === "/chat" ? handleChatNav : () => navigate(path)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-all relative ${
                active ? "text-primary" : "text-primary/30 hover:text-primary/60"
              }`}
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={active ? 2 : 1.5} />
              <span className="font-mono text-[8px] tracking-[0.15em] uppercase">{label}</span>
              {active && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-[1px] bg-primary shadow-[0_0_6px_#22d3ee]" />
              )}
            </button>
          );
        })}

        {/* More tab */}
        <button
          onClick={() => setOpen(v => !v)}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-all relative ${
            open ? "text-primary" : "text-primary/30 hover:text-primary/60"
          }`}
        >
          <Grid3x3 className="w-[18px] h-[18px]" strokeWidth={open ? 2 : 1.5} />
          <span className="font-mono text-[8px] tracking-[0.15em] uppercase">More</span>
          {open && (
            <span className="absolute bottom-0 left-1/4 right-1/4 h-[1px] bg-primary shadow-[0_0_6px_#22d3ee]" />
          )}
        </button>

        {/* Red status / check-in dot */}
        <button
          onClick={() => { navigate("/check-in"); setOpen(false); }}
          className="flex items-center justify-center w-12 flex-shrink-0 transition-all"
          title="Check-In"
        >
          <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse" />
        </button>
      </div>
    </>
  );
}