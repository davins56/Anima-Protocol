import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { REACTION_LABELS, REACTION_SET, userReactions } from "@/lib/chatReactions";

/**
 * Chat upgrade 6a (VITE_ANIMA_REACTIONS): the user's emoji on one of her
 * replies. Chosen ones show as chips (tap to remove); the smile button opens
 * the fixed palette. Disabled while a reply is in flight.
 */
export default function MessageReactions({ message, onReact, disabled = false, companionName = "" }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const wrapRef = useRef(null);
  const chosen = userReactions(message);
  const named = String(companionName || "").trim();
  const whose = named ? `${named}'s` : "her";

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && wrapRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const react = async (emoji) => {
    if (disabled || pending || !onReact) return;
    setPending(true);
    setOpen(false);
    try {
      await onReact(emoji);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative ml-10 sm:ml-12 -mt-1 mb-2 flex flex-wrap items-center gap-1"
      data-testid="message-reactions"
    >
      {chosen.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => react(emoji)}
          disabled={disabled || pending}
          aria-pressed="true"
          aria-label={`Remove your ${REACTION_LABELS[emoji] || emoji} reaction`}
          className="inline-flex items-center min-h-[32px] px-2 rounded-full border border-primary/40 bg-primary/10 text-sm disabled:opacity-50"
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pending}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`React to ${whose} reply`}
        className="inline-flex items-center justify-center min-w-[32px] min-h-[32px] rounded-full text-primary/40 hover:text-primary/80 disabled:opacity-30"
      >
        <SmilePlus className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="group"
          aria-label="Reactions"
          className="absolute bottom-full left-0 mb-1 z-20 flex gap-1 rounded-full border border-primary/30 bg-black/90 px-2 py-1 shadow-lg"
        >
          {REACTION_SET.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => react(emoji)}
              aria-pressed={chosen.includes(emoji)}
              aria-label={REACTION_LABELS[emoji] || emoji}
              className={`min-w-[36px] min-h-[36px] rounded-full text-lg hover:bg-primary/20 ${chosen.includes(emoji) ? "bg-primary/20" : ""}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
