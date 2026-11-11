// @ts-check
import { memo } from "react";
import { ScrollText, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Story-mode narrator beat: a full-width scene break in the chat log, with an
 * optional scene heading ("Later, at the docks") above third-person prose.
 * Not a character bubble — no avatar, no reply actions besides delete.
 *
 * @param {{ message: any, onDelete?: () => void, actionsDisabled?: boolean }} props
 */
function NarratorBubble({ message, onDelete, actionsDisabled = false }) {
  const heading = String(message?.scene_heading || "").trim();
  const paragraphs = String(message?.content || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      role="note"
      aria-label="Narrator"
      data-testid="narrator-message"
      className="group relative w-full my-4 px-2 sm:px-6"
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="h-px flex-1 bg-amber-200/20" />
        <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.3em] uppercase text-amber-200/70">
          <ScrollText className="w-3 h-3" aria-hidden="true" />
          {heading || "Narrator"}
        </span>
        <span className="h-px flex-1 bg-amber-200/20" />
      </div>
      <div className="mx-auto max-w-2xl text-center italic text-[15px] sm:text-base leading-relaxed text-amber-50/85 space-y-2 break-words">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={actionsDisabled}
          title="Remove this narration"
          aria-label="Remove narration"
          className="absolute top-0 right-2 p-1 text-amber-200/40 hover:text-rose-300 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-30"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </motion.div>
  );
}

export default memo(NarratorBubble);
