import { useState, useEffect } from "react";
import { ShieldAlert, Heart } from "lucide-react";
import { fetchIntimacyProfile, patchIntimacyProfile } from "@/lib/intimacyClient";
import { fetchSynchro } from "@/lib/synchroClient";
import ConnectionMeters from "./ConnectionMeters";

export default function IntimacyDock({ characterId, conversationId, refreshKey, onProfileUpdate }) {
  const [profile, setProfile] = useState(null);
  const [synchro, setSynchro] = useState(null);
  const [loading, setLoading] = useState(false);
  const [triggeringSafeword, setTriggeringSafeword] = useState(false);

  useEffect(() => {
    if (!characterId) return;
    let active = true;
    setSynchro(null);
    fetchIntimacyProfile(characterId).then((p) => {
      if (active && p) {
        setProfile(p);
        if (onProfileUpdate) onProfileUpdate(p);
      }
    });
    fetchSynchro(characterId).then((s) => {
      if (active && s) setSynchro(s);
    });
    return () => {
      active = false;
    };
  }, [characterId, conversationId]);

  // Heat is written server-side after each reply is persisted. Re-read it when
  // a turn settles (refreshKey changes) so the meter rises during the scene
  // instead of only after reopening the chat. Two reads cover the async save.
  useEffect(() => {
    if (!characterId || refreshKey == null) return;
    let active = true;
    const pull = () => {
      fetchSynchro(characterId).then((s) => {
        if (active && s) setSynchro(s);
      });
      return fetchIntimacyProfile(characterId).then((p) => {
        if (active && p) {
          setProfile(p);
          if (onProfileUpdate) onProfileUpdate(p);
        }
      });
    };
    const t1 = setTimeout(pull, 800);
    const t2 = setTimeout(pull, 3000);
    return () => {
      active = false;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [characterId, refreshKey]);
  if (!characterId || (!profile && !synchro)) return null;

  const toggleIntimacy = async () => {
    if (loading || !profile) return;
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

  const heat = profile?.heat || 0;
  const isEnabled = Boolean(profile?.intimacyEnabled);

  return (
    <div className="flex w-full flex-col gap-2 border border-primary/20 bg-black/60 px-3 py-1.5 font-mono text-xs hud-corner sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <ConnectionMeters synchro={synchro} heat={heat} showHeat={isEnabled} />

      {profile && (
        <div className="flex items-center gap-2 sm:gap-3">
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
          )}
        </div>
      )}
    </div>
  );
}
