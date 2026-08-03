import { useState } from 'react';
import { X, Save, Loader } from 'lucide-react';
import { motion } from 'framer-motion';

const ENTRY_TYPES = ['character', 'location', 'event', 'item', 'faction', 'concept', 'creature', 'lore'];
const IMPORTANCE_LEVELS = ['minor', 'notable', 'major', 'central'];

export default function WikiEnrichmentPanel({
  entry,
  onSave,
  onClose,
}) {
  const [formData, setFormData] = useState(entry || {
    name: '',
    entry_type: 'lore',
    summary: '',
    tags: [],
    lore_facts: [],
    importance: 'notable',
  });
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [factInput, setFactInput] = useState('');

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave?.(formData);
      onClose?.();
    } catch (err) {
      console.error('Error saving entry:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl bg-background border border-primary/30 rounded-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-primary/20 flex-shrink-0">
          <h2 className="font-mono text-[9px] text-primary tracking-widest uppercase">
            {entry ? 'Edit Entry' : 'New Entry'}
          </h2>
          <button onClick={onClose} className="text-primary/40 hover:text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Name & Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="Entity name..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors rounded"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Type</label>
              <select
                value={formData.entry_type}
                onChange={e => setFormData({ ...formData, entry_type: e.target.value })}
                className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors rounded"
              >
                {ENTRY_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Summary */}
          <div className="space-y-1">
            <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Summary</label>
            <textarea
              value={formData.summary || ''}
              onChange={e => setFormData({ ...formData, summary: e.target.value })}
              placeholder="Describe this entry..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded"
              rows="3"
            />
          </div>

          {/* Importance */}
          <div className="space-y-1">
            <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Importance</label>
            <div className="flex gap-2">
              {IMPORTANCE_LEVELS.map(level => (
                <button
                  key={level}
                  onClick={() => setFormData({ ...formData, importance: level })}
                  className={`flex-1 px-2 py-1 border rounded font-mono text-[8px] tracking-widest uppercase transition-all ${
                    formData.importance === level
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-primary/20 bg-black/40 text-primary/40 hover:text-primary/60'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Tags</label>
            <div className="flex gap-1.5 flex-wrap">
              {formData.tags?.map((tag, idx) => (
                <button
                  key={idx}
                  onClick={() => setFormData({
                    ...formData,
                    tags: formData.tags.filter((_, i) => i !== idx),
                  })}
                  className="px-2 py-1 bg-primary/10 border border-primary/30 text-primary/70 hover:text-primary text-[8px] rounded transition-all"
                >
                  {tag} ✕
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && tagInput.trim()) {
                    setFormData({
                      ...formData,
                      tags: [...(formData.tags || []), tagInput.trim()],
                    });
                    setTagInput('');
                  }
                }}
                placeholder="Add tag..."
                className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2 py-1 focus:outline-none focus:border-primary/50 transition-colors rounded"
              />
              <button
                onClick={() => {
                  if (tagInput.trim()) {
                    setFormData({
                      ...formData,
                      tags: [...(formData.tags || []), tagInput.trim()],
                    });
                    setTagInput('');
                  }
                }}
                className="px-3 py-1 bg-primary/10 border border-primary/30 text-primary/70 hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                Add
              </button>
            </div>
          </div>

          {/* Facts */}
          <div className="space-y-2">
            <label className="text-[8px] font-mono text-primary/50 tracking-widest uppercase block">Known Facts</label>
            <div className="space-y-1">
              {formData.lore_facts?.map((fact, idx) => (
                <div key={idx} className="flex gap-1.5 p-2 bg-primary/5 border border-primary/15 rounded">
                  <p className="flex-1 text-[8px] text-primary/70">{fact}</p>
                  <button
                    onClick={() => setFormData({
                      ...formData,
                      lore_facts: formData.lore_facts.filter((_, i) => i !== idx),
                    })}
                    className="text-primary/40 hover:text-red-400 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={factInput}
                onChange={e => setFactInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && factInput.trim()) {
                    setFormData({
                      ...formData,
                      lore_facts: [...(formData.lore_facts || []), factInput.trim()],
                    });
                    setFactInput('');
                  }
                }}
                placeholder="Add a fact..."
                className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2 py-1 focus:outline-none focus:border-primary/50 transition-colors rounded"
              />
              <button
                onClick={() => {
                  if (factInput.trim()) {
                    setFormData({
                      ...formData,
                      lore_facts: [...(formData.lore_facts || []), factInput.trim()],
                    });
                    setFactInput('');
                  }
                }}
                className="px-3 py-1 bg-primary/10 border border-primary/30 text-primary/70 hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t border-primary/20 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !formData.name}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            {saving ? (
              <>
                <Loader className="w-3 h-3 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-3 h-3" />
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}