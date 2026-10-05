import { useEffect, useState } from "react";
import { toast } from "sonner";
import { animaApi } from "@/api/animaApi";
import { clearOwnModelConfig } from "@/lib/ownModel/chat";

/**
 * Settings → AI Behavior: "let the own model learn from my chats". Shown
 * only while the steward lets it learn from people who opt in (or while
 * this person is still opted in, so they can always opt out).
 */
export default function OwnModelConsent({ api = animaApi.model }) {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => api.config())
      .then((next) => alive && setConfig(next))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  if (!config || (!config.learning_open && !config.share_for_training)) return null;
  const on = Boolean(config.share_for_training);

  const toggle = async () => {
    setSaving(true);
    try {
      const saved = await api.setConsent(!on);
      setConfig((prev) => ({ ...prev, share_for_training: Boolean(saved?.share_for_training) }));
      clearOwnModelConfig();
      toast.success(saved?.share_for_training ? "Thanks — it will learn from your chats." : "It won't learn from your chats.");
    } catch {
      toast.error("Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="font-mono text-xs text-primary/70 tracking-wider uppercase">Help Anima's own model learn</p>
        <p className="text-[9px] font-mono text-primary/30 mt-0.5 leading-relaxed">
          Your chats with the own model (never therapy or adult scenes) can become lessons it learns from.
          The Protocol steward can read those lessons. Off by default.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Help Anima's own model learn"
        disabled={saving}
        onClick={toggle}
        className={`relative w-10 h-5 border transition-all flex-shrink-0 disabled:opacity-40 ${
          on ? "bg-primary/20 border-primary/50" : "bg-black/60 border-primary/15"
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 transition-all ${on ? "left-5 bg-primary" : "left-0.5 bg-primary/20"}`} />
      </button>
    </div>
  );
}
