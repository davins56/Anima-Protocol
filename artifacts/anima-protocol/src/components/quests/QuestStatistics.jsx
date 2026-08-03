import { TrendingUp, Target, CheckCircle2 } from 'lucide-react';

export default function QuestStatistics({
  totalQuests,
  activeQuests,
  completedQuests,
  averageDifficulty,
  estimatedTimeRemaining,
  completionRate,
}) {
  const getCompletionColor = (rate) => {
    if (rate >= 80) return 'text-green-400';
    if (rate >= 50) return 'text-cyan-400';
    if (rate >= 20) return 'text-orange-400';
    return 'text-primary/40';
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border border-primary/20 bg-primary/5 rounded-lg">
      {/* Total Quests */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Target className="w-4 h-4 text-primary/50" />
          <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Total Quests</p>
        </div>
        <p className="font-mono text-lg text-primary font-semibold">{totalQuests}</p>
      </div>

      {/* Completion Rate */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-primary/50" />
          <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Completion</p>
        </div>
        <p className={`font-mono text-lg font-semibold ${getCompletionColor(completionRate || 0)}`}>
          {Math.round(completionRate || 0)}%
        </p>
      </div>

      {/* Active vs Completed */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-primary/50" />
          <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Active</p>
        </div>
        <p className="font-mono text-lg text-primary font-semibold">{activeQuests}</p>
        <p className="text-[7px] font-mono text-primary/40">{completedQuests} completed</p>
      </div>

      {/* Estimated Time */}
      {estimatedTimeRemaining && (
        <div className="space-y-2">
          <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Est. Time</p>
          <p className="font-mono text-sm text-primary font-semibold">{estimatedTimeRemaining}</p>
        </div>
      )}
    </div>
  );
}