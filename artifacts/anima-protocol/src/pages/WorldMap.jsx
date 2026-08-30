import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import {
  X,
  MapPin,
  Users,
  BookOpen,
  Plus,
  Trash2,
  Edit2,
  Zap,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Globe2,
  Layers,
  LocateFixed,
} from "lucide-react";
import LocationEventPin from "@/components/world/LocationEventPin";
import LocationVisitTracker from "@/components/world/LocationVisitTracker";
import { loadRosterCharacters } from "@/lib/loadRosterCharacters";
import { createCompositeAtlas } from "@/lib/universeWorldMap";

const defaultFormData = {
  name: "",
  description: "",
  x_coord: 50,
  y_coord: 50,
  category: "other",
  significance: "important",
};

const categoryEmojis = {
  city: "🏰",
  dungeon: "🕳️",
  wilderness: "🌲",
  building: "🏛️",
  sacred_site: "⛪",
  settlement: "🏘️",
  landmark: "🗿",
  other: "📍",
};

function characterInitial(character) {
  return String(character?.name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function WorldMap() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  const [locations, setLocations] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [locationLore, setLocationLore] = useState([]);
  const [locationEvents, setLocationEvents] = useState([]);
  const [locationCharacters, setLocationCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [usingBundledSeed, setUsingBundledSeed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showEventPin, setShowEventPin] = useState(false);
  const [formData, setFormData] = useState(defaultFormData);
  const [editingId, setEditingId] = useState(null);
  const [zoom, setZoom] = useState(0.72);
  const [worldFilter, setWorldFilter] = useState("all");

  const atlas = useMemo(
    () => createCompositeAtlas(characters, locations),
    [characters, locations],
  );

  const visibleWorlds = useMemo(() => {
    if (worldFilter === "all") return atlas.worlds;
    return atlas.worlds.filter((world) => world.id === worldFilter);
  }, [atlas.worlds, worldFilter]);

  const selectedLocation =
    selectedItem?.type === "location"
      ? locations.find((loc) => loc.id === selectedItem.locationId) || null
      : null;

  const selectedWorld =
    selectedItem?.type === "region"
      ? atlas.worlds.find((world) => world.id === selectedItem.worldId) || null
      : null;

  const selectedRegion =
    selectedWorld && selectedItem?.type === "region"
      ? selectedWorld.regions.find((region) => region.id === selectedItem.regionId) || null
      : null;

  useEffect(() => {
    loadMapData();
  }, []);

  useEffect(() => {
    if (selectedLocation) {
      loadLocationDetails(selectedLocation.id);
    } else {
      setLocationLore([]);
      setLocationEvents([]);
      setLocationCharacters([]);
    }
  }, [selectedLocation?.id, sessionId, characters, locations]);

  const loadMapData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let locationError = null;
      const [locData, roster] = await Promise.all([
        base44.entities.Location.list("-created_date", 100).catch((err) => {
          locationError = err;
          console.warn("Error loading map locations:", err?.message || err);
          return [];
        }),
        loadRosterCharacters({
          retrySeed: true,
          characterLimit: 1000,
          allowBundledFallback: true,
        }),
      ]);

      setLocations(locData || []);
      setCharacters(roster.characters || []);
      setUsingBundledSeed(Boolean(roster.usingBundledSeed));
      const message = locationError?.message || roster.error?.message || null;
      setLoadError(message);
    } catch (err) {
      console.error("Error loading composite world map:", err);
      setLoadError(err?.message || "Could not load the composite world map.");
      setLocations([]);
      setCharacters([]);
    } finally {
      setLoading(false);
    }
  };

  const reloadLocations = async () => {
    const data = await base44.entities.Location.list("-created_date", 100);
    setLocations(data || []);
  };

  const loadLocationDetails = async (locationId) => {
    const locName = locations.find(l => l.id === locationId)?.name || "";

    // Fetch lore entries and events mentioning this location in parallel
    const [allLore] = await Promise.all([
      base44.entities.WorldState.filter({ is_active: true }, "-created_date", 50),
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

      const sessionChars = characters.filter(c => charIds.includes(c.id));
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

    setFormData(defaultFormData);
    setShowForm(false);
    await reloadLocations();
  };

  const handleDeleteLocation = async (id) => {
    await base44.entities.Location.delete(id);
    if (selectedLocation?.id === id) setSelectedItem(null);
    await reloadLocations();
  };

  const startEdit = (loc) => {
    setEditingId(loc.id);
    setFormData({
      name: loc.name,
      description: loc.description || "",
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

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/40">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-mono text-2xl text-primary glow-text tracking-[0.2em] uppercase">// Composite World Map</h1>
            <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest">
              One scrollable atlas for every universe your AI characters inhabit
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-2 border border-primary/20 bg-black/40 font-mono text-[9px] text-primary/50 tracking-widest uppercase">
            <Globe2 className="w-4 h-4" />
            {pluralize(atlas.totals.worlds, "world")} · {pluralize(atlas.totals.characters, "character")}
          </div>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setFormData(defaultFormData); }}
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
        {/* Composite Atlas */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setWorldFilter("all")}
                className={`px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-colors ${
                  worldFilter === "all"
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-primary/20 text-primary/50 hover:text-primary/80"
                }`}
              >
                All Worlds
              </button>
              {atlas.worlds.map((world) => (
                <button
                  key={world.id}
                  onClick={() => setWorldFilter(world.id)}
                  className={`px-3 py-1.5 border font-mono text-[9px] tracking-widest uppercase transition-colors ${
                    worldFilter === world.id
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-primary/20 text-primary/50 hover:text-primary/80"
                  }`}
                >
                  {world.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom((value) => Math.max(0.45, Number((value - 0.12).toFixed(2))))}
                className="p-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 transition-colors"
                aria-label="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <div className="w-16 text-center border border-primary/15 bg-black/40 py-2 font-mono text-[9px] text-primary/50">
                {Math.round(zoom * 100)}%
              </div>
              <button
                onClick={() => setZoom((value) => Math.min(1.45, Number((value + 0.12).toFixed(2))))}
                className="p-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 transition-colors"
                aria-label="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom(0.72)}
                className="p-2 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40 transition-colors"
                aria-label="Reset zoom"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {loadError && (
            <div className="border border-yellow-400/20 bg-yellow-400/5 px-4 py-2 font-mono text-[9px] text-yellow-300/70 tracking-widest uppercase">
              {loadError}
              {usingBundledSeed ? " Showing bundled starter characters on the atlas." : ""}
            </div>
          )}

          <div className="flex-1 min-h-0 border border-primary/30 bg-black/50 rounded overflow-auto">
            <div
              className="relative"
              style={{
                width: `${atlas.dimensions.width * zoom}px`,
                height: `${atlas.dimensions.height * zoom}px`,
              }}
            >
              <svg
                viewBox={`0 0 ${atlas.dimensions.width} ${atlas.dimensions.height}`}
                className="absolute inset-0 w-full h-full cursor-crosshair"
                role="img"
                aria-label="Composite universe atlas"
              >
                <defs>
                  <pattern id="composite-grid" width="80" height="80" patternUnits="userSpaceOnUse">
                    <path d="M 80 0 L 0 0 0 80" fill="none" stroke="hsl(185 100% 50% / 0.08)" strokeWidth="1" />
                  </pattern>
                  <filter id="atlas-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="7" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <rect width={atlas.dimensions.width} height={atlas.dimensions.height} fill="hsl(220 35% 4%)" />
                <rect width={atlas.dimensions.width} height={atlas.dimensions.height} fill="url(#composite-grid)" />
                <circle cx="520" cy="480" r="470" fill="hsl(190 100% 50% / 0.04)" />
                <circle cx="1480" cy="520" r="560" fill="hsl(0 95% 60% / 0.04)" />
                <circle cx="820" cy="1150" r="350" fill="hsl(48 100% 50% / 0.04)" />
                <circle cx="1580" cy="1170" r="260" fill="hsl(170 100% 45% / 0.04)" />

                <rect x="0" y="1320" width={atlas.dimensions.width} height="180" fill="hsl(185 100% 50% / 0.025)" />
                <line x1="80" y1="1320" x2="2520" y2="1320" stroke="hsl(185 100% 50% / 0.18)" strokeDasharray="10 14" />
                <text x="120" y="1370" fill="hsl(185 100% 70% / 0.55)" className="font-mono text-[28px] tracking-[0.3em] uppercase">
                  Discovered Locations Strip
                </text>

                {visibleWorlds.map((world) => (
                  <g key={world.id}>
                    <rect
                      x={world.bounds.x}
                      y={world.bounds.y}
                      width={world.bounds.width}
                      height={world.bounds.height}
                      rx="34"
                      fill={world.color}
                      opacity="0.07"
                      stroke={world.color}
                      strokeWidth="2"
                      strokeDasharray="12 12"
                    />
                    <text
                      x={world.bounds.x + 34}
                      y={world.bounds.y + 54}
                      fill={world.color}
                      className="font-mono text-[30px] tracking-[0.18em] uppercase"
                    >
                      {world.label}
                    </text>
                    <text
                      x={world.bounds.x + 36}
                      y={world.bounds.y + 86}
                      fill="hsl(185 40% 80% / 0.48)"
                      className="font-mono text-[17px] tracking-[0.08em] uppercase"
                    >
                      {pluralize(world.characterCount, "character")} detected
                    </text>

                    {world.regions.slice(1).map((region) => (
                      <line
                        key={`${world.id}-line-${region.id}`}
                        x1={world.regions[0].x}
                        y1={world.regions[0].y}
                        x2={region.x}
                        y2={region.y}
                        stroke={world.color}
                        strokeWidth="2"
                        strokeOpacity="0.18"
                        strokeDasharray="8 12"
                      />
                    ))}

                    {world.regions.map((region) => {
                      const isSelected =
                        selectedItem?.type === "region" &&
                        selectedItem.worldId === world.id &&
                        selectedItem.regionId === region.id;
                      return (
                        <g
                          key={region.id}
                          role="button"
                          tabIndex="0"
                          onClick={() => setSelectedItem({ type: "region", worldId: world.id, regionId: region.id })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedItem({ type: "region", worldId: world.id, regionId: region.id });
                            }
                          }}
                          className="cursor-pointer"
                          filter={isSelected ? "url(#atlas-glow)" : undefined}
                        >
                          <rect
                            x={region.x - region.width / 2}
                            y={region.y - region.height / 2}
                            width={region.width}
                            height={region.height}
                            rx="28"
                            fill={region.color}
                            opacity={isSelected ? "0.28" : "0.14"}
                            stroke={region.color}
                            strokeWidth={isSelected ? "4" : "2"}
                          />
                          <circle
                            cx={region.x}
                            cy={region.y}
                            r={region.characterCount > 0 ? 19 : 12}
                            fill={region.color}
                            opacity="0.95"
                          />
                          <circle
                            cx={region.x}
                            cy={region.y}
                            r={region.characterCount > 0 ? 34 : 24}
                            fill={region.color}
                            opacity="0.16"
                          />
                          <text
                            x={region.x}
                            y={region.y - 36}
                            textAnchor="middle"
                            fill="hsl(185 100% 88%)"
                            className="font-mono text-[20px] tracking-[0.09em] uppercase pointer-events-none"
                          >
                            {region.name}
                          </text>
                          <text
                            x={region.x}
                            y={region.y + 52}
                            textAnchor="middle"
                            fill="hsl(185 50% 70% / 0.72)"
                            className="font-mono text-[16px] tracking-[0.08em] uppercase pointer-events-none"
                          >
                            {pluralize(region.characterCount, "character")}
                          </text>

                          {region.characters.slice(0, 5).map((character, index) => (
                            <g key={character.id || `${region.id}-${character.name}-${index}`} className="pointer-events-none">
                              <circle
                                cx={region.x - 48 + index * 24}
                                cy={region.y + region.height / 2 - 20}
                                r="13"
                                fill="hsl(220 25% 8%)"
                                stroke={region.color}
                                strokeWidth="1.5"
                              />
                              <text
                                x={region.x - 48 + index * 24}
                                y={region.y + region.height / 2 - 15}
                                textAnchor="middle"
                                fill={region.color}
                                className="font-mono text-[12px] font-bold"
                              >
                                {characterInitial(character)}
                              </text>
                            </g>
                          ))}
                          {region.characters.length > 5 && (
                            <text
                              x={region.x + 82}
                              y={region.y + region.height / 2 - 15}
                              fill={region.color}
                              className="font-mono text-[13px] pointer-events-none"
                            >
                              +{region.characters.length - 5}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                ))}

                {atlas.savedLocations.map((loc) => {
                  const isSelected = selectedLocation?.id === loc.id;
                  return (
                    <g
                      key={loc.id}
                      role="button"
                      tabIndex="0"
                      onClick={() => setSelectedItem({ type: "location", locationId: loc.id })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedItem({ type: "location", locationId: loc.id });
                        }
                      }}
                      className="cursor-pointer"
                      filter={isSelected ? "url(#atlas-glow)" : undefined}
                    >
                      <circle cx={loc.mapX} cy={loc.mapY} r="25" fill={loc.color_hex || "#22d3ee"} opacity="0.15" />
                      <circle
                        cx={loc.mapX}
                        cy={loc.mapY}
                        r={loc.significance === "critical" ? "15" : loc.significance === "major" ? "13" : "10"}
                        fill={loc.color_hex || "#22d3ee"}
                        stroke="hsl(185 100% 85%)"
                        strokeWidth={isSelected ? "3" : "1.5"}
                      />
                      <text
                        x={loc.mapX}
                        y={loc.mapY - 30}
                        textAnchor="middle"
                        fill="hsl(185 100% 80%)"
                        className="font-mono text-[17px] tracking-[0.08em] uppercase pointer-events-none"
                      >
                        {String(loc.name || "Location").slice(0, 24)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {loading && (
            <div className="text-center font-mono text-primary/30 text-sm tracking-widest uppercase animate-pulse">
              Loading composite atlas...
            </div>
          )}
        </div>

        {/* Location Details Sidebar */}
        <div className="w-80 border border-primary/30 bg-black/60 backdrop-blur-md flex flex-col rounded overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-primary/20">
            <div className="flex-1">
              <h2 className="font-mono text-primary text-sm tracking-[0.2em] uppercase">
                {selectedRegion
                  ? selectedRegion.name
                  : selectedLocation
                    ? `${categoryEmojis[selectedLocation.category] || categoryEmojis.other} ${selectedLocation.name}`
                    : "// Atlas Details"}
              </h2>
              <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest">
                {selectedRegion
                  ? selectedWorld?.label
                  : selectedLocation
                    ? `[${selectedLocation.category}] • ${selectedLocation.significance}`
                    : "Select a region or saved location"}
              </p>
            </div>
            {(selectedRegion || selectedLocation) && (
              <button
                onClick={() => setSelectedItem(null)}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto space-y-4 p-4">
            {!selectedRegion && !selectedLocation && (
              <>
                <div className="p-3 border border-primary/15 bg-primary/5 rounded space-y-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary/50" />
                    <p className="text-[9px] font-mono text-primary/50 tracking-widest uppercase">Atlas Population</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="border border-primary/10 bg-black/40 p-2">
                      <p className="font-mono text-lg text-primary">{atlas.totals.worlds}</p>
                      <p className="font-mono text-[8px] text-primary/35 uppercase">Worlds</p>
                    </div>
                    <div className="border border-primary/10 bg-black/40 p-2">
                      <p className="font-mono text-lg text-primary">{atlas.totals.characters}</p>
                      <p className="font-mono text-[8px] text-primary/35 uppercase">Chars</p>
                    </div>
                    <div className="border border-primary/10 bg-black/40 p-2">
                      <p className="font-mono text-lg text-primary">{atlas.totals.savedLocations}</p>
                      <p className="font-mono text-[8px] text-primary/35 uppercase">Pins</p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">Worlds on Map</p>
                  <div className="space-y-2">
                    {atlas.worlds.map((world) => (
                      <button
                        key={world.id}
                        onClick={() => {
                          setWorldFilter(world.id);
                          setSelectedItem({ type: "region", worldId: world.id, regionId: world.regions[0]?.id });
                        }}
                        className="w-full text-left p-3 border border-primary/15 bg-primary/5 hover:bg-primary/10 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: world.color }} />
                          <p className="font-mono text-[10px] text-primary/80 tracking-wider uppercase">{world.label}</p>
                        </div>
                        <p className="font-mono text-[9px] text-primary/45 mt-1 leading-relaxed">{world.summary}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {selectedRegion && (
              <>
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Region Brief</p>
                  <p className="text-xs font-mono text-primary/70 leading-relaxed">{selectedRegion.description}</p>
                </div>

                <div className="p-3 border border-primary/15 bg-primary/5 rounded">
                  <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">Source Universe</p>
                  <p className="text-[10px] font-mono text-primary/70">{selectedWorld.sourceUniverses.join(", ") || selectedWorld.name}</p>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-cyan-400/60" />
                    <p className="text-[9px] font-mono text-cyan-400/60 tracking-widest uppercase">
                      Characters ({selectedRegion.characters.length})
                    </p>
                  </div>
                  {selectedRegion.characters.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedRegion.characters.map((char) => (
                        <div key={char.id || `${selectedRegion.id}-${char.name}`} className="flex items-center gap-2 p-2 border border-cyan-400/15 bg-cyan-400/5">
                          {char.avatar_url ? (
                            <img src={char.avatar_url} alt={char.name} className="w-7 h-7 border border-cyan-400/20 object-cover" />
                          ) : (
                            <div className="w-7 h-7 border border-cyan-400/20 bg-cyan-400/10 flex items-center justify-center text-[9px] font-mono text-cyan-400/70">
                              {characterInitial(char)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-[10px] font-mono text-cyan-300/80 tracking-wider truncate">{char.name}</p>
                            <p className="text-[8px] font-mono text-cyan-200/35 tracking-widest uppercase truncate">{char.category || "character"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] font-mono text-primary/30 leading-relaxed">
                      No characters currently resolve to this region, but it remains on the atlas because the world is represented.
                    </p>
                  )}
                </div>
              </>
            )}

            {selectedLocation && (
              <>
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
              </>
            )}
          </div>

          {/* Footer Actions */}
          {selectedLocation ? (
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
          ) : (
            <div className="p-4 border-t border-primary/20 text-[9px] font-mono text-primary/35 leading-relaxed">
              <div className="flex items-start gap-2">
                <LocateFixed className="w-4 h-4 text-primary/40 flex-shrink-0 mt-0.5" />
                <p>Scroll the atlas to move across worlds. Zoom in for dense regions, then select a region to see which characters populate it.</p>
              </div>
            </div>
          )}
        </div>
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

              <div>
                <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Description</label>
                <textarea
                  value={formData.description || ""}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Location lore..."
                  rows={3}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none"
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