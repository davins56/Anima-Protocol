import { useState } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TraitEditor({ traits, onAdd, onUpdate, onDelete }) {
  const [newTrait, setNewTrait] = useState({ name: '', description: '', strength: 5 });
  const [showForm, setShowForm] = useState(false);

  const handleAddTrait = () => {
    if (!newTrait.name.trim()) return;
    onAdd(newTrait);
    setNewTrait({ name: '', description: '', strength: 5 });
    setShowForm(false);
  };

  return (
    <div className="space-y-3 p-4 border border-primary/20 bg-black/40 rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm text-primary tracking-wide">Core Traits</h3>
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
              value={newTrait.name}
              onChange={e => setNewTrait({ ...newTrait, name: e.target.value })}
              placeholder="Trait name..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
            <textarea
              value={newTrait.description}
              onChange={e => setNewTrait({ ...newTrait, description: e.target.value })}
              placeholder="Description..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors resize-none"
              rows="2"
            />
            <div className="flex items-center justify-between text-[8px]">
              <label className="font-mono text-primary/50 tracking-widest uppercase">Strength</label>
              <input
                type="range"
                min="0"
                max="10"
                value={newTrait.strength}
                onChange={e => setNewTrait({ ...newTrait, strength: parseInt(e.target.value) })}
                className="flex-1 mx-2 h-1.5 bg-primary/10 border border-primary/20 rounded appearance-none accent-primary"
              />
              <span className="w-5 font-mono text-primary/60">{newTrait.strength}</span>
            </div>
            <div className="flex gap-1.5 pt-1">
              <button
                onClick={handleAddTrait}
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

      {/* Traits List */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {traits?.map(trait => (
          <div key={trait.id} className="p-2.5 bg-primary/5 border border-primary/10 rounded space-y-1 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="font-mono text-[9px] text-primary font-semibold">{trait.name}</p>
                {trait.description && (
                  <p className="text-[8px] text-primary/60 mt-0.5">{trait.description}</p>
                )}
              </div>
              <button
                onClick={() => onDelete?.(trait.id)}
                className="opacity-0 group-hover:opacity-100 text-primary/30 hover:text-red-400 transition-all flex-shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-primary/10 rounded overflow-hidden">
                <div
                  className="h-full bg-primary/60 transition-all"
                  style={{ width: `${(trait.strength / 10) * 100}%` }}
                />
              </div>
              <span className="text-[7px] font-mono text-primary/50 w-5">{trait.strength}/10</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}