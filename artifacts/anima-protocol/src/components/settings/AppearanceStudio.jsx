import { useEffect, useState } from "react";
import { APPEARANCE_DEFAULTS, readAppearance, saveAppearance } from "@/lib/appearanceStudio";

const themes = [["original", "Original"], ["nebula", "Nebula"], ["celestial", "Celestial"], ["emerald", "Emerald"], ["eclipse", "Eclipse"], ["cybernetic","Cybernetic"], ["garden","Enchanted Garden"], ["academia","Dark Academia"], ["zen","Zen Garden"], ["synthwave","Synthwave"], ["arcane","Arcane Realm"], ["brutalist","Neo-Brutalist"], ["soft-aura","Soft Aura"], ["living","Living Companion"]];
const layouts = [["classic", "Classic"], ["compact", "Compact"], ["immersive", "Immersive"], ["dashboard", "Dashboard"]];
export default function AppearanceStudio() {
  const [value, setValue] = useState(readAppearance);
  useEffect(() => {
    const sync = () => setValue(readAppearance());
    window.addEventListener("storage", sync);
    window.addEventListener("anima:appearance", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("anima:appearance", sync); };
  }, []);
  const change = (key, next) => setValue(saveAppearance({ [key]: next }));
  return <section aria-label="Appearance Studio" className="rounded-xl border border-primary/25 bg-card p-4 space-y-5">
    <div><h3 className="text-lg font-semibold text-foreground">Appearance Studio</h3><p className="text-sm text-muted-foreground">Personalise the whole application. Changes apply instantly and are saved on this device.</p></div>
    <fieldset><legend className="mb-2 text-sm font-medium">Colour scheme</legend><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{themes.map(([id, label]) => <button type="button" key={id} aria-pressed={value.theme === id} onClick={() => change("theme", id)} className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${value.theme === id ? "border-primary bg-primary/20 text-foreground" : "border-border text-foreground"}`}>{label}</button>)}</div></fieldset>
    <fieldset><legend className="mb-2 text-sm font-medium">Layout density</legend><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{layouts.map(([id, label]) => <button type="button" key={id} aria-pressed={value.layout === id} onClick={() => change("layout", id)} className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${value.layout === id ? "border-primary bg-primary/20" : "border-border"}`}>{label}</button>)}</div></fieldset>
    <label className="flex flex-col gap-2 text-sm">Corners<select className="min-h-11 rounded-lg border border-border bg-background p-2" value={value.radius} onChange={e => change("radius", e.target.value)}><option value="default">Default</option><option value="rounded">Rounded</option><option value="square">Square</option></select></label>
    <label className="flex flex-col gap-2 text-sm">Text size<select className="min-h-11 rounded-lg border border-border bg-background p-2" value={value.scale} onChange={e => change("scale", e.target.value)}><option value="normal">Normal</option><option value="large">Large</option></select></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.motion === "reduced"} onChange={e => change("motion", e.target.checked ? "reduced" : "system")} /> Reduce animations</label>
    <button type="button" className="min-h-11 rounded-lg border border-primary px-4 py-2 text-primary" onClick={() => setValue(saveAppearance(APPEARANCE_DEFAULTS))}>Restore defaults</button>
  </section>;
}
