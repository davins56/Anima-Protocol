import { useState, useCallback } from 'react';
import { Search, Brain, BookOpen, Heart, Zap, TrendingUp, X, ChevronDown, Sparkles, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

const MEMORY_TYPE_CONFIG = {
  narrative_event:       { color: 'text-blue-400',   bg: 'bg-blue-400/10',   border: 'border-blue-400/30',   label: 'Event' },
  relationship_dynamic:  { color: 'text-pink-400',   bg: 'bg-pink-400/10',   border: 'border-pink-400/30',   label: 'Relationship' },
  character_interaction: { color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30', label: 'Interaction' },
  emotional_moment:      { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: 'Emotion' },
  conflict:              { color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',    label: 'Conflict' },
  resolution:            { color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/30',  label: 'Resolution' },
  growth:                { color: 'text-cyan-400',   bg: 'bg-cyan-400/10',   border: 'border-cyan-400/30',   label: 'Growth' },
};

const QUICK_SEARCHES = [
  'first time we met',
  'biggest conflict',
  'emotional confession',
  'a secret revealed',
  'moment of trust',
  'turning point',
];

function MemoryCard({ memory, onInject, injected }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = MEMORY_TYPE_CONFIG[memory.memory_type] || { color: 'text-primary/50', bg: 'bg-primary/5', border: 'border-primary/15', label: memory.memory_type };
  const score = memory.similarity_score != null ? Math.round(memory.similarity_score * 100) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded p-3 space-y-2 transition-colors ${cfg.border} ${cfg.bg} hover:brightness-110`}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[8px] font-mono tracking-widest uppercase ${cfg.color}`}>{cfg.label}</span>
            {score != null && (
              <span className="text-[7px] font-mono text-primary/40 bg-primary/10 px-1.5 py-0.5 rounded">
                {score}% match
              </span>
            )}
            {memory.narrative_significance > 0.7 && (
              <TrendingUp className="w-2.5 h-2.5 text-yellow-400" title="High significance" />
            )}
          </div>
          <p className="font-mono text-[10px] text-primary/90 tracking-wide mt-0.5 font-semibold line-clamp-1">
            {memory.title || memory.subject || 'Untitled Memory'}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 text-primary/30 hover:text-primary/60 transition-colors"
            title="Expand"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => onInject(memory)}
            title={injected ? 'Injected into next message' : 'Inject into AI context'}
            className={`p-1.5 rounded border transition-all ${
              injected
                ? 'bg-green-400/20 border-green-400/40 text-green-400'
                : 'bg-primary/10 border-primary/30 text-primary/60 hover:text-primary hover:border-primary/50'
            }`}
          >
            {injected ? <Check className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Preview */}
      <p className={`text-[9px] font-mono text-primary/70 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
        {memory.content || memory.description}
      </p>

      {/* Expanded metadata */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="pt-2 border-t border-primary/10 space-y-1.5"
          >
            {memory.emotional_signature?.primary_emotion && (
              <div className="flex items-center gap-2 text-[8px] font-mono text-primary/50">
                <Heart className="w-2.5 h-2.5 text-pink-400" />
                {memory.emotional_signature.primary_emotion}
                {memory.emotional_signature.intensity && ` · intensity ${memory.emotional_signature.intensity}/10`}
              </div>
            )}
            {memory.related_events?.length > 0 && (
              <div className="text-[8px] font-mono text-primary/40">
                Events: {memory.related_events.join(', ')}
              </div>
            )}
            {memory.recall_count > 0 && (
              <div className="text-[8px] font-mono text-primary/30">
                Recalled {memory.recall_count}× across sessions
              </div>
            )}
            {memory.session_id && (
              <div className="text-[7px] font-mono text-primary/20">
                Session: {memory.session_id.slice(0, 8)}…
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function MemoryRecallPanel({ characterId, sessionId, onMemoriesInjected }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [injectedIds, setInjectedIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'browse'
  const [browseMemories, setBrowseMemories] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseLoaded, setBrowseLoaded] = useState(false);
  const [injectedCount, setInjectedCount] = useState(0);

  const handleSearch = useCallback(async (q = query) => {
    if (!q.trim() || !characterId) return;
    setSearching(true);
    setSearched(false);
    try {
      const res = await base44.functions.invoke('vectorMemorySearch', {
        character_id: characterId,
        query: q.trim(),
        limit: 10,
        similarity_threshold: 0.3,
      });
      setResults(res?.data?.memories || []);
      setSearched(true);
    } catch (err) {
      console.error('Memory search failed:', err);
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }, [query, characterId]);

  const handleBrowse = useCallback(async () => {
    if (browseLoaded || !characterId) return;
    setBrowseLoading(true);
    try {
      const res = await base44.entities.VectorMemory.filter(
        { character_id: characterId },
        '-created_date',
        30
      );
      setBrowseMemories(res || []);
      setBrowseLoaded(true);
    } catch (err) {
      console.error('Browse failed:', err);
    } finally {
      setBrowseLoading(false);
    }
  }, [characterId, browseLoaded]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'browse') handleBrowse();
  };

  const handleInject = useCallback((memory) => {
    setInjectedIds(prev => {
      const next = new Set(prev);
      if (next.has(memory.id)) {
        next.delete(memory.id);
      } else {
        next.add(memory.id);
      }
      return next;
    });

    // Collect all currently injected memories and notify parent
    const allDisplayed = activeTab === 'search' ? results : browseMemories;
    const currentlyInjected = allDisplayed.filter(m => injectedIds.has(m.id));

    // Toggle this memory in/out
    const isRemoving = injectedIds.has(memory.id);
    const newInjected = isRemoving
      ? currentlyInjected.filter(m => m.id !== memory.id)
      : [...currentlyInjected, memory];

    setInjectedCount(newInjected.length);
    onMemoriesInjected?.(newInjected);
  }, [injectedIds, results, browseMemories, activeTab, onMemoriesInjected]);

  if (!characterId) return null;

  const displayResults = activeTab === 'search' ? results : browseMemories;
  const isLoading = activeTab === 'search' ? searching : browseLoading;

  return (
    <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/15 bg-black/30">
        <div className="flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">Memory Recall</span>
          {injectedCount > 0 && (
            <span className="text-[7px] font-mono px-1.5 py-0.5 bg-green-400/20 text-green-400 border border-green-400/30 rounded">
              {injectedCount} injected
            </span>
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1">
          {['search', 'browse'].map(tab => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-2 py-1 font-mono text-[8px] tracking-widest uppercase border rounded transition-all ${
                activeTab === tab
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-primary/10 text-primary/30 hover:text-primary/60'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Search Tab */}
      {activeTab === 'search' && (
        <div className="p-3 space-y-3">
          {/* Search input */}
          <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search past moments… e.g. 'first confession'"
              className="flex-1 bg-black/50 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-2.5 py-2 focus:outline-none focus:border-primary/50 transition-colors rounded"
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="px-3 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-40 transition-all rounded flex items-center gap-1"
            >
              {searching ? (
                <div className="w-3.5 h-3.5 border border-primary/30 border-t-primary rounded-full animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
            </button>
          </form>

          {/* Quick search chips */}
          {!searched && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SEARCHES.map(qs => (
                <button
                  key={qs}
                  onClick={() => { setQuery(qs); handleSearch(qs); }}
                  className="text-[8px] font-mono px-2 py-1 border border-primary/15 bg-primary/5 text-primary/50 hover:text-primary/80 hover:border-primary/30 rounded transition-all"
                >
                  {qs}
                </button>
              ))}
            </div>
          )}

          {/* Results */}
          {searched && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-center py-4 font-mono text-[9px] text-primary/30 tracking-widest uppercase">
                  No memories matched
                </p>
              ) : (
                <>
                  <p className="font-mono text-[8px] text-primary/30 tracking-widest">
                    {results.length} memories found
                  </p>
                  {results.map(mem => (
                    <MemoryCard
                      key={mem.id}
                      memory={mem}
                      onInject={handleInject}
                      injected={injectedIds.has(mem.id)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Browse Tab */}
      {activeTab === 'browse' && (
        <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
          {browseLoading ? (
            <p className="text-center py-4 font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
              Loading memories…
            </p>
          ) : browseMemories.length === 0 ? (
            <p className="text-center py-4 font-mono text-[9px] text-primary/30 tracking-widest uppercase">
              No memories formed yet
            </p>
          ) : (
            browseMemories.map(mem => (
              <MemoryCard
                key={mem.id}
                memory={mem}
                onInject={handleInject}
                injected={injectedIds.has(mem.id)}
              />
            ))
          )}
        </div>
      )}

      {/* Injection hint */}
      {injectedCount > 0 && (
        <div className="px-3 py-2 border-t border-green-400/20 bg-green-400/5 flex items-center justify-between">
          <p className="font-mono text-[8px] text-green-400/80">
            ✦ {injectedCount} {injectedCount === 1 ? 'memory' : 'memories'} will be referenced in the next AI response
          </p>
          <button
            onClick={() => {
              setInjectedIds(new Set());
              setInjectedCount(0);
              onMemoriesInjected?.([]);
            }}
            className="text-green-400/50 hover:text-green-400 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}