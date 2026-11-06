import { useState } from "react";
import { readAppearance, saveAppearance } from "@/lib/appearanceStudio";
import { readForge, saveForge } from "@/lib/animaForge";
const KEY = "anima-forge-profiles-v1";
function readProfiles() { try { const data = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(data) ? data.filter(p=>p && typeof p.name === "string").slice(0,12) : []; } catch { return []; } }
export default function ForgeProfiles() {
  const [profiles,setProfiles] = useState(readProfiles);
  const [name,setName] = useState("");
  const [message,setMessage] = useState("");
  const persist = (items) => { try { localStorage.setItem(KEY,JSON.stringify(items)); setProfiles(items); setMessage(""); } catch { setMessage("Device storage is full. Remove a profile or background."); } };
  const save = () => { const label = name.trim().slice(0,40); if (!label) { setMessage("Enter a profile name."); return; } if (profiles.length >= 12) { setMessage("Maximum of 12 profiles."); return; } const { background, ...forge } = readForge(); persist([...profiles,{ id: String(Date.now()),name:label,appearance:readAppearance(),forge }]); setName(""); };
  const load = p => { saveAppearance(p.appearance || {}); saveForge({ ...(p.forge || {}), background: "" }); setMessage("Profile applied. Uploaded backgrounds are not included."); };
  return <section aria-label="Saved appearance profiles" className="rounded-xl border border-primary/25 bg-card p-4 space-y-3">
    <div><h3 className="font-semibold text-lg">Saved realms</h3><p className="text-sm text-muted-foreground">Save up to 12 appearance configurations and switch between them. Background images are excluded to conserve storage.</p></div>
    <div className="flex flex-wrap gap-2"><input aria-label="Profile name" maxLength={40} className="min-h-11 flex-1 min-w-0 bg-background border border-border rounded-lg p-2" placeholder="Name this realm" value={name} onChange={e=>setName(e.target.value)}/><button type="button" className="min-h-11 border border-primary rounded-lg px-3" onClick={save}>Save current</button></div>
    <ul className="space-y-2">{profiles.map(p=><li key={p.id} className="flex items-center justify-between gap-2 border border-border rounded-lg p-2"><span className="truncate text-sm">{p.name}</span><div className="flex gap-2"><button type="button" className="min-h-11 px-3 border border-primary rounded-lg" onClick={()=>load(p)}>Apply</button><button type="button" className="min-h-11 px-3 border border-border rounded-lg" aria-label={`Delete ${p.name}`} onClick={()=>persist(profiles.filter(x=>x.id!==p.id))}>Delete</button></div></li>)}</ul>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
  </section>;
}
