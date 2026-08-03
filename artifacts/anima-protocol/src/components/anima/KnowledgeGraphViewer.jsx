import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Network, Loader, RefreshCw, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function KnowledgeGraphViewer() {
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [buildingGraph, setBuildingGraph] = useState(false);

  useEffect(() => {
    loadGraph();
  }, []);

  const loadGraph = async () => {
    try {
      setLoading(true);
      const user = await base44.auth.me();
      const graphs = await base44.entities.KnowledgeGraph.filter({
        user_email: user.email,
        is_active: true
      });
      if (graphs?.length > 0) {
        setGraph(graphs[0]);
      }
    } catch (err) {
      console.error('Failed to load graph:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBuildGraph = async () => {
    setBuildingGraph(true);
    try {
      const result = await base44.functions.invoke('buildKnowledgeGraph', {});
      if (result?.data?.success) {
        await loadGraph();
      }
    } catch (err) {
      console.error('Failed to build graph:', err);
    } finally {
      setBuildingGraph(false);
    }
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const result = await base44.functions.invoke('queryKnowledgeGraph', {
        query
      });
      setResults(result?.data?.results || []);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 p-4 border border-cyan-400/20 bg-cyan-900/10 rounded-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-cyan-400" />
          <h2 className="font-mono text-cyan-400 tracking-wider uppercase text-sm">
            Knowledge Graph
          </h2>
        </div>
        <button
          onClick={handleBuildGraph}
          disabled={buildingGraph}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600/30 border border-cyan-400/40 text-cyan-400 hover:bg-cyan-600/50 disabled:opacity-50 font-mono text-[8px] tracking-widest uppercase transition-all rounded"
        >
          {buildingGraph ? (
            <>
              <Loader className="w-3 h-3 animate-spin" />
              Building...
            </>
          ) : (
            <>
              <RefreshCw className="w-3 h-3" />
              Rebuild
            </>
          )}
        </button>
      </div>

      {/* Stats */}
      {graph && (
        <div className="grid grid-cols-3 gap-2 text-[8px] font-mono">
          <div className="border border-cyan-400/15 bg-cyan-400/5 p-2 rounded">
            <span className="text-cyan-400/60">Entities</span>
            <p className="text-cyan-400 font-bold">{graph.total_entities}</p>
          </div>
          <div className="border border-cyan-400/15 bg-cyan-400/5 p-2 rounded">
            <span className="text-cyan-400/60">Relationships</span>
            <p className="text-cyan-400 font-bold">{graph.edges.length}</p>
          </div>
          <div className="border border-cyan-400/15 bg-cyan-400/5 p-2 rounded">
            <span className="text-cyan-400/60">Documents</span>
            <p className="text-cyan-400 font-bold">{graph.document_count}</p>
          </div>
        </div>
      )}

      {/* Search */}
      {graph && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-cyan-400/30" />
            <input
              type="text"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-black/60 border border-cyan-400/20 text-cyan-400/80 placeholder-cyan-400/30 font-mono text-[9px] px-3 py-1.5 pl-8 focus:outline-none focus:border-cyan-400/50 rounded transition-colors"
            />
          </div>

          {/* Search Results */}
          <AnimatePresence>
            {results.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2 max-h-64 overflow-y-auto"
              >
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    className="p-2 border border-cyan-400/15 bg-black/40 rounded"
                  >
                    <p className="font-mono text-[9px] text-cyan-400">
                      {result.entity}
                      <span className="text-cyan-400/50 ml-2">({result.type})</span>
                    </p>
                    {result.description && (
                      <p className="text-[8px] text-cyan-400/60 mt-1">
                        {result.description}
                      </p>
                    )}
                    {result.connected_entities.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[7px] text-cyan-400/40 uppercase tracking-widest">
                          Connections:
                        </p>
                        {result.connected_entities.slice(0, 3).map((conn, cidx) => (
                          <p
                            key={cidx}
                            className="text-[8px] text-cyan-400/70 ml-2"
                          >
                            • {conn.label}
                            <span className="text-cyan-400/50"> {conn.relation}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {searchQuery && results.length === 0 && !searching && (
            <p className="text-[8px] font-mono text-cyan-400/40 text-center py-2">
              No entities match your search
            </p>
          )}
        </div>
      )}

      {!graph && !loading && (
        <p className="text-[8px] font-mono text-cyan-400/50 text-center py-4">
          Upload documents to build the knowledge graph
        </p>
      )}
    </motion.div>
  );
}