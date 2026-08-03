import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { X, MapPin, Users, BookOpen, Plus, Trash2, Edit2, Zap, ArrowLeft } from "lucide-react";
import LocationEventPin from "@/components/world/LocationEventPin";
import LocationVisitTracker from "@/components/world/LocationVisitTracker";

export default function WorldMap() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [locationLore, setLocationLore] = useState([]);
  const [locationEvents, setLocationEvents] = useState([]);
  const [locationCharacters, setLocationCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showEventPin, setShowEventPin] = useState(false);
  const [formData, setFormData] = useState({ name: "", x_coord: 50, y_coord: 50, category: "other", significance: "important" });
  const [editingId, setEditingId] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    loadLocations();
  }, []);

  useEffect(() => {
    if (selectedLocation && sessionId) {
      loadLocationDetails(selectedLocation.id);
    }
  }, [selectedLocation, sessionId]);

  useEffect(() => {
    drawMap();
  }, [locations, selectedLocation]);

  const loadLocations = async () => {
    setLoading(true);
    const data = await base44.entities.Location.list("-created_date", 100);
    setLocations(data || []);
    setLoading(false);
  };

  const loadLocationDetails = async (locationId) => {
    const locName = locations.find(l => l.id === locationId)?.name || "";

    // Fetch lore entries and events mentioning this location in parallel
    const [allLore, allChars] = await Promise.all([
      base44.entities.WorldState.filter({ is_active: true }, "-created_date", 50),
      base44.entities.Character.list("-created_date", 100),
    ]);

    const lore = (allLore || []).filter(l =>
      l.subject?.toLowerCase() === locName.toLowerCase() ||
      l.fact?.toLowerCase().includes(locName.toLowerCase())
    );
    const events = (allLore || []).filter(l =>
      l.category === "event" &&
      (l.subject?.toLowerCase().includes(locName.toLowerCase()) ||
       l.fact?.toLowerCase().includes(locName.toLowerCase()))
    );

    setLocationLore(lore);
    setLocationEvents(events);

    // Fetch session characters if specified
    if (sessionId) {
      const session = await base44.entities.ChatSession.filter({ id: sessionId });
      const charIds = session?.[0]?.mode === "group"
        ? session[0].group_character_ids || []
        : (session?.[0]?.character_id ? [session[0].character_id] : []);

      const sessionChars = allChars.filter(c => charIds.includes(c.id));
      setLocationCharacters(sessionChars);
    } else {
      setLocationCharacters([]);
    }
  };

  const handleAddLocation = async () => {
    if (!formData.name.trim()) return;

    if (editingId) {
      await base44.entities.Location.update(editingId, formData);
      setEditingId(null);
    } else {
      await base44.entities.Location.create(formData);
    }

    setFormData({ name: "", x_coord: 50, y_coord: 50, category: "other", significance: "important" });
    setShowForm(false);
    await loadLocations();
  };

  const handleDeleteLocation = async (id) => {
    await base44.entities.Location.delete(id);
    if (selectedLocation?.id === id) setSelectedLocation(null);
    await loadLocations();
  };

  const startEdit = (loc) => {
    setEditingId(loc.id);
    setFormData({
      name: loc.name,
      x_coord: loc.x_coord,
      y_coord: loc.y_coord,
      category: loc.category || "other",
      significance: loc.significance || "important"
    });
    setShowForm(true);
  };

  const handleEventPinned = async (pinData) => {
    // Mark location as visited
    await base44.entities.Location.update(selectedLocation.id, {
      visited: true,
      first_visit_session_id: sessionId || "global",
    });

    setShowEventPin(false);
    // Reload to show updated lore
    await loadLocationDetails(selectedLocation.id);
  };

  const drawMap = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = "hsl(220, 20%, 8%)";
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = "hsl(185, 50%, 15%)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 100; i += 10) {
      const px = (i / 100) * width;
      const py = (i / 100) * height;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }

    // Draw locations
    locations.forEach((loc) => {
      const x = (loc.x_coord / 100) * width;
      const y = (loc.y_coord / 100) * height;
      const isSelected = selectedLocation?.id === loc.id;
      const radius = loc.significance === "critical" ? 12 : loc.significance === "major" ? 10 : 7;

      // Glow effect for selected
      if (isSelected) {
        ctx.fillStyle = `hsl(185, 100%, 50%, 0.2)`;
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node circle
      ctx.fillStyle = loc.color_hex || "hsl(185, 100%, 50%)";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Border
      ctx.strokeStyle = isSelected ? "hsl(185, 100%, 60%)" : "hsl(185, 100%, 40%)";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Label (if room)
      if (radius > 8) {
        ctx.fillStyle = "hsl(185, 100%, 80%)";
        ctx.font = "10px 'Share Tech Mono'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(loc.name.slice(0, 12), x, y);
      }
    });
  };

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;

    // Hit detection
    for (const loc of locations) {
      const locX = (loc.x_coord / 100) * width;
      const locY = (loc.y_coord / 100) * height;
      const dist = Math.sqrt((x - locX) ** 2 + (y - locY) ** 2);

      if (dist < 20) {
        setSelectedLocation(loc);
        return;
      }
    }

    setSelectedLocation(null);
  };

  const categoryEmojis = {
    city: "🏰",
    dungeon: "🕳️",
    wilderness: "🌲",
    building: "🏛️",
    sacred_site: "⛪",
    settlement: "🏘️",
    landmark: "🗿",
    other: "📍"
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/40">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-2xl text-primary glow-text tracking-[0.2em] uppercase">// World Map</h1>
            <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest">Explore regions, discover lore, track events</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setFormData({ name: "", x_coord: 50, y_coord: 50, category: "other", significance: "important" }); }}
            className="flex items-center gap-2 px-4 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all"
          >
            <Plus className="w-4 h-4" /> Add Location
          </button>
          {sessionId && (
            <LocationVisitTracker sessionId={sessionId} />
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-6 p-6 min-h-0 overflow-hidden">
        {/* Canvas Map */}
        <div className="flex-1 flex flex-col">
        <div className="flex-1 border border-primary/30 bg-black/40 overflow-hidden rounded">
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onClick={handleCanvasClick}
            className="w-full h-full cursor-crosshair"
          />
        </div>

        {loading && (
          <div className="mt-4 text-center font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
            Loading map...
          </div>
        )}
      </div>

        {/* Location Details Sidebar */}
        {selectedLocation && (
          <div className="w-80 border border-primary/30 bg-black/60 backdrop-blur-md flex flex-col rounded overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-primary/20">
            <div className="flex-1">
              <h2 className="font-mono text-primary text-sm tracking-[0.2em] uppercase">
                {categoryEmojis[selectedLocation.category]} {selectedLocation.name}
              </h2>
              <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest">
                [{selectedLocation.category}] • {selectedLocation.significance}
              </p>
            </div>
            <button
              onClick={() => setSelectedLocation(null)}
              className="text-primary/30 hover:text-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto space-y-4 p-4">
            {/* Description */}
            {selectedLocation.description && (
              <div>
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Description</p>
                <p className="text-xs font-mono text-primary/70 leading-relaxed">{selectedLocation.description}</p>
              </div>
            )}

            {/* Lore Entries */}
            {locationLore.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4 text-primary/40" />
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Lore ({locationLore.length})</p>
                </div>
                <div className="space-y-2">
                  {locationLore.map((entry) => (
                    <div key={entry.id} className="p-2 border border-primary/15 bg-primary/5 text-[9px] font-mono text-primary/60">
                      <p className="font-bold text-primary/80 mb-0.5">{entry.subject}</p>
                      <p className="leading-relaxed">{entry.fact}</p>
                      <p className="text-primary/30 mt-1">[{entry.importance}]</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active Events */}
            {locationEvents.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-yellow-400/60" />
                  <p className="text-[9px] font-mono text-yellow-400/60 tracking-widest uppercase">Events ({locationEvents.length})</p>
                </div>
                <div className="space-y-2">
                  {locationEvents.map((event) => (
                    <div key={event.id} className="p-2 border border-yellow-400/20 bg-yellow-400/5 text-[9px] font-mono text-yellow-400/70">
                      <p className="font-bold text-yellow-400/90 mb-0.5">{event.subject}</p>
                      <p className="leading-relaxed">{event.fact}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Characters Present */}
            {locationCharacters.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-primary/40" />
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Characters ({locationCharacters.length})</p>
                </div>
                <div className="space-y-1">
                  {locationCharacters.map((char) => (
                    <div key={char.id} className="flex items-center gap-2 p-2 border border-primary/15 bg-primary/5">
                      {char.avatar_url ? (
                        <img src={char.avatar_url} alt={char.name} className="w-6 h-6 border border-primary/20" />
                      ) : (
                        <div className="w-6 h-6 border border-primary/20 bg-primary/10 flex items-center justify-center text-[9px] font-mono text-primary/60">
                          {char.name[0]}
                        </div>
                      )}
                      <span className="text-[9px] font-mono text-primary/70 tracking-wider">{char.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {locationLore.length === 0 && locationEvents.length === 0 && locationCharacters.length === 0 && (
              <p className="text-center text-primary/20 font-mono text-[9px] py-4 tracking-widest uppercase">
                No lore, events, or characters recorded
              </p>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex gap-2 p-4 border-t border-primary/20">
            {sessionId && (
              <button
                onClick={() => setShowEventPin(true)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-cyan-400/30 text-cyan-400/60 hover:text-cyan-400 hover:border-cyan-400/50 font-mono text-[9px] tracking-widest uppercase transition-all"
              >
                <Zap className="w-3 h-3" /> Pin Event
              </button>
            )}
            <button
              onClick={() => startEdit(selectedLocation)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/50 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={() => handleDeleteLocation(selectedLocation.id)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-red-900/30 text-red-900/60 hover:text-red-400 hover:border-red-400/30 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
        )}
      </div>

      {/* Add/Edit Location Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-background border border-primary/30 hud-corner glow-border">
            <div className="flex items-center justify-between p-4 border-b border-primary/20">
              <h2 className="font-mono text-primary tracking-[0.2em] uppercase">
                {editingId ? "// Edit Location" : "// New Location"}
              </h2>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="text-primary/30 hover:text-primary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Name</label>
                <input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Location name..."
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">X Coord</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.x_coord}
                    onChange={(e) => setFormData({ ...formData, x_coord: parseFloat(e.target.value) })}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Y Coord</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.y_coord}
                    onChange={(e) => setFormData({ ...formData, y_coord: parseFloat(e.target.value) })}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                >
                  {["city", "dungeon", "wilderness", "building", "sacred_site", "settlement", "landmark", "other"].map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Significance</label>
                <select
                  value={formData.significance}
                  onChange={(e) => setFormData({ ...formData, significance: e.target.value })}
                  className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                >
                  {["minor", "important", "major", "critical"].map(sig => (
                    <option key={sig} value={sig}>{sig}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 p-4 border-t border-primary/20">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="flex-1 px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary/60 font-mono text-xs tracking-widest uppercase transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLocation}
                disabled={!formData.name.trim()}
                className="flex-1 px-4 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
              >
                {editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Pin Modal */}
      {showEventPin && selectedLocation && (
        <LocationEventPin
          location={selectedLocation}
          sessionId={sessionId}
          onClose={() => setShowEventPin(false)}
          onEventPinned={handleEventPinned}
        />
      )}
    </div>
  );
}