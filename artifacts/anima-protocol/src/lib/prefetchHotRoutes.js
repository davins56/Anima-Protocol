/**
 * After first paint, warm the chunks operators hit next (home / chat /
 * customise) so leaving Landing is a cache hit instead of another spinner.
 */
export function prefetchHotRoutes() {
  const run = () => {
    void import("../pages/MainHome");
    void import("../pages/Chat");
    void import("../pages/NewChat");
    void import("../pages/CustomiseAnima");
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2500 });
    return;
  }
  setTimeout(run, 1);
}
