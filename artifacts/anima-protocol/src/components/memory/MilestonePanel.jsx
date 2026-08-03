import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';

export default function MilestonePanel({ milestones, onAdd, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [newMilestone, setNewMilestone] = useState({
    title: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    impact: 0,
  });

  const handleAdd = () => {
    if (!newMilestone.title.trim()) return;
    onAdd(newMilestone);
    setNewMilestone({ title: '', description: '', date: new Date().toISOString().split('T')[0], impact: 0 });
    setShowForm(false);
  };

  return (
    <div className="space-y-3 p-4 border border-primary/20 bg-black/40 rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm text-primary tracking-wide">Relationship Milestones</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="p-1.5 text-primary/40 hover:text-primary/70 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 bg-primary/5 border border-primary/10 rounded space-y-2"
          >
            <input
              type="text"
              value={newMilestone.title}
              onChange={e => setNewMilestone({ ...newMilestone, title: e.target.value })}
              placeholder="Milestone title..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
            <input
              type="date"
              value={newMilestone.date}
              onChange={e => setNewMilestone({ ...newMilestone, date: e.target.value })}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
            <textarea
              value={newMilestone.description}
              onChange={e => setNewMilestone({ ...newMilestone, description: e.target.value })}
              placeholder="What happened..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors resize-none"
              rows="2"
            />
            <div className="flex items-center justify-between text-[8px]">
              <label className="font-mono text-primary/50 tracking-widest uppercase">Impact</label>
              <input
                type="range"
                min="-10"
                max="10"
                value={newMilestone.impact}
                onChange={e => setNewMilestone({ ...newMilestone, impact: parseInt(e.target.value) })}
                className="flex-1 mx-2 h-1.5 bg-primary/10 border border-primary/20 rounded appearance-none accent-primary"
              />
              <span className="w-5 font-mono text-primary/60">{newMilestone.impact}</span>
            </div>
            <div className="flex gap-1.5 pt-1">
              <button
                onClick={handleAdd}
                className="flex-1 px-2 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                Add
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-2 py-1.5 border border-primary/15 text-primary/40 hover:text-primary/60 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Milestones List */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {milestones?.sort((a, b) => new Date(b.date) - new Date(a.date)).map(milestone => (
          <div key={milestone.id} className="p-2.5 bg-primary/5 border border-primary/10 rounded space-y-1 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="font-mono text-[9px] text-primary font-semibold">{milestone.title}</p>
                <p className="text-[8px] text-primary/50 mt-0.5">
                  {format(new Date(milestone.date), 'MMM d, yyyy')}
                </p>
                {milestone.description && (
                  <p className="text-[8px] text-primary/60 mt-1">{milestone.description}</p>
                )}
              </div>
              <button
                onClick={() => onDelete?.(milestone.id)}
                className="opacity-0 group-hover:opacity-100 text-primary/30 hover:text-red-400 transition-all flex-shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {milestone.impact !== 0 && (
              <div className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
                milestone.impact > 0 ? 'bg-green-400/20 text-green-400' : 'bg-red-400/20 text-red-400'
              }`}>
                {milestone.impact > 0 ? '+' : ''}{milestone.impact} Impact
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}