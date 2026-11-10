/**
 * After first paint, warm the chunks operators hit next (home / chat /
 * customise) so leaving Landing is a cache hit instead of another spinner.
 *
 * Chat is warmed without its heavy extras: the Story Feed widget graph
 * (StoryFeedBody) and the presence rail/stage are lazy inside Chat and load
 * on first expand/open, and three/R3F only loads with a 3D view. Do not add
 * those here.
 */
export function prefetchHotRoutes() {
  const run = () => {
    void import("../pages/MainHome");
    void import("../pages/Chat");
    void import("../pages/CustomiseAnima");
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2500 });
    return;
  }
  setTimeout(run, 1);
}
