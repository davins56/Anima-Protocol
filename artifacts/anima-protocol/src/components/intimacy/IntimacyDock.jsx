import { useState, useEffect } from "react";
import { Flame, ShieldAlert, Zap, Heart } from "lucide-react";
import { fetchIntimacyProfile, patchIntimacyProfile } from "@/lib/intimacyClient";

export default function IntimacyDock({ characterId, conversationId, onProfileUpdate }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [triggeringSafeword, setTriggeringSafeword] = useState(false);

  useEffect(() => {
    if (!characterId) return;
    let active = true;
    fetchIntimacyProfile(characterId).then((p) => {
      if (active && p) {
        setProfile(p);
        if (onProfileUpdate) onProfileUpdate(p);
      }
    });
    return () => {
      active = false;
    };
  }, [characterId, conversationId]);

  if (!characterId || !profile) return null;

  const toggleIntimacy = async () => {
    if (loading) return;
    setLoading(true);
    const nextEnabled = !profile.intimacyEnabled;
    const updated = await patchIntimacyProfile(characterId, { intimacyEnabled: nextEnabled });
    if (updated) {
      setProfile(updated);
      if (onProfileUpdate) onProfileUpdate(updated);
    }
    setLoading(false);
  };

  const handleSafeword = async () => {
    if (triggeringSafeword) return;
    setTriggeringSafeword(true);
    const updated = await patchIntimacyProfile(characterId, {
      heat: 15,
      intimacyEnabled: true,
    });
    if (updated) {
      setProfile(updated);
      if (onProfileUpdate) onProfileUpdate(updated);
    }
    setTriggeringSafeword(false);
  };

  const heat = profile.heat || 0;
  const isEnabled = profile.intimacyEnabled;

  const heatColor =
    heat >= 80
      ? "bg-rose-500 text-rose-300 border-rose-500/50 shadow-rose-500/20"
      : heat >= 40
        ? "bg-amber-500 text-amber-300 border-amber-500/50"
        : heat >= 15
          ? "bg-yellow-500 text-yellow-300 border-yellow-500/50"
          : "bg-primary/20 text-primary/60 border-primary/20";

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-black/60 border border-primary/20 hud-corner text-xs font-mono">
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggleIntimacy}
        disabled={loading}
        className={`flex items-center gap-1.5 px-2.5 py-1 border text-[10px] tracking-widest uppercase transition-all ${
          isEnabled
            ? "bg-rose-950/40 border-rose-500/50 text-rose-300 hover:bg-rose-900/50"
            : "bg-primary/5 border-primary/20 text-primary/40 hover:text-primary/70"
        }`}
      >
        <Heart className={`w-3 h-3 ${isEnabled ? "fill-rose-500 text-rose-400" : ""}`} />
        <span>{isEnabled ? "Pulse On" : "Pulse Off"}</span>
      </button>

      {isEnabled && (
        <>
          {/* Heat meter */}
          <div className="flex items-center gap-2 border-l border-primary/20 pl-3">
            <Flame className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <div className="flex flex-col">
              <span className="text-[9px] text-primary/40 uppercase tracking-wider">Heat</span>
              <div className="w-16 h-2 bg-black/80 border border-primary/20 rounded-full overflow-hidden mt-0.5">
                <div
                  className={`h-full transition-all duration-500 ${heatColor}`}
                  style={{ width: `${Math.min(100, Math.max(0, heat))}%` }}
                />
              </div>
            </div>
            <span className="text-[10px] font-bold text-amber-300 ml-1">{heat}</span>
          </div>

          {/* Safeword button */}
          <button
            type="button"
            onClick={handleSafeword}
            disabled={triggeringSafeword}
            className="flex items-center gap-1 px-2 py-1 bg-red-950/60 border border-red-500/50 text-red-400 hover:bg-red-900/70 text-[9px] uppercase tracking-widest transition-all hud-corner"
            title={`Trigger Safeword (${profile.safeword || "red"})`}
          >
            <ShieldAlert className="w-3 h-3 text-red-400" />
            <span>{profile.safeword ? profile.safeword.toUpperCase() : "SAFEWORD"}</span>
          </button>
        </>
      )}
    </div>
  );
}
