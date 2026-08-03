import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Search, Zap, Check, X } from "lucide-react";

const POPULAR_SERIES = [
  { title: "Harry Potter", year: "2001-2007" },
  { title: "The Lord of the Rings", year: "1954-1955" },
  { title: "Stranger Things", year: "2016-2024" },
  { title: "Game of Thrones / A Song of Ice and Fire", year: "1996-present" },
  { title: "The Witcher", year: "1990-present" },
  { title: "Percy Jackson", year: "2005-2009" },
  { title: "Dune", year: "1965-present" },
  { title: "Star Wars", year: "1977-present" },
  { title: "Marvel Cinematic Universe", year: "2008-present" },
  { title: "Avatar", year: "2009-2024" },
  { title: "The Matrix", year: "1999-2003" },
  { title: "Cyberpunk 2077", year: "2020" },
];

export default function SeriesLoreIngestion({ sessionId, characterId, onComplete }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filtered = POPULAR_SERIES.filter(
    (s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.year.includes(searchQuery)
  );

  const handleIngest = async (seriesTitle) => {
    if (!seriesTitle.trim() || !sessionId) return;

    setLoading(true);
    setResult(null);
    setSelectedSeries(null);

    try {
      const response = await base44.functions.invoke("ingestSeriesLore", {
        series_title: seriesTitle,
        session_id: sessionId,
        character_id: characterId,
      });

      if (response?.data?.success) {
        setResult(response.data);
        setSearchQuery("");
        setTimeout(() => onComplete?.(), 2000);
      } else {
        setResult({ error: "Failed to ingest series lore" });
      }
    } catch (err) {
      console.error("Ingestion error:", err);
      setResult({ error: err.message || "Ingestion failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="border border-primary/20 bg-black/40 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-primary/60" />
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Preload Series Lore
          </span>
        </div>
        <p className="font-mono text-[8px] text-primary/30">
          Select a series/movie to inject canonical plot, locations, and lore into your session
        </p>
      </div>

      {/* Result Display */}
      <AnimatePresence mode="wait">
        {result && !loading && (
          <motion.div
            key="result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`p-4 border-b ${
              result.error
                ? "border-red-500/20 bg-red-500/5"
                : "border-green-500/20 bg-green-500/5"
            }`}
          >
            {result.error ? (
              <div className="flex items-start gap-2">
                <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-mono text-[9px] text-red-400 tracking-widest uppercase mb-1">
                    Error
                  </p>
                  <p className="font-mono text-[8px] text-red-400/70">{result.error}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-mono text-[9px] text-green-400 tracking-widest uppercase mb-2">
                    ✓ {result.series_name} Lore Loaded
                  </p>
                  <div className="space-y-1 text-[8px] font-mono text-green-400/70">
                    <p>📜 {result.lore_entries_created} lore entries created</p>
                    {result.memory_nodes_created > 0 && (
                      <p>🧠 {result.memory_nodes_created} memory nodes injected</p>
                    )}
                    <p className="mt-2 text-green-400/50">
                      Themes: {result.lore_summary.major_themes.slice(0, 2).join(", ")}...
                    </p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search Input */}
      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Search series or movie title..."
            disabled={loading}
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-3 py-2 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
          />
        </div>

        {/* Suggestions Dropdown */}
        <AnimatePresence>
          {showSuggestions && filtered.length > 0 && !result && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="absolute left-4 right-4 top-20 max-h-48 overflow-y-auto border border-primary/20 bg-black/80 rounded z-10"
            >
              {filtered.map((series) => (
                <button
                  key={series.title}
                  onClick={() => {
                    setSelectedSeries(series.title);
                    setSearchQuery(series.title);
                    setShowSuggestions(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b border-primary/10 last:border-b-0 transition-colors"
                >
                  <p className="font-mono text-[9px] text-primary/80 tracking-wider">
                    {series.title}
                  </p>
                  <p className="font-mono text-[8px] text-primary/40">{series.year}</p>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => handleIngest(searchQuery)}
            disabled={!searchQuery.trim() || loading}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all font-mono text-[9px] tracking-widest uppercase"
          >
            {loading ? (
              <>
                <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Zap className="w-3 h-3" />
                Ingest Lore
              </>
            )}
          </button>
          <button
            onClick={() => {
              setSearchQuery("");
              setResult(null);
              setShowSuggestions(false);
            }}
            disabled={loading}
            className="px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary/60 disabled:opacity-30 transition-colors font-mono text-[9px] tracking-widest"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Quick Links */}
      {!result && searchQuery === "" && (
        <div className="px-4 pb-3 border-t border-primary/10 space-y-1.5">
          <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">
            Popular
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {POPULAR_SERIES.slice(0, 4).map((series) => (
              <button
                key={series.title}
                onClick={() => {
                  setSelectedSeries(series.title);
                  handleIngest(series.title);
                }}
                disabled={loading}
                className="px-2.5 py-1.5 text-left bg-primary/5 hover:bg-primary/10 border border-primary/15 rounded text-[8px] font-mono text-primary/60 hover:text-primary/80 transition-all disabled:opacity-50"
              >
                {series.title.split("/")[0].split(":")[0]}
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}