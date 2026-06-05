import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Sparkles, Heart, Trash2, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/lib/ConfirmDialog";
import PullToRefreshContainer from "@/components/mobile/PullToRefreshContainer";

export default function CharacterRepository() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [characters, setCharacters] = useState([]);
  const [selectedChar, setSelectedChar] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [charEvolutions, setCharEvolutions] = useState({});
  const [charTimelines, setCharTimelines] = useState({});
  const [loading, setLoading] = useState(true);
  const [swipeStart, setSwipeStart] = useState({});
  const [swipeOffset, setSwipeOffset] = useState({});

  useEffect(() => {
    loadRepository();
  }, []);

  const loadRepository = async () => {
    setLoading(true);
    try {
      const [chars, animas] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        base44.entities.Anima.list("-created_date", 100),
      ]);

      const animaAsChars = (animas || []).map(a => ({
        ...a,
        _isAnima: true,
        category: a.archetype || "guardian",
        universe: "Anima",
      }));

      const allChars = [...animaAsChars, ...(chars || [])];
      setCharacters(allChars);
    } catch (err) {
      console.error("Error loading character repository:", err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = characters.filter(char => {
    const matchesSearch = char.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "character" && !char._isAnima) ||
      (filter === "anima" && char._isAnima);
    return matchesSearch && matchesFilter;
  });

  const loadCharacterDetails = async (char) => {
    if (charEvolutions[char.id] && charTimelines[char.id]) return;

    try {
      const evoRes = await base44.functions.invoke("trackCharacterEvolution", {
        character_id: char.id,
        character_name: char.name,
      });
      if (evoRes?.data) {
        setCharEvolutions(prev => ({ ...prev, [char.id]: evoRes.data }));
      }
    } catch (err) {
      console.error(`Error loading evolution for ${char.name}:`, err);
    }

    try {
      const [journals, rels] = await Promise.all([
        base44.entities.CharacterJournal.filter({ character_id: char.id }, "-created_date", 10),
        base44.entities.CharacterRelationship.filter({ character_id: char.id }, "-created_date", 10),
      ]);
      setCharTimelines(prev => ({
        ...prev,
        [char.id]: { journals: journals || [], relationships: rels || [] }
      }));
    } catch (err) {
      console.error(`Error loading timeline for ${char.name}:`, err);
    }
  };

  const getCategoryColor = (category) => {
    const colors = {
      companion: "bg-blue-400/10 border-blue-400/30 text-blue-400",
      warrior: "bg-red-400/10 border-red-400/30 text-red-400",
      mystic: "bg-purple-400/10 border-purple-400/30 text-purple-400",
      scientist: "bg-cyan-400/10 border-cyan-400/30 text-cyan-400",
      villain: "bg-orange-400/10 border-orange-400/30 text-orange-400",
      hero: "bg-green-400/10 border-green-400/30 text-green-400",
      guardian: "bg-indigo-400/10 border-indigo-400/30 text-indigo-400",
      other: "bg-primary/10 border-primary/20 text-primary/60",
    };
    return colors[category] || colors.other;
  };

  const handleSwipeStart = (charId, e) => {
    if (e.touches) setSwipeStart({ [charId]: e.touches[0].clientX });
  };

  const handleSwipeMove = (charId, e) => {
    if (!e.touches || !swipeStart[charId]) return;
    const offset = e.touches[0].clientX - swipeStart[charId];
    if (Math.abs(offset) > 5) {
      setSwipeOffset({ [charId]: offset > 0 ? 0 : Math.min(offset, -1) });
    }
  };

  const handleSwipeEnd = (charId) => {
    if ((swipeOffset[charId] || 0) < -80) deleteCharacter(charId);
    setSwipeStart({});
    setSwipeOffset({});
  };

  const deleteCharacter = async (charId) => {
    const char = characters.find(c => c.id === charId);
    if (!char) return;
    const ok = await confirm({
      title: "Delete this character?",
      message: "This permanently removes the character and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await (char._isAnima
        ? base44.entities.Anima.delete(charId)
        : base44.entities.Character.delete(charId));
      setCharacters(prev => prev.filter(c => c.id !== charId));
      if (selectedChar?.id === charId) setSelectedChar(null);
    } catch (err) {
      console.error("Error deleting character:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0">
        <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase animate-pulse">
          Loading character repository...
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-3xl sm:text-4xl text-primary glow-text tracking-[0.2em] uppercase">
            Character Repository
          </h1>
          <p className="font-mono text-[9px] text-primary/40 tracking-widest mt-2 uppercase">
            {characters.length} characters and animae tracked
          </p>
        </div>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 px-3 min-h-[44px] border border-primary/20 hover:border-primary/40 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all flex-shrink-0"
          title="Back"
        >
          <ArrowLeft className="w-3 h-3" />
          <span className="hidden sm:inline">Back</span>
        </button>
      </div>

      {/* Search and Filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-primary/40" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search characters..."
            className="w-full bg-black/40 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all", "character", "anima"].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 min-h-[44px] border font-mono text-[9px] tracking-widest uppercase transition-all ${
                filter === f
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-primary/15 text-primary/40 hover:text-primary/70"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Character List — wrapped in PullToRefresh on mobile */}
        <div className="lg:col-span-1 max-h-[80vh]">
          {/* Mobile: Pull to refresh */}
          <div className="block lg:hidden h-[70vh]">
            <PullToRefreshContainer onRefresh={loadRepository} isLoading={loading}>
              <div className="space-y-2">
                {filtered.map(char => (
                  <CharacterListItem
                    key={char.id}
                    char={char}
                    isSelected={selectedChar?.id === char.id}
                    swipeOffset={swipeOffset}
                    onSelect={() => { setSelectedChar(char); loadCharacterDetails(char); }}
                    onSwipeStart={handleSwipeStart}
                    onSwipeMove={handleSwipeMove}
                    onSwipeEnd={handleSwipeEnd}
                    getCategoryColor={getCategoryColor}
                  />
                ))}
              </div>
            </PullToRefreshContainer>
          </div>

          {/* Desktop: Regular scroll */}
          <div className="hidden lg:block space-y-2 max-h-[80vh] overflow-y-auto">
            {filtered.map(char => (
              <CharacterListItem
                key={char.id}
                char={char}
                isSelected={selectedChar?.id === char.id}
                swipeOffset={swipeOffset}
                onSelect={() => { setSelectedChar(char); loadCharacterDetails(char); }}
                onSwipeStart={handleSwipeStart}
                onSwipeMove={handleSwipeMove}
                onSwipeEnd={handleSwipeEnd}
                getCategoryColor={getCategoryColor}
              />
            ))}
          </div>
        </div>

        {/* Character Details */}
        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">
            {selectedChar ? (
              <motion.div
                key={selectedChar.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                <div className="p-4 border border-primary/20 bg-black/40 rounded">
                  <div className="flex items-start gap-4">
                    {selectedChar.avatar_url && (
                      <img src={selectedChar.avatar_url} alt={selectedChar.name} className="w-24 h-24 rounded border border-primary/30 object-cover" />
                    )}
                    <div className="flex-1 space-y-2">
                      <h2 className="font-mono text-2xl text-primary tracking-wider uppercase">{selectedChar.name}</h2>
                      {selectedChar.universe && (
                        <p className="text-[9px] font-mono text-primary/50 tracking-widest">{selectedChar.universe}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <span className={`px-2 py-1 border rounded text-[8px] font-mono ${getCategoryColor(selectedChar.category)}`}>
                          {selectedChar.category || "character"}
                        </span>
                        {selectedChar.status && (
                          <span className="px-2 py-1 border border-primary/20 bg-primary/5 rounded text-[8px] font-mono text-primary/60">
                            {selectedChar.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedChar.personality && (
                    <div className="p-4 border border-primary/15 bg-black/30 rounded">
                      <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">Personality</p>
                      <p className="text-[10px] font-mono text-primary/70 leading-relaxed">{selectedChar.personality}</p>
                    </div>
                  )}
                  {selectedChar.speaking_style && (
                    <div className="p-4 border border-primary/15 bg-black/30 rounded">
                      <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">Speaking Style</p>
                      <p className="text-[10px] font-mono text-primary/70 leading-relaxed">{selectedChar.speaking_style}</p>
                    </div>
                  )}
                </div>

                {selectedChar.backstory && (
                  <div className="p-4 border border-primary/15 bg-black/30 rounded">
                    <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">Backstory</p>
                    <p className="text-[10px] font-mono text-primary/70 leading-relaxed">{selectedChar.backstory}</p>
                  </div>
                )}

                {charEvolutions[selectedChar.id] && (
                  <div className="p-4 border border-purple-400/30 bg-purple-400/5 rounded">
                    <p className="font-mono text-[9px] text-purple-400 tracking-widest uppercase mb-3">Evolution Status</p>
                    <div className="space-y-2 text-[9px] font-mono">
                      {charEvolutions[selectedChar.id].growth_areas?.length > 0 && (
                        <div>
                          <p className="text-purple-300/60 mb-1">Growth Areas:</p>
                          <ul className="text-purple-200/70 space-y-0.5 ml-2">
                            {charEvolutions[selectedChar.id].growth_areas.map((area, idx) => (
                              <li key={idx}>• {area}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {charEvolutions[selectedChar.id].updated_motivations?.length > 0 && (
                        <div>
                          <p className="text-purple-300/60 mb-1">Motivations:</p>
                          <ul className="text-purple-200/70 space-y-0.5 ml-2">
                            {charEvolutions[selectedChar.id].updated_motivations.map((mot, idx) => (
                              <li key={idx}>• {mot}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(charTimelines[selectedChar.id]?.journals?.length > 0 ||
                  charTimelines[selectedChar.id]?.relationships?.length > 0) && (
                  <div className="p-4 border border-cyan-400/30 bg-cyan-400/5 rounded">
                    <p className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase mb-3">Timeline & Events</p>
                    <div className="space-y-2 text-[9px] font-mono max-h-48 overflow-y-auto">
                      {charTimelines[selectedChar.id]?.journals?.map((journal, idx) => (
                        <div key={`j-${idx}`} className="p-2 border border-cyan-400/20 bg-black/40 rounded">
                          <p className="text-cyan-300/80 font-semibold">{journal.title}</p>
                          <p className="text-cyan-400/50 text-[8px] mt-0.5">
                            📖 Journal Entry • {new Date(journal.created_date).toLocaleDateString()}
                          </p>
                        </div>
                      ))}
                      {charTimelines[selectedChar.id]?.relationships?.map((rel, idx) => (
                        <div key={`r-${idx}`} className="p-2 border border-cyan-400/20 bg-black/40 rounded">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-cyan-300/80">
                              <Heart className="w-3 h-3 inline mr-1" />
                              Relationship Shift
                            </span>
                            <span className="text-[8px] font-mono" style={{ color: rel.score > 0 ? "#51cf66" : rel.score < 0 ? "#ff6b6b" : "#868e96" }}>
                              {rel.score > 0 ? "+" : ""}{rel.score} ({rel.tier})
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex items-center justify-center">
                <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Select a character to view details</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function CharacterListItem({ char, isSelected, swipeOffset, onSelect, onSwipeStart, onSwipeMove, onSwipeEnd, getCategoryColor }) {
  return (
    <div
      className="relative overflow-hidden"
      onTouchStart={(e) => onSwipeStart(char.id, e)}
      onTouchMove={(e) => onSwipeMove(char.id, e)}
      onTouchEnd={() => onSwipeEnd(char.id)}
    >
      <motion.div
        animate={{ x: swipeOffset[char.id] || 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <button
          onClick={onSelect}
          className={`w-full text-left p-3 min-h-[44px] border rounded transition-all ${
            isSelected
              ? "border-primary/40 bg-primary/10"
              : "border-primary/15 bg-black/30 hover:border-primary/30"
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-primary tracking-wider uppercase truncate">{char.name}</span>
              {char._isAnima && <Sparkles className="w-3 h-3 text-purple-400 flex-shrink-0" />}
            </div>
            <div className={`inline-block px-2 py-0.5 border rounded text-[8px] font-mono ${getCategoryColor(char.category)}`}>
              {char.category || "character"}
            </div>
          </div>
        </button>
      </motion.div>
      <motion.div
        animate={{ opacity: (swipeOffset[char.id] || 0) < -40 ? 1 : 0 }}
        className="absolute inset-0 bg-red-500/20 border border-red-500/40 rounded flex items-center justify-end pr-3 pointer-events-none"
      >
        <Trash2 className="w-4 h-4 text-red-400" />
      </motion.div>
    </div>
  );
}