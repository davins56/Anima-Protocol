import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  GraduationCap,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { animaApi } from "@/api/animaApi";
import { loadModelTutorStatus } from "@/hooks/useModelTutor";
import { clearOwnModelConfig } from "@/lib/ownModel/chat";
import {
  describeLearning,
  describeTrainer,
  downloadText,
  lessonStatusLabel,
  parseModelBundle,
  uploadModelBundle,
} from "@/lib/modelTutor";

const card = "border border-primary/15 bg-black/40 p-4 sm:p-5 space-y-3";
const heading = "font-mono text-[10px] uppercase tracking-[0.25em] text-primary/50";
const button =
  "inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 border font-mono text-[10px] uppercase tracking-[0.16em] transition-all disabled:opacity-40";

const STATUS_TONE = {
  learned: "border-emerald-400/40 text-emerald-200/80",
  failed: "border-red-400/40 text-red-200/80",
  saved: "border-amber-400/40 text-amber-200/80",
};

/** While lessons wait, look again now and then: the trainer runs every 15 minutes. */
const POLL_MS = 30_000;

function errorText(err, fallback) {
  return err?.payload?.error || (err instanceof Error && err.message) || fallback;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "?";
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

function Switch({ label, hint, checked, disabled, onChange }) {
  return (
    <label className="flex items-start justify-between gap-4 border-t border-primary/10 pt-3">
      <span>
        <span className="block text-xs text-primary/80">{label}</span>
        <span className="block text-[11px] leading-relaxed text-primary/40">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 accent-fuchsia-400"
      />
    </label>
  );
}

/** Settings → Model Tutor. Steward-only; the API refuses everyone else. */
export default function ModelTutorPanel({ api = animaApi.tutor }) {
  const [status, setStatus] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [advice, setAdvice] = useState([]);
  const [newAdvice, setNewAdvice] = useState("");
  const [busy, setBusy] = useState("");
  const [uploadProgress, setUploadProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const fileInput = useRef(null);

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

  const waiting = Boolean(status?.lessons?.pending || status?.trainer?.relearn_pending);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  const run = async (key, action, success) => {
    setBusy(key);
    try {
      const result = await action();
      if (success) toast.success(typeof success === "function" ? success(result) : success);
      // Chat picks up switch changes and new versions on its next turn.
      clearOwnModelConfig();
      await refresh();
    } catch (err) {
      toast.error(errorText(err, "That didn't work. Try again."));
    } finally {
      setBusy("");
    }
  };

  const upload = async (file) => {
    if (!file) return;
    await run(
      "upload",
      async () => {
        setUploadProgress(0);
        try {
          const bundle = await parseModelBundle(await file.arrayBuffer());
          return await uploadModelBundle(api, bundle, { onProgress: setUploadProgress });
        } finally {
          setUploadProgress(null);
          if (fileInput.current) fileInput.current.value = "";
        }
      },
      (result) => `Version ${result?.version ?? "?"} is live. Lessons it learned before are being relearned on it.`,
    );
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
        <p className="text-xs text-primary/50">Only the Protocol steward can teach the model.</p>
      </div>
    );
  }

  const model = status.model || {};
  const settings = status.settings || {};
  const counts = status.lessons || { total: 0, pending: 0, learned: 0, failed: 0, auto: 0 };
  const trainer = status.trainer || {};
  const published = Boolean(model.published);
  const config = model.config;
  const current = (model.versions || []).find((v) => v.version === model.current_version);

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-fuchsia-300/80" />
          <h3 className={heading}>Your model</h3>
        </div>
        {published ? (
          <div className="space-y-1 font-mono text-[11px] text-primary/70">
            <p>
              Live · version {model.current_version}
              {model.base_version !== model.current_version ? ` (learned on top of v${model.base_version})` : " (base)"}
              {config ? ` · ${config.n_layer} layers · ${config.block_size}-token memory` : ""}
              {current ? ` · ${formatBytes(current.bytes)}` : ""}
            </p>
            <p className="text-primary/45">
              It runs inside the app on each person's device — nothing has to stay open for it.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-amber-200/80">
            No model uploaded yet. Export yours with{" "}
            <code className="text-amber-100">python server/export_web.py</code> and upload the .bin file
            here.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".bin,application/octet-stream"
            aria-label="Model file"
            className="hidden"
            onChange={(event) => upload(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={Boolean(busy)}
            className={`${button} border-fuchsia-400/40 text-fuchsia-100`}
          >
            {busy === "upload" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {published ? "Upload a new base model" : "Upload model"}
          </button>
          {uploadProgress !== null && (
            <span className="font-mono text-[10px] text-primary/50" role="status">
              Uploading… {Math.round(uploadProgress * 100)}%
            </span>
          )}
        </div>

        <Switch
          label="Answer my chats with my model"
          hint="Just your chats, to try it out."
          checked={Boolean(status.preferences?.own_model_chat)}
          disabled={Boolean(busy) || (!published && !status.preferences?.own_model_chat)}
          onChange={(on) =>
            run("own-chat", () => api.setOwnModelChat(on), on ? "Your chats now go to your model." : "Your chats are back with Anima.")
          }
        />
        <Switch
          label="Answer everyone's chats"
          hint="Every account chats with your model instead of Anima. Turn it off to hand everyone back."
          checked={Boolean(settings.answer_everyone)}
          disabled={Boolean(busy) || (!published && !settings.answer_everyone)}
          onChange={(on) =>
            run(
              "everyone",
              () => api.setSettings({ answer_everyone: on }),
              on ? "Your model now answers everyone." : "Everyone is back with Anima.",
            )
          }
        />
        <Switch
          label="Always learning"
          hint="After each reply your model gives, Anima writes the reply it would have given and your model practises it. Never from therapy or adult scenes."
          checked={Boolean(settings.always_learning)}
          disabled={Boolean(busy)}
          onChange={(on) =>
            run("always", () => api.setSettings({ always_learning: on }), on ? "Always learning is on." : "Always learning is off.")
          }
        />
        <Switch
          label="Also learn from people who opt in"
          hint="Otherwise it only learns from your chats. People opt in under Settings → AI Behavior; their lessons show up below."
          checked={Boolean(settings.learn_from_opted_in)}
          disabled={Boolean(busy) || (!settings.always_learning && !settings.learn_from_opted_in)}
          onChange={(on) => run("opted-in", () => api.setSettings({ learn_from_opted_in: on }))}
        />
      </div>

      <div className={card}>
        <h3 className={heading}>Learning</h3>
        <p className="text-xs leading-relaxed text-primary/60" data-testid="trainer-status">
          {describeTrainer(trainer)}
        </p>
        <p className="font-mono text-[11px] text-primary/70">
          {counts.learned} learned · {counts.pending} waiting · {counts.failed} didn't take
          {counts.auto ? ` · ${counts.auto} automatic` : ""}
        </p>
        {trainer.relearn_pending && (
          <p className="text-xs leading-relaxed text-amber-200/80">
            Deleted lessons are still in its weights until it relearns everything from the base — that
            happens on the next run.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run("learn-now", () => api.learnNow(), "The trainer is starting.")}
            disabled={Boolean(busy) || !published || !trainer.dispatch_configured}
            title={
              trainer.dispatch_configured
                ? "Start a practice run now instead of waiting for the next one"
                : "Set GITHUB_TRAINER_TOKEN on the API host to start runs on demand"
            }
            className={`${button} border-cyan-400/40 text-cyan-100`}
          >
            <Zap className="h-3 w-3" /> Learn now
          </button>
          <button
            type="button"
            onClick={() => run("sync", () => api.sync(), "It will relearn every lesson from the base on its next run.")}
            disabled={Boolean(busy) || !published}
            className={`${button} border-primary/25 text-primary/60`}
          >
            <RefreshCw className="h-3 w-3" /> Relearn everything
          </button>
          <button
            type="button"
            onClick={() =>
              run("export", async () => {
                downloadText("steward_lessons.jsonl", await api.exportLessons("sft"));
                downloadText("steward_preferences.jsonl", await api.exportLessons("dpo"));
              })
            }
            disabled={Boolean(busy) || counts.total === 0}
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
          Your model is too small to read instructions, so Anima uses this advice whenever it writes
          replies for your model to learn — your drafts and the automatic lessons alike.
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
        <h3 className={heading}>Lessons ({counts.total})</h3>
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
                  <div className="flex shrink-0 gap-2">
                    {lesson.status === "failed" && (
                      <button
                        type="button"
                        onClick={() => run(`retry-${lesson.id}`, () => api.retry(lesson.id), "Queued again.")}
                        disabled={Boolean(busy)}
                        aria-label="Try this lesson again"
                        className="text-primary/30 hover:text-cyan-200"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        run(`lesson-${lesson.id}`, () => api.forget(lesson.id), (r) =>
                          r?.relearning
                            ? "Lesson deleted. Your model forgets it on its next run."
                            : "Lesson deleted.",
                        )
                      }
                      disabled={Boolean(busy)}
                      aria-label="Delete lesson"
                      className="text-primary/30 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {lesson.note && <p className="text-[11px] italic text-primary/45">“{lesson.note}”</p>}
                {lesson.after_reply && lesson.status === "learned" && (
                  <p className="text-[11px] text-emerald-100/60">Now says: {lesson.after_reply}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em]">
                  <span className={`border px-1.5 py-0.5 ${STATUS_TONE[lesson.status] || STATUS_TONE.saved}`}>
                    {lessonStatusLabel(lesson)}
                  </span>
                  <span className="border border-primary/15 px-1.5 py-0.5 text-primary/45">
                    {lesson.source === "auto" ? "Automatic" : "Yours"}
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
