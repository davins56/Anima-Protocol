import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, X, Edit2, Save, Plus, Trash2, AlertCircle } from 'lucide-react';

export default function QuestJournal({ sessionId, isVisible = true }) {
  const [quests, setQuests] = useState({
    active: [],
    completed: [],
    failed: [],
  });
  const [expandedQuestId, setExpandedQuestId] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    loadQuests();

    const unsubscribe = base44.entities.Quest.subscribe((event) => {
      if (event.data?.session_id === sessionId) {
        loadQuests();
      }
    });

    return unsubscribe;
  }, [sessionId]);

  const loadQuests = async () => {
    setLoading(true);
    try {
      const allQuests = await base44.entities.Quest.filter({
        session_id: sessionId,
      }, '-updated_date', 100);

      const grouped = {
        active: allQuests.filter(q => q.status === 'active'),
        completed: allQuests.filter(q => q.status === 'completed'),
        failed: allQuests.filter(q => q.status === 'failed'),
      };

      setQuests(grouped);
    } catch (err) {
      console.error('Error loading quests:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleObjective = async (questId, objectiveId) => {
    const allQuestsList = [...quests.active, ...quests.completed, ...quests.failed];
    const quest = allQuestsList.find(q => q.id === questId);
    if (!quest) return;

    setUpdatingId(`${questId}-${objectiveId}`);
    try {
      const updatedObjectives = quest.objectives.map(obj =>
        obj.id === objectiveId ? { ...obj, completed: !obj.completed } : obj
      );

      const allCompleted = updatedObjectives.every(obj => obj.completed);

      await base44.entities.Quest.update(questId, {
        objectives: updatedObjectives,
        status: allCompleted && quest.status === 'active' ? 'completed' : quest.status,
      });

      loadQuests();
    } catch (err) {
      console.error('Error updating objective:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleQuestStatus = async (questId, currentStatus) => {
    const nextStatus = currentStatus === 'active' ? 'failed' : 'active';

    setUpdatingId(questId);
    try {
      await base44.entities.Quest.update(questId, { status: nextStatus });
      loadQuests();
    } catch (err) {
      console.error('Error updating quest status:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveNote = async (questId, objectiveId) => {
    const allQuestsList = [...quests.active, ...quests.completed, ...quests.failed];
    const quest = allQuestsList.find(q => q.id === questId);
    if (!quest) return;

    setUpdatingId(`${questId}-note`);
    try {
      const updatedObjectives = quest.objectives.map(obj =>
        obj.id === objectiveId
          ? { ...obj, custom_note: noteText }
          : obj
      );

      await base44.entities.Quest.update(questId, {
        objectives: updatedObjectives,
      });

      setEditingNoteId(null);
      setNoteText('');
      loadQuests();
    } catch (err) {
      console.error('Error saving note:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const getProgress = (quest) => {
    if (!quest.objectives || quest.objectives.length === 0) return 0;
    const completed = quest.objectives.filter(obj => obj.completed).length;
    return (completed / quest.objectives.length) * 100;
  };

  const getDifficultyColor = (difficulty) => {
    const colors = {
      trivial: 'text-slate-400',
      easy: 'text-green-400',
      moderate: 'text-cyan-400',
      hard: 'text-orange-400',
      legendary: 'text-red-500',
    };
    return colors[difficulty] || 'text-primary';
  };

  const getStatusIcon = (status) => {
    const icons = {
      active: '⚔️',
      completed: '✓',
      failed: '✗',
    };
    return icons[status] || '○';
  };

  const renderQuestCard = (quest) => {
    const isExpanded = expandedQuestId === quest.id;
    const progress = getProgress(quest);

    return (
      <motion.div
        key={quest.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`border rounded overflow-hidden transition-all ${
          quest.status === 'completed'
            ? 'border-green-400/20 bg-green-400/5'
            : quest.status === 'failed'
            ? 'border-red-400/20 bg-red-400/5'
            : 'border-primary/20 bg-black/40'
        }`}
      >
        {/* Quest Header */}
        <button
          onClick={() => setExpandedQuestId(isExpanded ? null : quest.id)}
          className="w-full text-left p-3 hover:bg-primary/5 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{getStatusIcon(quest.status)}</span>
                <p className="font-mono text-sm font-semibold text-primary truncate">
                  {quest.title}
                </p>
              </div>

              {/* Progress Bar */}
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-1.5 bg-black/60 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-gradient-to-r from-primary to-cyan-400"
                  />
                </div>
                <span className="text-[8px] font-mono text-primary/60 flex-shrink-0">
                  {Math.round(progress)}%
                </span>
              </div>

              {/* Meta Info */}
              <div className="flex items-center gap-2 flex-wrap text-[8px] font-mono">
                <span className={getDifficultyColor(quest.difficulty)}>
                  {quest.difficulty}
                </span>
                {quest.objectives && (
                  <span className="text-primary/50">
                    {quest.objectives.filter(o => o.completed).length}/{quest.objectives.length}
                  </span>
                )}
              </div>
            </div>

            <ChevronDown
              className={`w-4 h-4 text-primary/40 transition-transform flex-shrink-0 ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {/* Quest Details */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border-t border-primary/10 bg-black/60 p-3 space-y-3"
            >
              {/* Description */}
              {quest.description && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                    Summary
                  </p>
                  <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
                    {quest.description}
                  </p>
                </div>
              )}

              {/* Objectives */}
              {quest.objectives && quest.objectives.length > 0 && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                    Objectives
                  </p>
                  <div className="space-y-2">
                    {quest.objectives.map((obj) => (
                      <div
                        key={obj.id}
                        className="p-2 bg-black/40 border border-primary/10 rounded space-y-1.5"
                      >
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => handleToggleObjective(quest.id, obj.id)}
                            disabled={updatingId === `${quest.id}-${obj.id}`}
                            className={`flex-shrink-0 mt-0.5 transition-all disabled:opacity-50 ${
                              obj.completed
                                ? 'text-green-400 hover:text-green-300'
                                : 'text-primary/40 hover:text-primary'
                            }`}
                          >
                            {obj.completed ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <AlertCircle className="w-4 h-4" />
                            )}
                          </button>
                          <span
                            className={`font-mono text-[9px] leading-relaxed flex-1 ${
                              obj.completed
                                ? 'text-primary/40 line-through'
                                : 'text-primary/70'
                            }`}
                          >
                            {obj.description}
                          </span>
                        </div>

                        {/* Custom Note */}
                        {editingNoteId === obj.id ? (
                          <div className="flex gap-1 ml-6">
                            <textarea
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder="Add a note..."
                              className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] p-1.5 focus:outline-none focus:border-primary/40 rounded resize-none"
                              rows="2"
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => handleSaveNote(quest.id, obj.id)}
                                disabled={updatingId === `${quest.id}-note`}
                                className="p-1 bg-green-400/10 border border-green-400/30 text-green-400 hover:bg-green-400/20 disabled:opacity-50 rounded transition-all"
                              >
                                <Save className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingNoteId(null);
                                  setNoteText('');
                                }}
                                className="p-1 bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20 rounded transition-all"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ) : obj.custom_note ? (
                          <div className="ml-6 p-1.5 bg-black/60 border border-yellow-400/20 rounded">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-[7px] font-mono text-yellow-400/60 tracking-widest uppercase">
                                Note
                              </p>
                              <button
                                onClick={() => {
                                  setEditingNoteId(obj.id);
                                  setNoteText(obj.custom_note);
                                }}
                                className="text-yellow-400/50 hover:text-yellow-400 transition-colors"
                              >
                                <Edit2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                            <p className="text-[8px] font-mono text-yellow-400/70">
                              {obj.custom_note}
                            </p>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingNoteId(obj.id);
                              setNoteText('');
                            }}
                            className="ml-6 text-[8px] font-mono text-primary/30 hover:text-primary/60 transition-colors flex items-center gap-1"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            Add note
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rewards */}
              {quest.rewards && (quest.rewards.xp > 0 || quest.rewards.items?.length > 0) && (
                <div className="pt-2 border-t border-primary/10">
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                    Rewards
                  </p>
                  <div className="text-[8px] font-mono text-cyan-400 space-y-0.5">
                    {quest.rewards.xp > 0 && <p>✨ {quest.rewards.xp} XP</p>}
                    {quest.rewards.items?.length > 0 && <p>📦 {quest.rewards.items.length} item(s)</p>}
                  </div>
                </div>
              )}

              {/* Status Toggle */}
              {quest.status === 'active' && (
                <button
                  onClick={() => handleToggleQuestStatus(quest.id, quest.status)}
                  disabled={updatingId === quest.id}
                  className="w-full mt-2 px-2 py-1.5 border border-red-400/30 text-red-400/60 hover:text-red-400 hover:bg-red-400/5 text-[8px] font-mono tracking-widest uppercase transition-all disabled:opacity-50"
                >
                  <X className="w-3 h-3 inline mr-1" />
                  Mark Failed
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  if (!isVisible) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-lg text-primary glow-text tracking-wider uppercase">
          📖 Quest Journal
        </h2>
        <span className="text-[9px] font-mono text-primary/40">
          {quests.active.length + quests.completed.length + quests.failed.length} total
        </span>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">Loading quests...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Quests */}
          {quests.active.length > 0 && (
            <div>
              <h3 className="font-mono text-sm text-primary tracking-wider uppercase mb-3 flex items-center gap-2">
                <span className="text-lg">⚔️</span>
                Active ({quests.active.length})
              </h3>
              <div className="space-y-2">
                {quests.active.map(renderQuestCard)}
              </div>
            </div>
          )}

          {/* Completed Quests */}
          {quests.completed.length > 0 && (
            <div>
              <h3 className="font-mono text-sm text-green-400 tracking-wider uppercase mb-3 flex items-center gap-2">
                <span className="text-lg">✓</span>
                Completed ({quests.completed.length})
              </h3>
              <div className="space-y-2">
                {quests.completed.map(renderQuestCard)}
              </div>
            </div>
          )}

          {/* Failed Quests */}
          {quests.failed.length > 0 && (
            <div>
              <h3 className="font-mono text-sm text-red-400 tracking-wider uppercase mb-3 flex items-center gap-2">
                <span className="text-lg">✗</span>
                Failed ({quests.failed.length})
              </h3>
              <div className="space-y-2">
                {quests.failed.map(renderQuestCard)}
              </div>
            </div>
          )}

          {/* Empty State */}
          {quests.active.length === 0 && quests.completed.length === 0 && quests.failed.length === 0 && (
            <div className="p-6 border border-primary/10 bg-primary/5 rounded text-center">
              <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
                No quests yet. Start by exploring the world!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Summary Stats */}
      {(quests.active.length > 0 || quests.completed.length > 0) && (
        <div className="p-3 border border-primary/10 bg-primary/5 rounded text-[8px] font-mono text-primary/60 space-y-1">
          <p>Progress: {quests.completed.length} completed • {quests.active.length} active</p>
          <p>Completion Rate: {Math.round((quests.completed.length / (quests.completed.length + quests.active.length)) * 100)}%</p>
        </div>
      )}
    </div>
  );
}