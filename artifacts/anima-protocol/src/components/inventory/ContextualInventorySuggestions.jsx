import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Lightbulb, Loader, Shield, Zap, Eye, Lock, Heart } from "lucide-react";

const SCENE_PATTERNS = {
  dangerous: {
    keywords: ["fight", "attack", "danger", "threat", "enemy", "monster", "combat", "weapon"],
    icon: Shield,
    color: "text-red-400 border-red-400/30 bg-red-400/5",
    useCases: {
      weapon: "Combat/Defense",
      armor: "Protection",
      potion: "Healing",
      scroll: "Magic Defense",
    },
  },
  stealth: {
    keywords: ["hide", "sneak", "shadow", "quiet", "silent", "undetected", "invisible"],
    icon: Eye,
    color: "text-blue-400 border-blue-400/30 bg-blue-400/5",
    useCases: {
      cloak: "Concealment",
      ring: "Magical Stealth",
      boots: "Silent Movement",
      potion: "Invisibility",
    },
  },
  exploration: {
    keywords: ["discover", "explore", "search", "investigate", "find", "map", "path"],
    icon: Lightbulb,
    color: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",
    useCases: {
      map: "Navigation",
      compass: "Direction",
      torch: "Illumination",
      key: "Access",
      rope: "Climbing/Access",
    },
  },
  social: {
    keywords: ["talk", "negotiate", "persuade", "convince", "barter", "trade", "gift", "charm"],
    icon: Heart,
    color: "text-pink-400 border-pink-400/30 bg-pink-400/5",
    useCases: {
      gift: "Building Affinity",
      charm: "Persuasion",
      ring: "Impressive Gift",
      potion: "Special Gift",
    },
  },
  magical: {
    keywords: ["spell", "magic", "ritual", "mystical", "arcane", "enchanted", "curse"],
    icon: Zap,
    color: "text-purple-400 border-purple-400/30 bg-purple-400/5",
    useCases: {
      scroll: "Spell Casting",
      wand: "Magic Channeling",
      gem: "Magical Focus",
      potion: "Magical Effect",
      ring: "Enchantment",
    },
  },
  locked: {
    keywords: ["lock", "sealed", "locked", "door", "gate", "barrier", "blocked"],
    icon: Lock,
    color: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
    useCases: {
      key: "Unlock",
      pick: "Lockpicking",
      spell: "Magical Unlock",
      potion: "Dissolution",
    },
  },
};

export default function ContextualInventorySuggestions({
  items,
  recentMessages,
  onItemSuggested,
}) {
  const [sceneContext, setSceneContext] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    analyzeScene();
  }, [recentMessages]);

  const analyzeScene = async () => {
    if (!recentMessages || recentMessages.length === 0) {
      setSceneContext(null);
      setSuggestions([]);
      return;
    }

    setAnalyzing(true);
    try {
      // Get recent context
      const recentText = recentMessages
        .slice(-5)
        .map(m => m.content)
        .join(" ")
        .toLowerCase();

      // Detect scene type
      let detectedScene = null;
      let maxMatches = 0;

      for (const [sceneType, config] of Object.entries(SCENE_PATTERNS)) {
        const matches = config.keywords.filter(keyword =>
          recentText.includes(keyword)
        ).length;

        if (matches > maxMatches) {
          maxMatches = matches;
          detectedScene = sceneType;
        }
      }

      if (detectedScene && maxMatches > 0) {
        setSceneContext(detectedScene);

        // Generate suggestions based on detected scene
        const sceneConfig = SCENE_PATTERNS[detectedScene];
        const relevantItems = items.filter(item => {
          const itemType = item.type?.toLowerCase() || "";
          const itemName = item.name?.toLowerCase() || "";
          return Object.keys(sceneConfig.useCases).some(
            useCase =>
              itemType.includes(useCase) ||
              itemName.includes(useCase)
          );
        });

        const suggestedItems = relevantItems.slice(0, 3).map(item => {
          const useCase = Object.entries(sceneConfig.useCases).find(
            ([key, _]) =>
              item.type?.toLowerCase().includes(key) ||
              item.name?.toLowerCase().includes(key)
          );

          return {
            ...item,
            suggestedUseCase: useCase?.[1] || "Context-Relevant Item",
            sceneType: detectedScene,
          };
        });

        setSuggestions(suggestedItems);
      } else {
        setSceneContext(null);
        setSuggestions([]);
      }
    } catch (err) {
      console.error("Error analyzing scene:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  if (!sceneContext || suggestions.length === 0) {
    return null;
  }

  const sceneConfig = SCENE_PATTERNS[sceneContext];
  const SceneIcon = sceneConfig.icon;

  return (
    <div className={`border p-4 hud-corner space-y-3 ${sceneConfig.color}`}>
      <div className="flex items-center gap-2">
        <SceneIcon className="w-4 h-4" />
        <h3 className="font-mono text-xs tracking-[0.15em] uppercase font-semibold">
          {sceneContext} Context Detected
        </h3>
        {analyzing && <Loader className="w-3 h-3 animate-spin ml-auto" />}
      </div>

      <p className="text-[9px] font-mono opacity-70 leading-relaxed">
        Based on the current scene, here are items that could be useful:
      </p>

      <div className="space-y-2 pt-1">
        {suggestions.map((item, idx) => (
          <button
            key={idx}
            onClick={() => onItemSuggested?.(item)}
            className="w-full text-left p-2 border border-current/20 bg-black/40 hover:bg-black/60 transition-all rounded"
          >
            <div className="flex items-start justify-between gap-2 mb-0.5">
              <span className="font-mono text-[9px] tracking-wider uppercase">
                {item.name}
              </span>
              <span className="text-[8px] font-mono opacity-50 flex-shrink-0">
                {item.type}
              </span>
            </div>
            <p className="text-[8px] font-mono opacity-60">
              💡 {item.suggestedUseCase}
            </p>
            {item.description && (
              <p className="text-[8px] font-mono opacity-40 mt-0.5 line-clamp-1">
                {item.description}
              </p>
            )}
          </button>
        ))}
      </div>

      <div className="text-[8px] font-mono opacity-50 pt-1 border-t border-current/10">
        Suggest an item to record its contextual use
      </div>
    </div>
  );
}