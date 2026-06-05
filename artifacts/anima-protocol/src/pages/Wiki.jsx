import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useStoreSync } from "@/lib/useStoreSync";
import { useConfirm } from "@/lib/ConfirmDialog";
import { BookOpen, Map, Shield, Scroll, Search, Trash2, Plus, X, Loader, Network, ArrowLeft } from "lucide-react";
import RelationshipTimeline from "@/components/lorebook/RelationshipTimeline";

export default function Wiki() {
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [lore, setLore] = useState([]);
  const [locations, setLocations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSession, setFilterSession] = useState(sessionId || "all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newEntityType, setNewEntityType] = useState("item");
  const [newEntityData, setNewEntityData] = useState({ name: "", description: "", category: "" });
  const [savingEntity, setSavingEntity] = useState(false);
  const [showVisualization, setShowVisualization] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [l, loc, s] = await Promise.all([
      base44.entities.WorldState.list("-created_date", 300),
      base44.entities.Location.list("-created_date", 100),
      base44.entities.ChatSession.list("-created_date", 100),
    ]);
    setLore(l || []);
    setLocations(loc || []);
    setSessions(s || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Live cross-device sync: refetch when another device changes our data.
  useStoreSync(loadData);

  const handleDeleteLore = async (id) => {
    const ok = await confirm({
      title: "Delete this lore entry?",
      message: "This permanently removes the entry and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await base44.entities.WorldState.delete(id);
    await loadData();
  };

  const handleDeleteLocation = async (id) => {
    const ok = await confirm({
      title: "Delete this location?",
      message: "This permanently removes the location and cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await base44.entities.Location.delete(id);
    await loadData();
  };

  const handleCreateEntity = async () => {
    if (!newEntityData.name.trim() || !newEntityData.description.trim()) return;
    
    setSavingEntity(true);
    try {
      if (newEntityType === "location") {
        await base44.entities.Location.create({
          name: newEntityData.name,
          description: newEntityData.description,
          x_coord: Math.random() * 100,
          y_coord: Math.random() * 100,
          category: newEntityData.category || "other",
          significance: "important",
          visited: false,
        });
      } else {
        await base44.entities.WorldState.create({
          session_id: filterSession !== "all" ? filterSession : null,
          category: newEntityType,
          subject: newEntityData.name,
          fact: newEntityData.description,
          importance: "medium",
          is_active: true,
        });
      }
      await loadData();
      setShowNewForm(false);
      setNewEntityData({ name: "", description: "", category: "" });
    } catch (err) {
      console.error("Error creating entity:", err);
    } finally {
      setSavingEntity(false);
    }
  };

  const filteredLore = lore.filter((entry) => {
    const sessionMatch = filterSession === "all" || entry.session_id === filterSession;
    const categoryMatch = filterCategory === "all" || entry.category === filterCategory;
    const searchMatch =
      !search.trim() ||
      entry.subject?.toLowerCase().includes(search.toLowerCase()) ||
      entry.fact?.toLowerCase().includes(search.toLowerCase());
    return sessionMatch && categoryMatch && searchMatch && entry.is_active;
  });

  const filteredLocations = locations.filter((loc) => {
    const searchMatch =
      !search.trim() ||
      loc.name?.toLowerCase().includes(search.toLowerCase()) ||
      loc.description?.toLowerCase().includes(search.toLowerCase());
    return searchMatch;
  });

  const categoryIcons = {
    location: Map,
    faction: Shield,
    event: Scroll,
    character_fact: BookOpen,
    item: BookOpen,
    relationship: BookOpen,
    secret: BookOpen,
    rule: BookOpen,
  };

  const categoryColors = {
    location: "border-blue-400/40 bg-blue-400/10 text-blue-400",
    faction: "border-purple-400/40 bg-purple-400/10 text-purple-400",
    event: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
    character_fact: "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
    item: "border-green-400/40 bg-green-400/10 text-green-400",
    relationship: "border-pink-400/40 bg-pink-400/10 text-pink-400",
    secret: "border-red-400/40 bg-red-400/10 text-red-400",
    rule: "border-orange-400/40 bg-orange-400/10 text-orange-400",
  };

  const getIcon = (category) => {
    const Icon = categoryIcons[category] || BookOpen;
    return Icon;
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background overflow-x-hidden">
      <div className="w-full px-4 sm:px-6 py-6">
        {/* Header */}
         <div className="mb-8 flex items-start justify-between gap-4">
           <div className="flex items-center gap-4">
             <Link to="/" className="text-primary/40 hover:text-primary transition-colors flex-shrink-0">
               <ArrowLeft className="w-5 h-5" />
             </Link>
             <div>
               <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-xl sm:text-2xl mb-2">
                 // World Wiki
               </h1>
               <p className="text-[11px] sm:text-sm font-mono text-primary/40 tracking-widest">
                 Define and cross-reference entities from your story
               </p>
             </div>
           </div>
           <button
             onClick={() => setShowNewForm(true)}
             className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase hud-corner glow-border flex-shrink-0"
           >
             <Plus className="w-4 h-4" />
             <span className="hidden sm:inline">New</span>
           </button>
         </div>

        {/* Visualization Toggle */}
         {filterSession !== "all" && (
           <div className="mb-8">
             <button
               onClick={() => setShowVisualization(!showVisualization)}
               className="flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-400/40 text-purple-400 hover:bg-purple-500/20 font-mono text-xs tracking-widest uppercase hud-corner transition-all"
             >
               <Network className="w-4 h-4" />
               {showVisualization ? "Hide" : "Show"} Timeline
             </button>
           </div>
         )}

         {/* Visualization Panel */}
         {showVisualization && filterSession !== "all" && (
           <div className="mb-8 p-6 border border-primary/20 bg-black/40 hud-corner">
             <RelationshipTimeline sessionId={filterSession} />
           </div>
         )}

        {/* Filters */}
         <div className="grid grid-cols-1 gap-3 sm:gap-4 mb-8">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search wiki entries..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          <select
            value={filterSession}
            onChange={(e) => setFilterSession(e.target.value)}
            className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="all">All Sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"}
              </option>
            ))}
          </select>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="all">All Categories</option>
            <option value="location">Locations</option>
            <option value="faction">Factions</option>
            <option value="event">Events</option>
            <option value="character_fact">Characters</option>
            <option value="item">Items</option>
            <option value="relationship">Relationships</option>
            <option value="secret">Secrets</option>
            <option value="rule">Rules</option>
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
            Loading wiki...
          </div>
        ) : filteredLore.length === 0 && filteredLocations.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-8 h-8 text-primary/10 mx-auto mb-3" />
            <p className="font-mono text-primary/20 text-sm tracking-widest uppercase">
              {lore.length === 0 && locations.length === 0
                ? "No wiki entries yet"
                : "No matching entries"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {/* Location Cards */}
            {filteredLocations.map((loc) => {
              const Icon = Map;
              return (
                <div
                  key={`loc-${loc.id}`}
                  className="border border-blue-400/30 bg-blue-400/5 p-4 hud-corner hover:border-blue-400/50 hover:bg-blue-400/10 transition-all"
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div className="w-5 h-5 sm:w-6 sm:h-6 border border-blue-400/50 bg-blue-400/20 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-mono text-[10px] sm:text-xs tracking-wider uppercase text-blue-400 truncate">
                        {loc.name}
                      </h3>
                      <p className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest mt-0.5">
                        {loc.category || "location"}
                      </p>
                    </div>
                  </div>

                  {loc.description && (
                    <p className="text-[9px] sm:text-[10px] font-mono text-primary/60 leading-relaxed mb-2 line-clamp-3">
                      {loc.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-blue-400/20">
                    <span className="text-[9px] font-mono text-primary/25">
                      {loc.significance || "important"}
                    </span>
                    <button
                      onClick={() => handleDeleteLocation(loc.id)}
                      className="text-red-900/40 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Lore Cards */}
            {filteredLore.map((entry) => {
              const Icon = getIcon(entry.category);
              const colorClass = categoryColors[entry.category] || categoryColors.rule;
              const sessionTitle = sessions.find((s) => s.id === entry.session_id)?.title || "Unknown";

              return (
                <div
                  key={`lore-${entry.id}`}
                  className={`border ${colorClass} p-4 hud-corner hover:brightness-110 transition-all`}
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div
                      className={`w-5 h-5 sm:w-6 sm:h-6 border flex items-center justify-center flex-shrink-0 ${colorClass.split(" ").slice(0, 1)[0]
                        }`}
                    >
                      <Icon className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-mono text-[10px] sm:text-xs tracking-wider uppercase truncate">
                        {entry.subject}
                      </h3>
                      <p className="text-[8px] sm:text-[9px] font-mono text-current/60 tracking-widest mt-0.5">
                        {entry.category}
                      </p>
                    </div>
                  </div>

                  <p className="text-[9px] sm:text-[10px] font-mono text-current/70 leading-relaxed mb-2 line-clamp-3">
                    {entry.fact}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-current/20">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] font-mono text-current/50 tracking-widest uppercase">
                        {entry.importance}
                      </span>
                      {entry.importance === "critical" && (
                        <span className="text-[8px] font-mono text-red-400">⚠</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteLore(entry.id)}
                      className="text-red-900/40 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <p className="text-[8px] font-mono text-current/40 mt-2 truncate">
                    Session: {sessionTitle}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Stats Footer */}
        {!loading && (
          <div className="mt-8 p-3 sm:p-4 border border-primary/10 bg-primary/5 grid grid-cols-3 gap-2 sm:gap-4 text-center">
            <div>
              <p className="font-mono text-[8px] sm:text-[9px] text-primary/30 tracking-widest uppercase">
                {filteredLore.length} lore
              </p>
            </div>
            <div>
              <p className="font-mono text-[8px] sm:text-[9px] text-primary/30 tracking-widest uppercase">
                {filteredLocations.length} locs
              </p>
            </div>
            <div>
              <p className="font-mono text-[8px] sm:text-[9px] text-primary/30 tracking-widest uppercase">
                {filterCategory === "faction"
                  ? filteredLore.filter((l) => l.category === "faction").length
                  : "~"}{" "}
                factions
              </p>
            </div>
          </div>
        )}
      </div>

      {/* New Entity Modal */}
      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-background border border-primary/30 hud-corner glow-border">
            <div className="flex items-center justify-between p-4 border-b border-primary/20">
              <h2 className="font-mono text-primary text-xs tracking-[0.2em] uppercase">// New Wiki Entry</h2>
              <button
                onClick={() => setShowNewForm(false)}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Type</label>
                <select
                  value={newEntityType}
                  onChange={(e) => setNewEntityType(e.target.value)}
                  className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-2.5 py-1.5 focus:outline-none focus:border-primary/40"
                >
                  <option value="item">Item</option>
                  <option value="location">Location</option>
                  <option value="faction">Faction</option>
                  <option value="event">Event</option>
                  <option value="secret">Secret</option>
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Name</label>
                <input
                  value={newEntityData.name}
                  onChange={(e) => setNewEntityData(d => ({ ...d, name: e.target.value }))}
                  placeholder="Entity name..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-2.5 py-1.5 focus:outline-none focus:border-primary/40"
                />
              </div>

              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Description</label>
                <textarea
                  value={newEntityData.description}
                  onChange={(e) => setNewEntityData(d => ({ ...d, description: e.target.value }))}
                  placeholder="What is this entity..."
                  rows={3}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-2.5 py-1.5 focus:outline-none focus:border-primary/40 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowNewForm(false)}
                  className="flex-1 px-3 py-1.5 border border-primary/15 text-primary/30 hover:text-primary/60 font-mono text-[9px] tracking-widest uppercase"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateEntity}
                  disabled={savingEntity || !newEntityData.name.trim() || !newEntityData.description.trim()}
                  className="flex-1 px-3 py-1.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase flex items-center justify-center gap-1"
                >
                  {savingEntity ? (
                    <>
                      <Loader className="w-2.5 h-2.5 animate-spin" />
                      <span className="hidden sm:inline">Saving</span>
                    </>
                  ) : (
                    "Create"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}