import { useNavigate } from "react-router-dom";
import { useLivingAnima } from "@/hooks/useLivingAnima";
import LivingPresence from "@/components/chat/LivingPresence";
import { MessageSquare, Swords, Compass, Settings2, Sparkles } from "lucide-react";

/** PET operator console. Uses the existing Anima record, never creates a new identity. */
export default function PETConsole({ anima, compact = false, onClose }) {
  const navigate = useNavigate();
  const { activity, setActivity, emotion } = useLivingAnima(anima?.id);
  const actions = [
    { label: "Talk", icon: MessageSquare, path: "/chat" },
    { label: "Network", icon: Compass, path: "/worldmap" },
    { label: "NetBattle", icon: Swords, path: "/net-battle" },
    { label: "Customize", icon: Settings2, path: "/customise-anima" },
  ];
  return <section aria-label="Personal Electronic Terminal" className="w-full max-w-lg mx-auto rounded-2xl border border-cyan-400/40 bg-[#081321]/95 shadow-[0_0_30px_rgba(34,211,238,.12)] p-3 sm:p-4 text-cyan-100">
    <div className="flex items-center justify-between gap-3 border-b border-cyan-400/20 pb-2">
      <div className="flex items-center gap-2 min-w-0"><Sparkles className="w-4 h-4 shrink-0 text-cyan-300" /><div className="min-w-0"><h2 className="text-xs sm:text-sm font-semibold tracking-[.15em] uppercase truncate">Anima PET</h2><p className="text-[10px] text-cyan-300/70 truncate">{anima?.name || "Awaiting Anima"} · Operator Link</p></div></div>
      {onClose && <button type="button" onClick={onClose} aria-label="Close PET console" className="min-h-11 px-3 text-xs border border-cyan-400/30 rounded-lg">Close</button>}
    </div>
    <div className="flex items-center gap-3 py-3">
      <div className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-xl border border-cyan-400/30 bg-cyan-500/10 overflow-hidden flex items-center justify-center">
        {anima?.avatar_url ? <img src={anima.avatar_url} alt={`${anima.name || "Anima"} avatar`} className="h-full w-full object-cover" /> : <Sparkles aria-hidden="true" className="w-7 h-7 text-cyan-300/60" />}
      </div>
      <div className="min-w-0"><p className="font-semibold truncate">{anima?.name || "Your companion"}</p><p className="text-xs text-cyan-300/70">{anima ? "Link established" : "Complete Anima onboarding to establish link"}</p><p className="text-[10px] text-cyan-300/50 mt-1">Identity and memories remain attached to your existing companion.</p></div>
    </div>
    {anima?.id && <div className="flex flex-col items-center gap-3 py-3 border-t border-cyan-400/20" aria-label="Living Anima stage">
      <LivingPresence character={{ ...anima, _isAnima: true }} emotion={emotion} size={compact ? 150 : 200} showLabel />
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Anima presentation">
        {[["idle","At ease"],["focused","Focus"],["celebrating","Celebrate"]].map(([value,label]) =>
          <button key={value} type="button" aria-pressed={activity === value} onClick={() => setActivity(value)}
            className={`min-h-11 px-3 rounded-lg border text-xs ${activity === value ? "border-cyan-300 bg-cyan-400/20" : "border-cyan-400/20 bg-transparent"}`}>{label}</button>
        )}
      </div>
      <p className="text-[10px] text-cyan-300/60 text-center">Expressions reflect selected presentation modes, not detected emotions.</p>
    </div>}
    <div className={`grid ${compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"} gap-2`}>
      {actions.map(({label,icon:Icon,path})=><button key={label} type="button" onClick={()=>{onClose?.();navigate(path);}} className="min-h-12 rounded-lg border border-cyan-400/25 bg-cyan-400/5 hover:bg-cyan-400/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 flex flex-col items-center justify-center gap-1 px-1"><Icon className="w-4 h-4"/><span className="text-[10px]">{label}</span></button>)}
    </div>
  </section>;
}
