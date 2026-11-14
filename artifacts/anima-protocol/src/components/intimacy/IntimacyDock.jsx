import { useState, useEffect, useRef } from "react";
import { ShieldAlert, Heart } from "lucide-react";
import { fetchIntimacyProfile, patchIntimacyProfile } from "@/lib/intimacyClient";
import { fetchSynchro } from "@/lib/synchroClient";
import ConnectionMeters from "./ConnectionMeters";
import { liveHeatNow, meterHeat } from "@/lib/pulseHeat";

/** How often the Heat meter re-checks its cooling during a pause. */
export const HEAT_COOL_TICK_MS = 30_000;

/** How long a live reply value outranks a re-read of the stored bond. */
export const LIVE_SYNCHRO_WINDOW_MS = 6000;

/**
 * `liveSynchroStrength` is the bond value the chat reply just reported
 * (companion_affect.synchro_strength). It updates the Synchro meter the moment
 * a reply lands, so it agrees with the Resonance Field instead of waiting on
 * the delayed re-read below.
 *
 * `livePulseHeat` is the Heat value the reply just reported (`pulse_heat` on
 * the chat `done` event). The meter shows the higher of it and the stored
 * profile, both cooled for the time since, so a re-read that lands before the
 * turn's save cannot drag it back to Calm.
 */
export default function IntimacyDock({ characterId, conversationId, refreshKey, onProfileUpdate, liveSynchroStrength = null, livePulseHeat = null }) {
  const [profile, setProfile] = useState(null);
  const [synchro, setSynchro] = useState(null);
  const [loading, setLoading] = useState(false);
  const [triggeringSafeword, setTriggeringSafeword] = useState(false);
  // Last live value from a reply. The turn's bond write lands after the reply
  // finishes, so a re-read right after can still return the previous value;
  // within this window the live value wins over a fetched one.
  const liveRef = useRef({ characterId: null, strength: null, at: 0 });
  const [liveHeat, setLiveHeat] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Cooling is time-based: re-evaluate on a slow tick, never per render.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), HEAT_COOL_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setLiveHeat(null);
  }, [characterId]);

  useEffect(() => {
    if (!characterId) return;
    const value = typeof livePulseHeat === "number" ? livePulseHeat : livePulseHeat?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const at = Date.now();
    setLiveHeat({ value: Math.max(0, Math.min(100, Math.round(value))), at });
    setNow(at);
  }, [characterId, livePulseHeat]);

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
        if (!active || !s) return;
        const live = liveRef.current;
        const liveIsFresh =
          live.characterId === characterId &&
          typeof live.strength === "number" &&
          Date.now() - live.at < LIVE_SYNCHRO_WINDOW_MS;
        setSynchro(liveIsFresh ? { ...s, strength: live.strength } : s);
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
  useEffect(() => {
    if (!characterId) return;
    if (typeof liveSynchroStrength !== "number" || !Number.isFinite(liveSynchroStrength)) return;
    const strength = Math.max(0, Math.min(100, Math.round(liveSynchroStrength)));
    liveRef.current = { characterId, strength, at: Date.now() };
    setSynchro((prev) => (prev?.strength === strength ? prev : { ...(prev || {}), strength }));
  }, [characterId, liveSynchroStrength]);

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

  const heat = Math.max(meterHeat(profile, now), liveHeatNow(liveHeat, now));
  const isEnabled = Boolean(profile?.intimacyEnabled);

  return (
    <div className="flex w-full flex-col gap-2 border border-primary/20 bg-black/60 px-3 py-1.5 font-mono text-xs hud-corner sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <ConnectionMeters synchro={synchro} heat={heat} showHeat={isEnabled} resetKey={characterId} />

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
