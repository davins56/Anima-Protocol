import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useConfirm } from "@/lib/ConfirmDialog";
import { Search, Filter, Plus, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import WikiEntryCard from './WikiEntryCard';

const ENTRY_TYPES = ['character', 'location', 'event', 'item', 'faction', 'concept', 'creature', 'lore'];

export default function WikiBrowser({ sessionId, onEditEntry }) {
  const confirm = useConfirm();
  const [entries, setEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedImportance, setSelectedImportance] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('mention_count');

  useEffect(() => {
    loadEntries();
  }, [sessionId]);

  const loadEntries = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const data = await base44.entities.WikiCodex.filter({
        session_ids: { $elemMatch: sessionId },
      }, `-${sortBy}`, 100);
      setEntries(data || []);
    } catch (err) {
      console.error('Error loading wiki entries:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let filtered = entries;

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(searchLower) ||
        e.summary?.toLowerCase().includes(searchLower) ||
        e.tags?.some(t => t.toLowerCase().includes(searchLower))
      );
    }

    // Type filter
    if (selectedType !== 'all') {
      filtered = filtered.filter(e => e.entry_type === selectedType);
    }

    // Importance filter
    if (selectedImportance !== 'all') {
      filtered = filtered.filter(e => e.importance === selectedImportance);
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'mention_count') return (b.mention_count || 0) - (a.mention_count || 0);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });

    setFilteredEntries(filtered);
  }, [entries, search, selectedType, selectedImportance, sortBy]);

  return (
    <div className="space-y-4 p-4 border border-primary/20 bg-black/40 rounded-lg max-h-[600px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
          Wiki Codex ({filteredEntries.length})
        </h3>
      </div>

      {/* Search & Filters */}
      <div className="space-y-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entries..."
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] pl-8 pr-3 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
          />
        </div>

        {/* Filter Controls */}
        <div className="flex gap-1 flex-wrap">
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            className="text-[7px] font-mono px-2 py-1 bg-black/60 border border-primary/20 text-primary/70 focus:outline-none focus:border-primary/50 rounded"
          >
            <option value="all">All Types</option>
            {ENTRY_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <select
            value={selectedImportance}
            onChange={e => setSelectedImportance(e.target.value)}
            className="text-[7px] font-mono px-2 py-1 bg-black/60 border border-primary/20 text-primary/70 focus:outline-none focus:border-primary/50 rounded"
          >
            <option value="all">All Importance</option>
            <option value="minor">Minor</option>
            <option value="notable">Notable</option>
            <option value="major">Major</option>
            <option value="central">Central</option>
          </select>

          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="text-[7px] font-mono px-2 py-1 bg-black/60 border border-primary/20 text-primary/70 focus:outline-none focus:border-primary/50 rounded"
          >
            <option value="mention_count">Most Mentioned</option>
            <option value="name">A-Z</option>
          </select>
        </div>
      </div>

      {/* Entries List */}
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader className="w-4 h-4 text-primary/40 animate-spin" />
          </div>
        ) : filteredEntries.length > 0 ? (
          <AnimatePresence>
            {filteredEntries.map(entry => (
              <WikiEntryCard
                key={entry.id}
                entry={entry}
                onEdit={onEditEntry}
                onDelete={async (id) => {
                  const ok = await confirm({
                    title: "Delete this wiki entry?",
                    message: "This permanently removes the entry and cannot be undone.",
                    confirmLabel: "Delete",
                  });
                  if (!ok) return;
                  await base44.entities.WikiCodex.delete(id);
                  loadEntries();
                }}
              />
            ))}
          </AnimatePresence>
        ) : (
          <div className="text-center py-8">
            <Filter className="w-4 h-4 text-primary/20 mx-auto mb-2" />
            <p className="text-[8px] font-mono text-primary/40">No entries match filters</p>
          </div>
        )}
      </div>
    </div>
  );
}