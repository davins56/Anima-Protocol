import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Search, Loader, Pin, Trash2, Tag, Heart } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function CharacterMemoriesDashboard() {
  const [characters, setCharacters] = useState([]);
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [memories, setMemories] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [pinnedMemories, setPinnedMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    loadCharacters();
  }, []);

  useEffect(() => {
    if (selectedCharId) {
      loadMemories();
    }
  }, [selectedCharId]);

  const loadCharacters = async () => {
    try {
      const chars = await base44.entities.Character.list("-created_date", 100);
      setCharacters(chars || []);
      if (chars?.length > 0) {
        setSelectedCharId(chars[0].id);
      }
    } catch (err) {
      console.error("Error loading characters:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadMemories = async () => {
    try {
      setLoading(true);
      const result = await base44.functions.invoke("characterMemory", {
        action: "get",
        character_id: selectedCharId,
      });
      const mems = result?.data?.memories || [];
      setMemories(mems);
      
      // Load pinned status from user metadata
      const user = await base44.auth.me();
      const pinned = user?.pinned_memories?.[selectedCharId] || [];
      setPinnedMemories(pinned);
    } catch (err) {
      console.error("Error loading memories:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !selectedCharId) return;

    setSearching(true);
    try {
      const result = await base44.functions.invoke("searchMemoriesSemantically", {
        character_id: selectedCharId,
        query: searchQuery,
        limit: 10,
      });
      setSearchResults(result?.data?.results || []);
    } catch (err) {
      console.error("Error searching memories:", err);
    } finally {
      setSearching(false);
    }
  };

  const togglePin = async (factId) => {
    const newPinned = pinnedMemories.includes(factId)
      ? pinnedMemories.filter((id) => id !== factId)
      : [factId, ...pinnedMemories];

    setPinnedMemories(newPinned);

    try {
      const user = await base44.auth.me();
      const updated = {
        ...user,
        pinned_memories: {
          ...(user?.pinned_memories || {}),
          [selectedCharId]: newPinned,
        },
      };
      await base44.auth.updateMe(updated);
    } catch (err) {
      console.error("Error updating pinned memories:", err);
    }
  };

  const displayMemories = searchQuery.trim() ? searchResults : memories;
  const sortedMemories = [
    ...displayMemories.filter((m) => pinnedMemories.includes(m.id || JSON.stringify(m))),
    ...displayMemories.filter((m) => !pinnedMemories.includes(m.id || JSON.stringify(m))),
  ];

  const categoryColors = {
    character_fact: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
    item: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    location: "text-green-400 bg-green-400/10 border-green-400/30",
    event: "text-purple-400 bg-purple-400/10 border-purple-400/30",
    relationship: "text-pink-400 bg-pink-400/10 border-pink-400/30",
    secret: "text-red-400 bg-red-400/10 border-red-400/30",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 bg-background">
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading memories...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="font-mono text-4xl text-primary tracking-wider glow-text uppercase flex items-center justify-center gap-3">
            <Heart className="w-8 h-8" />
            // Memory Archive
          </h1>
          <p className="font-mono text-[10px] text-primary/40 tracking-widest">
            SEMANTIC MEMORY SEARCH & PINNING
          </p>
        </div>

        {/* Character Selector */}
        <div className="space-y-2">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Character</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {characters.map((char) => (
              <button
                key={char.id}
                onClick={() => {
                  setSelectedCharId(char.id);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className={`p-2 border rounded transition-all font-mono text-[9px] tracking-widest uppercase ${
                  selectedCharId === char.id
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "border-primary/20 text-primary/40 hover:text-primary/60 hover:border-primary/30"
                }`}
              >
                {char.name}
              </button>
            ))}
          </div>
        </div>

        {/* Search Bar */}
        <div className="space-y-2">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Semantic Search</p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search memories by meaning..."
                className="w-full bg-black/60 border border-primary/30 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-3 focus:outline-none focus:border-primary/60 focus:bg-primary/5 transition-all hud-corner"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/40 pointer-events-none" />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-6 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-sm tracking-widest uppercase transition-all hud-corner"
            >
              {searching ? "Searching..." : "Find"}
            </button>
          </div>
        </div>

        {/* Stats */}
        {selectedCharId && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 border border-primary/15 bg-black/40 rounded text-center">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                Total Memories
              </p>
              <p className="font-mono text-2xl font-semibold text-primary">{memories.length}</p>
            </div>
            <div className="p-3 border border-primary/15 bg-black/40 rounded text-center">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                Pinned
              </p>
              <p className="font-mono text-2xl font-semibold text-yellow-400">{pinnedMemories.length}</p>
            </div>
            <div className="p-3 border border-primary/15 bg-black/40 rounded text-center">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                Recent
              </p>
              <p className="font-mono text-2xl font-semibold text-cyan-400">{Math.min(memories.length, 5)}</p>
            </div>
            <div className="p-3 border border-primary/15 bg-black/40 rounded text-center">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-1">
                Search Results
              </p>
              <p className="font-mono text-2xl font-semibold text-purple-400">{searchResults.length}</p>
            </div>
          </div>
        )}

        {/* Memories Grid */}
        <div className="space-y-3">
          {sortedMemories.length === 0 ? (
            <div className="p-6 border border-primary/15 bg-black/40 rounded text-center">
              <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
                {searchQuery.trim() ? "No matching memories found" : "No memories recorded"}
              </p>
            </div>
          ) : (
            <AnimatePresence>
              {sortedMemories.map((mem, idx) => {
                const memId = mem.id || JSON.stringify(mem);
                const isPinned = pinnedMemories.includes(memId);
                const colors = categoryColors[mem.category] || categoryColors.character_fact;

                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`p-4 border rounded transition-all ${isPinned ? "border-yellow-400/40 bg-yellow-400/5" : "border-primary/15 bg-black/40 hover:bg-black/60"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`font-mono text-[8px] font-semibold px-2 py-0.5 border rounded ${colors}`}>
                            {mem.category}
                          </span>
                          {isPinned && (
                            <span className="flex items-center gap-1 text-[8px] font-mono text-yellow-400 px-2 py-0.5 border border-yellow-400/30 bg-yellow-400/10 rounded">
                              <Pin className="w-2 h-2" />
                              PINNED
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-sm text-primary leading-relaxed mb-2">
                          {mem.fact}
                        </p>
                        <p className="font-mono text-[8px] text-primary/40">
                          {new Date(mem.timestamp || Date.now()).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => togglePin(memId)}
                          title={isPinned ? "Unpin memory" : "Pin to top"}
                          className={`w-8 h-8 border flex items-center justify-center transition-all ${
                            isPinned
                              ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-400"
                              : "border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40"
                          }`}
                        >
                          <Pin className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Info Footer */}
        <div className="p-4 border border-primary/15 bg-primary/5 rounded">
          <p className="font-mono text-[9px] text-primary/50 leading-relaxed">
            💡 <strong>Tip:</strong> Pinned memories are prioritized by the AI during story generation. Use semantic search to find related memories quickly, then pin the most important ones for better narrative consistency.
          </p>
        </div>
      </div>
    </div>
  );
}