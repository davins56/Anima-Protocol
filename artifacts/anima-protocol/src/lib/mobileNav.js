// @ts-check
/**
 * App dock (UI only). Five tabs — Talk, People, World, You, Moments.
 *
 * Explore (the searchable module menu from the old six-tab bar) is folded
 * into World so the footer stays five tabs and still fits a phone or iPad
 * with the home indicator. World opens Explore; World is also the active
 * tab on /explore and other world routes.
 *
 * Route → tab:
 *   /chat                        → Talk
 *   /animas, companions          → People
 *   /explore, world routes       → World
 *   /settings, /profile          → You
 *   /memories, /moments          → Moments
 *   / (home floor)               → none (home is reached from Explore)
 *
 * Settings stays on the You tab (/settings) and is also listed in Explore,
 * because the dock label is You, not Settings.
 *
 * Codespace / Repo Workspace stay steward-only in Explore — the API still
 * enforces its own checks; this only hides the entry.
 */

/**
 * @typedef {{ id: string, label: string, path?: string, opensExplore?: boolean }} DockTab
 */

/** @type {DockTab[]} */
export const DOCK_TABS = [
  { id: "talk", label: "Talk", path: "/chat" },
  { id: "people", label: "People", path: "/animas" },
  { id: "world", label: "World", opensExplore: true },
  { id: "you", label: "You", path: "/settings" },
  { id: "moments", label: "Moments", path: "/memories" },
];

/**
 * Dock destinations hidden from the Explore grid (World has no single path).
 * Kept as PRIMARY_TABS so existing exploreModules callers keep working.
 * @type {{ path: string, label: string, key: string }[]}
 */
export const PRIMARY_TABS = DOCK_TABS.filter((tab) => tab.path).map((tab) => ({
  path: tab.path,
  label: tab.label,
  key: tab.id,
}));

/**
 * Dock roots that still appear in Explore. Settings is listed because the
 * dock tab is labelled You, not Settings — the old bar had a Settings tab.
 * @type {Set<string>}
 */
export const EXPLORE_ALSO_LISTS = new Set(["/settings"]);

const PEOPLE_PREFIXES = [
  "/animas",
  "/characters",
  "/groups",
  "/companion-generator",
  "/customise-anima",
  "/customize",
];

const MOMENTS_PREFIXES = [
  "/memories",
  "/moments",
  "/memory-crystals",
  "/memory-map",
  "/what-she-remembers",
  "/journals",
  "/dreams",
];

const YOU_PREFIXES = [
  "/settings",
  "/profile",
  "/check-in",
  "/subscription",
  "/therapy",
  "/reflection-log",
  "/reflections",
  "/insights",
  "/ai-behavior",
];

const WORLD_PREFIXES = [
  "/explore",
  "/cyberworld",
  "/worldmap",
  "/worldcodex",
  "/world-pulse",
  "/world-timeline",
  "/world-calendar-dashboard",
  "/worldcalendar",
  "/integrated-calendar",
  "/constellation",
  "/origins",
  "/net-battle",
  "/storyboard",
  "/lorebook",
  "/chronicles",
  "/quest-journal",
  "/echo-keys",
  "/energy-fragments",
  "/inventory",
  "/codespace",
  "/repo-codespace",
  "/book-of-echoes",
  "/what-if",
  "/narrative",
  "/flowchart",
  "/locationsmap",
  "/wiki",
  "/globalwiki",
  "/meditation",
];

/**
 * @param {string} pathname
 * @param {string[]} prefixes
 */
function pathMatches(pathname, prefixes) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * @param {string} [pathname]
 * @param {{ exploreOpen?: boolean }} [opts]
 * @returns {string | null}
 */
export function dockTabForPath(pathname, opts = {}) {
  if (opts.exploreOpen) return "world";
  const path = pathname || "/";
  if (path === "/chat" || path.startsWith("/chat/")) return "talk";
  if (pathMatches(path, PEOPLE_PREFIXES)) return "people";
  if (pathMatches(path, MOMENTS_PREFIXES)) return "moments";
  if (pathMatches(path, YOU_PREFIXES)) return "you";
  if (pathMatches(path, WORLD_PREFIXES)) return "world";
  return null;
}

/**
 * Routes that should not show the fixed app dock. Home (`/`) is handled by
 * the caller — it uses the same dock in-flow instead of the fixed bar.
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function hidesAppDock(pathname) {
  if (!pathname) return true;
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) return true;
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return true;
  if (pathname === "/legacy-onboarding" || pathname.startsWith("/legacy-onboarding/")) return true;
  return false;
}

export const STEWARD_ONLY_PATHS = new Set(["/codespace", "/repo-codespace"]);

/**
 * Full Explore catalogue. Home is included because it is no longer a dock
 * tab. Settings is included even though You opens /settings, so it can be
 * found by name.
 * @type {{ label: string, path: string, icon: string, signOut?: boolean }[]}
 */
export const EXPLORE_MODULES = [
  { label: "Home", path: "/", icon: "⌂" },
  { label: "Settings", path: "/settings", icon: "⚙" },
  { label: "Hall of Origins", path: "/origins", icon: "✨" },
  { label: "Memory Crystals", path: "/memory-crystals", icon: "💎" },
  { label: "Constellation", path: "/constellation", icon: "🌌" },
  { label: "Book of Echoes", path: "/book-of-echoes", icon: "📖" },
  { label: "Dream journal", path: "/dreams", icon: "🌙" },
  { label: "Codespace", path: "/codespace", icon: "⌨" },
  { label: "Repo Workspace", path: "/repo-codespace", icon: "🖥" },
  { label: "NetBattle", path: "/net-battle", icon: "⚔" },
  { label: "Cyberworld", path: "/cyberworld", icon: "⌗" },
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
  { label: "Energy Fragments", path: "/energy-fragments", icon: "⬡" },
  { label: "Echo Keys", path: "/echo-keys", icon: "🔑" },
  { label: "Characters", path: "/characters", icon: "👥" },
  { label: "Customise Anima", path: "/customise-anima?tab=look", icon: "✦" },
  { label: "Check-In", path: "/check-in", icon: "✚" },
  { label: "Therapy Mode", path: "/therapy", icon: "♡" },
  { label: "Reflect Log", path: "/reflection-log", icon: "📝" },
  { label: "Sign Out", path: "/", icon: "⎋", signOut: true },
];

/**
 * @template {{ path: string, signOut?: boolean }} T
 * @param {T[]} modules
 * @param {{ isSteward?: boolean }} [opts]
 * @returns {T[]}
 */
export function exploreModules(modules, { isSteward = false } = {}) {
  const primary = new Set(PRIMARY_TABS.map((t) => t.path));
  return (Array.isArray(modules) ? modules : []).filter((m) => {
    if (!m || typeof m.path !== "string") return false;
    const pathOnly = m.path.split("?")[0];
    if (!m.signOut && primary.has(pathOnly) && !EXPLORE_ALSO_LISTS.has(pathOnly)) return false;
    if (STEWARD_ONLY_PATHS.has(pathOnly) && !isSteward) return false;
    return true;
  });
}

/**
 * Every destination the retired six-tab bar exposed: its five pinned tabs
 * plus the Explore catalogue (including Sign Out). Steward-only codespaces
 * stay hidden for everyone else, as they were.
 * @type {{ label: string, path: string, signOut?: boolean, stewardOnly?: boolean }[]}
 */
export const LEGACY_BAR_DESTINATIONS = [
  { label: "Chat", path: "/chat" },
  { label: "Companions", path: "/animas" },
  { label: "Memories", path: "/memories" },
  { label: "Home", path: "/" },
  { label: "Settings", path: "/settings" },
  { label: "Hall of Origins", path: "/origins" },
  { label: "Memory Crystals", path: "/memory-crystals" },
  { label: "Constellation", path: "/constellation" },
  { label: "Book of Echoes", path: "/book-of-echoes" },
  { label: "Codespace", path: "/codespace", stewardOnly: true },
  { label: "Repo Workspace", path: "/repo-codespace", stewardOnly: true },
  { label: "NetBattle", path: "/net-battle" },
  { label: "Cyberworld", path: "/cyberworld" },
  { label: "Storyboard", path: "/storyboard" },
  { label: "Narrative", path: "/narrative" },
  { label: "Flowchart", path: "/flowchart" },
  { label: "What-If", path: "/what-if" },
  { label: "Quest Journal", path: "/quest-journal" },
  { label: "World Map", path: "/worldmap" },
  { label: "Locations", path: "/locationsmap" },
  { label: "Calendar", path: "/integrated-calendar" },
  { label: "Chronicles", path: "/chronicles" },
  { label: "World Codex", path: "/worldcodex" },
  { label: "Lore Book", path: "/lorebook" },
  { label: "Journals", path: "/journals" },
  { label: "Session Wiki", path: "/wiki" },
  { label: "Global Wiki", path: "/globalwiki" },
  { label: "Memory Map", path: "/memory-map" },
  { label: "Inventory", path: "/inventory" },
  { label: "Energy Fragments", path: "/energy-fragments" },
  { label: "Echo Keys", path: "/echo-keys" },
  { label: "Characters", path: "/characters" },
  { label: "Customise Anima", path: "/customise-anima?tab=look" },
  { label: "Check-In", path: "/check-in" },
  { label: "Therapy Mode", path: "/therapy" },
  { label: "Reflect Log", path: "/reflection-log" },
  { label: "Sign Out", path: "/", signOut: true },
];

/**
 * How a path is reached from the five-tab dock or Explore.
 * @param {string} path
 * @param {{ isSteward?: boolean }} [opts]
 * @returns {{ dock: boolean, explore: boolean }}
 */
export function dockOrExploreReach(path, { isSteward = false } = {}) {
  const pathOnly = String(path || "").split("?")[0];
  const dock = DOCK_TABS.some((tab) => tab.path === pathOnly);
  const explore = exploreModules(EXPLORE_MODULES, { isSteward }).some((m) => {
    if (m.signOut) return false;
    return m.path.split("?")[0] === pathOnly;
  });
  return { dock, explore };
}
