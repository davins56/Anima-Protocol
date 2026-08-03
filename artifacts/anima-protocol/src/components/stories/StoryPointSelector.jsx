import { useState } from "react";
import { ChevronLeft, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function StoryPointSelector({ story, onSelectPoints, onBack }) {
  const [selectedPoints, setSelectedPoints] = useState(new Set());
  const [multiSelect, setMultiSelect] = useState(false);

  const togglePoint = (pointId) => {
    const newSelected = new Set(selectedPoints);
    if (newSelected.has(pointId)) {
      newSelected.delete(pointId);
    } else {
      if (!multiSelect) {
        newSelected.clear();
      }
      newSelected.add(pointId);
    }
    setSelectedPoints(newSelected);
  };

  const handleConfirm = () => {
    const points = story.insertionPoints.filter((p) =>
      selectedPoints.has(p.id)
    );
    onSelectPoints(points);
  };

  const availablePoints = story.insertionPoints || [];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[9px] font-mono text-primary/40 hover:text-primary tracking-widest uppercase transition-colors mb-4"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Story Selection
          </button>
          <h2 className="font-mono text-lg text-primary tracking-wider uppercase glow-text">
            {story.title}
          </h2>
          <p className="text-[9px] font-mono text-primary/40 mt-1 tracking-widest">
            {availablePoints.length} story point{availablePoints.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setMultiSelect(!multiSelect)}
          className={`px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all ${
            multiSelect
              ? "bg-primary/10 border-primary/40 text-primary"
              : "border-primary/20 text-primary/40 hover:text-primary/60"
          }`}
        >
          {multiSelect ? "✓ Multi" : "Single"}
        </button>
      </div>

      {/* Story Info */}
      {story.description && (
        <p className="text-[9px] font-mono text-primary/60 leading-relaxed p-3 border border-primary/15 bg-black/40 rounded">
          {story.description}
        </p>
      )}

      {/* Story Points Grid */}
      <div className="space-y-2">
        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
          Select Entry Point{multiSelect ? "s" : ""}
        </p>
        <div className="grid gap-2">
          {availablePoints.map((point) => {
            const isSelected = selectedPoints.has(point.id);
            return (
              <motion.button
                key={point.id}
                onClick={() => togglePoint(point.id)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`relative p-4 border rounded text-left transition-all ${
                  isSelected
                    ? "border-primary/50 bg-primary/10"
                    : "border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3 w-5 h-5 bg-primary flex items-center justify-center rounded">
                    <Check className="w-3 h-3 text-background" />
                  </div>
                )}

                <div className="pr-6">
                  <h3 className="font-mono text-[10px] text-primary tracking-wider uppercase mb-1">
                    {point.title}
                  </h3>
                  {point.chapter && (
                    <p className="text-[8px] text-primary/40 mb-1">{point.chapter}</p>
                  )}
                  <p className="text-[9px] text-primary/60 line-clamp-2">
                    {point.narrative}
                  </p>
                  {point.setting && (
                    <p className="text-[8px] text-primary/40 mt-2">
                      📍 {point.setting}
                    </p>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Confirm Button */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-xs tracking-widest uppercase transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={selectedPoints.size === 0}
          className="flex-1 px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
        >
          Continue ({selectedPoints.size} selected)
        </button>
      </div>
    </motion.div>
  );
}