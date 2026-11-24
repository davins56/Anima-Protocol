import { useEffect, useState } from "react";
import {
  CONTROLS_BY_FORM,
  EYE_SHAPE_OPTIONS,
  HAIR_STYLE_OPTIONS,
  NAME_MAX,
  NET_FORM_OPTIONS,
  SHAPE_OPTIONS,
  TAGLINE_MAX,
  THEME_OPTIONS,
  VESSEL_TYPE_OPTIONS,
  controlApplies,
  isUserSet,
  loadEssenceProfile,
  resetCalibrationField,
  saveEssenceProfile,
  setCalibrationField,
  validateEssenceIdentity,
  type CalibrationControl,
  type CalibrationPath,
  type EssenceProfile,
  type Option,
  type VesselType,
} from "./calibration";
import { VesselPreview } from "./VesselPreview";
import { Heading, Panel, PendingNote } from "./ui";

export const FROM_VESSEL = "From her vessel";

/** Shown when a field isn't user-set: her existing vessel drives it, not the calibration default. */
function FromVessel({ userSet, onReset, label }: { userSet: boolean; onReset: () => void; label: string }) {
  return userSet ? (
    <button type="button" onClick={onReset} className="text-[10px] text-slate-500 hover:text-blue-200 underline-offset-2 hover:underline" aria-label={`Use her vessel's ${label.toLowerCase()}`}>
      Use her vessel's
    </button>
  ) : (
    <span className="text-[10px] text-blue-300/70" data-testid="from-vessel-hint">
      {FROM_VESSEL}
    </span>
  );
}

function Chips<T extends string>({
  label,
  options,
  value,
  userSet,
  onPick,
  onReset,
  testId,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T | undefined;
  userSet: boolean;
  onPick: (v: T) => void;
  onReset: () => void;
  testId?: string;
}) {
  const chip = (checked: boolean) =>
    `px-2.5 py-1 rounded-full text-xs border transition-colors ${
      checked ? "border-blue-400/70 bg-blue-500/20 text-blue-100" : "border-slate-600/50 text-slate-300 hover:border-blue-400/40"
    }`;
  return (
    <fieldset className="space-y-1.5" data-testid={testId}>
      <legend className="font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">{label}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {/* Not user-set: her vessel decides, so no calibration value is shown as picked. */}
        <button type="button" role="radio" aria-checked={!userSet} onClick={() => userSet && onReset()} className={`${chip(!userSet)} italic`}>
          {FROM_VESSEL}
        </button>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={userSet && o.value === value} onClick={() => onPick(o.value)} className={chip(userSet && o.value === value)} title={o.blurb}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Slider({ label, value, userSet, onChange, onReset, left, right }: { label: string; value: number; userSet: boolean; onChange: (n: number) => void; onReset: () => void; left?: string; right?: string }) {
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="flex justify-between font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">
          <span>{label}</span>
          <span className="text-blue-200">{userSet ? value : "—"}</span>
        </span>
        <input type="range" min={0} max={100} step={1} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className={`w-full accent-blue-500 ${userSet ? "" : "opacity-50"}`} />
      </label>
      <span className="flex justify-between text-[10px] text-slate-500">
        <span>{left}</span>
        <FromVessel userSet={userSet} onReset={onReset} label={label} />
        <span>{right}</span>
      </span>
    </div>
  );
}

function ColorField({ label, value, userSet, onChange, onReset }: { label: string; value: string; userSet: boolean; onChange: (v: string) => void; onReset: () => void }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <input type="color" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className={`h-7 w-9 rounded border border-slate-600 bg-transparent ${userSet ? "" : "opacity-50"}`} />
      <span>{label}</span>
      {userSet ? <span className="font-mono text-slate-500">{value}</span> : null}
      <FromVessel userSet={userSet} onReset={onReset} label={label} />
    </div>
  );
}

/** The form whose controls apply: what the preview renders (humanoid unless the user picked another). */
export function activeForm(cal: { vesselType: VesselType; source: Partial<Record<string, string>> }): VesselType {
  return cal.source?.vesselType === "user" ? cal.vesselType : "humanoid";
}

export default function CalibrateScreen({ characterId, companionName }: { characterId: string; companionName: string; avatarUrl?: string | null }) {
  // Name falls back to the companion's name at display time, so the companion
  // list arriving late never wipes edits in progress.
  const [profile, setProfile] = useState<EssenceProfile>(() => loadEssenceProfile(characterId));
  const [status, setStatus] = useState<"idle" | "saved" | "failed" | "invalid_name" | "invalid_tagline">("idle");
  useEffect(() => {
    setProfile(loadEssenceProfile(characterId));
    setStatus("idle");
  }, [characterId]);

  const cal = profile.calibration;
  const form = activeForm(cal);
  const u = (p: CalibrationPath) => isUserSet(cal, p);
  // Controls that don't apply to this form are hidden; their values stay saved.
  const show = (c: CalibrationControl) => controlApplies(form, c);
  const hiddenCount = CONTROLS_BY_FORM.humanoid.filter((c) => !controlApplies(form, c)).length;
  const reset = (path: CalibrationPath) => {
    setStatus("idle");
    setProfile((p) => ({ ...p, calibration: resetCalibrationField(p.calibration, path) }));
  };
  const set = (path: string, value: unknown) => {
    setStatus("idle");
    setProfile((p) => ({ ...p, calibration: setCalibrationField(p.calibration, path, value) }));
  };
  const save = () => {
    // An empty name field means "keep her current name", as the placeholder shows.
    const candidate = { ...profile, name: profile.name.trim() || companionName };
    const errors = validateEssenceIdentity(candidate.name, candidate.tagline);
    if (errors.length) {
      setStatus(errors.includes("invalid_name") ? "invalid_name" : "invalid_tagline");
      return;
    }
    const saved = saveEssenceProfile(characterId, candidate);
    if (saved) setProfile(saved);
    setStatus(saved ? "saved" : "failed");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Panel className="flex flex-col items-center gap-4">
        <VesselPreview characterId={characterId} name={profile.name || companionName} cal={cal} />
        <div className="text-center">
          <p className="font-serif text-xl text-slate-100">{profile.name || companionName || "Unnamed"}</p>
          <p className="text-sm text-slate-400 italic">{profile.tagline || "A receptacle for consciousness"}</p>
        </div>
      </Panel>
      <Panel className="space-y-4">
        <Heading eyebrow="Calibrate" title="Tune her vessel" sub="Fields you haven't touched follow her existing vessel. Every form's settings are kept." />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-300 space-y-1">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">Name</span>
            <input value={profile.name} maxLength={NAME_MAX} placeholder={companionName} onChange={(e) => { setStatus("idle"); setProfile((p) => ({ ...p, name: e.target.value })); }} className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-100" />
          </label>
          <label className="block text-xs text-slate-300 space-y-1">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-slate-400">Tagline</span>
            <input value={profile.tagline} maxLength={TAGLINE_MAX} placeholder="A receptacle for consciousness" onChange={(e) => { setStatus("idle"); setProfile((p) => ({ ...p, tagline: e.target.value })); }} className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-100" />
          </label>
        </div>
        <Chips label="Vessel type" testId="control-vesselType" options={VESSEL_TYPE_OPTIONS} value={cal.vesselType} userSet={u("vesselType")} onPick={(v) => set("vesselType", v)} onReset={() => reset("vesselType")} />
        {show("shape") ? <Chips label="Shape" testId="control-shape" options={SHAPE_OPTIONS} value={cal.shape} userSet={u("shape")} onPick={(v) => set("shape", v)} onReset={() => reset("shape")} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {show("hair.style") ? <Chips label="Hair style" testId="control-hair.style" options={HAIR_STYLE_OPTIONS} value={cal.hair.style} userSet={u("hair.style")} onPick={(v) => set("hair.style", v)} onReset={() => reset("hair.style")} /> : null}
          {show("hair.color") ? <ColorField label="Hair color" value={cal.hair.color} userSet={u("hair.color")} onChange={(v) => set("hair.color", v)} onReset={() => reset("hair.color")} /> : null}
          {show("eyes.shape") ? <Chips label="Eye shape" testId="control-eyes.shape" options={EYE_SHAPE_OPTIONS} value={cal.eyes.shape} userSet={u("eyes.shape")} onPick={(v) => set("eyes.shape", v)} onReset={() => reset("eyes.shape")} /> : null}
          {show("eyes.color") ? <ColorField label="Eye color" value={cal.eyes.color} userSet={u("eyes.color")} onChange={(v) => set("eyes.color", v)} onReset={() => reset("eyes.color")} /> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {show("resonance.intensity") ? <Slider label="Sapphire resonance" value={cal.resonance.intensity} userSet={u("resonance.intensity")} onChange={(n) => set("resonance.intensity", n)} onReset={() => reset("resonance.intensity")} /> : null}
          {show("resonance.glow") ? <Slider label="Glow strength" value={cal.resonance.glow} userSet={u("resonance.glow")} onChange={(n) => set("resonance.glow", n)} onReset={() => reset("resonance.glow")} /> : null}
        </div>
        {show("silverWarmth") ? <Slider label="Silver tone" value={cal.silverWarmth} userSet={u("silverWarmth")} onChange={(n) => set("silverWarmth", n)} onReset={() => reset("silverWarmth")} left="Cool platinum" right="Warm moonlight" /> : null}
        {show("theme") ? <Chips label="Theme" testId="control-theme" options={THEME_OPTIONS} value={cal.theme} userSet={u("theme")} onPick={(v) => set("theme", v)} onReset={() => reset("theme")} /> : null}
        {show("netForm") ? <Chips label="Net form" testId="control-netForm" options={NET_FORM_OPTIONS} value={cal.netForm} userSet={u("netForm") && Boolean(cal.netForm)} onPick={(v) => set("netForm", v)} onReset={() => reset("netForm")} /> : null}
        {hiddenCount > 0 ? (
          <p className="text-[11px] text-slate-500" data-testid="essence-hidden-controls">
            {hiddenCount === 1 ? "One setting doesn't" : `${hiddenCount} settings don't`} change this form. They stay saved for when she returns to Humanoid.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" onClick={save} className="rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-1.5">
            Save calibration
          </button>
          {status === "saved" ? <span role="status" className="text-xs text-emerald-300">Saved on this device.</span> : null}
          {status === "failed" ? <span role="alert" className="text-xs text-rose-300">Couldn't save here (storage blocked).</span> : null}
          {status === "invalid_name" ? <span role="alert" className="text-xs text-rose-300">Her name needs 1–{NAME_MAX} characters.</span> : null}
          {status === "invalid_tagline" ? <span role="alert" className="text-xs text-rose-300">The tagline can be up to {TAGLINE_MAX} characters.</span> : null}
        </div>
        <PendingNote testId="essence-calibration-local">
          Saved on this device only for now. It syncs to her vessel once the calibration storage route is agreed and approved. Her name in chat doesn't change here.
        </PendingNote>
      </Panel>
    </div>
  );
}
