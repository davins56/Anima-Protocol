import { useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import CharacterMemoryManager from "@/components/character/CharacterMemoryManager";
import CharacterHistoryTimeline from "@/components/character/CharacterHistoryTimeline";
import { ChevronLeft, Users, Calendar, History } from "lucide-react";

export default function CharacterMemories() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const characterId = searchParams.get("character");
  const [character, setCharacter] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("timeline");

  useEffect(() => {
    loadCharacters();
  }, []);

  const loadCharacters = async () => {
    setLoading(true);
    try {
      const chars = await base44.entities.Character.list("-created_date", 100);
      setCharacters(chars || []);
      
      if (characterId) {
        const selected = chars.find((c) => c.id === characterId);
        setCharacter(selected);
      } else if (chars.length > 0) {
        setCharacter(chars[0]);
      }
    } catch (err) {
      console.error("Error loading characters:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="lg:hidden text-primary/40 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-mono text-2xl sm:text-3xl text-primary glow-text tracking-[0.2em] uppercase">
              // Character Memories
            </h1>
            <p className="text-[10px] font-mono text-primary/50 mt-1 tracking-widest">
              Manage what characters remember and analyze relationships
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
              Loading characters...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Character Selector */}
            <div className="lg:col-span-1 border border-primary/20 bg-black/30 rounded p-4 h-fit max-h-96 overflow-y-auto">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-3">
                Characters
              </p>
              <div className="space-y-2">
                {characters.map((char) => (
                  <button
                    key={char.id}
                    onClick={() => {
                      setCharacter(char);
                      navigate(`?character=${char.id}`);
                    }}
                    className={`w-full text-left p-2.5 border rounded transition-all ${
                      character?.id === char.id
                        ? "border-primary/40 bg-primary/10"
                        : "border-primary/15 bg-black/40 hover:border-primary/25"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {char.avatar_url && (
                        <img
                          src={char.avatar_url}
                          alt={char.name}
                          className="w-6 h-6 rounded border border-primary/20 object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[9px] text-primary/80 tracking-wider uppercase truncate">
                          {char.name}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content */}
            <div className="lg:col-span-3 space-y-4">
              {/* Tab Buttons */}
              <div className="flex gap-2 border-b border-primary/20">
                <button
                  onClick={() => setActiveTab("timeline")}
                  className={`flex items-center gap-2 px-4 py-2 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
                    activeTab === "timeline"
                      ? "border-primary text-primary"
                      : "border-transparent text-primary/50 hover:text-primary/70"
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  History
                </button>
                <button
                  onClick={() => setActiveTab("memories")}
                  className={`flex items-center gap-2 px-4 py-2 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
                    activeTab === "memories"
                      ? "border-primary text-primary"
                      : "border-transparent text-primary/50 hover:text-primary/70"
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Memories
                </button>
              </div>

              {/* Tab Content */}
              {character ? (
                activeTab === "timeline" ? (
                  <CharacterHistoryTimeline
                    characterId={character.id}
                    characterName={character.name}
                  />
                ) : (
                  <CharacterMemoryManager
                    characterId={character.id}
                    characterName={character.name}
                  />
                )
              ) : (
                <div className="flex items-center justify-center h-64 border border-primary/20 bg-black/30 rounded">
                  <div className="text-center space-y-3">
                    <Users className="w-8 h-8 text-primary/30 mx-auto" />
                    <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                      Select a character to view their history
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Info Panel */}
        <div className="p-4 border border-primary/15 bg-black/40 rounded space-y-2">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            💡 How it works
          </p>
          <ul className="text-[9px] font-mono text-primary/60 space-y-1 ml-4">
            <li>• <strong>Add Memories:</strong> Record significant events the character remembers</li>
            <li>• <strong>Tag Memories:</strong> Categorize by relationship, trauma, alliance, etc.</li>
            <li>• <strong>Edit/Delete:</strong> Manually correct memories or remove them entirely</li>
            <li>• <strong>Summarize:</strong> AI analyzes all memories to output relationship status</li>
            <li>• <strong>Filter:</strong> View memories by tag to focus on specific themes</li>
          </ul>
        </div>
      </div>
    </div>
  );
}