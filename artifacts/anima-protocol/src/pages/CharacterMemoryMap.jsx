import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Loader, Search } from "lucide-react";
import { Link } from "react-router-dom";
import MemoryTimeline from "@/components/character/MemoryTimeline";

export default function CharacterMemoryMap() {
  const [characters, setCharacters] = useState([]);
  const [selectedChar, setSelectedChar] = useState("");
  const [memories, setMemories] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [characterEmotions, setCharacterEmotions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadCharacters();
  }, []);

  useEffect(() => {
    if (selectedChar) {
      loadCharacterData();
    }
  }, [selectedChar]);

  const loadCharacters = async () => {
    try {
      const data = await base44.entities.Character.list("-created_date", 100);
      setCharacters(data || []);
      if (data?.length > 0) {
        setSelectedChar(data[0].id);
      }
    } catch (err) {
      console.error("Error loading characters:", err);
    }
  };

  const loadCharacterData = async () => {
    setLoading(true);
    try {
      const [memData, relData] = await Promise.all([
        base44.entities.CharacterMemory.filter({ character_id: selectedChar }, "-created_date", 100),
        base44.entities.CharacterRelationship.filter({ character_id: selectedChar }, "-created_date", 100),
      ]);

      setMemories(memData || []);
      setRelationships(relData || []);

      // Get current emotional state if available
      const emotionalStates = await base44.entities.CharacterEmotionalState.filter(
        { character_id: selectedChar, is_current: true },
        "-created_date",
        1
      );
      if (emotionalStates?.length > 0) {
        setCharacterEmotions(emotionalStates[0]);
      }
    } catch (err) {
      console.error("Error loading character data:", err);
    } finally {
      setLoading(false);
    }
  };

  const selectedCharacter = characters.find(c => c.id === selectedChar);
  const filteredMemories = memories.filter(m =>
    !search.trim() || 
    m.fact?.toLowerCase().includes(search.toLowerCase()) ||
    m.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 min-h-0 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl">
              // Memory Map
            </h1>
            <p className="text-[9px] sm:text-[10px] font-mono text-primary/40 tracking-widest">
              Long-term memories & relationship evolution
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl space-y-6">
          {/* Character Selector */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
              Select Character
            </label>
            <select
              value={selectedChar}
              onChange={(e) => setSelectedChar(e.target.value)}
              className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            >
              {characters.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.universe ? `(${c.universe})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Character Info Card */}
          {selectedCharacter && (
            <div className="p-4 border border-primary/20 bg-primary/5 space-y-3">
              <div className="flex items-start gap-4">
                {selectedCharacter.avatar_url && (
                  <img
                    src={selectedCharacter.avatar_url}
                    alt={selectedCharacter.name}
                    className="w-16 h-16 border border-primary/30 object-cover"
                  />
                )}
                <div className="flex-1">
                  <h2 className="font-mono text-lg text-primary tracking-wider uppercase">
                    {selectedCharacter.name}
                  </h2>
                  {selectedCharacter.universe && (
                    <p className="text-[9px] font-mono text-primary/50 mt-1">
                      {selectedCharacter.universe}
                    </p>
                  )}
                </div>
              </div>

              {/* Current Emotional State */}
              {characterEmotions && (
                <div className="pt-3 border-t border-primary/20 space-y-2">
                  <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
                    Current Emotional State
                  </p>
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-mono text-sm text-primary capitalize">
                        {characterEmotions.primary_emotion}
                      </p>
                      <p className="text-[9px] font-mono text-primary/50 mt-0.5">
                        {characterEmotions.trigger && `Triggered by: ${characterEmotions.trigger}`}
                      </p>
                    </div>
                    <div className="ml-auto">
                      <div className="text-right">
                        <p className="text-[9px] font-mono text-primary/40">Intensity</p>
                        <div className="w-32 h-2 bg-primary/20 rounded-full mt-1 overflow-hidden">
                          <div
                            className="h-full bg-primary/60"
                            style={{ width: `${(characterEmotions.intensity / 10) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Search Filter */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
              Search Memories
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search memories, tags..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          {/* Timeline */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto mb-3" />
                <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                  Loading memories...
                </p>
              </div>
            </div>
          ) : (
            <MemoryTimeline
              memories={filteredMemories}
              relationships={relationships}
              characterName={selectedCharacter?.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}