import { useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import CharacterCustomizer from "@/components/character/CharacterCustomizer";
import { ChevronLeft, Users, Sparkles } from "lucide-react";

export default function CharacterCustomization() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const characterId = searchParams.get("character");
  const [tab, setTab] = useState(searchParams.get("tab") || "characters");
  const [characters, setCharacters] = useState([]);
  const [animas, setAnimas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [chars, animaList] = await Promise.all([
        base44.entities.Character.list("-created_date", 100),
        base44.entities.Anima.list("-created_date", 100),
      ]);
      setCharacters(chars || []);
      setAnimas(animaList || []);
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCharacter = (charId) => {
    setSearchParams({ character: charId, tab: "characters" });
    setTab("characters");
  };

  const handleSelectAnima = (animaId) => {
    setSearchParams({ character: animaId, tab: "animas" });
    setTab("animas");
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
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
              // Customization
            </h1>
            <p className="text-[10px] font-mono text-primary/50 mt-1 tracking-widest">
              Customize characters & Serenity
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-primary/10">
          <button
            onClick={() => {
              setTab("characters");
              setSearchParams({ tab: "characters" });
            }}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
              tab === "characters"
                ? "border-primary text-primary"
                : "border-transparent text-primary/40 hover:text-primary/70"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Characters
          </button>
          <button
            onClick={() => {
              setTab("animas");
              setSearchParams({ tab: "animas" });
            }}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
              tab === "animas"
                ? "border-primary text-primary"
                : "border-transparent text-primary/40 hover:text-primary/70"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Animas (Serenity)
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
              Loading...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Sidebar - List */}
            <div className="lg:col-span-1 border border-primary/20 bg-black/30 rounded p-4 h-fit max-h-96 overflow-y-auto">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-3">
                {tab === "characters" ? "Characters" : "Animas"}
              </p>
              <div className="space-y-2">
                {(tab === "characters" ? characters : animas).map((char) => (
                  <button
                    key={char.id}
                    onClick={() =>
                      tab === "characters"
                        ? handleSelectCharacter(char.id)
                        : handleSelectAnima(char.id)
                    }
                    className={`w-full text-left p-2.5 border rounded transition-all ${
                      characterId === char.id
                        ? "border-primary/40 bg-primary/10"
                        : "border-primary/15 bg-black/40 hover:border-primary/25"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {char.avatar_url && (
                        <img
                          src={char.avatar_url}
                          alt={char.name}
                          className="w-6 h-6 rounded border border-primary/20 object-cover flex-shrink-0"
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

            {/* Main Content */}
            <div className="lg:col-span-3">
              {characterId ? (
                <CharacterCustomizer
                  characterId={characterId}
                  isAnima={tab === "animas"}
                />
              ) : (
                <div className="flex items-center justify-center h-96 border border-primary/20 bg-black/30 rounded">
                  <div className="text-center space-y-3">
                    {tab === "characters" ? (
                      <Users className="w-8 h-8 text-primary/30 mx-auto" />
                    ) : (
                      <Sparkles className="w-8 h-8 text-primary/30 mx-auto" />
                    )}
                    <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                      Select{" "}
                      {tab === "characters"
                        ? "a character"
                        : "an anima (like Serenity)"}
                      {"\n"}to customize
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
            💡 Customization Tips
          </p>
          <ul className="text-[9px] font-mono text-primary/60 space-y-1 ml-4">
            <li>• <strong>Characters:</strong> Customize your story participants (OCs, canon characters)</li>
            <li>• <strong>Animas:</strong> Customize Serenity and other companion AI personalities</li>
            <li>• <strong>Personality:</strong> AI uses this to inform dialogue and decisions</li>
            <li>• <strong>Speaking Style:</strong> Influences tone, vocabulary, and mannerisms</li>
            <li>• <strong>Avatar:</strong> Upload an image URL to display the character</li>
            <li>• All changes sync across your story sessions</li>
          </ul>
        </div>
      </div>
    </div>
  );
}