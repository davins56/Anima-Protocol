import { useEffect, useState } from "react";
import { updateCompanionRecord } from "@/lib/listPersonalAnimas";
import { Check, Loader, Save } from "lucide-react";

const ANIMA_ARCHETYPES = [
  "guardian",
  "muse",
  "sage",
  "trickster",
  "shadow",
  "lover",
  "explorer",
  "oracle",
  "serenity",
  "echo",
];

const inputClass =
  "w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors";

/**
 * Personality / identity editor for a personal Anima inside the Customiser hub.
 */
export default function AnimaPersonalityPanel({ anima, onSave }) {
  const [form, setForm] = useState(() => ({
    name: anima?.name || "",
    tagline: anima?.tagline || "",
    archetype: anima?.archetype || "guardian",
    personality: anima?.personality || "",
    backstory: anima?.backstory || "",
    speaking_style: anima?.speaking_style || "",
    status: anima?.status || "active",
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm({
      name: anima?.name || "",
      tagline: anima?.tagline || "",
      archetype: anima?.archetype || "guardian",
      personality: anima?.personality || "",
      backstory: anima?.backstory || "",
      speaking_style: anima?.speaking_style || "",
      status: anima?.status || "active",
    });
    setSaved(false);
    setError("");
  }, [anima?.id]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const dirty =
    form.name !== (anima?.name || "") ||
    form.tagline !== (anima?.tagline || "") ||
    form.archetype !== (anima?.archetype || "guardian") ||
    form.personality !== (anima?.personality || "") ||
    form.backstory !== (anima?.backstory || "") ||
    form.speaking_style !== (anima?.speaking_style || "") ||
    form.status !== (anima?.status || "active");

  const handleSave = async () => {
    if (!anima?.id || !form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const patch = {
        name: form.name.trim(),
        tagline: form.tagline.trim(),
        archetype: form.archetype,
        personality: form.personality,
        backstory: form.backstory,
        speaking_style: form.speaking_style,
        status: form.status,
      };
      await updateCompanionRecord(anima, patch);
      setSaved(true);
      onSave?.(patch);
    } catch (err) {
      setError(err?.message || "Failed to save personality.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-primary/25 bg-background hud-corner glow-border">
      <div className="px-4 sm:px-5 py-4 border-b border-primary/15 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm text-primary tracking-[0.2em] uppercase">
            // Personality
          </h2>
          <p className="font-mono text-[9px] text-primary/35 tracking-widest uppercase mt-0.5">
            Name, archetype, voice of mind
          </p>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className={`flex items-center gap-2 px-4 py-2 border font-mono text-[10px] tracking-widest uppercase transition-all disabled:opacity-40 ${
              saved
                ? "border-green-400/50 bg-green-400/10 text-green-400"
                : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            }`}
          >
            {saving ? (
              <Loader className="w-3.5 h-3.5 animate-spin" />
            ) : saved ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Archetype">
            <select
              value={form.archetype}
              onChange={(e) => setField("archetype", e.target.value)}
              className={inputClass}
            >
              {ANIMA_ARCHETYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Tagline">
          <input
            type="text"
            value={form.tagline}
            onChange={(e) => setField("tagline", e.target.value)}
            placeholder="A short line that captures their presence…"
            className={inputClass}
          />
        </Field>

        <Field label="Personality & Traits">
          <textarea
            value={form.personality}
            onChange={(e) => setField("personality", e.target.value)}
            rows={4}
            placeholder="Quirks, strengths, how they meet the world…"
            className={`${inputClass} resize-none leading-relaxed`}
          />
        </Field>

        <Field label="Backstory">
          <textarea
            value={form.backstory}
            onChange={(e) => setField("backstory", e.target.value)}
            rows={4}
            placeholder="Origin, history, what shaped them…"
            className={`${inputClass} resize-none leading-relaxed`}
          />
        </Field>

        <Field label="Speaking Style">
          <textarea
            value={form.speaking_style}
            onChange={(e) => setField("speaking_style", e.target.value)}
            rows={3}
            placeholder="Tone, vocabulary, cadence, verbal habits…"
            className={`${inputClass} resize-none leading-relaxed`}
          />
        </Field>

        <Field label="Status">
          <select
            value={form.status}
            onChange={(e) => setField("status", e.target.value)}
            className={inputClass}
          >
            <option value="active">Active</option>
            <option value="dormant">Dormant</option>
            <option value="archived">Archived</option>
          </select>
        </Field>

        {error && (
          <p className="font-mono text-[10px] text-red-400/90 border border-red-400/30 bg-red-950/20 px-3 py-2">
            {error}
          </p>
        )}

        <p className="font-mono text-[9px] text-primary/30 leading-relaxed">
          Personality and speaking style shape how your Anima replies in chat.
          Look and theme stay on the Look tab.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}
