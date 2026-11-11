/** Customization panel (touch-friendly, iPad-first). Pure controlled component. */
import { useState } from "react";
import {
  ACCESSORIES,
  AURAS,
  BODY_TYPES,
  BOTTOMS,
  HAIR_STYLES,
  SERENITY_FORMS,
  TOPS,
  VESSEL_BASES,
  VESSEL_PRESETS,
  parseVesselConfig,
  serenityFormOf,
  type SerenityForm,
  type VesselConfig,
} from "@/lib/vessel/vesselConfig";
import { applyVesselText } from "@/lib/vessel/vesselText";
import type { VesselRecord } from "@/lib/vessel/vesselApi";
import VesselModelUpload from "./VesselModelUpload";
import { LIFELIKE_BASES, hasLifelikeBase, isLifelikeModel, withLifelikeBase } from "@/lib/vessel/lifelikeBase";

const FORM_KEYS = Object.keys(SERENITY_FORMS) as SerenityForm[];

type Props = {
  value: VesselConfig;
  onChange: (v: VesselConfig) => void;
  /** Gets the typed description that produced a change, so it can be stored as the save note. */
  onTextApplied?: (text: string) => void;
  /** Companion id; enables the VRM/GLB model upload section. */
  characterId?: string;
  /** Called with the new vessel version after a model upload completes. */
  onModelUploaded?: (vessel: VesselRecord) => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] tracking-widest uppercase text-primary/60">{title}</p>
      {children}
    </div>
  );
}

function Chips<T extends string>({ options, value, onPick }: { options: readonly T[]; value: T | T[]; onPick: (v: T) => void }) {
  const active = (o: T) => (Array.isArray(value) ? value.includes(o) : value === o);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(o)}
          className={`px-2.5 py-1.5 min-h-[36px] border font-mono text-[11px] capitalize ${active(o) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
        >
          {o.replace(/-/g, " ")}
        </button>
      ))}
    </div>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-9 h-9 bg-transparent border border-border" />
      {label}
    </label>
  );
}

/** Type the customisation in words; the parser fills the controls below. */
function Describe({ value, onApply }: { value: VesselConfig; onApply: (next: VesselConfig, text: string) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ applied: string[]; unmatched: string[] } | null>(null);
  const run = () => {
    if (!text.trim()) return;
    const parsed = applyVesselText(text, value);
    onApply(parsed.config, text);
    setResult({ applied: parsed.applied, unmatched: parsed.unmatched });
  };
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={400}
        aria-label="Describe the vessel"
        placeholder="short white hair, silver-blue eyes, white robe with an indigo sash, small halo, violet wings…"
        className="w-full bg-transparent border border-border px-2 py-2 text-sm"
      />
      <button
        type="button"
        onClick={run}
        disabled={!text.trim()}
        className="w-full min-h-[40px] border border-primary bg-primary/15 text-primary font-mono text-[11px] tracking-widest uppercase disabled:opacity-40"
      >
        Generate from text
      </button>
      {result && (
        <div className="font-mono text-[10px] text-muted-foreground space-y-0.5">
          {result.applied.length ? (
            result.applied.map((line, i) => <p key={`${line}-${i}`}>· {line}</p>)
          ) : (
            <p>Nothing recognised — name her hair, eyes, outfit, a colour or an aura.</p>
          )}
          {result.unmatched.length > 0 && <p className="opacity-70">not used: {result.unmatched.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

export default function VesselCustomizer({ value: v, onChange, onTextApplied, characterId, onModelUploaded }: Props) {
  const set = (patch: Partial<VesselConfig>) => onChange(parseVesselConfig({ ...v, ...patch }));
  return (
    <div className="space-y-5">
      <Section title="Model">
        <VesselModelUpload
          characterId={characterId}
          model={v.model}
          onUploaded={(vessel) => (onModelUploaded ? onModelUploaded(vessel) : onChange(vessel.config))}
          onUseProcedural={() => onChange(parseVesselConfig({ ...v, model: { kind: "procedural" } }))}
        />
      </Section>
      {hasLifelikeBase(v.base) && (
        <Section title="Body">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onChange(parseVesselConfig({ ...v, model: { kind: "procedural" } }))}
              className={`px-2.5 py-1.5 min-h-[36px] border font-mono text-[11px] ${!isLifelikeModel(v.model) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
            >
              Stylised
            </button>
            <button
              type="button"
              onClick={() => hasLifelikeBase(v.base) && onChange(withLifelikeBase(v, v.base))}
              className={`px-2.5 py-1.5 min-h-[36px] border font-mono text-[11px] ${isLifelikeModel(v.model) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
            >
              {LIFELIKE_BASES[v.base].label} (beta)
            </button>
          </div>
          {isLifelikeModel(v.model) && (
            <p className="font-mono text-[10px] text-muted-foreground">High-detail body, ~20 MB, loads only here and in the expanded presence view. Use HD for full skin and eye shading.</p>
          )}
        </Section>
      )}
      <Section title="Type it">
        <Describe
          value={v}
          onApply={(next, text) => {
            onChange(next);
            onTextApplied?.(text);
          }}
        />
      </Section>
      <Section title="Preset">
        <Chips options={VESSEL_BASES} value={v.base} onPick={(b) => set(b === "custom" ? { base: "custom" } : { ...VESSEL_PRESETS[b] })} />
      </Section>
      {v.base === "serenity" && (
        <Section title="Form">
          <Chips options={FORM_KEYS} value={serenityFormOf(v)} onPick={(form) => set({ ...SERENITY_FORMS[form] })} />
        </Section>
      )}
      <Section title="Body">
        <Chips options={BODY_TYPES} value={v.bodyType} onPick={(bodyType) => set({ bodyType })} />
        <input type="range" min={0.85} max={1.15} step={0.01} value={v.height} onChange={(e) => set({ height: Number(e.target.value) })} className="w-full" aria-label="Height" />
        <Color label="Skin" value={v.skinTone} onChange={(skinTone) => set({ skinTone })} />
      </Section>
      <Section title="Hair">
        <Chips options={HAIR_STYLES} value={v.hair.style} onPick={(style) => set({ hair: { ...v.hair, style } })} />
        <Color label="Hair color" value={v.hair.color} onChange={(color) => set({ hair: { ...v.hair, color } })} />
      </Section>
      <Section title="Eyes">
        <Color label="Iris" value={v.eyes.color} onChange={(color) => set({ eyes: { ...v.eyes, color } })} />
        <input type="range" min={0} max={1} step={0.05} value={v.eyes.glow} onChange={(e) => set({ eyes: { ...v.eyes, glow: Number(e.target.value) } })} className="w-full" aria-label="Eye glow" />
      </Section>
      <Section title="Clothing">
        <Chips options={TOPS} value={v.outfit.top as (typeof TOPS)[number]} onPick={(top) => set({ outfit: { ...v.outfit, top } })} />
        <Chips options={BOTTOMS} value={v.outfit.bottom as (typeof BOTTOMS)[number]} onPick={(bottom) => set({ outfit: { ...v.outfit, bottom } })} />
        <div className="flex gap-4">
          <Color label="Main" value={v.outfit.color} onChange={(color) => set({ outfit: { ...v.outfit, color } })} />
          <Color label="Accent" value={v.outfit.accent} onChange={(accent) => set({ outfit: { ...v.outfit, accent } })} />
        </div>
      </Section>
      <Section title="Accessories">
        <Chips
          options={ACCESSORIES}
          value={v.accessories as (typeof ACCESSORIES)[number][]}
          onPick={(a) => set({ accessories: v.accessories.includes(a) ? v.accessories.filter((x) => x !== a) : [...v.accessories, a] })}
        />
      </Section>
      <Section title="Aura">
        <Chips options={AURAS} value={v.effects.aura} onPick={(aura) => set({ effects: { ...v.effects, aura } })} />
        <Color label="Aura color" value={v.effects.color} onChange={(color) => set({ effects: { ...v.effects, color } })} />
        <input type="range" min={0} max={400} step={10} value={v.effects.particles} onChange={(e) => set({ effects: { ...v.effects, particles: Number(e.target.value) } })} className="w-full" aria-label="Particles" />
      </Section>
    </div>
  );
}
