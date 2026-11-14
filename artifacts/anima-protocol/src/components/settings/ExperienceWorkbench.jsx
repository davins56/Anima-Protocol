import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/react";
import { toast } from "sonner";
import { readAppearance, saveAppearance } from "@/lib/appearanceStudio";
import { exportExperiencePreset, importExperiencePreset } from "@/lib/experiencePresetExchange";
import {
  EXTRA_DEFAULTS, PRESET_FIELDS, FEATURE_MATRIX,
  loadPresets, writePresets, sanitizePreset,
} from "@/lib/experiencePresets";
import { readActiveExtras, saveActiveExtras } from "@/lib/experienceRuntime";

const GROUPS = [
  ["theme","Colour scheme"],["layout","Layout"],["background","Background"],
  ["bubble","Chat bubbles"],["shell","Surface shell"],["navigation","Navigation"],
  ["character","Character presentation"],["hud","NetNavi interface"],
  ["radius","Corners"],["scale","Text size"],["motion","Animation"],
];
const SCREENS = ["Chat","Home","Character","Cyberworld"];
const COLORS = {
  original:["#081320","#22d3ee"],nebula:["#190f39","#a78bfa"],
  celestial:["#ebf6ff","#3476b8"],emerald:["#09271f","#34d399"],
  eclipse:["#141119","#e879f9"],cybernetic:["#071d2b","#06b6d4"],
  garden:["#192d24","#a3e635"],academia:["#211a18","#d6b384"],
  zen:["#182d2b","#75c9bf"],synthwave:["#2b104d","#f472b6"],
  arcane:["#1b1530","#c4b5fd"],brutalist:["#171717","#facc15"],
  "soft-aura":["#30283c","#f0abfc"],living:["#13242a","#5eead4"],
};
const title = value => value.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const deviceValue = () => ({ ...EXTRA_DEFAULTS, ...readAppearance() });

function MiniScreen({ config, screen }) {
  const [bg, accent] = COLORS[config.theme] || COLORS.original;
  const glass = config.shell !== "solid";
  const corners = config.radius === "square" ? "0" : config.radius === "rounded" ? "22px" : "12px";
  const border = config.bubble === "outlined" ? `1px solid ${accent}` : "1px solid transparent";
  const bodyBackground = config.background === "matrix"
    ? `repeating-linear-gradient(90deg, transparent 0 24px, ${accent}22 25px), ${bg}`
    : config.background === "grid"
      ? `linear-gradient(${accent}18 1px, transparent 1px),linear-gradient(90deg,${accent}18 1px,transparent 1px),${bg}`
      : config.background === "nebula"
        ? `radial-gradient(ellipse at top right,${accent}66,transparent 65%),${bg}`
        : bg;
  const surface = { background:glass ? "rgba(255,255,255,.09)" : "rgba(0,0,0,.3)",
    backdropFilter:glass ? `blur(${config.shell === "glass" ? 22 : 10}px)` : "none",
    border:`1px solid ${accent}50`, borderRadius:corners };
  return <div className="min-h-[270px] p-3 text-white relative overflow-hidden" style={{ background:bodyBackground,borderRadius:corners,color:config.theme === "celestial" ? "#10263f" : "#f8fafc" }}>
    <div className="flex items-center justify-between gap-2 mb-3 p-2" style={surface}>
      <span className="text-xs tracking-widest font-bold" style={{color:accent}}>ANIMA // {screen.toUpperCase()}</span>
      <span className="text-[10px]">SYNC • 98%</span>
    </div>
    <div className={config.layout === "dashboard" ? "grid grid-cols-2 gap-2" : "space-y-2"}>
      <div className="p-3 space-y-2" style={surface}>
        <div className="flex gap-2 items-center">
          <div className="h-12 w-12 shrink-0 flex items-center justify-center border font-mono text-xl"
            style={{borderColor:accent,color:accent,borderRadius:config.character === "portrait" ? "50%" : "8px"}}>
            {config.character === "netnavi" ? "N" : config.character === "hologram" ? "◈" : "S"}
          </div>
          <div className="min-w-0"><div className="font-semibold text-sm">Serenity</div><div className="text-[10px] opacity-70">{title(config.character)} presentation</div></div>
        </div>
        {screen === "Chat" ? <>
          <div className="text-[11px] p-2 max-w-[90%]" style={{...surface,border,...(config.bubble === "terminal" ? {fontFamily:"monospace",borderRadius:0} : {})}}>Connection established. Shall we explore?</div>
          <div className="text-[11px] p-2 ml-auto max-w-[80%]" style={{...surface,background:`${accent}33`,borderRadius:config.bubble === "rounded" ? "24px" : corners}}>Open the network.</div>
        </> : <div className="text-xs opacity-80">{screen === "Home" ? "Companion network online" : screen === "Character" ? "Identity • Appearance • Bond" : "Network gateway ready"}</div>}
      </div>
      <div className="p-3 text-[11px] space-y-2" style={surface}>
        <div style={{color:accent}}>{config.hud === "battle-network" ? "HP  1000 / 1000   ◈" : config.hud === "tactical" ? "STATUS // SYSTEM NOMINAL" : "Active companion"}</div>
        <div className="h-1.5 rounded-full opacity-80" style={{background:accent,width:"74%"}} />
        <div>Navigation: {title(config.navigation)}</div>
        <div>Layout: {title(config.layout)}</div>
      </div>
    </div>
    <div className="flex gap-2 mt-3 text-[10px] p-2" style={surface}>{(config.navigation === "rail" ? ["☰","⌂","◇","⚙"] : config.navigation === "command" ? ["⌘ Command","Search","Actions"] : ["Home","Chat","Anima","Settings"]).map(t => <span key={t} className="flex-1 text-center">{t}</span>)}</div>
  </div>;
}
export default function ExperienceWorkbench() {
  const {user} = useUser();
  const userId = user?.id;
  const [draft,setDraft] = useState(deviceValue);
  const [screen,setScreen] = useState("Chat");
  const [presetName,setPresetName] = useState("");
  const [presets,setPresets] = useState([]);
  const [compare,setCompare] = useState("");
  useEffect(() => { setPresets(loadPresets(userId)); setDraft({ ...deviceValue(), ...readActiveExtras(userId) }); }, [userId]);
  const [importing,setImporting] = useState(false);
  useEffect(() => {
    const refresh = () => setDraft(prev => ({...prev,...readAppearance()}));
    window.addEventListener("anima:appearance",refresh);
    return () => window.removeEventListener("anima:appearance",refresh);
  },[]);
  const current = useMemo(() => ({...EXTRA_DEFAULTS,...draft}),[draft]);
  const compared = presets.find(p => p.id === compare);
  const update = (key,value) => setDraft(prev => ({...prev,[key]:value}));
  const store = () => {
    if (!userId) return toast.error("Sign in to save a preset.");
    const name = presetName.trim().slice(0,60);
    if (!name) return toast.error("Give the preset a name.");
    try {
      const id = globalThis.crypto?.randomUUID?.() || String(Date.now());
      const next = writePresets(userId,[...presets,{id,name,values:sanitizePreset(current)}]);
      setPresets(next);setPresetName("");toast.success("Preset saved on this device.");
    } catch(e) { toast.error(e.message); }
  };
  const downloadPreset = () => {
    const json = exportExperiencePreset(presetName || "Anima Theme", current);
    const url = URL.createObjectURL(new Blob([json], {type:"application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "anima-experience-preset.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const importPreset = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 16_384) return toast.error("Preset file is too large.");
    setImporting(true);
    try {
      const imported = importExperiencePreset(await file.text());
      setDraft(prev => ({...prev,...imported.values}));
      setPresetName(imported.name);
      toast.success("Theme loaded into preview. Save it to keep it on this device.");
    } catch (error) { toast.error(error.message); }
    finally { setImporting(false); }
  };
  const remove = id => {
    try {setPresets(writePresets(userId,presets.filter(p => p.id !== id)));if(compare === id)setCompare("");}
    catch(e){toast.error(e.message);}
  };
  return <section aria-label="Experience Design Workbench" className="rounded-xl border border-primary/25 p-4 space-y-5 bg-card">
    <header><h3 className="text-lg font-semibold">Experience Design Workbench</h3>
      <p className="text-sm text-muted-foreground">Design safely in a preview. Applying updates supported global appearance and lightweight chat, navigation, and avatar presentation. Character presentation also reaches 3D vessels and gameplay HUDs. Advanced navigation mechanics remain planned.</p></header>
    <div className="grid gap-5 lg:grid-cols-[minmax(210px,1fr)_minmax(280px,1.6fr)]">
      <div className="space-y-3">
        {GROUPS.map(([field,label]) => <label key={field} className="flex flex-col gap-1 text-sm"><span className="font-medium">{label}</span>
          <select aria-label={label} className="min-h-11 rounded-lg border border-border bg-background p-2 text-foreground"
            value={current[field]} onChange={e => update(field,e.target.value)}>
            {PRESET_FIELDS[field].map(value => <option key={value} value={value}>{title(value)}</option>)}
          </select></label>)}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 rounded-lg border border-primary" onClick={() => {saveAppearance(Object.fromEntries(["theme","layout","radius","scale","motion"].map(key => [key,current[key]])));saveActiveExtras(userId,current);toast.success("Appearance and experience settings applied.");}}>Apply supported settings</button>
          <button type="button" className="px-3 py-2 rounded-lg border border-border" onClick={() => setDraft({...deviceValue(),...readActiveExtras(userId)})}>Reset draft</button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Preview screen">{SCREENS.map(s => <button key={s} type="button" role="tab" aria-selected={screen === s} className={`rounded-lg border px-3 py-2 text-xs ${screen === s ? "border-primary bg-primary/15" : "border-border"}`} onClick={() => setScreen(s)}>{s}</button>)}</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="mb-1 text-xs text-muted-foreground">Draft preview</p><MiniScreen config={current} screen={screen}/></div>
          <div><p className="mb-1 text-xs text-muted-foreground">Comparison {compared ? `• ${compared.name}` : "• current appearance"}</p><MiniScreen config={{...EXTRA_DEFAULTS,...readAppearance(),...readActiveExtras(userId),...(compared?.values || {})}} screen={screen}/></div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input aria-label="New preset name" value={presetName} maxLength={60} onChange={e => setPresetName(e.target.value)} placeholder="Preset name" className="min-h-11 flex-1 min-w-32 bg-background border border-border p-2 rounded-lg"/>
          <button type="button" onClick={store} className="rounded-lg border border-primary px-4">Save preset</button>
          <button type="button" onClick={downloadPreset} className="rounded-lg border border-border px-4">Export theme</button>
          <label className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm">
            Import theme
            <input type="file" accept=".json,application/json" className="sr-only" disabled={importing} onChange={importPreset} aria-label="Import Anima theme JSON" />
          </label>
        </div>
        <label className="text-sm flex flex-col gap-1">Compare with saved preset
          <select className="min-h-11 bg-background border border-border p-2 rounded-lg" value={compare} onChange={e => setCompare(e.target.value)}>
            <option value="">Current applied appearance</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <div className="space-y-2">{presets.map(p => <div key={p.id} className="flex items-center justify-between gap-2 text-xs border border-border rounded-lg p-2"><span>{p.name}</span><span className="flex gap-2">
          <button type="button" className="underline" onClick={() => setDraft({...EXTRA_DEFAULTS,...p.values})}>Load to draft</button>
          <button type="button" className="underline" onClick={() => remove(p.id)} aria-label={`Delete ${p.name}`}>Delete</button>
        </span></div>)}</div>
      </div>
    </div>
    <div className="rounded-lg border border-border p-3 space-y-2">
      <h4 className="font-semibold">Connected experience areas</h4>
      <p className="text-xs text-muted-foreground">Your appearance choices remain separate from identity and runtime data. These sections are managed by Anima itself.</p>
      <div className="flex flex-wrap gap-2 text-sm">
        <a className="underline" href="/settings?section=customise-anima">Anima and characters</a>
        <a className="underline" href="/settings?section=ai">Chat behavior</a>
        <a className="underline" href="/settings?section=data">Memory and privacy</a>
        <a className="underline" href="/settings?section=interface">Interface settings</a>
      </div>
    </div>
    <div><h4 className="font-semibold mb-2">Implementation ledger</h4>
      <div className="grid sm:grid-cols-2 gap-2">{FEATURE_MATRIX.map(f => <div key={f.name} className="rounded-lg border border-border p-3 text-xs">
        <div className="flex justify-between gap-2 font-medium"><span>{f.name}</span><span className="capitalize text-muted-foreground">{f.status}</span></div>
        <p className="mt-1 text-muted-foreground">{f.detail}</p></div>)}</div>
    </div>
    <p className="text-xs text-muted-foreground">Scope guarantee: presets contain presentation settings only. Stable personality, session behavior, temporary and durable memory, private/shared context, and multi-Anima entitlement are not read or modified here. Device-local presets and experience settings are not cloud backed. Theme JSON files can be exchanged without transferring private Anima data.</p>
  </section>;
}
