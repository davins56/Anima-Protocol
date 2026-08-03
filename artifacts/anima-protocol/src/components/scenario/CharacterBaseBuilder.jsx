import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CharacterBaseBuilder({ characterBases, setCharacterBases }) {
  const [expanded, setExpanded] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newChar, setNewChar] = useState({
    name: '',
    universe: '',
    personality: '',
    backstory: '',
    speaking_style: '',
    category: 'companion',
  });

  const handleAddCharacter = () => {
    if (!newChar.name.trim()) return;
    setCharacterBases([...characterBases, { id: `char-${Date.now()}`, ...newChar }]);
    setNewChar({
      name: '',
      universe: '',
      personality: '',
      backstory: '',
      speaking_style: '',
      category: 'companion',
    });
    setShowForm(false);
  };

  const handleRemoveCharacter = (id) => {
    setCharacterBases(characterBases.filter(c => c.id !== id));
  };

  return (
    <div className="space-y-3 p-4 border border-primary/20 bg-black/40 rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
      >
        <h3 className="font-mono text-sm text-primary tracking-wide">
          Character Bases ({characterBases.length})
        </h3>
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
            {/* Characters List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {characterBases.map(char => (
                <div key={char.id} className="p-3 bg-primary/5 border border-primary/10 rounded space-y-2 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-mono text-[9px] text-primary font-semibold">{char.name}</p>
                      {char.universe && (
                        <p className="text-[8px] text-primary/50 mt-0.5">{char.universe}</p>
                      )}
                    </div>
                    <span className="text-[7px] font-mono px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary/50 rounded">
                      {char.category}
                    </span>
                  </div>
                  {char.personality && (
                    <p className="text-[8px] text-primary/60">{char.personality.slice(0, 80)}...</p>
                  )}
                  <button
                    onClick={() => handleRemoveCharacter(char.id)}
                    className="opacity-0 group-hover:opacity-100 text-primary/30 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Character Form */}
            {showForm ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-3 bg-primary/5 border border-primary/10 rounded space-y-2"
              >
                <input
                  autoFocus
                  type="text"
                  value={newChar.name}
                  onChange={e => setNewChar({ ...newChar, name: e.target.value })}
                  placeholder="Character name..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
                />
                <input
                  type="text"
                  value={newChar.universe}
                  onChange={e => setNewChar({ ...newChar, universe: e.target.value })}
                  placeholder="Universe/Series (optional)..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
                />
                <textarea
                  value={newChar.personality}
                  onChange={e => setNewChar({ ...newChar, personality: e.target.value })}
                  placeholder="Personality traits..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded"
                  rows="2"
                />
                <textarea
                  value={newChar.backstory}
                  onChange={e => setNewChar({ ...newChar, backstory: e.target.value })}
                  placeholder="Backstory..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded"
                  rows="2"
                />
                <textarea
                  value={newChar.speaking_style}
                  onChange={e => setNewChar({ ...newChar, speaking_style: e.target.value })}
                  placeholder="How they speak..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors resize-none rounded"
                  rows="2"
                />
                <select
                  value={newChar.category}
                  onChange={e => setNewChar({ ...newChar, category: e.target.value })}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-[8px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
                >
                  <option value="companion">Companion</option>
                  <option value="warrior">Warrior</option>
                  <option value="mystic">Mystic</option>
                  <option value="scientist">Scientist</option>
                  <option value="villain">Villain</option>
                  <option value="hero">Hero</option>
                  <option value="other">Other</option>
                </select>
                <div className="flex gap-1.5 pt-1">
                  <button
                    onClick={handleAddCharacter}
                    className="flex-1 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowForm(false)}
                    className="flex-1 px-3 py-1.5 border border-primary/15 text-primary/40 hover:text-primary/60 font-mono text-[8px] tracking-widest uppercase transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            ) : (
              <button
                onClick={() => setShowForm(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/50 font-mono text-[8px] tracking-widest uppercase transition-all"
              >
                <Plus className="w-3 h-3" />
                Add Character
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}