import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Loader } from "lucide-react";
import { Link } from "react-router-dom";
import AIBehaviorDashboard from "@/components/settings/AIBehaviorDashboard";

export default function AIBehaviorSettings() {
  const [characters, setCharacters] = useState([]);
  const [selectedCharId, setSelectedCharId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCharacters();
  }, []);

  const loadCharacters = async () => {
    setLoading(true);
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

  return (
    <div className="flex-1 min-h-0 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl">
              // AI Behavior Settings
            </h1>
            <p className="text-[10px] sm:text-xs font-mono text-primary/40 tracking-widest">
              Customize AI personality and response behavior per character
            </p>
          </div>
        </div>
      </div>

      {/* Character Selector */}
      <div className="px-4 sm:px-6 py-4 border-b border-primary/10 bg-black/40">
        <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
          Select Character
        </label>
        <select
          value={selectedCharId}
          onChange={(e) => setSelectedCharId(e.target.value)}
          className="w-full max-w-xs bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
        >
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading...
              </p>
            </div>
          </div>
        ) : selectedCharId ? (
          <div className="max-w-lg">
            <AIBehaviorDashboard
              characterId={selectedCharId}
              characterName={characters.find(c => c.id === selectedCharId)?.name || "Character"}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}