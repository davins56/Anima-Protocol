import { useState } from 'react';
import { X, Pin, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function MemoryNodeEditor({ node, onSave, onDelete, onClose }) {
  const [label, setLabel] = useState(node?.label || '');
  const [description, setDescription] = useState(node?.description || '');
  const [type, setType] = useState(node?.type || 'event');
  const [pinned, setPinned] = useState(node?.pinned || false);
  const [emotionalWeight, setEmotionalWeight] = useState(node?.emotional_weight || 5);

  const handleSave = () => {
    onSave({
      ...node,
      label,
      description,
      type,
      pinned,
      emotional_weight: emotionalWeight,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="w-80 border border-primary/20 bg-black/80 rounded-lg p-4 space-y-4 shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm text-primary tracking-wide">Edit Memory Node</h3>
        <button onClick={onClose} className="text-primary/40 hover:text-primary">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Type */}
      <div className="space-y-2">
        <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Type</label>
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[9px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
        >
          <option value="event">Event</option>
          <option value="trait">Trait</option>
          <option value="milestone">Milestone</option>
          <option value="relationship">Relationship</option>
        </select>
      </div>

      {/* Label */}
      <div className="space-y-2">
        <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Label</label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
          placeholder="Memory label..."
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors resize-none"
          rows="3"
          placeholder="Memory details..."
        />
      </div>

      {/* Emotional Weight */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Emotional Weight</label>
          <span className="text-[9px] font-mono text-primary/60">{emotionalWeight}/10</span>
        </div>
        <input
          type="range"
          min="0"
          max="10"
          value={emotionalWeight}
          onChange={e => setEmotionalWeight(parseInt(e.target.value))}
          className="w-full h-1.5 bg-primary/10 border border-primary/20 rounded appearance-none accent-primary"
        />
      </div>

      {/* Pin toggle */}
      <button
        onClick={() => setPinned(!pinned)}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2 border rounded font-mono text-[8px] tracking-widest uppercase transition-all ${
          pinned
            ? 'bg-yellow-600/20 border-yellow-400/40 text-yellow-400'
            : 'bg-primary/10 border-primary/20 text-primary/60 hover:text-primary/80'
        }`}
      >
        <Pin className="w-3 h-3" />
        {pinned ? 'Pinned' : 'Pin Memory'}
      </button>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onClose}
          className="flex-1 px-3 py-2 border border-primary/20 text-primary/50 hover:text-primary font-mono text-[8px] tracking-widest uppercase transition-all"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="px-3 py-2 border border-red-400/30 text-red-400/60 hover:text-red-400 hover:border-red-400/50 font-mono text-[8px] tracking-widest uppercase transition-all"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={handleSave}
          className="flex-1 px-3 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
        >
          Save
        </button>
      </div>
    </motion.div>
  );
}