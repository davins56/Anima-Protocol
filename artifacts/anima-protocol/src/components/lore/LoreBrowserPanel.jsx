import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, BookOpen, Users, MapPin, Zap, ChevronRight } from 'lucide-react';

const categoryConfig = {
  character: { label: 'People', icon: Users, color: 'text-cyan-400' },
  location: { label: 'Places', icon: MapPin, color: 'text-green-400' },
  event: { label: 'Events', icon: Zap, color: 'text-yellow-400' },
};

export default function LoreBrowserPanel({ sessionId, isOpen = true, onClose }) {
  const [loreEntries, setLoreEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    loadLore();

    // Subscribe to lore updates
    const unsubscribe = base44.entities.WorldState.subscribe((event) => {
      if (event.data?.session_id === sessionId) {
        loadLore();
      }
    });

    return unsubscribe;
  }, [sessionId]);

  const loadLore = async () => {
    try {
      const data = await base44.entities.WorldState.filter(
        { session_id: sessionId, is_active: true },
        '-created_date',
        200
      );
      setLoreEntries(data || []);
      setLoading(false);
    } catch (err) {
      console.error('Error loading lore:', err);
      setLoading(false);
    }
  };

  // Filter entries by search and category
  useEffect(() => {
    let filtered = loreEntries;

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(e => e.category === selectedCategory);
    }

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        e =>
          e.subject?.toLowerCase().includes(searchLower) ||
          e.fact?.toLowerCase().includes(searchLower)
      );
    }

    setFilteredEntries(filtered);
  }, [loreEntries, search, selectedCategory]);

  if (!isOpen) return null;

  const categoryStats = {
    all: loreEntries.length,
    character: loreEntries.filter(e => e.category === 'character').length,
    location: loreEntries.filter(e => e.category === 'location').length,
    event: loreEntries.filter(e => e.category === 'event').length,
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      transition={{ duration: 0.2 }}
      className="fixed right-0 top-0 h-[100dvh] w-96 bg-black/95 border-l border-primary/20 backdrop-blur-md flex flex-col z-40 overflow-hidden"
    >
      {/* Header */}
      <div className="border-b border-primary/20 p-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary/60" />
            <h2 className="font-mono text-sm text-primary tracking-wider uppercase">
              Lore Database
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lore..."
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs pl-8 pr-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="border-b border-primary/10 px-2 py-2 flex gap-1 flex-shrink-0 overflow-x-auto">
        {['all', 'character', 'location', 'event'].map(cat => {
          const Config = cat === 'all' ? null : categoryConfig[cat];
          const Icon = Config?.icon;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[9px] font-mono tracking-widest uppercase transition-all whitespace-nowrap flex-shrink-0 ${
                selectedCategory === cat
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'bg-black/40 text-primary/40 hover:text-primary/60 border border-primary/10'
              }`}
            >
              {Icon && <Icon className="w-3 h-3" />}
              <span>{cat === 'all' ? 'All' : Config?.label}</span>
              <span className="text-[8px] text-primary/50 ml-1">({categoryStats[cat]})</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Entries List */}
        <div className="w-1/2 border-r border-primary/10 overflow-y-auto flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase animate-pulse">
                Loading...
              </p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full p-4 text-center">
              <p className="font-mono text-[8px] text-primary/20">
                No {selectedCategory === 'all' ? 'lore' : categoryConfig[selectedCategory]?.label} discovered yet
              </p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {filteredEntries.map(entry => {
                const Config = categoryConfig[entry.category];
                const Icon = Config?.icon;
                const isSelected = selectedEntry?.id === entry.id;

                return (
                  <motion.button
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    layout
                    className={`w-full text-left px-2.5 py-2 rounded border transition-all group ${
                      isSelected
                        ? 'bg-primary/15 border-primary/40'
                        : 'bg-black/30 border-primary/10 hover:border-primary/25 hover:bg-primary/5'
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {Icon && (
                        <Icon className={`w-3 h-3 flex-shrink-0 mt-0.5 ${Config?.color || 'text-primary'}`} />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[9px] text-primary/80 truncate uppercase tracking-wider">
                          {entry.subject}
                        </p>
                        {entry.importance === 'critical' && (
                          <p className="text-[7px] text-red-400 tracking-widest">CRITICAL</p>
                        )}
                      </div>
                      <ChevronRight className={`w-3 h-3 text-primary/30 flex-shrink-0 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* Details Pane */}
        <div className="w-1/2 overflow-y-auto">
          <AnimatePresence mode="wait">
            {selectedEntry ? (
              <motion.div
                key={selectedEntry.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-3 space-y-3 h-full"
              >
                {/* Entry Header */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {categoryConfig[selectedEntry.category] && (
                      <>
                        {(() => {
                          const Icon = categoryConfig[selectedEntry.category].icon;
                          return <Icon className={`w-3.5 h-3.5 ${categoryConfig[selectedEntry.category].color}`} />;
                        })()}
                      </>
                    )}
                    <span className="text-[8px] font-mono text-primary/40 uppercase tracking-widest">
                      {categoryConfig[selectedEntry.category]?.label}
                    </span>
                  </div>
                  <h3 className="font-mono text-sm text-primary tracking-wider uppercase break-words">
                    {selectedEntry.subject}
                  </h3>
                </div>

                {/* Importance Badge */}
                {selectedEntry.importance && (
                  <div>
                    <span
                      className={`px-2 py-1 rounded text-[7px] font-mono tracking-widest uppercase ${
                        selectedEntry.importance === 'critical'
                          ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                          : selectedEntry.importance === 'major'
                          ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
                          : 'bg-primary/10 text-primary/50 border border-primary/20'
                      }`}
                    >
                      {selectedEntry.importance}
                    </span>
                  </div>
                )}

                {/* Facts */}
                {selectedEntry.fact && (
                  <div>
                    <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                      Information
                    </p>
                    <p className="text-[9px] font-mono text-primary/70 leading-relaxed">
                      {selectedEntry.fact}
                    </p>
                  </div>
                )}

                {/* Category Details */}
                {selectedEntry.category === 'character' && selectedEntry.relationship_status && (
                  <div className="p-2 bg-primary/5 border border-primary/10 rounded">
                    <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                      Status
                    </p>
                    <p className="text-[9px] font-mono text-primary/70">
                      {selectedEntry.relationship_status}
                    </p>
                  </div>
                )}

                {selectedEntry.category === 'location' && selectedEntry.coordinates && (
                  <div className="p-2 bg-primary/5 border border-primary/10 rounded">
                    <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                      Coordinates
                    </p>
                    <p className="text-[9px] font-mono text-primary/70">
                      {selectedEntry.coordinates}
                    </p>
                  </div>
                )}

                {/* Related Entries */}
                {selectedEntry.related_entries?.length > 0 && (
                  <div>
                    <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                      Related
                    </p>
                    <div className="space-y-1">
                      {selectedEntry.related_entries.map(relId => {
                        const relEntry = loreEntries.find(e => e.id === relId);
                        return relEntry ? (
                          <button
                            key={relId}
                            onClick={() => setSelectedEntry(relEntry)}
                            className="text-left text-[9px] font-mono text-primary/60 hover:text-primary transition-colors px-2 py-1 bg-black/40 rounded border border-primary/10 hover:border-primary/25 w-full"
                          >
                            → {relEntry.subject}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}

                {/* Discovery Info */}
                <div className="text-[8px] font-mono text-primary/30 pt-2 border-t border-primary/10">
                  <p>Discovered: {new Date(selectedEntry.created_date).toLocaleDateString()}</p>
                </div>
              </motion.div>
            ) : (
              <div className="flex items-center justify-center h-full p-3 text-center">
                <p className="font-mono text-[8px] text-primary/20">
                  Select an entry to view details
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}