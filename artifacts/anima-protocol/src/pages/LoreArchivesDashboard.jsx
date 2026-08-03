import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ResonanceRankPanel from "@/components/lore/ResonanceRankPanel";
import SlipthkChapterGrid from "@/components/lore/SlipthkChapterGrid";
import MemoryCrystalVault from "@/components/lore/MemoryCrystalVault";

const TABS = [
  { id: "rank", label: "Resonance Rank", glyph: "⬟" },
  { id: "chapters", label: "Slipthk Continuum", glyph: "◈" },
  { id: "crystals", label: "Memory Crystals", glyph: "✦" },
];

export default function LoreArchivesDashboard() {
  const [activeTab, setActiveTab] = useState("rank");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [crystals, setCrystals] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    setLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);

      const [profiles, myCrystals, mySessions] = await Promise.all([
        base44.entities.ResonanceProfile.filter({ user_email: me.email }),
        base44.entities.MemoryCrystal.filter({ user_email: me.email }, "-created_date", 100),
        base44.entities.ChatSession.list("-updated_date", 200),
      ]);

      let p = profiles?.[0];
      if (!p) {
        // Bootstrap profile for new user
        p = await base44.entities.ResonanceProfile.create({
          user_email: me.email,
          resonance_rank: "Initiate",
          resonance_xp: 0,
          unlocked_chapters: ["chapter_zero"],
          total_sessions: mySessions.length,
          total_messages: mySessions.reduce((sum, s) => sum + (s.messages?.length || 0), 0),
          last_sync: new Date().toISOString(),
        });
      } else {
        // Sync totals
        const totalMsgs = mySessions.reduce((sum, s) => sum + (s.messages?.length || 0), 0);
        const xp = computeXP(mySessions, myCrystals || []);
        const rank = computeRank(xp);
        const unlocked = computeUnlocks(xp, p.unlocked_chapters || []);
        p = await base44.entities.ResonanceProfile.update(p.id, {
          total_sessions: mySessions.length,
          total_messages: totalMsgs,
          resonance_xp: xp,
          resonance_rank: rank,
          unlocked_chapters: unlocked,
          last_sync: new Date().toISOString(),
        });
      }

      setProfile(p);
      setCrystals(myCrystals || []);
      setSessions(mySessions || []);

      // Auto-generate crystals for sessions without them
      await autoGenerateCrystals(me.email, mySessions, myCrystals || []);
    } catch (err) {
      console.error("Init error:", err);
    } finally {
      setLoading(false);
    }
  };

  const computeXP = (sessions, crystals) => {
    const sessionXP = sessions.length * 40;
    const messageXP = sessions.reduce((sum, s) => sum + Math.min((s.messages?.length || 0) * 2, 200), 0);
    const crystalXP = crystals.reduce((sum, c) => sum + (c.resonance_xp_awarded || 50), 0);
    return sessionXP + messageXP + crystalXP;
  };

  const computeRank = (xp) => {
    if (xp >= 2000) return "Ascendant";
    if (xp >= 800) return "Seraphic";
    if (xp >= 300) return "Harmonic";
    return "Initiate";
  };

  const computeUnlocks = (xp, current) => {
    const unlocked = new Set(current);
    unlocked.add("chapter_zero");
    if (xp >= 100) unlocked.add("chapter_one");
    if (xp >= 300) unlocked.add("chapter_two");
    if (xp >= 600) unlocked.add("chapter_three");
    if (xp >= 1000) unlocked.add("chapter_four");
    if (xp >= 1600) unlocked.add("chapter_five");
    if (xp >= 2000) unlocked.add("chapter_six");
    return Array.from(unlocked);
  };

  const autoGenerateCrystals = async (email, sessions, existing) => {
    const existingSessionIds = new Set(existing.map(c => c.session_id));
    const eligible = sessions.filter(s => !existingSessionIds.has(s.id) && (s.messages?.length || 0) >= 10);

    for (const session of eligible.slice(0, 5)) {
      const msgs = session.messages || [];
      const charName = msgs.find(m => m.role === "assistant")?.character_name || "Unknown";
      const excerpt = msgs.find(m => m.role === "assistant" && m.content?.length > 40)?.content?.slice(0, 120) || "";
      const milestoneType = msgs.length >= 50 ? "deep_resonance" : msgs.length >= 20 ? "revelation" : "first_contact";
      const xp = milestoneType === "deep_resonance" ? 150 : milestoneType === "revelation" ? 80 : 50;

      await base44.entities.MemoryCrystal.create({
        user_email: email,
        session_id: session.id,
        character_name: charName,
        title: milestoneType === "first_contact" ? `First Contact · ${charName}` :
               milestoneType === "revelation" ? `Revelation · ${charName}` :
               `Deep Resonance · ${charName}`,
        excerpt: excerpt + (excerpt.length >= 120 ? "..." : ""),
        milestone_type: milestoneType,
        resonance_xp_awarded: xp,
        crystal_color: milestoneType === "deep_resonance" ? "#A78BFA" :
                       milestoneType === "revelation" ? "#60A5FA" : "#34D399",
        emotional_tone: "resonant",
        message_index: msgs.length - 1,
      });
    }

    // Reload crystals
    if (eligible.length > 0) {
      const updated = await base44.entities.MemoryCrystal.filter({ user_email: email }, "-created_date", 100);
      setCrystals(updated || []);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center"
        style={{ background: "linear-gradient(160deg, #030712 0%, #0a0414 40%, #040a1a 100%)" }}>
        <div className="text-center space-y-3">
          <div className="text-3xl text-violet-400 animate-pulse">⬟</div>
          <p className="font-mono text-[10px] text-violet-300/40 tracking-[0.4em] uppercase animate-pulse">
            Synchronizing Archive...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col pb-20"
      style={{ background: "linear-gradient(160deg, #030712 0%, #0a0414 50%, #040a1a 100%)" }}>

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full opacity-10 blur-[100px]"
          style={{ background: "radial-gradient(circle, #7C3AED, transparent 70%)" }} />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full opacity-8 blur-[80px]"
          style={{ background: "radial-gradient(circle, #3B82F6, transparent 70%)" }} />
      </div>

      {/* Header */}
      <div className="relative z-10 border-b px-4 sm:px-6 py-4 sticky top-0 backdrop-blur-xl"
        style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(3,7,18,0.8)" }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-violet-300/30 hover:text-violet-300 transition-colors p-1">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-violet-400 text-sm">⬟</span>
                <h1 className="font-mono text-sm sm:text-base tracking-[0.2em] uppercase"
                  style={{ color: "#E0D9FF" }}>
                  Lore Archives
                </h1>
              </div>
              <p className="font-mono text-[8px] tracking-[0.3em] uppercase mt-0.5"
                style={{ color: "rgba(167,139,250,0.4)" }}>
                The Slipthk Continuum · {profile?.resonance_rank || "Initiate"}
              </p>
            </div>
          </div>
          {profile && (
            <div className="flex items-center gap-2 px-3 py-1.5 border"
              style={{ borderColor: "rgba(139,92,246,0.25)", background: "rgba(124,58,237,0.08)" }}>
              <span className="text-violet-300 text-xs">◈</span>
              <span className="font-mono text-[10px] text-violet-300/70 tracking-widest">
                {profile.resonance_xp?.toLocaleString()} XP
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="relative z-10 border-b"
        style={{ borderColor: "rgba(139,92,246,0.1)", background: "rgba(3,7,18,0.6)" }}>
        <div className="max-w-5xl mx-auto flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 font-mono text-[9px] sm:text-[10px] tracking-[0.2em] uppercase transition-all border-b-2 ${
                activeTab === tab.id
                  ? "border-violet-400 text-violet-300"
                  : "border-transparent text-white/25 hover:text-white/50"
              }`}
            >
              <span>{tab.glyph}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6">
        <AnimatePresence mode="wait">
          {activeTab === "rank" && (
            <motion.div key="rank" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ResonanceRankPanel profile={profile} sessions={sessions} crystals={crystals} />
            </motion.div>
          )}
          {activeTab === "chapters" && (
            <motion.div key="chapters" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SlipthkChapterGrid profile={profile} />
            </motion.div>
          )}
          {activeTab === "crystals" && (
            <motion.div key="crystals" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <MemoryCrystalVault crystals={crystals} sessions={sessions} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}