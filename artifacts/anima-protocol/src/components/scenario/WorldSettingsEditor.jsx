import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function WorldSettingsEditor({ worldSettings, setWorldSettings }) {
  const [expanded, setExpanded] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleAddSetting = () => {
    if (!newKey.trim()) return;
    setWorldSettings({
      ...worldSettings,
      [newKey]: newValue,
    });
    setNewKey('');
    setNewValue('');
  };

  const handleRemoveSetting = (key) => {
    const updated = { ...worldSettings };
    delete updated[key];
    setWorldSettings(updated);
  };

  return (
    <div className="space-y-3 p-4 border border-primary/20 bg-black/40 rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
      >
        <h3 className="font-mono text-sm text-primary tracking-wide">World Settings</h3>
        <span className={`text-primary/50 transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 pt-2"
          >
            {/* Current Settings */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {Object.entries(worldSettings).map(([key, value]) => (
                <div key={key} className="p-2.5 bg-primary/5 border border-primary/10 rounded space-y-1 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-mono text-[9px] text-primary font-semibold">{key}</p>
                      <p className="text-[8px] text-primary/60 mt-0.5 break-words">{String(value)}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveSetting(key)}
                      className="opacity-0 group-hover:opacity-100 text-primary/30 hover:text-red-400 transition-all flex-shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Setting */}
            <div className="p-3 bg-primary/5 border border-primary/10 rounded space-y-2">
              <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Add Setting</p>
              <input
                type="text"
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="Setting name (e.g., 'climate', 'magic_system')..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
              />
              <textarea
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="Setting details..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded"
                rows="2"
              />
              <button
                onClick={handleAddSetting}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}