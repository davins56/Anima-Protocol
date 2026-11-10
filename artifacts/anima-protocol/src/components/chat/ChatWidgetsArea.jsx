import { lazy, Suspense, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const loadStoryFeedBody = () => import("./StoryFeedBody");
const StoryFeedBody = lazy(loadStoryFeedBody);

function StoryFeedSkeleton() {
  return (
    <div className="space-y-2 py-1" role="status" aria-label="Loading Story Feed">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 rounded border border-primary/10 bg-primary/5 animate-pulse" />
      ))}
    </div>
  );
}

export default function ChatWidgetsArea(props) {
  const [collapsed, setCollapsed] = useState(true);
  // Warm the feed chunk when the reader reaches for the toggle.
  const warm = () => {
    void loadStoryFeedBody();
  };
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div data-story-feed>
      {/* Collapse toggle — not draggable. Horizontal drag on this header
          stole taps on mobile and made the bar slide/fade instead of opening. */}
      <div className="flex items-center border-b border-primary/10 bg-black/30">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          onPointerEnter={warm}
          onFocus={warm}
          aria-expanded={!collapsed}
          className="flex-1 flex items-center justify-between px-3 py-1.5 hover:bg-black/50 transition-colors touch-manipulation"
        >
          <span className="font-mono text-[8px] text-primary/20 tracking-widest uppercase">Story Feed</span>
          <span className="flex items-center gap-1 text-primary/30 hover:text-primary/60 font-mono text-[8px] tracking-widest uppercase">
            {collapsed ? (
              <><ChevronDown className="w-3 h-3" /> Show</>
            ) : (
              <><ChevronUp className="w-3 h-3" /> Hide</>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Hide Story Feed"
          className="px-2 py-1.5 text-primary/25 hover:text-primary/60 transition-colors touch-manipulation"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="story-feed-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <Suspense fallback={<StoryFeedSkeleton />}>
              <StoryFeedBody {...props} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
