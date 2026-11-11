// @ts-check
/**
 * Slim mobile navigation (UI only). Five primary tabs first; everything else
 * lives behind Explore. Codespace / Repo Workspace are steward-only in the
 * menu — the API still enforces its own checks; this only hides the entry.
 */
export const PRIMARY_TABS = [
  { path: "/chat", label: "Chat", key: "chat" },
  { path: "/animas", label: "Companions", key: "companions" },
  { path: "/memories", label: "Memories", key: "memories" },
  { path: "/", label: "Home", key: "home" },
  { path: "/settings", label: "Settings", key: "settings" },
];

export const STEWARD_ONLY_PATHS = new Set(["/codespace", "/repo-codespace"]);

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
    if (!m.signOut && primary.has(m.path)) return false;
    if (STEWARD_ONLY_PATHS.has(m.path) && !isSteward) return false;
    return true;
  });
}
