import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, BookOpen, User, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Build insertion points from a character's metadata so the user can drop
 * themselves into that character's story.  Uses backstory, universe, and
 * personality to fabricate two or three scene-entry moments.
 */
function buildInsertionPoints(char) {
  const universe = char.universe || "an unknown realm";
  const name = char.name || "this character";
  const backstory = (char.backstory || "").trim();
  const personality = (char.personality || "").trim();

  const points = [];

  // 1. Origin / meeting point — always available
  points.push({
    id: `${char.id}-origin`,
    title: `First Encounter with ${name}`,
    chapter: universe !== "an unknown realm" ? `Universe: ${universe}` : null,
    narrative: backstory
      ? `You find yourself in the world of ${universe}. ${name} stands before you — ${backstory.slice(0, 220)}${backstory.length > 220 ? "…" : ""}. Your paths cross for the first time. What will you say?`
      : `You arrive in the world of ${universe}. Ahead of you stands ${name}, a figure of mystery and intrigue. This is the moment your stories intertwine.`,
    setting: universe !== "an unknown realm" ? universe : `${name}'s World`,
  });

  // 2. If there's a backstory, generate a mid-story point
  if (backstory.length > 40) {
    points.push({
      id: `${char.id}-midstory`,
      title: `Drawn Into ${name}'s Story`,
      chapter: "Mid-Story",
      narrative: `The events of ${name}'s life are unfolding around you. ${backstory.slice(0, 180)}${backstory.length > 180 ? "…" : ""} You've been pulled into the middle of it all — and ${name} needs your help.`,
      setting: universe !== "an unknown realm" ? `Deep within ${universe}` : `The Heart of ${name}'s World`,
    });
  }

  // 3. If there are personality traits, generate a bonding/conflict point
  if (personality) {
    const tone = personality.toLowerCase().includes("dark") ||
      personality.toLowerCase().includes("brooding") ||
      personality.toLowerCase().includes("villain")
      ? "tension crackles between you"
      : "a bond begins to form";
    points.push({
      id: `${char.id}-bond`,
      title: `A Turning Point with ${name}`,
      chapter: "Pivotal Moment",
      narrative: `You and ${name} face a crossroads. Known for being ${personality.slice(0, 120)}${personality.length > 120 ? "…" : ""}, ${tone}. The next move will define everything.`,
      setting: `${name}'s Domain`,
    });
  }

  return points;
}

export default function CharacterStoryChooser({ onClose, onCreateSession }) {
  const [step, setStep] = useState("target"); // "target" | "self" | "confirm"
  const [characters, setCharacters] = useState([]);
  const [targetCharacter, setTargetCharacter] = useState(null);
  const [selfCharacter, setSelfCharacter] = useState(null);
  const [selectedPointId, setSelectedPointId] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCharacters();
  }, []);

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

  const filteredCharacters = useMemo(() => {
    const term = search.toLowerCase();
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.universe || "").toLowerCase().includes(term),
    );
  }, [characters, search]);

  // Characters available for the "self" step — exclude the target so the user
  // can't insert themselves as the same character.
  const selfCandidates = useMemo(
    () => filteredCharacters.filter((c) => c.id !== targetCharacter?.id),
    [filteredCharacters, targetCharacter],
  );

  const insertionPoints = useMemo(
    () => (targetCharacter ? buildInsertionPoints(targetCharacter) : []),
    [targetCharacter],
  );

  // Default-select the first insertion point when they're generated
  useEffect(() => {
    if (insertionPoints.length > 0 && !selectedPointId) {
      setSelectedPointId(insertionPoints[0].id);
    }
  }, [insertionPoints, selectedPointId]);

  const handleCreateSession = async () => {
    const point = insertionPoints.find((p) => p.id === selectedPointId);
    if (!targetCharacter || !selfCharacter || !point) return;
    setLoading(true);
    try {
      const narratorExposition = `[LOCATION: ${point.setting || targetCharacter.universe || "Unknown"}]\n\n${point.narrative}`;

      const session = await base44.entities.ChatSession.create({
        mode: "solo",
        character_id: targetCharacter.id,
        title: `${selfCharacter.name} enters ${targetCharacter.name}'s Story`,
        opening_scene: point.narrative,
        selected_story_points: [
          { id: point.id, title: point.title, narrative: point.narrative },
        ],
        messages: [
          {
            role: "assistant",
            character_name: "Narrator",
            content: narratorExposition,
            timestamp: new Date().toISOString(),
          },
        ],
        last_message: point.narrative.slice(0, 60),
      });
      onCreateSession(session);
    } catch (err) {
      console.error("Error creating story session:", err);
    } finally {
      setLoading(false);
    }
  };

  const stepLabel =
    step === "target"
      ? "Choose a character to enter their story"
      : step === "self"
        ? "Choose who YOU will be"
        : "Pick your entry point";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
      <div
        className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border flex flex-col"
        style={{
          height: "calc(var(--app-height, 100dvh) * 0.9)",
          maxHeight: "calc(var(--app-height, 100dvh) * 0.9)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-6 border-b border-primary/20 flex-shrink-0">
          <div>
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
              // Enter Their Story
            </h2>
            <p className="text-[9px] sm:text-[10px] font-mono text-primary/30 mt-1 tracking-widest uppercase">
              {stepLabel}
            </p>
          </div>
          {step !== "target" && (
            <button
              onClick={() => {
                if (step === "self") {
                  setStep("target");
                  setSelfCharacter(null);
                  setSearch("");
                } else {
                  setStep("self");
                  setSelectedPointId(null);
                  setSearch("");
                }
              }}
              className="text-primary/40 hover:text-primary transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 min-h-0">
          <AnimatePresence mode="wait">
            {/* Step 1: pick the target character */}
            {step === "target" && (
              <motion.div
                key="target"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4 text-primary/60" />
                  <p className="text-[10px] font-mono text-primary/50 tracking-wider">
                    Pick a character — you'll be inserted into their story
                  </p>
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search characters..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                />

                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                  {filteredCharacters.map((char) => (
                    <button
                      key={char.id}
                      onClick={() => {
                        setTargetCharacter(char);
                        setSearch("");
                        setStep("self");
                      }}
                      className="p-3 border border-primary/15 bg-black/40 text-primary/60 hover:border-primary/40 hover:bg-primary/10 rounded transition-all text-left"
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
                      <p className="text-[8px] text-primary/40 truncate">
                        {char.universe || "Original"}
                      </p>
                      {char.backstory && (
                        <p className="text-[7px] text-primary/30 mt-1 line-clamp-2">
                          {char.backstory.slice(0, 80)}…
                        </p>
                      )}
                    </button>
                  ))}
                  {filteredCharacters.length === 0 && (
                    <p className="col-span-full text-center text-[10px] text-primary/30 font-mono py-8">
                      No characters found. Create or import characters first.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step 2: pick yourself */}
            {step === "self" && (
              <motion.div
                key="self"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <User className="w-4 h-4 text-primary/60" />
                  <p className="text-[10px] font-mono text-primary/50 tracking-wider">
                    Who will you be in {targetCharacter?.name}'s story?
                  </p>
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your characters..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                />

                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                  {selfCandidates.map((char) => (
                    <button
                      key={char.id}
                      onClick={() => {
                        setSelfCharacter(char);
                        setSearch("");
                        setStep("confirm");
                      }}
                      className="p-3 border border-primary/15 bg-black/40 text-primary/60 hover:border-primary/40 hover:bg-primary/10 rounded transition-all text-left"
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
                      <p className="text-[8px] text-primary/40 truncate">
                        {char.universe || "Original"}
                      </p>
                    </button>
                  ))}
                  {selfCandidates.length === 0 && (
                    <p className="col-span-full text-center text-[10px] text-primary/30 font-mono py-8">
                      No other characters available. Create another character to play as.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step 3: pick insertion point and confirm */}
            {step === "confirm" && targetCharacter && selfCharacter && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-primary/60" />
                  <p className="text-[10px] font-mono text-primary/50 tracking-wider">
                    {selfCharacter.name} entering {targetCharacter.name}'s story
                  </p>
                </div>

                {/* Summary card */}
                <div className="p-3 border border-primary/20 bg-black/40 rounded flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-mono text-[9px] text-primary/60 tracking-wider uppercase">
                      You: <span className="text-primary">{selfCharacter.name}</span>
                    </p>
                    <p className="font-mono text-[9px] text-primary/60 tracking-wider uppercase mt-0.5">
                      Their story: <span className="text-primary">{targetCharacter.name}</span>
                      {targetCharacter.universe && (
                        <span className="text-primary/40"> — {targetCharacter.universe}</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Insertion points */}
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
                  Select your entry point
                </p>
                <div className="space-y-2">
                  {insertionPoints.map((point) => {
                    const isSelected = selectedPointId === point.id;
                    return (
                      <button
                        key={point.id}
                        onClick={() => setSelectedPointId(point.id)}
                        className={`w-full text-left p-4 border rounded transition-all ${
                          isSelected
                            ? "border-primary/50 bg-primary/10"
                            : "border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5"
                        }`}
                      >
                        <h3 className="font-mono text-[10px] text-primary tracking-wider uppercase mb-1">
                          {point.title}
                        </h3>
                        {point.chapter && (
                          <p className="text-[8px] text-primary/40 mb-1">
                            {point.chapter}
                          </p>
                        )}
                        <p className="text-[9px] text-primary/60 line-clamp-3">
                          {point.narrative}
                        </p>
                        {point.setting && (
                          <p className="text-[8px] text-primary/40 mt-2">
                            📍 {point.setting}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 sm:p-6 border-t border-primary/20 bg-black/60 flex-shrink-0">
          <p className="text-[8px] font-mono text-primary/40 tracking-widest">
            {targetCharacter && `${targetCharacter.name}'s story`}
            {selfCharacter && ` • as ${selfCharacter.name}`}
          </p>
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-initial px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-xs tracking-widest uppercase transition-all"
            >
              Cancel
            </button>
            {step === "confirm" && (
              <button
                onClick={handleCreateSession}
                disabled={!selectedPointId || loading}
                className="flex-1 sm:flex-initial px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                {loading ? "Creating…" : "Enter Story"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
