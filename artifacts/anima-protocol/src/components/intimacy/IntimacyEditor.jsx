import { useState, useEffect } from "react";
import { Flame, Shield, Sparkles, Heart, Save, Loader2 } from "lucide-react";
import { fetchIntimacyProfile, patchIntimacyProfile } from "@/lib/intimacyClient";

export default function IntimacyEditor({ characterId, characterName, onSaved }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({
    intimacyEnabled: false,
    safeword: "red",
    preferredPace: "slow",
    powerAxis: 0,
    kinks: "",
    limits: "",
    softLimits: "",
    aftercareStyle: "quiet grounding, closeness, verbal check-in",
    anatomyChest: "",
    anatomyLowerBody: "",
    anatomyZones: "",
    anatomyNotes: "",
  });

  useEffect(() => {
    if (!characterId) return;
    let active = true;
    setLoading(true);
    fetchIntimacyProfile(characterId).then((p) => {
      if (!active) return;
      if (p) {
        setProfile(p);
        setForm({
          intimacyEnabled: Boolean(p.intimacyEnabled),
          safeword: p.safeword || "red",
          preferredPace: p.preferredPace || "slow",
          powerAxis: typeof p.powerAxis === "number" ? p.powerAxis : 0,
          kinks: Array.isArray(p.kinks) ? p.kinks.join(", ") : "",
          limits: Array.isArray(p.limits) ? p.limits.join(", ") : "",
          softLimits: Array.isArray(p.softLimits) ? p.softLimits.join(", ") : "",
          aftercareStyle: p.aftercareStyle || "quiet grounding, closeness, verbal check-in",
          anatomyChest: p.anatomy?.chest || "",
          anatomyLowerBody: p.anatomy?.lowerBody || "",
          anatomyZones: Array.isArray(p.anatomy?.erogenousZones) ? p.anatomy.erogenousZones.join(", ") : "",
          anatomyNotes: p.anatomy?.notes || "",
        });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [characterId]);

  if (!characterId) return null;

  const handleSave = async () => {
    setSaving(true);
    setMsg("");

    const kinksArr = form.kinks.split(",").map((s) => s.trim()).filter(Boolean);
    const limitsArr = form.limits.split(",").map((s) => s.trim()).filter(Boolean);
    const softLimitsArr = form.softLimits.split(",").map((s) => s.trim()).filter(Boolean);
    const zonesArr = form.anatomyZones.split(",").map((s) => s.trim()).filter(Boolean);

    const patch = {
      intimacyEnabled: form.intimacyEnabled,
      safeword: form.safeword,
      preferredPace: form.preferredPace,
      powerAxis: Number(form.powerAxis),
      kinks: kinksArr,
      limits: limitsArr,
      softLimits: softLimitsArr,
      aftercareStyle: form.aftercareStyle,
      anatomy: {
        chest: form.anatomyChest,
        lowerBody: form.anatomyLowerBody,
        erogenousZones: zonesArr,
        notes: form.anatomyNotes,
      },
    };

    const updated = await patchIntimacyProfile(characterId, patch);
    if (updated) {
      setProfile(updated);
      setMsg("Saved intimacy profile.");
      if (onSaved) onSaved(updated);
    } else {
      setMsg("Failed to save profile.");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center text-primary/40 font-mono text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading Intimacy Configuration...
      </div>
    );
  }

  return (
    <div className="border border-rose-500/30 bg-black/60 p-5 hud-corner space-y-4 font-mono text-xs">
      <div className="flex items-center justify-between border-b border-rose-500/20 pb-3">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-rose-400" />
          <h3 className="text-rose-300 font-bold tracking-wider uppercase">
            // Pulse & Intimacy Settings {characterName ? `— ${characterName}` : ""}
          </h3>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-[10px] uppercase text-rose-300/70">Enable Intimacy</span>
          <input
            type="checkbox"
            checked={form.intimacyEnabled}
            onChange={(e) => setForm((f) => ({ ...f, intimacyEnabled: e.target.checked }))}
            className="accent-rose-500 w-4 h-4"
          />
        </label>
      </div>

      {form.intimacyEnabled && (
        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
                Safeword *
              </label>
              <input
                type="text"
                value={form.safeword}
                onChange={(e) => setForm((f) => ({ ...f, safeword: e.target.value }))}
                placeholder="red"
                className="w-full bg-black/80 border border-primary/20 text-rose-300 px-3 py-1.5 focus:border-rose-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
                Preferred Pace
              </label>
              <select
                value={form.preferredPace}
                onChange={(e) => setForm((f) => ({ ...f, preferredPace: e.target.value }))}
                className="w-full bg-black/80 border border-primary/20 text-rose-300 px-3 py-1.5 focus:border-rose-500 outline-none"
              >
                <option value="slow">Slow (gradual buildup)</option>
                <option value="build">Build (moderate pace)</option>
                <option value="intense">Intense (fast build)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
                Hard Limits (comma-separated)
              </label>
              <input
                type="text"
                value={form.limits}
                onChange={(e) => setForm((f) => ({ ...f, limits: e.target.value }))}
                placeholder="e.g. violence, public"
                className="w-full bg-black/80 border border-primary/20 text-primary/80 px-3 py-1.5 focus:border-rose-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
                Soft Limits (comma-separated)
              </label>
              <input
                type="text"
                value={form.softLimits}
                onChange={(e) => setForm((f) => ({ ...f, softLimits: e.target.value }))}
                placeholder="e.g. bite, restrain"
                className="w-full bg-black/80 border border-primary/20 text-primary/80 px-3 py-1.5 focus:border-rose-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
              Kinks & Preferences (comma-separated)
            </label>
            <input
              type="text"
              value={form.kinks}
              onChange={(e) => setForm((f) => ({ ...f, kinks: e.target.value }))}
              placeholder="e.g. praise, slow romance, neck touch"
              className="w-full bg-black/80 border border-primary/20 text-primary/80 px-3 py-1.5 focus:border-rose-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
              Aftercare Style
            </label>
            <textarea
              rows={2}
              value={form.aftercareStyle}
              onChange={(e) => setForm((f) => ({ ...f, aftercareStyle: e.target.value }))}
              placeholder="e.g. quiet grounding, closeness, verbal check-in"
              className="w-full bg-black/80 border border-primary/20 text-primary/80 px-3 py-1.5 focus:border-rose-500 outline-none resize-none"
            />
          </div>

          {/* Anatomy Configuration */}
          <div className="border-t border-rose-500/20 pt-3 space-y-3">
            <h4 className="text-[11px] text-rose-300 font-bold uppercase tracking-wider">
              // Anatomy & Physical Characteristics
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
                  Chest / Upper Body
                </label>
                <input
                  type="text"
                  value={form.anatomyChest}
                  onChange={(e) => setForm((f) => ({ ...f, anatomyChest: e.target.value }))}
                  placeholder="Upper body details..."
                  className="w-full bg-black/80 border border-primary/20 text-primary/80 px-3 py-1.5 focus:border-rose-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
                  Lower Body
                </label>
                <input
                  type="text"
                  value={form.anatomyLowerBody}
                  onChange={(e) => setForm((f) => ({ ...f, anatomyLowerBody: e.target.value }))}
                  placeholder="Lower body details..."
                  className="w-full bg-black/80 border border-primary/20 text-primary/80 px-3 py-1.5 focus:border-rose-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-primary/40 uppercase tracking-widest mb-1">
                Erogenous Zones (comma-separated)
              </label>
              <input
                type="text"
                value={form.anatomyZones}
                onChange={(e) => setForm((f) => ({ ...f, anatomyZones: e.target.value }))}
                placeholder="e.g. neck, lower back, inner thighs"
                className="w-full bg-black/80 border border-primary/20 text-primary/80 px-3 py-1.5 focus:border-rose-500 outline-none"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-primary/10">
        {msg && <span className="text-[10px] text-rose-400">{msg}</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-rose-950/60 border border-rose-500/50 text-rose-300 hover:bg-rose-900/60 font-mono text-xs uppercase tracking-widest hud-corner transition-all"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span>Save Intimacy Profile</span>
        </button>
      </div>
    </div>
  );
}
