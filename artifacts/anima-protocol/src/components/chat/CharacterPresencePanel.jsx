import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Users, MapPin, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const EMOTION_COLORS = {
  joyful: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
  calm: "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
  sad: "border-blue-400/40 bg-blue-400/10 text-blue-400",
  angry: "border-red-400/40 bg-red-400/10 text-red-400",
  afraid: "border-purple-400/40 bg-purple-400/10 text-purple-400",
  peaceful: "border-green-400/40 bg-green-400/10 text-green-400",
  hopeful: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
  conflicted: "border-orange-400/40 bg-orange-400/10 text-orange-400",
};

export default function CharacterPresencePanel({
  sessionId,
  currentLocation,
  sessionCharacters = [],
  characterEmotions = {},
}) {
  const [nearbyCharacters, setNearbyCharacters] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentLocation && sessionCharacters.length > 0) {
      loadNearbyCharacters();
    }
  }, [currentLocation, sessionCharacters]);

  const loadNearbyCharacters = async () => {
    setLoading(true);
    try {
      // For now, assume all session characters are "nearby" if in the same location
      // In a full implementation, you'd fetch actual location data
      setNearbyCharacters(sessionCharacters || []);
    } catch (err) {
      console.error("Error loading nearby characters:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!currentLocation || nearbyCharacters.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="w-72 border-l border-primary/20 bg-black/60 backdrop-blur-md flex flex-col max-h-[50vh] overflow-hidden"
    >
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-primary/20 bg-black/80">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-4 h-4 text-primary/60" />
          <h3 className="font-mono text-xs text-primary/80 tracking-widest uppercase">
            Present at Location
          </h3>
        </div>
        <p className="font-mono text-[10px] text-primary/40 truncate">
          {currentLocation}
        </p>
      </div>

      {/* Character List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader className="w-4 h-4 text-primary/40 animate-spin" />
          </div>
        ) : nearbyCharacters.length === 0 ? (
          <div className="flex items-center justify-center h-full p-4 text-center">
            <p className="font-mono text-[9px] text-primary/30">
              No one else here
            </p>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            <AnimatePresence>
              {nearbyCharacters.map((char, idx) => {
                const emotion = characterEmotions[char.id];
                const emotionColor =
                  EMOTION_COLORS[emotion?.emotion] ||
                  "border-primary/20 bg-primary/5 text-primary/60";

                return (
                  <motion.div
                    key={char.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`p-3 border rounded transition-all hover:border-opacity-60 ${emotionColor}`}
                  >
                    {/* Avatar and Name */}
                    <div className="flex items-center gap-3 mb-2">
                      {char.avatar_url ? (
                        <img
                          src={char.avatar_url}
                          alt={char.name}
                          className="w-8 h-8 rounded border border-current/30 object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded border border-current/30 flex items-center justify-center text-[10px] font-mono font-bold bg-current/10">
                          {char.name[0]}
                        </div>
                      )}
                      <span className="font-mono text-[10px] font-semibold tracking-wider uppercase flex-1 truncate">
                        {char.name}
                      </span>
                    </div>

                    {/* Emotion Status */}
                    {emotion && (
                      <div className="space-y-1">
                        <p className="text-[8px] font-mono text-current/70 tracking-widest uppercase">
                          {emotion.emotion}
                          {emotion.intensity && ` (${emotion.intensity}/10)`}
                        </p>
                        {emotion.trigger && (
                          <p className="text-[8px] text-current/50 leading-tight">
                            {emotion.trigger}
                          </p>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 p-3 border-t border-primary/10 bg-black/80">
        <p className="font-mono text-[8px] text-primary/30 text-center tracking-widest uppercase">
          {nearbyCharacters.length} character{nearbyCharacters.length !== 1 ? "s" : ""} present
        </p>
      </div>
    </motion.div>
  );
}