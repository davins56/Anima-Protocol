import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { BookOpen, Tag, Search, Sparkles, MapPin, Users, Zap, Eye, Crown, Lightbulb, ArrowLeft } from "lucide-react";

const DISCOVERY_ICONS = {
  location: MapPin,
  event: Zap,
  faction: Crown,
  artifact: Sparkles,
  character_detail: Users,
  history: Eye,
};

const DISCOVERY_COLORS = {
  location: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  event: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  faction: "text-purple-400 border-purple-400/30 bg-purple-400/5",
  artifact: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",
  character_detail: "text-pink-400 border-pink-400/30 bg-pink-400/5",
  history: "text-green-400 border-green-400/30 bg-green-400/5",
};

export default function WorldCodex() {
   const navigate = useNavigate();
   const [loreEntries, setLoreEntries] = useState([]);
   const [discoveries, setDiscoveries] = useState([]);
   const [loading, setLoading] = useState(true);
   const [search, setSearch] = useState("");
   const [selectedTag, setSelectedTag] = useState(null);
   const [allTags, setAllTags] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [lore, disc] = await Promise.all([
        base44.entities.WorldState.list("-created_date", 200),
        base44.entities.PendingDiscovery.filter({ status: "approved" }, "-created_date", 100),
      ]);
      
      setLoreEntries(lore || []);
      setDiscoveries(disc || []);
      
      // Collect all tags from lore
      const tags = new Set();
      (lore || []).forEach(entry => {
        if (entry.category) tags.add(entry.category);
      });
      (disc || []).forEach(entry => {
        if (entry.discovery_type) tags.add(entry.discovery_type);
      });
      setAllTags(Array.from(tags).sort());
    } catch (err) {
      console.error("Error loading codex data:", err);
    } finally {
      setLoading(false);
    }
  };

  const filterEntries = () => {
    const searchLower = search.toLowerCase();
    const combined = [
      ...(loreEntries || []).map(e => ({ ...e, _type: "lore" })),
      ...(discoveries || []).map(e => ({ ...e, _type: "discovery" }))
    ];

    return combined.filter(entry => {
      const matchesSearch = !searchLower || 
        (entry.subject || entry.fact || entry.title || "").toLowerCase().includes(searchLower) ||
        (entry.description || "").toLowerCase().includes(searchLower);
      
      const matchesTag = !selectedTag || 
        entry.category === selectedTag || 
        entry.discovery_type === selectedTag;
      
      return matchesSearch && matchesTag;
    });
  };

  const filteredEntries = filterEntries();
  const grouped = {};
  filteredEntries.forEach(entry => {
    const key = entry._type === "lore" ? entry.category : entry.discovery_type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(entry);
  });

  const sortedGroups = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background overflow-x-hidden">
      <div className="w-full px-3 sm:px-6 py-4 sm:py-6">
        {/* Header */}
         <div className="mb-6 flex items-start justify-between gap-4">
           <div className="flex-1">
             <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl mb-2 flex items-center gap-2">
               <BookOpen className="w-5 sm:w-6 h-5 sm:h-6" />
               // World Codex
             </h1>
          <p className="text-[10px] sm:text-xs font-mono text-primary/40 tracking-widest">
            A compendium of all discovered lore, locations, artifacts, and world-building facts
          </p>
          </div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-2 border border-primary/20 hover:border-primary/40 text-primary/60 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all flex-shrink-0"
          title="Back"
        >
          <ArrowLeft className="w-3 h-3" />
          <span className="hidden sm:inline">Back</span>
        </button>
          </div>

        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-xs sm:text-sm animate-pulse">
            Loading codex...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Search and Filter */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search entries..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-10 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Tag Filter */}
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedTag(null)}
                    className={`px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all ${
                      !selectedTag
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-primary/15 text-primary/30 hover:text-primary/60"
                    }`}
                  >
                    All ({filteredEntries.length})
                  </button>
                  {allTags.map(tag => {
                    const count = filteredEntries.filter(e => (e.category || e.discovery_type) === tag).length;
                    return (
                      <button
                        key={tag}
                        onClick={() => setSelectedTag(tag)}
                        className={`px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-all flex items-center gap-1.5 ${
                          selectedTag === tag
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-primary/15 text-primary/30 hover:text-primary/60"
                        }`}
                      >
                        <Tag className="w-3 h-3" />
                        <span>{tag}</span>
                        <span className="text-primary/50">({count})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Entries */}
            {filteredEntries.length === 0 ? (
              <div className="text-center py-12">
                <Lightbulb className="w-8 h-8 text-primary/10 mx-auto mb-3" />
                <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase">
                  No entries found
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {sortedGroups.map(([category, entries]) => {
                  const Icon = DISCOVERY_ICONS[category] || BookOpen;
                  const colorClass = DISCOVERY_COLORS[category] || "text-primary/60 border-primary/20 bg-primary/5";
                  
                  return (
                    <div key={category}>
                      <div className={`flex items-center gap-2 mb-3 px-3 py-2 border rounded ${colorClass}`}>
                        <Icon className="w-4 h-4" />
                        <h2 className="font-mono text-xs tracking-[0.15em] uppercase font-semibold">
                          {category}
                        </h2>
                        <span className="ml-auto text-[9px] opacity-60">{entries.length}</span>
                      </div>

                      <div className="space-y-2">
                        {entries.map((entry, idx) => {
                          const isDiscovery = entry._type === "discovery";
                          return (
                            <div
                              key={idx}
                              className="p-3 sm:p-4 border border-primary/10 bg-black/40 hover:border-primary/25 hover:bg-black/60 transition-all"
                            >
                              {/* Title */}
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <h3 className="font-mono text-xs sm:text-sm text-primary/90 tracking-wider uppercase flex-1">
                                  {isDiscovery ? entry.subject : entry.subject}
                                </h3>
                                {isDiscovery && entry.confidence && (
                                  <span className="text-[8px] font-mono text-primary/40">
                                    {Math.round(entry.confidence * 100)}%
                                  </span>
                                )}
                              </div>

                              {/* Content */}
                              <p className="font-mono text-[9px] sm:text-[10px] text-primary/60 leading-relaxed mb-2">
                                {isDiscovery ? entry.description : entry.fact}
                              </p>

                              {/* Importance or Context */}
                              <div className="flex flex-wrap items-center gap-2">
                                {!isDiscovery && entry.importance && (
                                  <span className={`text-[8px] font-mono tracking-widest uppercase px-2 py-1 border ${
                                    entry.importance === "critical"
                                      ? "border-red-400/40 text-red-400"
                                      : entry.importance === "high"
                                      ? "border-orange-400/40 text-orange-400"
                                      : entry.importance === "medium"
                                      ? "border-yellow-400/40 text-yellow-400"
                                      : "border-primary/20 text-primary/40"
                                  }`}>
                                    {entry.importance}
                                  </span>
                                )}
                                {isDiscovery && entry.status && (
                                  <span className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
                                    ✓ {entry.status}
                                  </span>
                                )}
                                <span className="text-[8px] font-mono text-primary/20 tracking-widest ml-auto">
                                  {new Date(entry.created_date || entry.approved_at).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}