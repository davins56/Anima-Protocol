import { useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// Routes where the back button should NOT appear
const ROOT_ROUTES = new Set(["/", "/landing", "/onboarding"]);

// Human-readable titles for routes
const ROUTE_TITLES = {
  "/characters": "Characters",
  "/groups": "Groups",
  "/chronicles": "Chronicles",
  "/animas": "Animas",
  "/meditation": "Sacred Space",
  "/settings": "Settings",
  "/lorebook": "Lore Book",
  "/quest-journal": "Quest Journal",
  "/journals": "Journals",
  "/wiki": "Wiki",
  "/archive": "Lore Archive",
  "/inventory": "Inventory",
  "/worldmap": "World Map",
  "/storyboard": "Storyboard",
  "/reflections": "Reflections",
  "/insights": "Insights",
  "/subscription": "Subscription",
  "/terms": "Terms of Service",
  "/privacy-policy": "Privacy Policy",
  "/disclaimer": "Disclaimer",
  "/ai-behavior": "AI Behavior",
  "/companion-generator": "Companion Generator",
  "/what-if": "What-If Scenarios",
  "/discoveries": "Discoveries",
  "/check-in": "Check-In",
  "/codespace": "Codespace",
};

function getTitle(pathname) {
  // Exact match first
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  // Prefix match for dynamic routes like /chat/:id, /quests/:id, etc.
  const prefix = "/" + pathname.split("/")[1];
  return ROUTE_TITLES[prefix] || null;
}

export default function MobileHeader() {
  const location = useLocation();
  const navigate = useNavigate();

  const pathname = location.pathname;
  const isRoot = ROOT_ROUTES.has(pathname) || pathname.startsWith("/chat");

  if (isRoot) return null;

  const title = getTitle(pathname);
  if (!title) return null;

  return (
    <div className="lg:hidden flex items-center h-11 px-2 border-b border-primary/20 bg-black/80 backdrop-blur-md z-40 flex-shrink-0">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 px-2 py-2 text-primary/60 hover:text-primary transition-colors touch-target"
        aria-label="Go back"
      >
        <ChevronLeft className="w-5 h-5" />
        <span className="font-mono text-[10px] tracking-widest uppercase">Back</span>
      </button>
      <h1 className="flex-1 text-center font-mono text-[11px] tracking-[0.25em] uppercase text-primary/80 pr-12">
        {title}
      </h1>
    </div>
  );
}