import { useState } from "react";
import { Loader, ChevronDown, AlertCircle, TrendingUp, Users, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function AIInsightsPanel({ insights, loading, onAnalyzeNow }) {
  const [expanded, setExpanded] = useState(false);

  if (!insights && !loading) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-purple-400/30 bg-purple-400/5 rounded"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-purple-400/10 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {loading ? (
            <Loader className="w-4 h-4 text-purple-400 animate-spin flex-shrink-0" />
          ) : (
            <Zap className="w-4 h-4 text-purple-400 flex-shrink-0" />
          )}
          <h3 className="font-mono text-xs sm:text-sm text-purple-400 tracking-[0.15em] uppercase font-semibold">
            AI Insights
          </h3>
          {insights && !loading && (
            <span className="text-[8px] font-mono text-purple-400/60 ml-auto hidden sm:inline">
              {insights.analysis_timestamp
                ? new Date(insights.analysis_timestamp).toLocaleTimeString()
                : "Just now"}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-purple-400 transition-transform flex-shrink-0 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-purple-400/20 px-3 sm:px-4 py-3 space-y-3 bg-black/40"
          >
            {loading ? (
              <div className="text-center py-4">
                <p className="font-mono text-[9px] text-purple-400/60 tracking-widest uppercase">
                  Analyzing conversation...
                </p>
              </div>
            ) : (
              <>
                {/* Character Themes */}
                {insights.character_themes && insights.character_themes.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-3 h-3 text-cyan-400" />
                      <p className="font-mono text-[9px] text-purple-400/60 tracking-widest uppercase">
                        Character Themes
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {insights.character_themes.map((theme, idx) => (
                        <div key={idx} className="p-2 border border-cyan-400/20 bg-cyan-400/5 rounded">
                          <p className="font-mono text-[9px] text-cyan-400 font-semibold mb-0.5">
                            {theme.character}
                          </p>
                          <p className="font-mono text-[8px] text-cyan-400/70 leading-relaxed">
                            {theme.theme}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Plot Issues */}
                {insights.plot_issues && insights.plot_issues.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-3 h-3 text-yellow-400" />
                      <p className="font-mono text-[9px] text-purple-400/60 tracking-widest uppercase">
                        Plot Notes
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {insights.plot_issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className={`p-2 border rounded ${
                            issue.severity === "high"
                              ? "border-red-400/30 bg-red-400/5"
                              : "border-yellow-400/20 bg-yellow-400/5"
                          }`}
                        >
                          <p className="font-mono text-[8px] text-yellow-400/80">
                            {issue.issue}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Evolution Trends */}
                {insights.character_evolution && insights.character_evolution.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-3 h-3 text-green-400" />
                      <p className="font-mono text-[9px] text-purple-400/60 tracking-widest uppercase">
                        Evolution Trends
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {insights.character_evolution.map((evolution, idx) => (
                        <div key={idx} className="p-2 border border-green-400/20 bg-green-400/5 rounded">
                          <p className="font-mono text-[9px] text-green-400 font-semibold mb-0.5">
                            {evolution.character}
                          </p>
                          <p className="font-mono text-[8px] text-green-400/70 leading-relaxed">
                            {evolution.arc}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Analysis Summary */}
                {insights.summary && (
                  <div className="p-2 border border-purple-400/20 bg-purple-400/5 rounded mt-2">
                    <p className="font-mono text-[8px] text-purple-400/70 leading-relaxed">
                      {insights.summary}
                    </p>
                  </div>
                )}

                {/* Re-analyze Button */}
                <button
                  onClick={onAnalyzeNow}
                  disabled={loading}
                  className="w-full mt-2 px-3 py-1.5 border border-purple-400/30 text-purple-400/70 hover:text-purple-400 hover:border-purple-400/60 disabled:opacity-50 font-mono text-[8px] tracking-widest uppercase transition-all"
                >
                  Analyze Now
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}