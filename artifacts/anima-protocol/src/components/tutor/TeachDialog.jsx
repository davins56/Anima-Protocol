import { useEffect, useState } from "react";
import { GraduationCap, Loader2, RotateCcw, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { animaApi } from "@/api/animaApi";
import { track } from "@/lib/analytics";
import { LONG_REPLY_CHARS } from "@/lib/modelTutor";

const label = "block font-mono text-[9px] uppercase tracking-[0.2em] text-primary/50";
const field =
  "w-full resize-none border border-primary/25 bg-black/60 p-2.5 font-mono text-xs leading-relaxed text-primary/90 outline-none placeholder:text-primary/25 focus:border-primary/50";
const button =
  "inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 border font-mono text-[10px] uppercase tracking-[0.18em] transition-all disabled:opacity-40";

function errorText(err, fallback) {
  return err?.payload?.error || (err instanceof Error && err.message) || fallback;
}

/**
 * Teach the steward's own model a better reply for one chat message.
 * `target` comes from buildTeachTarget(); null keeps the dialog closed.
 */
export default function TeachDialog({ target, onClose, api = animaApi.tutor }) {
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState("");
  const [drafted, setDrafted] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [lesson, setLesson] = useState(null);
  const [trainerStarted, setTrainerStarted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setNote("");
    setChosen("");
    setDrafted(null);
    setLesson(null);
    setError("");
  }, [target]);

  const open = Boolean(target);
  const busy = drafting || teaching;

  const draft = async () => {
    setDrafting(true);
    setError("");
    try {
      const result = await api.draft({
        context: target.context,
        rejected: target.rejected,
        note: note.trim() || null,
      });
      setChosen(result.draft || "");
      setDrafted(result.draft || null);
    } catch (err) {
      setError(errorText(err, "Anima couldn't draft a reply. Write it yourself."));
    } finally {
      setDrafting(false);
    }
  };

  const teach = async () => {
    const better = chosen.trim();
    if (!better) {
      setError("Write the reply you wanted first.");
      return;
    }
    setTeaching(true);
    setError("");
    try {
      const { lesson: saved, trainer_started: started } = await api.teach({
        session_id: target.session_id,
        message_id: target.message_id,
        part: target.part,
        context: target.context,
        rejected: target.rejected,
        chosen: better,
        note: note.trim() || null,
        source_brand: target.source_brand,
      });
      track("model_lesson_taught", {
        has_note: Boolean(note.trim()),
        is_drafted: Boolean(drafted) && drafted.trim() === better,
        is_own_model_reply: target.source_brand === "own",
        is_trainer_started: Boolean(started),
      });
      setTrainerStarted(Boolean(started));
      setLesson(saved);
    } catch (err) {
      setError(errorText(err, "That lesson didn't save. Try again."));
    } finally {
      setTeaching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose?.()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-fuchsia-400/25 bg-black/95 text-primary sm:max-w-xl rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em] text-fuchsia-200">
            <GraduationCap className="h-4 w-4" /> Teach your model
          </DialogTitle>
          <DialogDescription className="text-left text-xs leading-relaxed text-primary/50">
            Show it what it should have said. In the background it practises your reply until it
            sticks, and learns to steer away from this one.
          </DialogDescription>
        </DialogHeader>

        {target && !lesson && (
          <div className="space-y-3">
            <div>
              <span className={label}>What it said{target.character_name ? ` (as ${target.character_name})` : ""}</span>
              <div className="mt-1 max-h-28 overflow-y-auto border border-primary/15 bg-black/40 p-2.5 font-mono text-xs leading-relaxed text-primary/60 whitespace-pre-wrap">
                {target.rejected || "(no reply)"}
              </div>
            </div>

            <label className="block">
              <span className={label}>What went wrong? (optional)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Too cold — ask how I'm feeling before giving advice."
                className={`${field} mt-1`}
              />
            </label>

            <div>
              <div className="flex items-end justify-between gap-2">
                <span className={label}>What it should have said</span>
                <button
                  type="button"
                  onClick={draft}
                  disabled={busy}
                  className={`${button} min-h-[32px] border-cyan-400/30 text-cyan-200/80 hover:border-cyan-300/60`}
                  title="Anima drafts a better reply from your note and standing advice"
                >
                  {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Draft with Anima
                </button>
              </div>
              <textarea
                aria-label="What it should have said"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="Of course. I'm here — tell me what happened."
                className={`${field} mt-1`}
              />
              {drafted && (
                <p className="mt-1 text-[10px] text-primary/40">
                  Drafted by Anima from your note and advice. Edit it until it sounds right.
                </p>
              )}
              {chosen.length > LONG_REPLY_CHARS && (
                <p className="mt-1 text-[10px] text-amber-300/70">
                  Short replies teach best — your model only remembers about 256 tokens at a time.
                </p>
              )}
            </div>

            {error && <p className="text-xs text-red-300/80">{error}</p>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className={`${button} border-primary/20 text-primary/50 hover:border-primary/40`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={teach}
                disabled={busy || !chosen.trim()}
                className={`${button} border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25`}
              >
                {teaching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="h-3.5 w-3.5" />}
                {teaching ? "Saving…" : "Teach"}
              </button>
            </div>
          </div>
        )}

        {lesson && (
          <div className="space-y-3" data-testid="teach-result">
            <p className="font-mono text-xs text-emerald-300/90">Lesson saved.</p>
            <p className="text-xs leading-relaxed text-primary/60">
              {trainerStarted
                ? "Your model is learning it now — usually a few minutes."
                : "Your model learns it on its next practice run, within about 15 minutes."}{" "}
              The next version downloads by itself on your next chat. Progress is in Settings → Model
              Tutor.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setLesson(null)}
                className={`${button} border-primary/20 text-primary/60 hover:border-primary/40`}
              >
                <RotateCcw className="h-3 w-3" /> Teach again
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`${button} border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25`}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
