import { useState } from "react";
import { ChevronRight, ChevronDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function DialogueTreeVisualizer({ choices, sessionMessages, onSelectChoice }) {
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [showTree, setShowTree] = useState(false);

  if (!choices || choices.length === 0) {
    return null;
  }

  const togglePath = (idx) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(idx)) {
      newExpanded.delete(idx);
    } else {
      newExpanded.add(idx);
    }
    setExpandedPaths(newExpanded);
  };

  return (
    <div className="space-y-3 mb-4">
      {/* Visualizer Toggle */}
      <button
        onClick={() => setShowTree(!showTree)}
        className="w-full flex items-center justify-between px-3 py-2 border border-primary/20 hover:border-primary/40 bg-black/30 hover:bg-primary/5 rounded transition-all"
      >
        <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
          🌳 Dialogue Tree ({choices.length} paths)
        </span>
        <ChevronDown
          className={`w-4 h-4 text-primary/40 transition-transform ${
            showTree ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Tree Modal */}
      <AnimatePresence>
        {showTree && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              className="w-full max-w-3xl max-h-[80vh] bg-background border border-primary/30 rounded-lg overflow-hidden flex flex-col"
              layout
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-primary/20 bg-black/60 flex-shrink-0">
                <h3 className="font-mono text-sm text-primary tracking-[0.2em] uppercase">
                  Narrative Branches
                </h3>
                <button
                  onClick={() => setShowTree(false)}
                  className="text-primary/30 hover:text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tree Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {choices.map((choice, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="space-y-1"
                  >
                    {/* Choice Button */}
                    <button
                      onClick={() => togglePath(idx)}
                      className="w-full text-left p-3 border border-primary/15 hover:border-primary/40 bg-black/30 hover:bg-primary/5 rounded transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-[10px] text-primary/80 tracking-wider leading-relaxed">
                            {choice.text}
                          </p>
                          {choice.consequence && (
                            <p className="text-[9px] text-primary/40 mt-1">
                              → {choice.consequence}
                            </p>
                          )}
                        </div>
                        <ChevronRight
                          className={`w-4 h-4 text-primary/40 flex-shrink-0 transition-transform ${
                            expandedPaths.has(idx) ? "rotate-90" : ""
                          }`}
                        />
                      </div>
                    </button>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {expandedPaths.has(idx) && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="ml-4 pl-4 border-l border-primary/20 space-y-2"
                        >
                          {/* Impact */}
                          {choice.impact && (
                            <div className="p-2 bg-black/40 rounded border border-primary/10">
                              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                                Impact
                              </p>
                              <p className="text-[9px] text-primary/70">{choice.impact}</p>
                            </div>
                          )}

                          {/* Tags */}
                          {choice.tags && choice.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {choice.tags.map((tag, tagIdx) => (
                                <span
                                  key={tagIdx}
                                  className="px-2 py-1 bg-primary/10 border border-primary/20 rounded text-[8px] font-mono text-primary/60"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Select Button */}
                          <button
                            onClick={() => {
                              onSelectChoice(choice);
                              setShowTree(false);
                            }}
                            className="w-full mt-2 px-3 py-1.5 bg-primary/15 border border-primary/30 text-primary/80 hover:bg-primary/25 font-mono text-[9px] tracking-widest uppercase rounded transition-all"
                          >
                            Choose This Path
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}