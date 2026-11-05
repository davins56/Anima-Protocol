import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

/**
 * Thumbs up / down on one companion reply. After a thumbs down the steward can
 * correct her: an optional better version and/or what was wrong, then either
 * "Correct her" (save and re-render the reply with the correction) or "Save only".
 * `onRate(rating, betterReply?, { note, rerender }?)` returns a promise.
 */
export default function ReplyRating({ onRate, initial = 0, disabled = false }) {
  const [rating, setRating] = useState(initial);
  const [askBetter, setAskBetter] = useState(false);
  const [better, setBetter] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const send = async (next, betterReply, extra) => {
    if (saving || disabled) return;
    const prev = rating;
    setRating(next);
    setSaving(true);
    try {
      await (extra ? onRate(next, betterReply, extra) : onRate(next, betterReply));
      setSaved(Boolean(betterReply || extra?.note));
    } catch {
      setRating(prev);
    } finally {
      setSaving(false);
    }
  };

  const btn =
    "inline-flex items-center justify-center min-w-[44px] min-h-[44px] border font-mono text-[10px] tracking-widest uppercase transition-all disabled:opacity-40";
  return (
    <div className="flex flex-col gap-1 mt-0.5" data-testid="reply-rating">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Good reply"
          aria-pressed={rating === 1}
          disabled={saving || disabled}
          onClick={() => {
            setAskBetter(false);
            void send(rating === 1 ? 0 : 1);
          }}
          className={`${btn} ${rating === 1 ? "border-emerald-300/60 text-emerald-200" : "border-transparent text-primary/30 hover:text-emerald-200"}`}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Not quite right"
          aria-pressed={rating === -1}
          disabled={saving || disabled}
          onClick={() => {
            if (rating === -1) {
              setAskBetter(false);
              void send(0);
              return;
            }
            setAskBetter(true);
            void send(-1);
          }}
          className={`${btn} ${rating === -1 ? "border-rose-300/60 text-rose-200" : "border-transparent text-primary/30 hover:text-rose-200"}`}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
        {saved && <span className="text-[10px] font-mono text-primary/40">Thanks — saved</span>}
      </div>
      {askBetter && rating === -1 && (
        <div className="flex flex-col gap-1">
          <textarea
            value={better}
            onChange={(e) => setBetter(e.target.value)}
            rows={3}
            maxLength={4000}
            aria-label="A better version (optional)"
            placeholder="Optional: how should she have said it?"
            className="w-full rounded border border-primary/30 bg-black/50 p-2 text-sm text-cyan-50"
            style={{ fontSize: "16px" }}
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={600}
            aria-label="What was wrong (optional)"
            placeholder="Optional: what was wrong? She learns from this."
            className="w-full rounded border border-primary/30 bg-black/50 p-2 text-sm text-cyan-50"
            style={{ fontSize: "16px" }}
          />
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={saving || (!better.trim() && !note.trim())}
              onClick={async () => {
                await send(-1, better.trim() || undefined, { note: note.trim() || undefined, rerender: true });
                setAskBetter(false);
              }}
              className={`${btn} px-3 border-rose-300/50 text-rose-100`}
            >
              Correct her
            </button>
            <button
              type="button"
              disabled={saving || (!better.trim() && !note.trim())}
              onClick={async () => {
                const trimmedNote = note.trim();
                await send(-1, better.trim() || undefined, trimmedNote ? { note: trimmedNote, rerender: false } : undefined);
                setAskBetter(false);
              }}
              className={`${btn} px-3 border-primary/40 text-primary/80`}
            >
              Save only
            </button>
            <button type="button" onClick={() => setAskBetter(false)} className={`${btn} px-3 border-transparent text-primary/50`}>
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
