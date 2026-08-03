import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Search, Loader, X, BookMarked } from "lucide-react";
import { motion } from "framer-motion";

export default function RealStoriesBrowser({ onSelectStory, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await base44.functions.invoke("fetchYnStoryURL", {
        search_query: query,
        limit: 10,
      });
      setResults(res?.data?.stories || []);
      setSearched(true);
    } catch (err) {
      console.error("Error searching stories:", err);
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStory = (story) => {
    onSelectStory(story);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-2xl max-h-[80vh] bg-background border border-primary/30 rounded overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20">
          <div className="flex items-center gap-3">
            <BookMarked className="w-5 h-5 text-primary" />
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">Real Stories</h2>
          </div>
          <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-6 border-b border-primary/20 bg-black/40">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stories (Marvel, Game of Thrones, etc.)..."
                className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-10 py-2 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
            >
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : "Search"}
            </button>
          </form>
          <p className="text-[9px] font-mono text-primary/40 mt-2 tracking-widest">
            Search for universes like MCU, Star Wars, Harry Potter, or specific stories
          </p>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader className="w-6 h-6 text-primary/60 animate-spin" />
            </div>
          ) : !searched ? (
            <div className="text-center py-12">
              <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
                Enter a search query to find stories
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12">
              <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
                No stories found. Try a different query.
              </p>
            </div>
          ) : (
            results.map((story, idx) => (
              <motion.button
                key={idx}
                onClick={() => handleSelectStory(story)}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="w-full p-4 border border-primary/20 bg-black/40 hover:bg-primary/10 hover:border-primary/40 text-left transition-all rounded space-y-2"
              >
                <h3 className="font-mono text-primary font-semibold text-sm">{story.title || "Untitled"}</h3>
                <p className="text-[9px] font-mono text-primary/50 leading-relaxed line-clamp-2">
                  {story.description || story.summary || "A narrative from the multiverse awaits..."}
                </p>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[8px] font-mono text-primary/40">{story.universe || "Unknown Universe"}</span>
                  <span className="text-[8px] font-mono text-primary/30">Click to set insertion point →</span>
                </div>
              </motion.button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}