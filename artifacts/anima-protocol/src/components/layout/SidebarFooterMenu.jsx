// @ts-check
import { useState } from "react";
import {
  Menu,
  X,
  BookMarked,
  BookOpen,
  Newspaper,
  Map,
  Globe,
  Calendar,
  Lightbulb,
  Sparkles,
  GitGraph,
  Package,
  GitBranch,
  Layers,
  Library,
  Users,
  Settings,
  Zap,
  Scroll,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

/**
 * @param {{ activeSessionId?: string | null, onMobileMenuClick?: () => void }} [props]
 */
export default function SidebarFooterMenu({ activeSessionId, onMobileMenuClick } = { activeSessionId: null, onMobileMenuClick: undefined }) {
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    { icon: Settings, label: "Settings", path: "/settings", title: "Settings" },
    { icon: BookMarked, label: "Storyboard", path: "/storyboard", title: "Storyboard" },
    { icon: BookOpen, label: "Lore Book", path: "/lorebook", title: "Lore Book" },
    { icon: Newspaper, label: "Journals", path: "/journals", title: "Journals" },
    { icon: BookOpen, label: "Chronicles", path: "/chronicles", title: "Daily Chronicles" },
    { icon: Map, label: "World Map", path: "/worldmap", title: "World Map" },
    {
      icon: Globe,
      label: "Session Wiki",
      path: activeSessionId ? `/wiki?session=${activeSessionId}` : "/wiki",
      title: "Session Wiki",
    },
    { icon: Globe, label: "Global Wiki", path: "/globalwiki", title: "Global Wiki" },
    {
      icon: Calendar,
      label: "Calendar",
      path: activeSessionId ? `/calenderview?session=${activeSessionId}` : "/calenderview",
      title: "Calendar View",
    },
    { icon: Lightbulb, label: "World Codex", path: "/worldcodex", title: "World Codex" },
    {
      icon: Sparkles,
      label: "Narrative",
      path: activeSessionId ? `/narrative?session=${activeSessionId}` : "/narrative",
      title: "Narrative Dashboard",
    },
    {
      icon: GitGraph,
      label: "Flowchart",
      path: activeSessionId ? `/flowchart?session=${activeSessionId}` : "/flowchart",
      title: "Story Flowchart",
    },
    { icon: Map, label: "Locations", path: "/locationsmap", title: "Locations Map" },
    { icon: Package, label: "Inventory", path: "/inventory", title: "Inventory" },
    { icon: Scroll, label: "Quest Journal", path: "/quest-journal", title: "Quest Journal" },
    {
      icon: GitBranch,
      label: "Branching",
      path: activeSessionId ? `/branching?session=${activeSessionId}` : "/branching",
      title: "Story Branching",
    },
    { icon: Zap, label: "What-If", path: "/what-if", title: "What-If Scenarios" },
    { icon: Layers, label: "Memory Map", path: "/memory-map", title: "Character Memory Map" },
    { icon: Library, label: "Y/n Library", path: "/yn-library", title: "Y/n Stories Library" },
    { icon: Users, label: "Characters", path: "/characters-repository", title: "Character Repository" },
  ];

  return (
    <div className="flex items-center justify-between flex-1">
      {/* Desktop: Show all icons */}
      <div className="hidden lg:flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="text-primary/30 hover:text-primary transition-colors p-1"
            title={item.title}
          >
            <item.icon className="w-3 sm:w-4 h-3 sm:h-4" />
          </Link>
        ))}
      </div>

      {/* Mobile/Tablet: Hamburger menu */}
      <div className="lg:hidden flex items-center justify-end z-50">
        <button
          onClick={() => {
            // If wired from the Chat overlay, use that.
            // Otherwise, fall back to local popover.
            if (onMobileMenuClick) onMobileMenuClick();
            else setIsOpen(!isOpen);
          }}
          className="text-primary/50 hover:text-primary transition-colors p-2 relative"
          title="Menu"
          type="button"
        >
          <Menu className="w-4 h-4" />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed w-52 border border-primary/20 bg-black/95 backdrop-blur-md rounded shadow-lg z-[100]"
              style={{ bottom: "calc(var(--tab-bar-height, 56px) + 8px)", left: "8px" }}
            >
              <div className="flex items-center justify-between p-3 border-b border-primary/10">
                <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                  Navigation
                </span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-primary/40 hover:text-primary transition-colors"
                  type="button"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="max-h-96 overflow-y-auto p-2 space-y-1">
                {menuItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-primary/60 hover:text-primary hover:bg-primary/10 transition-all rounded text-[9px] font-mono"
                  >
                    <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}