import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import RelationshipGraphVisualization from "@/components/network/RelationshipGraphVisualization";
import LocationKnowledgePanel from "@/components/world/LocationKnowledgePanel";
import { Home, MapPin, Users } from "lucide-react";

export default function RelationshipAndLocationDashboard() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("relationships");

  useEffect(() => {
    loadSessionData();
  }, [sessionId]);

  const loadSessionData = async () => {
    setLoading(true);
    try {
      // Load session
      const sessions = await base44.entities.ChatSession.list("-updated_date", 200);
      const currentSession = sessions.find((s) => s.id === sessionId);
      setSession(currentSession);

      // Load characters
      const [chars, animas] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        base44.entities.Anima.list("-created_date", 100),
      ]);

      const animaAsChars = (animas || []).map((a) => ({
        ...a,
        _isAnima: true,
        category: a.archetype || "guardian",
      }));

      const allChars = [...animaAsChars, ...(chars || [])];

      // Filter to session participants if solo/group mode
      let filteredChars = allChars;
      if (currentSession?.mode === "solo" && currentSession?.character_id) {
        filteredChars = allChars.filter((c) => c.id === currentSession.character_id);
        setSelectedCharacterId(currentSession.character_id);
      } else if (currentSession?.mode === "group" && currentSession?.group_character_ids?.length) {
        filteredChars = allChars.filter((c) =>
          currentSession.group_character_ids.includes(c.id)
        );
        if (filteredChars.length > 0) {
          setSelectedCharacterId(filteredChars[0].id);
        }
      }

      setCharacters(filteredChars);
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background p-6 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex-1 min-h-0 bg-background p-6 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Home className="w-12 h-12 text-primary/30 mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Session not found
          </p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-2 border border-primary/30 text-primary/60 hover:text-primary transition-colors font-mono text-xs tracking-widest uppercase"
          >
            Return to Chat
          </button>
        </div>
      </div>
    );
  }

  const selectedChar = characters.find((c) => c.id === selectedCharacterId);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-mono text-2xl text-primary glow-text tracking-[0.2em] uppercase">
                // Relationship & Location Dashboard
              </h1>
              <p className="font-mono text-[10px] text-primary/40 tracking-widest mt-2">
                {session.title}
              </p>
            </div>
            <button
              onClick={() => navigate(`/chat/${sessionId}`)}
              className="px-4 py-2 border border-primary/30 text-primary/60 hover:text-primary transition-colors font-mono text-xs tracking-widest uppercase"
            >
              Back to Chat
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 border-b border-primary/20">
            <button
              onClick={() => setActiveTab("relationships")}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
                activeTab === "relationships"
                  ? "border-primary text-primary"
                  : "border-transparent text-primary/50 hover:text-primary/70"
              }`}
            >
              <Users className="w-4 h-4" />
              Bonds & Conflicts
            </button>
            <button
              onClick={() => setActiveTab("locations")}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
                activeTab === "locations"
                  ? "border-primary text-primary"
                  : "border-transparent text-primary/50 hover:text-primary/70"
              }`}
            >
              <MapPin className="w-4 h-4" />
              Geography & Knowledge
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {activeTab === "relationships" ? (
          <div className="space-y-6">
            {/* Relationship Graph */}
            <RelationshipGraphVisualization sessionId={sessionId} characters={characters} />

            {/* Character Selection & Details */}
            <div className="space-y-3">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                Select Character for Details
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {characters.map((char) => (
                  <button
                    key={char.id}
                    onClick={() => setSelectedCharacterId(char.id)}
                    className={`flex flex-col items-center gap-2 p-3 border rounded transition-all ${
                      selectedCharacterId === char.id
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-primary/15 bg-black/30 text-primary/60 hover:border-primary/30"
                    }`}
                  >
                    {char.avatar_url ? (
                      <img
                        src={char.avatar_url}
                        alt={char.name}
                        className="w-8 h-8 rounded object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center">
                        <span className="font-mono text-xs text-primary/60">{char.name[0]}</span>
                      </div>
                    )}
                    <span className="font-mono text-[8px] text-center truncate">
                      {char.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Character Relationships */}
            {selectedChar && (
              <div className="border border-primary/20 bg-black/40 rounded p-4 space-y-3">
                <p className="font-mono text-[10px] text-primary/60 tracking-widest uppercase">
                  {selectedChar.name}'s Relationship Network
                </p>
                <p className="font-mono text-[9px] text-primary/50 leading-relaxed">
                  This character's bonds are visualized in the graph above. Click on their node to
                  see all active relationships, including strength, tier, and interaction count.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Location Knowledge */}
            {selectedChar ? (
              <LocationKnowledgePanel
                sessionId={sessionId}
                characterId={selectedChar.id}
                characterName={selectedChar.name}
              />
            ) : (
              <div className="border border-primary/20 bg-black/30 rounded p-6 text-center">
                <MapPin className="w-12 h-12 text-primary/20 mx-auto mb-3" />
                <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                  Select a character to view their location knowledge
                </p>
              </div>
            )}

            {/* All Locations in Session */}
            <div className="space-y-3">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                All Session Locations
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Placeholder for location cards - would be populated dynamically */}
                <div className="border border-primary/15 bg-black/30 rounded p-3 text-center">
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                    Locations auto-extract from chat
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}