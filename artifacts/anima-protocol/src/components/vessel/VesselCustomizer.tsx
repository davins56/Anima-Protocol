/** Customization panel (touch-friendly, iPad-first). Pure controlled component. */
import { ACCESSORIES, AURAS, BODY_TYPES, BOTTOMS, HAIR_STYLES, TOPS, VESSEL_BASES, VESSEL_PRESETS, parseVesselConfig, type VesselConfig } from "@/lib/vessel/vesselConfig";

type Props = { value: VesselConfig; onChange: (v: VesselConfig) => void };

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

export default function VesselCustomizer({ value: v, onChange }: Props) {
  const set = (patch: Partial<VesselConfig>) => onChange(parseVesselConfig({ ...v, ...patch }));
  return (
    <div className="space-y-5">
      <Section title="Preset">
        <Chips options={VESSEL_BASES} value={v.base} onPick={(b) => set(b === "custom" ? { base: "custom" } : { ...VESSEL_PRESETS[b] })} />
      </Section>
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
