import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, Circle, AlertCircle, TrendingUp, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import QuestProgressCard from '@/components/quests/QuestProgressCard';
import MilestoneDetector from '@/components/quests/MilestoneDetector';
import QuestStatistics from '@/components/quests/QuestStatistics';

export default function QuestTrackingDashboard() {
  const { sessionId } = useParams();
  const [activeQuests, setActiveQuests] = useState([]);
  const [completedQuests, setCompletedQuests] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (sessionId) {
      loadQuestData();
      const interval = setInterval(loadQuestData, 3000); // Auto-update every 3s
      return () => clearInterval(interval);
    }
  }, [sessionId]);

  const loadQuestData = async () => {
    try {
      const [quests, stats, sess] = await Promise.all([
        base44.entities.Quest.filter({ session_id: sessionId }, '-updated_date', 100),
        base44.functions.invoke('generateQuestStatistics', {
          session_id: sessionId,
        }),
        base44.entities.ChatSession.list().then(s => s.find(x => x.id === sessionId)),
      ]);

      if (quests) {
        setActiveQuests(quests.filter(q => q.status === 'active'));
        setCompletedQuests(quests.filter(q => q.status === 'completed'));
      }

      if (stats?.data) {
        setStatistics(stats.data);
      }

      if (sess) {
        setSession(sess);
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading quest data:', err);
      setLoading(false);
    }
  };

  const handleQuestCompleted = async (questId) => {
    try {
      const quest = activeQuests.find(q => q.id === questId);
      if (quest) {
        await base44.entities.Quest.update(questId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });

        // Add milestone
        setMilestones(prev => [...prev, {
          id: `milestone-${Date.now()}`,
          title: `Completed: ${quest.title}`,
          type: 'quest_completed',
          questId,
        }]);

        await loadQuestData();
      }
    } catch (err) {
      console.error('Error completing quest:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background p-4 sm:p-6 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-[0.3em] uppercase">Loading quests...</p>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex-1 min-h-0 bg-background p-4 sm:p-6 flex items-center justify-center">
        <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">No session selected</p>
      </div>
    );
  }

  const totalProgress = activeQuests.length > 0
    ? Math.round((activeQuests.reduce((sum, q) => {
        const completed = q.objectives?.filter(o => o.completed).length || 0;
        const total = q.objectives?.length || 1;
        return sum + (completed / total);
      }, 0) / activeQuests.length) * 100)
    : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="font-sacred text-3xl sm:text-4xl text-primary tracking-wider">Quest Log</h1>
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            {activeQuests.length} active • {completedQuests.length} completed
          </p>
        </div>

        {/* Overall Progress Bar */}
        {activeQuests.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border border-primary/20 bg-primary/5 rounded-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
                Overall Progress
              </span>
              <span className="font-mono text-[9px] text-primary font-semibold">{totalProgress}%</span>
            </div>
            <div className="h-2 bg-black/40 border border-primary/10 rounded-full overflow-hidden">
              <motion.div
                animate={{ width: `${totalProgress}%` }}
                className="h-full bg-gradient-to-r from-primary via-cyan-400 to-primary transition-all"
              />
            </div>
          </motion.div>
        )}

        {/* Milestones Alert */}
        <AnimatePresence>
          {milestones.map(milestone => (
            <motion.div
              key={milestone.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 border border-green-400/30 bg-green-900/20 rounded-lg flex items-center gap-3"
            >
              <Zap className="w-5 h-5 text-green-400 flex-shrink-0" />
              <div>
                <p className="font-mono text-[9px] text-green-400 tracking-widest uppercase">Quest Completed</p>
                <p className="text-sm text-green-300 mt-1">{milestone.title}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Milestone Detector */}
        <MilestoneDetector
          sessionId={sessionId}
          onMilestoneDetected={(milestone) => {
            setMilestones(prev => [...prev, milestone]);
          }}
        />

        {/* Active Quests */}
        {activeQuests.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Circle className="w-4 h-4 text-primary/60" />
              <h2 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
                Active Objectives ({activeQuests.length})
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {activeQuests.map(quest => (
                <QuestProgressCard
                  key={quest.id}
                  quest={quest}
                  onComplete={() => handleQuestCompleted(quest.id)}
                  onObjectiveToggle={async (objectiveId) => {
                    const objectives = quest.objectives.map(o =>
                      o.id === objectiveId ? { ...o, completed: !o.completed } : o
                    );
                    await base44.entities.Quest.update(quest.id, { objectives });
                    await loadQuestData();
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 border border-primary/10 bg-black/40 rounded-lg text-center">
            <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">No active quests</p>
          </div>
        )}

        {/* Completed Quests */}
        {completedQuests.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400/60" />
              <h2 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
                Completed ({completedQuests.length})
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {completedQuests.slice(0, 4).map(quest => (
                <div key={quest.id} className="p-4 border border-green-400/20 bg-green-900/10 rounded-lg">
                  <p className="font-mono text-[9px] text-green-400 line-through">{quest.title}</p>
                  <p className="text-[8px] text-green-400/60 mt-2">✓ Completed</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Statistics */}
        {statistics && (
          <QuestStatistics
            totalQuests={activeQuests.length + completedQuests.length}
            activeQuests={activeQuests.length}
            completedQuests={completedQuests.length}
            averageDifficulty={statistics.average_difficulty}
            estimatedTimeRemaining={statistics.estimated_time_remaining}
            completionRate={statistics.completion_rate}
          />
        )}
      </div>
    </div>
  );
}