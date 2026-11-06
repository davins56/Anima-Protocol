import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { animaClient } from "@/api/animaClient";
import LivingPresence from "@/components/chat/LivingPresence";
import { ArrowLeft, Compass, Home, MessageSquare, Swords, Sparkles } from "lucide-react";

const ROOMS = [
  { id: "sanctuary", title: "Sanctuary", description: "A quiet digital home for your Anima.", icon: Home, accent: "from-indigo-950 via-slate-950 to-violet-950" },
  { id: "nexus", title: "Network Nexus", description: "A crossroads of luminous data pathways.", icon: Compass, accent: "from-cyan-950 via-slate-950 to-blue-950" },
  { id: "arena", title: "Training Arena", description: "Prepare for tactical NetBattles.", icon: Swords, accent: "from-rose-950 via-slate-950 to-orange-950" },
];
const storageKey = id => `anima-network-room:${id}`;

export default function AnimaNetworkWorld() {
  const navigate = useNavigate();
  const [anima, setAnima] = useState(null);
  const [loading, setLoading] = useState(true);
  const [roomId, setRoomId] = useState("sanctuary");
  const [arrival, setArrival] = useState(false);
  useEffect(() => {
    let alive = true;
    animaClient.entities.Anima.list().then(items => {
      if (!alive) return;
      const companion = items?.[0] || null;
      setAnima(companion);
      if (companion?.id) {
        try { const stored = localStorage.getItem(storageKey(companion.id)); if (ROOMS.some(r => r.id === stored)) setRoomId(stored); } catch {}
      }
    }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const room = ROOMS.find(r => r.id === roomId) || ROOMS[0];
  const selectRoom = id => {
    setRoomId(id);
    setArrival(true);
    if (anima?.id) try { localStorage.setItem(storageKey(anima.id), id); } catch {}
  };
  return <main className="flex-1 min-h-0 overflow-y-auto bg-[#050b17] text-cyan-50 p-3 sm:p-6" aria-label="Anima Network World">
    <div className="max-w-4xl mx-auto space-y-4">
      <header className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate("/?pet=1")} className="min-h-11 px-3 border border-cyan-400/30 rounded-lg flex items-center gap-2 text-xs"><ArrowLeft size={16}/> PET</button>
        <div className="text-center min-w-0"><h1 className="font-semibold tracking-[.15em] uppercase text-sm sm:text-lg">Anima Network</h1><p className="text-[10px] text-cyan-300/60">Digital world · Local exploration</p></div>
        <Sparkles size={18} className="text-cyan-300 shrink-0" aria-hidden="true"/>
      </header>
      <nav aria-label="Network destinations" className="grid grid-cols-3 gap-2">
        {ROOMS.map(r => <button key={r.id} type="button" onClick={() => selectRoom(r.id)} aria-current={roomId === r.id ? "location" : undefined} className={`min-h-16 rounded-xl border p-2 text-center text-xs flex flex-col items-center justify-center gap-1 ${roomId === r.id ? "border-cyan-300 bg-cyan-500/20" : "border-cyan-500/20 bg-cyan-500/5"}`}><r.icon size={18}/><span>{r.title}</span></button>)}
      </nav>
      <section aria-label={room.title} className={`relative min-h-[360px] rounded-2xl border border-cyan-400/30 bg-gradient-to-b ${room.accent} overflow-hidden flex flex-col items-center justify-center p-5 text-center`}>
        <div className="absolute inset-0 opacity-25 pointer-events-none" aria-hidden="true" style={{ backgroundImage:"linear-gradient(rgba(103,232,249,.2) 1px, transparent 1px),linear-gradient(90deg,rgba(103,232,249,.2) 1px,transparent 1px)", backgroundSize:"34px 34px", transform:"perspective(400px) rotateX(30deg) scale(1.3)" }}/>
        <div className="relative z-10 flex flex-col items-center gap-2">
          {anima ? <LivingPresence character={{ ...anima, _isAnima: true }} emotion={roomId === "nexus" ? "curious" : roomId === "arena" ? "focused" : "calm"} size={210} /> : <div className="min-h-48 flex items-center justify-center text-cyan-300/70">{loading ? "Connecting to Anima…" : "Create your Anima to enter together."}</div>}
          <h2 className="text-xl font-semibold">{room.title}</h2><p className="text-sm text-cyan-100/70 max-w-xs">{room.description}</p>
          {arrival && <p role="status" className="text-xs text-cyan-300">Destination loaded</p>}
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => navigate("/chat")} className="min-h-12 border border-cyan-400/30 rounded-xl flex items-center justify-center gap-2 text-sm"><MessageSquare size={17}/> Talk</button>
        <button type="button" onClick={() => navigate(roomId === "arena" ? "/net-battle" : "/worldmap")} className="min-h-12 border border-cyan-400/30 rounded-xl flex items-center justify-center gap-2 text-sm">{roomId === "arena" ? <Swords size={17}/> : <Compass size={17}/>} {roomId === "arena" ? "NetBattle" : "World Map"}</button>
      </div>
      <p className="text-xs text-cyan-300/50 text-center">Private 2D world prototype. Multiplayer, quests, free movement and cross-device room sync are not enabled.</p>
    </div>
  </main>;
}
