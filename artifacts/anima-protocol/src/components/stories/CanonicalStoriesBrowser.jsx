import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CANONICAL_STORIES, getUniverses, getStoryByUniverse } from "@/lib/canonicalStories";
import { ChevronRight, BookOpen, Clock, Users } from "lucide-react";

export default function CanonicalStoriesBrowser({ onSelectStory, isInline = false }) {
  const [selectedUniverse, setSelectedUniverse] = useState(null);
  const [selectedStory, setSelectedStory] = useState(null);
  const universes = getUniverses();

  const handleStorySelect = (story) => {
    setSelectedStory(story);
    if (onSelectStory) {
      onSelectStory(story);
    }
  };

  if (selectedStory) {
    return (
      <InsertionPointSelector
        story={selectedStory}
        onBack={() => setSelectedStory(null)}
        onSelectPoint={(point) => {
          if (onSelectStory) {
            onSelectStory(selectedStory, point);
          }
        }}
      />
    );
  }

  if (selectedUniverse) {
    const stories = getStoryByUniverse(selectedUniverse);
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <button
          onClick={() => setSelectedUniverse(null)}
          className="text-[9px] font-mono text-primary/40 hover:text-primary tracking-widest uppercase transition-colors mb-4"
        >
          ← Back to Universes
        </button>

        <div className="space-y-3">
          {stories.map((story) => (
            <motion.button
              key={story.id}
              onClick={() => handleStorySelect(story)}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="w-full text-left p-4 border border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5 transition-all rounded"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
                    {story.title}
                  </h3>
                  {story.book && (
                    <p className="text-[9px] text-primary/40 mt-1">
                      Book: {story.book}
                    </p>
                  )}
                  {story.season && (
                    <p className="text-[9px] text-primary/40 mt-1">
                      Season: {story.season}
                    </p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-primary/30 flex-shrink-0 mt-1" />
              </div>
              <p className="text-[9px] text-primary/60 line-clamp-2">
                {story.description}
              </p>
              <div className="flex items-center gap-3 mt-2 text-[8px] text-primary/40">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {story.year || "N/A"}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" /> {story.characters.length} characters
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="w-4 h-4 text-primary/60" />
        <h2 className="font-mono text-sm text-primary tracking-wider uppercase">
          Canonical Story Universes
        </h2>
      </div>

      <p className="text-[9px] text-primary/40 mb-4">
        Select a universe to join its plot-aligned story. Enter at key narrative moments.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {universes.map((universe) => {
          const storyCount = getStoryByUniverse(universe).length;
          return (
            <motion.button
              key={universe}
              onClick={() => setSelectedUniverse(universe)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 border border-primary/20 bg-black/60 hover:border-primary/40 hover:bg-primary/10 transition-all rounded text-left group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-mono text-sm text-primary tracking-wider uppercase group-hover:glow-text transition-all">
                  {universe}
                </h3>
                <ChevronRight className="w-4 h-4 text-primary/30 group-hover:text-primary/60 transition-colors" />
              </div>
              <p className="text-[9px] text-primary/40">
                {storyCount} story{storyCount !== 1 ? "ies" : ""}
              </p>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}

function InsertionPointSelector({ story, onBack, onSelectPoint }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <button
        onClick={onBack}
        className="text-[9px] font-mono text-primary/40 hover:text-primary tracking-widest uppercase transition-colors mb-4"
      >
        ← Back to {story.universe}
      </button>

      <div className="p-4 border border-primary/20 bg-primary/5 rounded space-y-2 mb-4">
        <h2 className="font-mono text-lg text-primary tracking-wider uppercase">
          {story.title}
        </h2>
        <p className="text-[9px] text-primary/60">{story.description}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {story.characters.slice(0, 5).map((char) => (
            <span
              key={char}
              className="px-2 py-1 bg-primary/10 border border-primary/20 rounded text-[8px] text-primary/70"
            >
              {char}
            </span>
          ))}
          {story.characters.length > 5 && (
            <span className="px-2 py-1 text-[8px] text-primary/40">
              +{story.characters.length - 5} more
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-3">
          Choose where to enter the story
        </p>
        {story.insertionPoints.map((point) => (
          <motion.button
            key={point.id}
            onClick={() => onSelectPoint(point)}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-full text-left p-4 border border-primary/25 bg-black/40 hover:border-primary/50 hover:bg-primary/5 transition-all rounded space-y-2"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
                  {point.title}
                </h3>
                <p className="text-[8px] text-primary/40 mt-1">{point.chapter}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-primary/30 flex-shrink-0 mt-1" />
            </div>
            <p className="text-[9px] text-primary/60">{point.narrative}</p>
            <p className="text-[8px] font-mono text-primary/30">{point.setting}</p>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}