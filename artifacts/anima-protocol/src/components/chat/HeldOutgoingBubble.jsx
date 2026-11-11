import { HELD_SEND_NOTE } from "@/lib/heldChatSend";

/**
 * A follow-up the user sent while a reply is still in flight.
 * It is not part of the session transcript until it actually sends.
 */
export default function HeldOutgoingBubble({ text, note = HELD_SEND_NOTE, onCancel }) {
  if (!text) return null;
  return (
    <div
      className="flex flex-row-reverse gap-2 sm:gap-3"
      data-testid="held-outgoing"
    >
      <div className="max-w-[80%] sm:max-w-[75%] flex flex-col items-end gap-1">
        <div className="px-3 sm:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm leading-relaxed hud-corner bg-primary/10 border border-primary/30 text-primary/90 text-right whitespace-pre-wrap">
          {text}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[8px] sm:text-[9px] text-primary/45 tracking-widest uppercase">
            {note}
          </span>
          <button
            type="button"
            onClick={onCancel}
            data-testid="held-outgoing-cancel"
            className="font-mono text-[8px] sm:text-[9px] tracking-widest uppercase text-primary/60 hover:text-primary border border-primary/25 hover:border-primary/50 px-1.5 py-0.5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
