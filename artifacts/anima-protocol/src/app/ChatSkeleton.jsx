/**
 * Chat-shaped placeholder shown while the Chat route chunk (or a thread)
 * loads: a header bar, a few alternating bubbles and the composer, so the
 * layout does not jump from a centered spinner to a full thread.
 *
 * @param {{ label?: string, header?: boolean }} props
 */
export function ChatSkeleton({ label = "Loading chat", header = true }) {
  const bubbles = [
    { mine: false, w: "w-3/5" },
    { mine: true, w: "w-2/5" },
    { mine: false, w: "w-4/6" },
    { mine: true, w: "w-1/3" },
  ];
  return (
    <div
      className="flex flex-1 min-h-0 h-full w-full flex-col"
      role="status"
      aria-label={label}
      data-testid="chat-skeleton"
    >
      {header && (
        <div className="flex items-center gap-3 border-b border-primary/10 px-3 py-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 animate-pulse" />
          <div className="h-3 w-32 rounded bg-primary/10 animate-pulse" />
        </div>
      )}
      <div className="flex-1 min-h-0 space-y-4 overflow-hidden p-3 sm:p-6">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex gap-2 ${b.mine ? "flex-row-reverse" : ""}`}>
            {!b.mine && <div className="h-7 w-7 flex-shrink-0 border border-primary/20 bg-primary/5 animate-pulse" />}
            <div className={`${b.w} h-12 border border-primary/10 bg-primary/5 animate-pulse`} />
          </div>
        ))}
      </div>
      <div className="border-t border-primary/10 p-3">
        <div className="h-11 w-full border border-primary/15 bg-black/40 animate-pulse" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
