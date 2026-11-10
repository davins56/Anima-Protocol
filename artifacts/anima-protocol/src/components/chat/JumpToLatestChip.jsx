import { ArrowDown } from "lucide-react";

/**
 * Pinned to the bottom of the chat scroll area while the reader is scrolled up
 * and something new has arrived (or a reply is still streaming in below).
 * Zero-height so it never shifts the thread.
 *
 * @param {{ visible: boolean, streaming?: boolean, onJump: () => void }} props
 */
export default function JumpToLatestChip({ visible, streaming = false, onJump }) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-3 z-20 h-0 flex justify-center pointer-events-none">
      <button
        type="button"
        onClick={onJump}
        data-testid="jump-to-latest"
        className="pointer-events-auto -translate-y-full flex items-center gap-2 min-h-[36px] px-4 py-1.5 rounded-full border border-primary/50 bg-black/85 backdrop-blur-md text-primary hover:bg-primary/20 font-mono text-[10px] tracking-widest uppercase shadow-lg shadow-black/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
      >
        <ArrowDown className="w-3 h-3" aria-hidden="true" />
        {streaming ? "New reply below" : "Jump to latest"}
      </button>
    </div>
  );
}
