import { useState } from "react";
import { ChevronDown, CheckCircle2, Clock, AlertCircle, Trash2, Edit2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STATUS_CONFIG = {
  available: { icon: Clock, color: "text-primary/50", bg: "bg-primary/5", label: "Available", border: "border-primary/20" },
  active: { icon: Clock, color: "text-yellow-400", bg: "bg-yellow-400/5", label: "In Progress", border: "border-yellow-400/30" },
  completed: { icon: CheckCircle2, color: "text-green-400", bg: "bg-green-400/5", label: "Completed", border: "border-green-400/30" },
  failed: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-400/5", label: "Failed", border: "border-red-400/30" },
};

const DIFFICULTY_CONFIG = {
  trivial: { label: "Trivial", color: "text-gray-400" },
  easy: { label: "Easy", color: "text-green-400" },
  moderate: { label: "Moderate", color: "text-yellow-400" },
  hard: { label: "Hard", color: "text-red-400" },
  legendary: { label: "Legendary", color: "text-purple-400" },
};

export default function QuestCard({
  quest,
  onStatusChange,
  onDelete,
  onEdit,
  isLoading,
}) {
  const [expanded, setExpanded] = useState(false);
  const statusConfig = STATUS_CONFIG[quest.status] || STATUS_CONFIG.available;
  const StatusIcon = statusConfig.icon;
  const difficultyConfig = DIFFICULTY_CONFIG[quest.difficulty] || DIFFICULTY_CONFIG.moderate;

  const completedObjectives = quest.objectives?.filter(o => o.completed).length || 0;
  const totalObjectives = quest.objectives?.length || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`border rounded transition-all hover:shadow-lg ${statusConfig.border} ${statusConfig.bg}`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between gap-3 p-4 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Status icon */}
          <div className={`flex-shrink-0 mt-0.5 ${statusConfig.color}`}>
            <StatusIcon className="w-5 h-5" />
          </div>

          {/* Title and metadata */}
          <div className="flex-1 min-w-0">
            <h3 className="font-mono text-sm font-semibold tracking-wide truncate">
              {quest.title}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className={`text-[8px] font-mono tracking-widest uppercase ${difficultyConfig.color}`}>
                {difficultyConfig.label}
              </span>
              <span className={`text-[8px] font-mono tracking-widest uppercase ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
              {totalObjectives > 0 && (
                <span className="text-[8px] font-mono text-primary/50">
                  {completedObjectives}/{totalObjectives} objectives
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown
          className={`flex-shrink-0 w-4 h-4 text-primary/40 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-current/20 overflow-hidden"
          >
            <div className="p-4 space-y-3">
              {/* Description */}
              {quest.description && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                    Description
                  </p>
                  <p className="text-sm leading-relaxed text-primary/80">
                    {quest.description}
                  </p>
                </div>
              )}

              {/* Objectives */}
              {quest.objectives && quest.objectives.length > 0 && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                    Objectives ({completedObjectives}/{totalObjectives})
                  </p>
                  <div className="space-y-1">
                    {quest.objectives.map((obj, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 p-2 rounded text-sm ${
                          obj.completed
                            ? "bg-green-400/5 border border-green-400/20"
                            : "bg-black/30 border border-primary/10"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={obj.completed}
                          onChange={() => {
                            const updated = quest.objectives.map((o, i) =>
                              i === idx ? { ...o, completed: !o.completed } : o
                            );
                            onStatusChange?.(quest.id, quest.status, updated);
                          }}
                          disabled={isLoading}
                          className="mt-0.5 w-4 h-4 accent-green-400 cursor-pointer"
                        />
                        <span
                          className={`leading-relaxed ${
                            obj.completed ? "line-through text-primary/40" : "text-primary/80"
                          }`}
                        >
                          {obj.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quest rewards */}
              {quest.rewards && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                    Rewards
                  </p>
                  <div className="space-y-1 text-sm">
                    {quest.rewards.xp > 0 && (
                      <p className="text-primary/70">⭐ {quest.rewards.xp} XP</p>
                    )}
                    {quest.rewards.items && quest.rewards.items.length > 0 && (
                      <div>
                        <p className="text-primary/70">📦 Items:</p>
                        <ul className="ml-4 space-y-0.5">
                          {quest.rewards.items.map((item, idx) => (
                            <li key={idx} className="text-primary/60">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Dates */}
              {(quest.started_at || quest.completed_at) && (
                <div className="text-[8px] font-mono text-primary/40 space-y-0.5 pt-2 border-t border-current/10">
                  {quest.started_at && (
                    <p>Started: {new Date(quest.started_at).toLocaleDateString()}</p>
                  )}
                  {quest.completed_at && (
                    <p>Completed: {new Date(quest.completed_at).toLocaleDateString()}</p>
                  )}
                </div>
              )}

              {/* Status buttons */}
              <div className="flex gap-2 pt-3 border-t border-current/10">
                {quest.status !== "completed" && (
                  <button
                    onClick={() => onStatusChange?.(quest.id, "completed")}
                    disabled={isLoading}
                    className="flex-1 px-3 py-1.5 bg-green-400/10 border border-green-400/30 text-green-400 hover:bg-green-400/20 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
                  >
                    Complete
                  </button>
                )}
                {quest.status !== "failed" && quest.status !== "completed" && (
                  <button
                    onClick={() => onStatusChange?.(quest.id, "failed")}
                    disabled={isLoading}
                    className="flex-1 px-3 py-1.5 bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
                  >
                    Fail
                  </button>
                )}
                <button
                  onClick={() => onEdit?.(quest)}
                  disabled={isLoading}
                  className="px-3 py-1.5 border border-primary/15 text-primary/40 hover:text-primary/70 disabled:opacity-50 font-mono text-[9px] transition-all"
                  title="Edit quest"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete?.(quest.id)}
                  disabled={isLoading}
                  className="px-3 py-1.5 border border-red-900/20 text-red-900/40 hover:text-red-400 hover:border-red-400/40 disabled:opacity-50 font-mono text-[9px] transition-all"
                  title="Delete quest"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}