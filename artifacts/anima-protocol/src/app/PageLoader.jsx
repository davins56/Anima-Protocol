/**
 * Spinner-only fallback so lazy routes do not stack a second loading
 * label on top of in-page fetch states.
 */
export function PageLoader() {
  return (
    <div
      className="flex items-center justify-center h-screen-safe"
      role="status"
      aria-label="Loading page"
    >
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}
