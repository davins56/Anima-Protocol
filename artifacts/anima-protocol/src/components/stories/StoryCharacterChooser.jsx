import { useState, useEffect } from "react";
import { ChevronLeft, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { CANONICAL_STORIES } from "@/lib/canonicalStories";
import StoryPointSelector from "./StoryPointSelector";
import { motion, AnimatePresence } from "framer-motion";

export default function StoryCharacterChooser({ onClose, onCreateSession }) {
  const [step, setStep] = useState("story"); // "story" | "character" | "insertion" | "points"
  const [selectedStory, setSelectedStory] = useState(null);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [selectedInsertions, setSelectedInsertions] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleInsertion = (pointId) => {
    setSelectedInsertions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(pointId)) {
        newSet.delete(pointId);
      } else {
        newSet.add(pointId);
      }
      return newSet;
    });
  };

  useEffect(() => {
    if (step === "character") {
      loadCharacters();
    }
  }, [step]);

  const loadCharacters = async () => {
    try {
      const [chars, animas] = await Promise.all([
        base44.entities.Character.list("-created_date", 500),
        base44.entities.Anima.list("-created_date", 100),
      ]);
      const animaAsChars = (animas || []).map((a) => ({
        ...a,
        _isAnima: true,
        category: a.archetype || "guardian",
        universe: "Anima",
      }));
      setCharacters([...animaAsChars, ...(chars || [])]);
    } catch (err) {
      console.error("Error loading characters:", err);
    }
  };

  const filteredCharacters = characters.filter((c) => {
    const searchLower = search.toLowerCase();
    const matchesSearch =
      c.name.toLowerCase().includes(searchLower) ||
      (c.universe || "").toLowerCase().includes(searchLower);
    
    // Filter by story characters if a story is selected
    const inStory = !selectedStory || selectedStory.characters.includes(c.name);
    
    return matchesSearch && inStory;
  });

  const handleCreateSession = async () => {
    if (!selectedStory || !selectedCharacter || selectedInsertions.length === 0) return;
    setLoading(true);
    try {
      const firstInsertion = selectedInsertions[0];
      
      // Build narrator exposition
      const narratorExposition = `[LOCATION: ${firstInsertion.setting || selectedStory.title}]\n\n${firstInsertion.narrative}`;
      
      const session = await base44.entities.ChatSession.create({
        mode: "solo",
        character_id: selectedCharacter.id,
        title: `${selectedCharacter.name} in ${selectedStory.title}`,
        opening_scene: firstInsertion.narrative,
        selected_story_points: selectedInsertions.map((p) => ({
          id: p.id,
          title: p.title,
          narrative: p.narrative,
        })),
        messages: [
          {
            role: "assistant",
            character_name: "Narrator",
            content: narratorExposition,
            timestamp: new Date().toISOString(),
          },
        ],
        last_message: firstInsertion.narrative.slice(0, 60),
      });
      onCreateSession(session);
    } catch (err) {
      console.error("Error creating session:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-2xl h-[90vh] sm:max-h-[90vh] bg-background border border-primary/30 hud-corner glow-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-6 border-b border-primary/20 flex-shrink-0">
          <div>
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
              // Story Chooser
            </h2>
            <p className="text-[9px] sm:text-[10px] font-mono text-primary/30 mt-1 tracking-widest uppercase">
              {step === "story"
                ? "Select a canonical story"
                : step === "character"
                ? "Choose your character"
                : "Pick your insertion point"}
            </p>
          </div>
          {step !== "story" && (
            <button
              onClick={() => setStep(step === "character" ? "story" : "character")}
              className="text-primary/40 hover:text-primary transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 min-h-0">
          <AnimatePresence mode="wait">
            {step === "story" && (
              <motion.div
                key="story"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="grid gap-3 grid-cols-1 sm:grid-cols-2"
              >
                {CANONICAL_STORIES.map((story) => (
                  <button
                    key={story.id}
                    onClick={() => {
                      setSelectedStory(story);
                      setStep("character");
                    }}
                    className="p-4 border border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/10 rounded text-left transition-all group"
                  >
                    <h3 className="font-mono text-sm text-primary tracking-wider uppercase mb-1 group-hover:glow-text">
                      {story.title}
                    </h3>
                    <p className="text-[9px] text-primary/60 mb-2">{story.universe}</p>
                    <p className="text-[9px] text-primary/40 line-clamp-2">{story.description}</p>
                    <p className="text-[8px] text-primary/30 mt-2">
                      {story.insertionPoints.length} insertion point{story.insertionPoints.length !== 1 ? "s" : ""}
                    </p>
                  </button>
                ))}
              </motion.div>
            )}

            {step === "character" && (
              <motion.div
                key="character"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search characters..."
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                  {filteredCharacters.map((char) => (
                    <button
                      key={char.id}
                      onClick={() => {
                        setSelectedCharacter(char);
                        setStep("points");
                      }}
                      className={`p-3 border rounded transition-all ${
                        selectedCharacter?.id === char.id
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-primary/15 bg-black/40 text-primary/60 hover:border-primary/40"
                      }`}
                    >
                      {char.avatar_url && (
                        <img
                          src={char.avatar_url}
                          alt={char.name}
                          className="w-full aspect-square object-cover border border-primary/20 mb-2 rounded"
                        />
                      )}
                      <p className="font-mono text-[9px] tracking-wider uppercase truncate">
                        {char.name}
                      </p>
                      <p className="text-[8px] text-primary/40 truncate">{char.universe || "Original"}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === "points" && selectedStory && selectedCharacter && (
              <StoryPointSelector
                story={selectedStory}
                onSelectPoints={(points) => {
                  setSelectedInsertions(points);
                  handleCreateSession();
                }}
                onBack={() => setStep("character")}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 sm:p-6 border-t border-primary/20 bg-black/60 flex-shrink-0">
          <p className="text-[8px] font-mono text-primary/40 tracking-widest">
            {selectedCharacter && `${selectedCharacter.name} •`} {selectedStory && selectedStory.title}
          </p>
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-xs tracking-widest uppercase transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateSession}
              disabled={!selectedStory || !selectedCharacter || selectedInsertions.length === 0 || loading}
              className="flex-1 sm:flex-initial px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
            >
              {loading ? "Creating..." : "Enter Story"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}