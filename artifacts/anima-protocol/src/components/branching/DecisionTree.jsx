import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Lock, CheckCircle, GitBranch, Zap } from 'lucide-react';

export default function DecisionTree({
  sessionId,
  lastUserChoice,
  recentMessages,
  characterEmotions,
  relationships,
  isVisible = true,
}) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedBranchId, setExpandedBranchId] = useState(null);
  const [discoveredPaths, setDiscoveredPaths] = useState(new Set());

  useEffect(() => {
    if (!sessionId || !lastUserChoice) return;
    predictBranches();
  }, [sessionId, lastUserChoice]);

  const predictBranches = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('predictNarrativeBranches', {
        session_id: sessionId,
        last_user_choice: lastUserChoice,
        recent_messages: recentMessages.slice(-5),
        character_emotions: characterEmotions,
        relationships,
      });

      if (result?.data?.branches) {
        setBranches(result.data.branches);
      }
    } catch (err) {
      console.error('Error predicting branches:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isVisible || branches.length === 0) return null;

  const availableBranches = branches.filter(b => b.status === 'available');
  const lockedBranches = branches.filter(b => b.status === 'locked');

  const getImpactColor = (impact) => {
    if (impact >= 8) return 'text-red-400';
    if (impact >= 5) return 'text-yellow-400';
    return 'text-cyan-400';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-primary/20 bg-black/40 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary/60" />
            <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
              Narrative Decision Tree
            </span>
          </div>
          <div className="flex items-center gap-2 text-[8px] font-mono">
            <span className="text-cyan-400">{availableBranches.length} available</span>
            {lockedBranches.length > 0 && (
              <>
                <span className="text-primary/30">•</span>
                <span className="text-primary/50">{lockedBranches.length} locked</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Decision Point */}
      <div className="px-4 py-2 border-b border-primary/10 bg-black/60">
        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">Last Choice</p>
        <p className="text-[9px] font-mono text-primary/70 italic line-clamp-2">"{lastUserChoice}"</p>
      </div>

      {/* Branch Visualization */}
      <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
        {loading ? (
          <div className="text-center py-6">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
            <p className="font-mono text-[8px] text-primary/30 tracking-widest uppercase">Predicting branches...</p>
          </div>
        ) : (
          <>
            {/* Available Branches */}
            {availableBranches.length > 0 && (
              <div className="space-y-2">
                {availableBranches.map((branch) => (
                  <motion.button
                    key={branch.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    onClick={() => setExpandedBranchId(expandedBranchId === branch.id ? null : branch.id)}
                    className="w-full text-left border border-primary/25 bg-black/60 hover:border-primary/40 hover:bg-primary/10 rounded p-3 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                          <p className="font-mono text-[10px] text-primary/80 tracking-wider uppercase">
                            {branch.name}
                          </p>
                        </div>
                        {branch.description && (
                          <p className="text-[8px] text-primary/60 line-clamp-2">{branch.description}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <div className="text-right">
                          <p className={`text-[8px] font-mono ${getImpactColor(branch.impact_level)}`}>
                            Impact: {branch.impact_level}/10
                          </p>
                          <p className="text-[8px] font-mono text-primary/50">
                            {Math.round(branch.probability * 100)}% likely
                          </p>
                        </div>
                        <ChevronDown
                          className={`w-3 h-3 text-primary/40 transition-transform ${
                            expandedBranchId === branch.id ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {expandedBranchId === branch.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 pt-2 border-t border-primary/10 space-y-2"
                        >
                          {/* Consequences */}
                          <div>
                            <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                              Consequences
                            </p>
                            <ul className="space-y-0.5">
                              {(branch.consequences || []).map((consequence, idx) => (
                                <li key={idx} className="text-[8px] font-mono text-primary/70">
                                  <span className="text-primary/40">• </span>{consequence}
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Affected Characters */}
                          {branch.affected_characters?.length > 0 && (
                            <div>
                              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                                Affected Characters
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {branch.affected_characters.map((char, idx) => (
                                  <span key={idx} className="px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded text-[7px] font-mono text-primary/70">
                                    {char}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                ))}
              </div>
            )}

            {/* Locked Branches */}
            {lockedBranches.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-primary/10">
                <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">Locked Paths</p>
                {lockedBranches.map((branch) => (
                  <motion.div
                    key={branch.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="border border-primary/15 bg-black/80 rounded p-3 opacity-60 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-primary/40 flex-shrink-0" />
                        <p className="font-mono text-[10px] text-primary/60 tracking-wider uppercase">
                          {branch.name}
                        </p>
                      </div>
                      <span className={`text-[8px] font-mono ${getImpactColor(branch.impact_level)}`}>
                        Impact: {branch.impact_level}/10
                      </span>
                    </div>

                    {/* Unlock Requirements */}
                    {branch.prerequisites?.length > 0 && (
                      <div>
                        <p className="text-[7px] font-mono text-primary/30 tracking-widest uppercase">Requirements</p>
                        <ul className="space-y-0.5 mt-1">
                          {branch.prerequisites.map((req, idx) => (
                            <li key={idx} className="text-[8px] font-mono text-primary/40">
                              <span className="text-primary/20">◦ </span>{req}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Stats Footer */}
      {!loading && branches.length > 0 && (
        <div className="px-4 py-2 border-t border-primary/10 bg-primary/5 text-[8px] font-mono text-primary/50 space-y-1">
          <div className="flex items-center justify-between">
            <span>Total narrative paths predicted:</span>
            <span className="text-primary/70">{branches.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Average impact:</span>
            <span className="text-primary/70">
              {(branches.reduce((sum, b) => sum + b.impact_level, 0) / branches.length).toFixed(1)}/10
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}