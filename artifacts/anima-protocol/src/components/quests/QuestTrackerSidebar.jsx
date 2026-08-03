import { useState, useEffect } from 'react';
import { ChevronDown, CheckCircle2, Circle, Zap, Gift, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

const statusConfig = {
  available: { icon: Circle, color: 'text-primary/50', label: 'Available' },
  active: { icon: Zap, color: 'text-yellow-400', label: 'Active' },
  completed: { icon: CheckCircle2, color: 'text-green-400', label: 'Completed' },
  failed: { icon: AlertCircle, color: 'text-red-400', label: 'Failed' },
};

export default function QuestTrackerSidebar({ 
  sessionId, 
  characterId, 
  recentMessages = [],
  isVisible = true,
  onQuestUpdate 
}) {
  const [detectedQuests, setDetectedQuests] = useState([]);
  const [expandedQuestId, setExpandedQuestId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Detect quests from recent narrative
  useEffect(() => {
    if (!sessionId || !recentMessages?.length || recentMessages.length < 3) return;

    const detectQuests = async () => {
      setLoading(true);
      try {
        const result = await base44.functions.invoke('detectQuestsFromNarrative', {
          session_id: sessionId,
          character_id: characterId,
          recent_messages: recentMessages.slice(-8),
        });

        if (result?.data?.quests?.length > 0) {
          setDetectedQuests(prev => {
            const newQuests = result.data.quests;
            const merged = [...prev];
            
            newQuests.forEach(newQ => {
              const existing = merged.findIndex(q => q.id === newQ.id);
              if (existing >= 0) {
                merged[existing] = newQ;
              } else {
                merged.push(newQ);
              }
            });
            
            return merged;
          });
          
          onQuestUpdate?.(result.data.quests);
        }
      } catch (err) {
        console.error('Quest detection failed:', err);
      } finally {
        setLoading(false);
      }
    };

    // Debounce detection - only check every few messages
    const timer = setTimeout(detectQuests, 1000);
    return () => clearTimeout(timer);
  }, [sessionId, characterId, recentMessages, onQuestUpdate]);

  if (!isVisible || detectedQuests.length === 0) return null;

  const activeCount = detectedQuests.filter(q => q.status === 'active').length;
  const completedCount = detectedQuests.filter(q => q.status === 'completed').length;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="border-r border-primary/20 bg-black/40 h-full overflow-hidden flex flex-col"
      style={{ width: collapsed ? '50px' : '280px', transition: 'width 0.3s ease' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/15 bg-black/60 flex-shrink-0">
        <AnimatePresence mode="wait">
          {!collapsed ? (
            <motion.div
              key="header"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 min-w-0"
            >
              <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase truncate">
                Quests
              </h3>
              <p className="text-[8px] text-primary/30 mt-0.5">
                {activeCount} active • {completedCount} done
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-primary/40 hover:text-primary/60 transition-colors flex-shrink-0"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        </button>
      </div>

      {/* Quest List */}
      <div className="flex-1 overflow-y-auto space-y-1 px-2 py-2">
        <AnimatePresence mode="popLayout">
          {detectedQuests.map((quest, idx) => {
            const cfg = statusConfig[quest.status] || statusConfig.available;
            const IconComponent = cfg.icon;
            const isExpanded = expandedQuestId === quest.id;
            const totalObjectives = quest.objectives?.length || 0;
            const completedObjectives = quest.objectives?.filter(o => o.completed)?.length || 0;
            const progress = totalObjectives > 0 ? (completedObjectives / totalObjectives) * 100 : 0;

            return (
              <motion.div
                key={quest.id || idx}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`border border-primary/15 rounded overflow-hidden transition-all ${
                  isExpanded
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-black/50 hover:bg-black/70 cursor-pointer'
                }`}
                onClick={() => !collapsed && setExpandedQuestId(isExpanded ? null : quest.id)}
              >
                {/* Quest Header */}
                <div className="p-2 flex items-start gap-2">
                  <IconComponent className={`w-3.5 h-3.5 ${cfg.color} flex-shrink-0 mt-0.5`} />
                  {!collapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-mono text-primary/80 font-semibold truncate">
                        {quest.title || 'Untitled Quest'}
                      </p>
                      <p className={`text-[8px] font-mono ${cfg.color} tracking-widest uppercase mt-0.5`}>
                        {cfg.label}
                      </p>
                    </div>
                  )}
                </div>

                {/* Progress Bar */}
                {!collapsed && totalObjectives > 0 && (
                  <div className="px-2 pb-2">
                    <div className="w-full h-1.5 bg-black/60 rounded overflow-hidden border border-primary/10">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 to-primary transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-[7px] text-primary/40 mt-1">
                      {completedObjectives}/{totalObjectives} objectives
                    </p>
                  </div>
                )}

                {/* Expanded Details */}
                <AnimatePresence>
                  {isExpanded && !collapsed && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-primary/10 bg-black/80 p-2 space-y-2"
                    >
                      {/* Description */}
                      {quest.description && (
                        <p className="text-[8px] text-primary/70 leading-relaxed">
                          {quest.description}
                        </p>
                      )}

                      {/* Objectives */}
                      {quest.objectives?.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[7px] text-primary/40 tracking-widest uppercase">Objectives</p>
                          {quest.objectives.map((obj, oi) => (
                            <div key={oi} className="flex items-start gap-1.5 text-[8px]">
                              {obj.completed ? (
                                <CheckCircle2 className="w-2.5 h-2.5 text-green-400 flex-shrink-0 mt-0.5" />
                              ) : (
                                <Circle className="w-2.5 h-2.5 text-primary/30 flex-shrink-0 mt-0.5" />
                              )}
                              <span className={obj.completed ? 'text-primary/40 line-through' : 'text-primary/70'}>
                                {obj.description}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Rewards */}
                      {quest.rewards && (
                        <div className="border-t border-primary/10 pt-2 space-y-1">
                          <div className="flex items-center gap-1.5 text-[8px] text-primary/60">
                            <Gift className="w-3 h-3 text-yellow-400" />
                            <span className="tracking-widest uppercase">Rewards</span>
                          </div>
                          {quest.rewards.xp > 0 && (
                            <p className="text-[8px] text-cyan-400">+{quest.rewards.xp} XP</p>
                          )}
                          {quest.rewards.items?.length > 0 && (
                            <div className="text-[8px] space-y-0.5">
                              {quest.rewards.items.map((item, ii) => (
                                <p key={ii} className="text-primary/60">• {item}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {loading && (
          <div className="text-center py-4 text-[8px] font-mono text-primary/30 animate-pulse">
            Detecting quests...
          </div>
        )}
      </div>
    </motion.div>
  );
}