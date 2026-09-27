import { useCallback, useEffect, useState } from "react";
import {
  Download,
  GraduationCap,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { animaApi } from "@/api/animaApi";
import { loadModelTutorStatus } from "@/hooks/useModelTutor";
import {
  describeLearning,
  downloadText,
  lessonStatusLabel,
} from "@/lib/modelTutor";

const card = "border border-primary/15 bg-black/40 p-4 sm:p-5 space-y-3";
const heading = "font-mono text-[10px] uppercase tracking-[0.25em] text-primary/50";
const button =
  "inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 border font-mono text-[10px] uppercase tracking-[0.16em] transition-all disabled:opacity-40";

const STATUS_TONE = {
  learned: "border-emerald-400/40 text-emerald-200/80",
  learning: "border-cyan-400/40 text-cyan-200/80",
  failed: "border-red-400/40 text-red-200/80",
  saved: "border-amber-400/40 text-amber-200/80",
};

function errorText(err, fallback) {
  return err?.payload?.error || (err instanceof Error && err.message) || fallback;
}

function formatParams(n) {
  if (!Number.isFinite(n)) return "?";
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`;
}

/** Settings → Model Tutor. Steward-only; the API refuses everyone else. */
export default function ModelTutorPanel({ api = animaApi.tutor }) {
  const [status, setStatus] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [advice, setAdvice] = useState([]);
  const [newAdvice, setNewAdvice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await loadModelTutorStatus({ force: true });
    setStatus(next);
    if (next?.isSteward) {
      const [l, a] = await Promise.all([
        api.lessons({ limit: 100 }).catch(() => ({ lessons: [] })),
        api.advice().catch(() => ({ advice: [] })),
      ]);
      setLessons(l.lessons || []);
      setAdvice(a.advice || []);
    }
    return next;
  }, [api]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const training = Boolean(status?.model?.training);
  useEffect(() => {
    if (!training) return undefined;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [training, refresh]);

  const run = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      if (success) toast.success(typeof success === "function" ? success(result) : success);
      await refresh();
    } catch (err) {
      toast.error(errorText(err, "That didn't work. Try again."));
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className={`${card} flex items-center gap-2 text-xs text-primary/50`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your model…
      </div>
    );
  }

  if (!status?.isSteward) {
    return (
      <div className={card}>
        <p className="text-xs text-primary/50">
          Only the Protocol steward can teach the model.
        </p>
      </div>
    );
  }

  const model = status.model;
  const ownModelChat = Boolean(status.preferences?.own_model_chat);

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-fuchsia-300/80" />
          <h3 className={heading}>Your model</h3>
        </div>
        {!status.configured && (
          <p className="text-xs leading-relaxed text-amber-200/80">
            Not connected. {status.error} Lessons you teach are still saved and will be learned once it
            is connected.
          </p>
        )}
        {status.configured && !status.reachable && (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-amber-200/80">{status.error}</p>
            <button
              type="button"
              onClick={() => run("refresh", refresh)}
              disabled={Boolean(busy)}
              className={`${button} border-primary/25 text-primary/60`}
            >
              <RefreshCw className="h-3 w-3" /> Check again
            </button>
          </div>
        )}
        {model && (
          <div className="space-y-1 font-mono text-[11px] text-primary/70">
            <p>
              Connected · version {model.version} · {formatParams(model.params)} parameters ·{" "}
              {model.block_size}-token memory · {model.device}
            </p>
            <p>
              {model.lessons_learned} of {status.lessons_total} lessons learned
              {training && (
                <span className="ml-2 inline-flex items-center gap-1 text-cyan-200/80">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {model.current_job?.kind === "rebuild" ? "relearning everything" : "learning"}
                  {model.current_job?.progress?.epoch
                    ? ` (round ${model.current_job.progress.epoch})`
                    : ""}
                </span>
              )}
            </p>
          </div>
        )}

        <label className="flex items-start justify-between gap-4 border-t border-primary/10 pt-3">
          <span>
            <span className="block text-xs text-primary/80">Answer my chats with my model</span>
            <span className="block text-[11px] leading-relaxed text-primary/40">
              Only your chats. Everyone else keeps talking to Anima.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Answer my chats with my model"
            checked={ownModelChat}
            disabled={Boolean(busy) || (!status.configured && !ownModelChat)}
            onChange={(event) =>
              run(
                "toggle",
                () => api.setOwnModelChat(event.target.checked),
                event.target.checked
                  ? "Your chats now go to your model."
                  : "Your chats are back with Anima.",
              )
            }
            className="mt-1 h-4 w-4 accent-fuchsia-400"
          />
        </label>

        {status.needs_sync && (
          <p className="text-xs leading-relaxed text-amber-200/80">
            {model && model.lessons_learned < status.lessons_total
              ? `Your model doesn't know ${status.lessons_total - model.lessons_learned} of your lessons yet.`
              : "Deleted lessons are still in its weights."}{" "}
            Re-teach all lessons to bring it up to date.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              run("sync", () => api.sync(), (r) =>
                `Relearning ${r?.lessons ?? "all"} lessons from the base model.`,
              )
            }
            disabled={Boolean(busy) || !status.reachable || training}
            className={`${button} ${status.needs_sync ? "border-amber-400/50 text-amber-100" : "border-primary/25 text-primary/60"}`}
          >
            {busy === "sync" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-teach all lessons
          </button>
          <button
            type="button"
            onClick={() => run("undo", () => api.rollback(), "Undid the last lesson.")}
            disabled={Boolean(busy) || !model?.can_rollback || training}
            className={`${button} border-primary/25 text-primary/60`}
          >
            <Undo2 className="h-3 w-3" /> Undo last lesson
          </button>
          <button
            type="button"
            onClick={() =>
              run("export", async () => {
                downloadText("steward_lessons.jsonl", await api.exportLessons("sft"));
                downloadText("steward_preferences.jsonl", await api.exportLessons("dpo"));
              })
            }
            disabled={Boolean(busy) || status.lessons_total === 0}
            className={`${button} border-primary/25 text-primary/60`}
            title="For retraining offline: put them in data/sft/ and data/prefs/, then rerun phases 2 and 3"
          >
            <Download className="h-3 w-3" /> Download for retraining
          </button>
        </div>
      </div>

      <div className={card}>
        <h3 className={heading}>Standing advice</h3>
        <p className="text-[11px] leading-relaxed text-primary/40">
          Your model is too small to read instructions, so Anima uses this advice when it drafts
          better replies for you to teach. The advice reaches your model as examples.
        </p>
        <ul className="space-y-1.5">
          {advice.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 border border-primary/10 px-3 py-2">
              <span className="text-xs text-primary/80">{item.text}</span>
              <button
                type="button"
                onClick={() => run(`advice-${item.id}`, () => api.removeAdvice(item.id))}
                disabled={Boolean(busy)}
                aria-label={`Remove advice: ${item.text}`}
                className="text-primary/30 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = newAdvice.trim();
            if (!text) return;
            run("advice", async () => {
              await api.addAdvice(text);
              setNewAdvice("");
            });
          }}
        >
          <input
            value={newAdvice}
            onChange={(event) => setNewAdvice(event.target.value)}
            maxLength={500}
            placeholder="When I'm sad, ask what happened before giving advice."
            aria-label="New advice"
            className="min-w-0 flex-1 border border-primary/20 bg-black/60 px-3 py-2 font-mono text-xs text-primary/90 outline-none placeholder:text-primary/25 focus:border-primary/50"
          />
          <button
            type="submit"
            disabled={Boolean(busy) || !newAdvice.trim()}
            className={`${button} border-fuchsia-400/40 text-fuchsia-100`}
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </form>
      </div>

      <div className={card}>
        <h3 className={heading}>Lessons ({status.lessons_total})</h3>
        {lessons.length === 0 && (
          <p className="text-xs leading-relaxed text-primary/40">
            No lessons yet. In a chat, tap <span className="text-fuchsia-200/80">Teach</span> under a reply
            to show your model what it should have said.
          </p>
        )}
        <ul className="space-y-2">
          {lessons.map((lesson) => {
            const learned = describeLearning(lesson);
            return (
              <li key={lesson.id} className="space-y-1 border border-primary/10 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-3 text-xs text-primary/85">{lesson.chosen}</p>
                  <button
                    type="button"
                    onClick={() =>
                      run(`lesson-${lesson.id}`, () => api.forget(lesson.id), (r) =>
                        r?.needs_sync
                          ? "Lesson deleted. Re-teach all lessons to make your model forget it."
                          : "Lesson deleted.",
                      )
                    }
                    disabled={Boolean(busy)}
                    aria-label="Delete lesson"
                    className="shrink-0 text-primary/30 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {lesson.note && <p className="text-[11px] italic text-primary/45">“{lesson.note}”</p>}
                <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em]">
                  <span className={`border px-1.5 py-0.5 ${STATUS_TONE[lesson.status] || STATUS_TONE.saved}`}>
                    {lessonStatusLabel(lesson)}
                  </span>
                  {learned && <span className="text-primary/40 normal-case tracking-normal">{learned}</span>}
                  {lesson.created_date && (
                    <span className="text-primary/30">{new Date(lesson.created_date).toLocaleDateString()}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
