import { useState, useEffect } from 'react';
import { ChevronDown, GitBranch, Zap, TrendingUp, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

export default function WhatIfBranchExplorer({ sessionId, characterId, characterName, recentMessages }) {
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    if (!sessionId || !characterId || !recentMessages?.length) return;
    generateBranches();
  }, [sessionId, characterId, recentMessages]);

  const generateBranches = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('predictNarrativeBranches', {
        session_id: sessionId,
        character_id: characterId,
        character_name: characterName,
        recent_messages: recentMessages.slice(-8),
        num_branches: 3,
      });
      
      if (result?.data?.branches) {
        setBranches(result.data.branches);
        if (result.data.branches.length > 0) {
          setSelectedBranch(result.data.branches[0]);
        }
      }
    } catch (err) {
      console.error('Branch prediction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPrompt = (branchId, prompt) => {
    navigator.clipboard.writeText(prompt);
    setCopied(branchId);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleExpanded = (branchId) => {
    setExpanded(prev => ({
      ...prev,
      [branchId]: !prev[branchId]
    }));
  };

  if (loading) {
    return (
      <div className="p-3 border border-cyan-400/20 bg-cyan-900/10 rounded animate-pulse">
        <p className="text-[9px] font-mono text-cyan-400/50 tracking-widest uppercase">Predicting branches...</p>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <button
        onClick={generateBranches}
        className="w-full px-3 py-2 border border-cyan-400/20 text-cyan-400/60 hover:text-cyan-400 hover:border-cyan-400/40 font-mono text-[9px] tracking-widest uppercase transition-all rounded"
      >
        <GitBranch className="w-3 h-3 inline mr-1" />
        Explore Narrative Branches
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-cyan-400/20 bg-cyan-900/10 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-cyan-400/15 bg-cyan-900/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">
            What If Branches ({branches.length})
          </span>
        </div>
        <button
          onClick={generateBranches}
          className="text-cyan-400/50 hover:text-cyan-400 transition-colors"
          title="Regenerate branches"
        >
          <Zap className="w-3 h-3" />
        </button>
      </div>

      {/* Branches List */}
      <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
        {branches.map((branch, idx) => {
          const isSelected = selectedBranch?.id === branch.id;
          const isExpanded = expanded[branch.id];
          
          return (
            <motion.div
              key={branch.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`border rounded p-2.5 transition-all cursor-pointer ${
                isSelected
                  ? 'border-cyan-400/50 bg-cyan-400/10'
                  : 'border-cyan-400/15 bg-black/30 hover:border-cyan-400/30'
              }`}
              onClick={() => setSelectedBranch(branch)}
            >
              {/* Branch Title & Divergence */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-[9px] font-mono font-semibold text-cyan-300 truncate">
                    Path {idx + 1}: {branch.title}
                  </h4>
                  <p className="text-[8px] font-mono text-cyan-400/60 mt-0.5 line-clamp-1">
                    {branch.divergence_point}
                  </p>
                </div>
                {branch.divergence_probability && (
                  <span className="text-[7px] font-mono px-1.5 py-0.5 bg-cyan-400/20 text-cyan-300 rounded flex-shrink-0">
                    {Math.round(branch.divergence_probability * 100)}%
                  </span>
                )}
              </div>

              {/* Impact Summary */}
              {branch.predicted_impact && (
                <div className="mt-1.5 pt-1.5 border-t border-cyan-400/10 space-y-1">
                  <div className="flex items-center gap-1.5 text-[8px] font-mono">
                    <TrendingUp className="w-2.5 h-2.5 text-yellow-400/70" />
                    <span className="text-cyan-400/70">{branch.predicted_impact}</span>
                  </div>
                </div>
              )}

              {/* Expand Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(branch.id);
                }}
                className="mt-1.5 w-full flex items-center justify-between px-2 py-1 border border-cyan-400/10 hover:border-cyan-400/30 bg-black/50 rounded text-[8px] font-mono text-cyan-400/60 hover:text-cyan-400 transition-all"
              >
                <span>{isExpanded ? 'Hide' : 'Show'} Details</span>
                <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded Details */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2 pt-2 border-t border-cyan-400/10 space-y-1.5"
                  >
                    {/* Outcome */}
                    {branch.outcome && (
                      <div>
                        <p className="text-[7px] font-mono text-cyan-400/50 tracking-widest uppercase mb-0.5">Outcome</p>
                        <p className="text-[8px] font-mono text-cyan-300/80 leading-relaxed">
                          {branch.outcome}
                        </p>
                      </div>
                    )}

                    {/* World State Changes */}
                    {branch.world_state_changes?.length > 0 && (
                      <div>
                        <p className="text-[7px] font-mono text-cyan-400/50 tracking-widest uppercase mb-0.5">
                          World Impact
                        </p>
                        <div className="space-y-0.5">
                          {branch.world_state_changes.slice(0, 3).map((change, i) => (
                            <div key={i} className="text-[8px] font-mono text-cyan-300/70 flex gap-1">
                              <span className="text-cyan-400/50">•</span>
                              <span>{change}</span>
                            </div>
                          ))}
                          {branch.world_state_changes.length > 3 && (
                            <p className="text-[7px] font-mono text-cyan-400/40">
                              +{branch.world_state_changes.length - 3} more changes
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Action Prompt */}
                    {branch.action_prompt && (
                      <div>
                        <p className="text-[7px] font-mono text-cyan-400/50 tracking-widest uppercase mb-0.5">
                          Next Action
                        </p>
                        <div className="relative p-1.5 border border-cyan-400/15 bg-black/50 rounded group">
                          <p className="text-[8px] font-mono text-cyan-300/80 pr-6">
                            {branch.action_prompt}
                          </p>
                          <button
                            onClick={() => handleCopyPrompt(branch.id, branch.action_prompt)}
                            className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 bg-cyan-400/20 hover:bg-cyan-400/40 rounded transition-all"
                            title="Copy prompt"
                          >
                            {copied === branch.id ? (
                              <Check className="w-2.5 h-2.5 text-green-400" />
                            ) : (
                              <Copy className="w-2.5 h-2.5 text-cyan-400" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Selected Branch Preview */}
      {selectedBranch && (
        <div className="px-3 py-2 border-t border-cyan-400/10 bg-black/30 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-mono text-cyan-400/60 tracking-widest uppercase">Selected Path</span>
            <span className="text-[8px] font-mono text-cyan-400 bg-cyan-400/20 px-2 py-0.5 rounded">
              {selectedBranch.title}
            </span>
          </div>
          {selectedBranch.long_term_impact && (
            <p className="text-[8px] font-mono text-cyan-300/80 leading-relaxed">
              <strong className="text-cyan-400">Long-term:</strong> {selectedBranch.long_term_impact}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}