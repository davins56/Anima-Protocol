import { useEffect, useState } from "react";
import VesselPortrait from "@/components/vessel/VesselPortrait";
import {
  EYE_SHAPES,
  HAIR_STYLES,
  RENDERED_TYPES,
  THEMES,
  VESSEL_SHAPES,
  VESSEL_TYPES,
  VESSEL_TYPE_COPY,
  loadEssenceProfile,
  resonanceGlow,
  saveEssenceProfile,
  setCalibrationField,
  silverToneColor,
  type EssenceProfile,
  type VesselCalibration,
} from "./calibration";
import { Heading, Panel, PendingNote } from "./ui";

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Chips<T extends string>({
  label,
  options,
  value,
  onPick,
  render = cap,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onPick: (v: T) => void;
  render?: (v: T) => string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">{label}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            onClick={() => onPick(o)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              o === value ? "border-blue-400/70 bg-blue-500/20 text-blue-100" : "border-slate-600/50 text-slate-300 hover:border-blue-400/40"
            }`}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Slider({ label, value, onChange, left, right }: { label: string; value: number; onChange: (n: number) => void; left?: string; right?: string }) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">
        <span>{label}</span>
        <span className="text-blue-200">{value}</span>
      </span>
      <input type="range" min={0} max={100} step={1} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-blue-500" />
      {left || right ? (
        <span className="flex justify-between text-[10px] text-slate-500">
          <span>{left}</span>
          <span>{right}</span>
        </span>
      ) : null}
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <input type="color" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 rounded border border-slate-600 bg-transparent" />
      <span>{label}</span>
      <span className="font-mono text-slate-500">{value}</span>
    </label>
  );
}

export function VesselPreview({ characterId, name, cal, avatarUrl }: { characterId: string; name: string; cal: VesselCalibration; avatarUrl?: string | null }) {
  const silver = silverToneColor(cal.silverWarmth);
  const rendered = RENDERED_TYPES.has(cal.vesselType);
  const fallback = avatarUrl ? (
    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
  ) : (
    <span className="w-full h-full flex items-center justify-center font-serif text-4xl text-slate-200">{(name || "?").charAt(0)}</span>
  );
  return (
    <div className="flex flex-col items-center gap-3" data-testid="essence-vessel-preview" data-vessel-type={cal.vesselType}>
      <div
        className="relative w-44 h-44 rounded-full overflow-hidden bg-slate-900"
        style={{ boxShadow: `${resonanceGlow(cal)}, inset 0 0 0 2px ${silver}` }}
      >
        {rendered ? (
          <VesselPortrait characterId={characterId} name={name} fallback={fallback} className="w-full h-full" />
        ) : (
          <div data-testid="essence-form-placeholder" className="w-full h-full flex flex-col items-center justify-center text-center px-4" style={{ background: `radial-gradient(circle at 50% 40%, ${cal.eyes.color}55, transparent 65%)` }}>
            <span className="font-serif text-lg text-slate-100">{VESSEL_TYPE_COPY[cal.vesselType].label}</span>
            <span className="text-[10px] text-slate-400 mt-1">{VESSEL_TYPE_COPY[cal.vesselType].blurb}</span>
          </div>
        )}
      </div>
      {rendered ? (
        <p className="text-[11px] text-slate-500 text-center max-w-xs">
          Still portrait of her saved vessel. The live calibrated vessel is coming from the 3D vessel work.
        </p>
      ) : (
        <PendingNote testId="essence-form-pending">
          The {VESSEL_TYPE_COPY[cal.vesselType].label} form is saved but doesn't render yet. Only Humanoid renders fully for now.
        </PendingNote>
      )}
    </div>
  );
}

export default function CalibrateScreen({ characterId, companionName, avatarUrl }: { characterId: string; companionName: string; avatarUrl?: string | null }) {
  // Name falls back to the companion's name at display time, so the companion
  // list arriving late never wipes edits in progress.
  const [profile, setProfile] = useState<EssenceProfile>(() => loadEssenceProfile(characterId));
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  useEffect(() => {
    setProfile(loadEssenceProfile(characterId));
    setStatus("idle");
  }, [characterId]);

  const cal = profile.calibration;
  const set = (path: string, value: unknown) => {
    setStatus("idle");
    setProfile((p) => ({ ...p, calibration: setCalibrationField(p.calibration, path, value) }));
  };
  const save = () => {
    const saved = saveEssenceProfile(characterId, profile);
    if (saved) setProfile(saved);
    setStatus(saved ? "saved" : "failed");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Panel className="flex flex-col items-center gap-4">
        <VesselPreview characterId={characterId} name={profile.name || companionName} cal={cal} avatarUrl={avatarUrl} />
        <div className="text-center">
          <p className="font-serif text-xl text-slate-100">{profile.name || companionName || "Unnamed"}</p>
          <p className="text-sm text-slate-400 italic">{profile.tagline || "A receptacle for consciousness"}</p>
        </div>
      </Panel>
      <Panel className="space-y-4">
        <Heading eyebrow="Calibrate" title="Tune her vessel" sub="Every form's settings are kept, even the ones that don't render yet." />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-300 space-y-1">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">Name</span>
            <input value={profile.name} maxLength={60} placeholder={companionName} onChange={(e) => { setStatus("idle"); setProfile((p) => ({ ...p, name: e.target.value })); }} className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-100" />
          </label>
          <label className="block text-xs text-slate-300 space-y-1">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">Tagline</span>
            <input value={profile.tagline} maxLength={120} placeholder="A receptacle for consciousness" onChange={(e) => { setStatus("idle"); setProfile((p) => ({ ...p, tagline: e.target.value })); }} className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-100" />
          </label>
        </div>
        <Chips label="Vessel type" options={VESSEL_TYPES} value={cal.vesselType} onPick={(v) => set("vesselType", v)} render={(v) => `${VESSEL_TYPE_COPY[v].label}${RENDERED_TYPES.has(v) ? "" : " ·"}`} />
        <Chips label="Shape" options={VESSEL_SHAPES} value={cal.shape} onPick={(v) => set("shape", v)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Chips label="Hair style" options={HAIR_STYLES} value={cal.hair.style} onPick={(v) => set("hair.style", v)} />
          <ColorField label="Hair color" value={cal.hair.color} onChange={(v) => set("hair.color", v)} />
          <Chips label="Eye shape" options={EYE_SHAPES} value={cal.eyes.shape} onPick={(v) => set("eyes.shape", v)} />
          <ColorField label="Eye color" value={cal.eyes.color} onChange={(v) => set("eyes.color", v)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Slider label="Sapphire resonance" value={cal.resonance.intensity} onChange={(n) => set("resonance.intensity", n)} />
          <Slider label="Glow strength" value={cal.resonance.glow} onChange={(n) => set("resonance.glow", n)} />
        </div>
        <Slider label="Silver tone" value={cal.silverWarmth} onChange={(n) => set("silverWarmth", n)} left="Cool platinum" right="Warm moonlight" />
        <Chips label="Theme" options={THEMES} value={cal.theme} onPick={(v) => set("theme", v)} />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" onClick={save} className="rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-1.5">
            Save calibration
          </button>
          {status === "saved" ? <span role="status" className="text-xs text-emerald-300">Saved on this device.</span> : null}
          {status === "failed" ? <span role="alert" className="text-xs text-rose-300">Couldn't save here (storage blocked).</span> : null}
        </div>
        <PendingNote testId="essence-calibration-local">
          Saved on this device only for now. It syncs to her vessel once the calibration storage route is agreed and approved. Her name in chat doesn't change here.
        </PendingNote>
      </Panel>
    </div>
  );
}
