import { useEffect, useRef, useState } from "react";
import { FORGE_DEFAULTS, readForge, saveForge, exportForge, importForge } from "@/lib/animaForge";
const options = (items) => items.map(([value,label]) => <option key={value} value={value}>{label}</option>);
export default function AnimaForge() {
  const [value, setValue] = useState(readForge);
  const [error, setError] = useState("");
  const upload = useRef(null);
  const change = (key, next) => { try { setValue(saveForge({ [key]: next })); setError(""); } catch { setError("Could not save these preferences. Try a smaller image."); } };
  useEffect(() => { const sync = () => setValue(readForge()); window.addEventListener("storage",sync); window.addEventListener("anima:forge",sync); return () => { window.removeEventListener("storage",sync); window.removeEventListener("anima:forge",sync); }; },[]);
  const onImage = async (file) => {
    if (!file) return;
    if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 900000) { setError("Use a PNG, JPEG or WebP image under 900 KB."); return; }
    const reader = new FileReader();
    reader.onload = () => change("background", String(reader.result || ""));
    reader.onerror = () => setError("Could not read the selected image.");
    reader.readAsDataURL(file);
  };
  const onExport = () => { const blob = new Blob([exportForge()],{type:"application/json"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download="anima-forge-profile.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
  const onImport = async (file) => { if (!file) return; try { if (file.size > 20000) throw Error(); setValue(importForge(await file.text())); setError(""); } catch { setError("Invalid profile file."); } };
  return <section aria-label="Anima Forge" className="rounded-xl border border-primary/25 bg-card p-4 space-y-4">
    <div><h3 className="text-lg font-semibold">Anima Forge</h3><p className="text-sm text-muted-foreground">Make the app your own. Changes apply instantly on this device.</p></div>
    <div className="space-y-2"><p className="text-sm font-medium">Application background</p><input ref={upload} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload application background" onChange={e=>onImage(e.target.files?.[0])} className="block w-full text-sm" /><button type="button" onClick={()=>{change("background","");if(upload.current)upload.current.value="";}} className="min-h-11 border border-border rounded-lg px-3">Remove background</button></div>
    <label className="flex flex-col gap-1 text-sm">Background fit<select className="min-h-11 bg-background border border-border rounded-lg p-2" value={value.backgroundFit} onChange={e=>change("backgroundFit",e.target.value)}>{options([["cover","Fill screen"],["contain","Show entire image"]])}</select></label>
    <label className="block text-sm">Background dimming: {value.overlay}%<input className="w-full" type="range" min="0" max="90" value={value.overlay} onChange={e=>change("overlay",Number(e.target.value))}/></label>
    <label className="block text-sm">Glass blur: {value.glass}%<input className="w-full" type="range" min="0" max="90" value={value.glass} onChange={e=>change("glass",Number(e.target.value))}/></label>
    {!value.background && <p className="text-xs text-muted-foreground">Glass frosts a background image — add one above to see the effect.</p>}
    <label className="flex flex-col gap-1 text-sm">Typography<select className="min-h-11 bg-background border border-border rounded-lg p-2" value={value.font} onChange={e=>change("font",e.target.value)}>{options([["default","Anima default"],["serif","Literary serif"],["mono","Terminal mono"]])}</select></label>
    <label className="flex flex-col gap-1 text-sm">Navigation<select className="min-h-11 bg-background border border-border rounded-lg p-2" value={value.navigation} onChange={e=>change("navigation",e.target.value)}>{options([["standard","Standard"],["floating","Floating bar"],["minimal","Minimal navigation"]])}</select></label>
    <label className="flex flex-col gap-1 text-sm">Message bubble style<select className="min-h-11 bg-background border border-border rounded-lg p-2" value={value.bubble} onChange={e=>change("bubble",e.target.value)}>{options([["default","Default"],["soft","Soft"],["square","Angular"]])}</select></label>
    <label className="flex flex-col gap-1 text-sm">Transitions<select className="min-h-11 bg-background border border-border rounded-lg p-2" value={value.transition} onChange={e=>change("transition",e.target.value)}>{options([["none","None"],["subtle","Subtle"],["expressive","Expressive"]])}</select></label>
    <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={value.tapFeedback} onChange={e=>change("tapFeedback",e.target.checked)} /> Button press feedback</label>
    {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" onClick={onExport} className="min-h-11 border border-border rounded-lg px-3">Export profile</button><label className="min-h-11 border border-border rounded-lg px-3 flex items-center cursor-pointer">Import profile<input type="file" accept=".json,application/json" className="sr-only" onChange={e=>onImport(e.target.files?.[0])}/></label><button type="button" onClick={()=>setValue(saveForge(FORGE_DEFAULTS))} className="min-h-11 border border-border rounded-lg px-3">Reset Forge</button></div>
    <p className="text-xs text-muted-foreground">Export includes settings only, not your uploaded image. Images remain stored locally in this browser.</p>
  </section>;
}
