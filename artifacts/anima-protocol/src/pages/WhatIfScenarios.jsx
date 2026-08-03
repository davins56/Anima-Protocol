import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GitBranch, ArrowLeft, Send, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import WhatIfBranchExplorer from '@/components/whatif/WhatIfBranchExplorer';
import WorldStateImpactViewer from '@/components/whatif/WorldStateImpactViewer';

export default function WhatIfScenarios() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareBranch, setCompareBranch] = useState(null);
  const [loadingSession, setLoadingSession] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const data = await base44.entities.ChatSession.list('-updated_date', 50);
      setSessions(data || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  };

  const handleSelectSession = async (session) => {
    setSelectedSession(session);
    setSelectedBranch(null);
    setCompareMode(false);
  };

  const handleSelectBranch = (branch) => {
    setSelectedBranch(branch);
    if (!compareMode) {
      setCompareBranch(null);
    }
  };

  const handleUseBranch = async (branch) => {
    if (!selectedSession) return;

    // Navigate to session and inject the branch's action prompt
    navigate(`/chat/${selectedSession.id}`);
    
    // Store the action prompt for the chat to use
    sessionStorage.setItem('whatif_action_prompt', branch.action_prompt || branch.title);
  };

  return (
    <div className="min-h-[100dvh] bg-background p-3 sm:p-6 space-y-6 pb-safe">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-primary/10 rounded transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-primary/60" />
          </button>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-xl">
              What If Explorer
            </h1>
            <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest uppercase">
              Predict and explore narrative branches
            </p>
          </div>
        </div>
        <GitBranch className="w-6 h-6 text-primary/40" />
      </div>

      {/* Session Selector */}
      {!selectedSession ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          {sessions.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <p className="font-mono text-primary/30 text-sm tracking-widest uppercase">
                No sessions found
              </p>
              <button
                onClick={() => navigate('/')}
                className="mt-4 px-4 py-2 border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/50 font-mono text-[9px] tracking-widest uppercase transition-all"
              >
                Create a new session
              </button>
            </div>
          ) : (
            sessions.map((session) => (
              <motion.button
                key={session.id}
                onClick={() => handleSelectSession(session)}
                whileHover={{ scale: 1.02 }}
                className="p-4 border border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5 rounded transition-all text-left group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-mono text-primary text-[9px] tracking-widest uppercase truncate">
                    {session.title || 'Untitled Session'}
                  </p>
                  <GitBranch className="w-3 h-3 text-primary/40 group-hover:text-primary/60 flex-shrink-0 transition-colors" />
                </div>
                <p className="text-[8px] font-mono text-primary/40">
                  {session.messages?.length || 0} messages
                </p>
                {session.last_message && (
                  <p className="text-[8px] font-mono text-primary/30 mt-2 line-clamp-1">
                    {session.last_message}
                  </p>
                )}
              </motion.button>
            ))
          )}
        </motion.div>
      ) : (
        <div className="space-y-4">
          {/* Session Header */}
          <div className="flex items-center justify-between p-4 border border-primary/20 bg-primary/5 rounded">
            <div>
              <p className="font-mono text-[10px] text-primary/50 tracking-widest uppercase">
                Analyzing Session
              </p>
              <h2 className="font-mono text-primary text-lg tracking-wider mt-1">
                {selectedSession.title || 'Untitled'}
              </h2>
            </div>
            <button
              onClick={() => {
                setSelectedSession(null);
                setSelectedBranch(null);
              }}
              className="px-4 py-2 border border-primary/30 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              Back
            </button>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Branch Explorer */}
            <div className="lg:col-span-1">
              <WhatIfBranchExplorer
                sessionId={selectedSession.id}
                characterId={selectedSession.character_id}
                characterName={
                  selectedSession.character_id
                    ? selectedSession.title?.split(' ')[0]
                    : 'Character'
                }
                recentMessages={selectedSession.messages?.slice(-10) || []}
              />
            </div>

            {/* Impact Visualization */}
            <div className="lg:col-span-2 space-y-4">
              {selectedBranch ? (
                <>
                  {/* World State Impact */}
                  <WorldStateImpactViewer
                    branch={selectedBranch}
                    compareWith={compareMode ? compareBranch : null}
                  />

                  {/* Branch Action Card */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 border border-cyan-400/30 bg-cyan-900/10 rounded space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">
                        Branch Preview
                      </h3>
                      <button
                        onClick={() => setCompareMode(!compareMode)}
                        className={`px-2 py-1 text-[8px] font-mono tracking-widest uppercase border rounded transition-all ${
                          compareMode
                            ? 'border-yellow-400/40 bg-yellow-400/10 text-yellow-400'
                            : 'border-primary/20 text-primary/40 hover:text-primary/70'
                        }`}
                      >
                        {compareMode ? <Eye className="w-2.5 h-2.5 inline mr-1" /> : <EyeOff className="w-2.5 h-2.5 inline mr-1" />}
                        Compare
                      </button>
                    </div>

                    {/* Title & Description */}
                    <div className="space-y-2">
                      <p className="font-mono text-[9px] text-cyan-300 font-semibold">
                        {selectedBranch.title}
                      </p>
                      {selectedBranch.outcome && (
                        <p className="text-[8px] font-mono text-cyan-300/80 leading-relaxed">
                          {selectedBranch.outcome}
                        </p>
                      )}
                      {selectedBranch.long_term_impact && (
                        <div className="pt-2 border-t border-cyan-400/10">
                          <p className="text-[8px] font-mono text-cyan-400/70 mb-1">
                            <strong>Long-term Impact:</strong>
                          </p>
                          <p className="text-[8px] font-mono text-cyan-300/70">
                            {selectedBranch.long_term_impact}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Use Branch Button */}
                    <button
                      onClick={() => handleUseBranch(selectedBranch)}
                      className="w-full px-4 py-2 bg-cyan-400/20 border border-cyan-400/40 text-cyan-400 hover:bg-cyan-400/30 font-mono text-[9px] tracking-widest uppercase transition-all rounded flex items-center justify-center gap-2 group"
                    >
                      <Send className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                      Use This Branch
                    </button>
                  </motion.div>

                  {/* Comparison Mode */}
                  {compareMode && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 border border-yellow-400/20 bg-yellow-900/10 rounded space-y-3"
                    >
                      <p className="text-[9px] font-mono text-yellow-400 tracking-widest uppercase">
                        Select another branch to compare
                      </p>
                    </motion.div>
                  )}
                </>
              ) : (
                <div className="p-6 border border-primary/10 bg-black/20 rounded text-center">
                  <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">
                    Select a branch above to view impact analysis
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}